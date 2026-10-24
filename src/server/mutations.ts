import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import {
	type FileEntry,
	fileEntriesEqual,
	type PreparedFileChange,
	type PreparedRecordKeyResolver,
	snapshotFileEntry,
} from "../file-system/prepared-change.ts";
import { parseMilestone } from "../markdown/parser.ts";
import type { ProjectMutationContext } from "./index.ts";
import { type MutationIntent, MutationStore, type StoredRecord } from "./mutation-store.ts";
import type {
	HistoryEvent,
	HistoryRecordChange,
	MutationActor,
	MutationErrorBody,
	MutationErrorCode,
	MutationScope,
	OperationView,
	SafeHttpResult,
	WriteState,
} from "./mutation-types.ts";
import type { ObservedInventory, ScannedRecord } from "./observation.ts";
import { ObservationConflictError, ObservationStore } from "./observation-store.ts";
import type { ObservationState, ObservedPathSnapshot } from "./observation-types.ts";
import { assertProjectBoundary, readProjectFile } from "./project-paths.ts";

export interface ManagementAuditChange {
	kind: "user" | "membership" | "folder-area" | "project" | "agent-key";
	recordKey: string;
	visibleId: string;
	before: unknown | null;
	after: unknown | null;
}

/** Invoked inside the existing account/project SQLite write transaction. */
export type ManagementAuditHook = (
	database: Database,
	changes: ManagementAuditChange | ManagementAuditChange[],
	result: unknown,
) => void;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORED_HEADERS = ["content-type", "etag", "x-backlog-operation-id", "x-backlog-tasks-revision"];

export class MutationError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: MutationErrorCode,
		readonly details: Partial<MutationErrorBody> = {},
		readonly freezePublication = false,
	) {
		super(message);
		this.name = "MutationError";
	}

	response(): Response {
		return Response.json({ error: this.message, code: this.code, ...this.details } satisfies MutationErrorBody, {
			status: this.status,
		});
	}
}

/** Preserve the existing authorization response after a queued write loses access. */
export class MutationAbortResponse extends Error {
	readonly freezePublication = false;
	constructor(readonly response: Response) {
		super("Mutation authorization changed before durable intent.");
		this.name = "MutationAbortResponse";
	}
}

/** A short queue per project; no SQLite transaction is kept open while waiting. */
export class MutationQueue {
	private readonly tails = new Map<string, Promise<void>>();

	async run<T>(scope: string, action: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(scope);
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = (previous ?? Promise.resolve()).catch(() => {}).then(() => gate);
		this.tails.set(scope, tail);
		await previous?.catch(() => {});
		try {
			return await action();
		} finally {
			release();
			if (this.tails.get(scope) === tail) this.tails.delete(scope);
		}
	}
}

export function requireOperationId(request: Request): string {
	const operationId = request.headers.get("Idempotency-Key")?.trim() ?? "";
	if (!UUID.test(operationId)) {
		throw new MutationError("A UUID Idempotency-Key is required for this write.", 428, "PRECONDITION_REQUIRED");
	}
	return operationId;
}

/** An ETag changes with both content and lifecycle, including archive/restore. */
export function recordRevision(
	recordKey: string,
	recordPath: string,
	lifecycle: "active" | "draft" | "archived" | "deleted",
	bytes: Uint8Array,
): string {
	const hash = createHash("sha256")
		.update(recordKey)
		.update("\0")
		.update(recordPath)
		.update("\0")
		.update(lifecycle)
		.update("\0")
		.update(bytes)
		.digest("hex");
	return `"r1-${hash}"`;
}

export function taskCollectionRevision(records: readonly { recordKey: string; revision: string }[]): string {
	const hash = createHash("sha256");
	for (const record of [...records].sort((a, b) => a.recordKey.localeCompare(b.recordKey))) {
		hash.update(record.recordKey).update("\0").update(record.revision).update("\0");
	}
	return `"c1-${hash.digest("hex")}"`;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function managementRevision(value: unknown): string {
	return `"m1-${createHash("sha256").update(stableJson(value)).digest("hex")}"`;
}

export function versionedManagement<T extends object>(
	recordKey: string,
	value: T,
): T & { recordKey: string; revision: string } {
	return { ...value, recordKey, revision: managementRevision(value) };
}

export function managementAudit(
	store: MutationStore,
	options: {
		operationId: string;
		scope: MutationScope;
		actor: MutationActor;
		source: "browser" | "server-cli";
		requestHash: string;
		action: string;
		status?: number;
		forceEvent?: boolean;
		requireRevision?: boolean;
		expectedRevision?: string | null;
		resultBody?: (result: unknown) => unknown;
	},
): ManagementAuditHook {
	return (database, changed, result) => {
		const changes = Array.isArray(changed) ? changed : [changed];
		if (options.requireRevision) {
			const current = changes.find((change) => change.before !== null);
			if (current) {
				if (!options.expectedRevision)
					throw new MutationError("A current record revision is required.", 428, "PRECONDITION_REQUIRED", {
						recordKey: current.recordKey,
					});
				const actual = managementRevision(current.before);
				if (actual !== options.expectedRevision)
					throw new MutationError("The record has changed since it was opened.", 409, "REVISION_CONFLICT", {
						recordKey: current.recordKey,
						expectedRevision: options.expectedRevision,
						currentRevision: actual,
					});
			} else if (options.expectedRevision) {
				throw new MutationError("The record no longer exists.", 409, "REVISION_CONFLICT");
			}
		}
		const meaningful = changes.filter(
			(change) => options.forceEvent || stableJson(change.before) !== stableJson(change.after),
		);
		const event: HistoryEvent | null = meaningful.length
			? {
					eventId: options.operationId,
					operationId: options.operationId,
					scope: options.scope,
					source: options.source,
					actor: options.actor,
					action: options.action,
					occurredAt: new Date().toISOString(),
					changes: meaningful.map((change) => ({
						recordKey: change.recordKey,
						kind: change.kind,
						visibleId: change.visibleId,
						beforeRevision: change.before === null ? null : managementRevision(change.before),
						afterRevision: change.after === null ? null : managementRevision(change.after),
						before: change.before,
						after: change.after,
					})),
				}
			: null;
		const after = changes.find((change) => change.after !== null);
		const resultBody = options.resultBody
			? options.resultBody(result)
			: after && result !== null && typeof result === "object"
				? versionedManagement(after.recordKey, result)
				: (result ?? { success: true });
		store.appendAuditInTransaction(database, {
			operationId: options.operationId,
			scope: options.scope,
			actor: options.actor,
			source: options.source,
			requestHash: options.requestHash,
			action: options.action,
			files: [],
			recordUpdates: [],
			plannedResult: {
				status: options.status ?? 200,
				body: resultBody,
				headers: { "content-type": "application/json", "x-backlog-operation-id": options.operationId },
			},
			plannedEvent: event,
		});
	};
}

/** Hash only the semantic request, never a cookie, CSRF token, or authorization header. */
export async function requestHash(request: Request): Promise<string> {
	const url = new URL(request.url);
	url.searchParams.sort();
	const route = `${url.pathname}${url.search}`;
	const rawBody = new Uint8Array(await request.clone().arrayBuffer());
	let body: string | Uint8Array = rawBody;
	if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json") {
		try {
			body = stableJson(JSON.parse(new TextDecoder().decode(rawBody)));
		} catch {
			// Validation will reject malformed JSON; hash its exact bytes until then.
		}
	}
	return createHash("sha256")
		.update(request.method.toUpperCase())
		.update("\0")
		.update(route)
		.update("\0")
		.update(request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "")
		.update("\0")
		.update(request.headers.get("if-match") ?? "")
		.update("\0")
		.update(body)
		.digest("hex");
}

/** Preserve the response contract without storing Set-Cookie or other secret headers. */
export async function safeResult(response: Response): Promise<SafeHttpResult> {
	const headers: Record<string, string> = {};
	for (const key of STORED_HEADERS) {
		const value = response.headers.get(key);
		if (value !== null) headers[key] = value;
	}
	const rawBody = await response.clone().text();
	let body: unknown = rawBody;
	if (headers["content-type"]?.includes("application/json")) {
		try {
			body = JSON.parse(rawBody);
		} catch {
			throw new Error("A central mutation cannot store an invalid JSON response.");
		}
	}
	return { status: response.status, body, headers };
}

export function responseFromResult(result: SafeHttpResult): Response {
	const headers = new Headers(result.headers);
	const contentType = headers.get("content-type") ?? "";
	const body =
		result.body === null || result.body === undefined
			? null
			: contentType.includes("application/json")
				? JSON.stringify(result.body)
				: String(result.body);
	return new Response(body, { status: result.status, headers });
}

export interface CentralProject {
	id: string;
	rootPath: string;
	tracking: boolean;
}

export interface CentralRecordSnapshot {
	kind: StoredRecord["kind"];
	visibleId: string;
	lifecycle: "active" | "draft" | "archived";
	recordPath: string;
	entry: FileEntry;
	bytes: Uint8Array;
}

export interface ObservationHooks {
	publish: (entries: readonly ObservedPathSnapshot[]) => Promise<void>;
	needsPublication?: () => boolean;
	onState?: (state: ObservationState) => void;
	onPublicationFailure?: () => Promise<void>;
	watchDirectory?: string;
}

type ObservationScan = (
	previousPaths: readonly string[],
	previousEntries?: readonly ObservedPathSnapshot[],
) => Promise<ObservedInventory>;

const OBSERVATION_PERIOD_MS = 30_000;

interface TrackedObservation {
	project: CentralProject;
	scan: ObservationScan;
	hooks: ObservationHooks;
	watchDirectory: string;
	watchers: FSWatcher[];
	interval: ReturnType<typeof setInterval>;
	debounce?: ReturnType<typeof setTimeout>;
	running?: Promise<void>;
	repeat?: boolean;
}

export type MutationCheckpoint = (
	stage: "before_intent" | "after_intent" | "after_file" | "before_finalize" | "after_finalize",
	operationId: string,
	fileIndex?: number,
) => void | Promise<void>;

export interface ManagementMutationContext {
	operationId: string;
	audit(
		action: string,
		options?: {
			status?: number;
			forceEvent?: boolean;
			requireRevision?: boolean;
			resultBody?: (result: unknown) => unknown;
		},
	): ManagementAuditHook;
}

type ObservedFiles = "before" | "after" | "mixed";

async function observedFiles(rootPath: string, files: readonly PreparedFileChange[]): Promise<ObservedFiles> {
	try {
		assertProjectBoundary(
			rootPath,
			files.map((file) => file.path),
		);
		let allBefore = true;
		let allAfter = true;
		for (const file of files) {
			const observed = await snapshotFileEntry(file.path);
			allBefore &&= fileEntriesEqual(observed, file.before);
			allAfter &&= fileEntriesEqual(observed, file.after);
		}
		if (allAfter) return "after";
		if (allBefore) return "before";
	} catch {
		// An unreadable or unsafe path requires explicit recovery inspection.
	}
	return "mixed";
}

function afterContent(rootPath: string, file: PreparedFileChange, all: readonly PreparedFileChange[]): Uint8Array {
	const entry = file.after;
	if (!entry) throw new Error("A deleted record has no after content.");
	if (entry.type === "file") return entry.bytes;
	const referent = resolve(dirname(file.path), entry.target);
	const staged = all.find((candidate) => candidate.path === referent)?.after;
	if (staged?.type === "file") return staged.bytes;
	return readProjectFile(rootPath, referent);
}

function plannedRecordChanges(
	store: MutationStore,
	projectId: string,
	rootPath: string,
	files: readonly PreparedFileChange[],
): { records: StoredRecord[]; changes: HistoryRecordChange[] } {
	const grouped = new Map<string, PreparedFileChange[]>();
	for (const file of files) {
		const recordKey = file.record.recordKey;
		if (!recordKey) throw new Error("Prepared record has no stable record key.");
		const group = grouped.get(recordKey) ?? [];
		group.push(file);
		grouped.set(recordKey, group);
	}
	const records: StoredRecord[] = [];
	const changes: HistoryRecordChange[] = [];
	for (const [recordKey, effects] of grouped) {
		const prior = store.loadRecord(projectId, recordKey);
		const after = effects.find((effect) => effect.after !== null);
		const representative = after ?? effects[0];
		if (!representative) continue;
		const kind = representative.record.kind;
		const visibleId = representative.record.visibleId;
		const path = after ? (after.record.recordPath ?? after.path) : null;
		const lifecycle = after ? after.record.lifecycle : "deleted";
		const beforeBytes = prior?.path ? readProjectFile(rootPath, prior.path) : null;
		const afterBytes = after ? afterContent(rootPath, after, files) : null;
		const revision = path && afterBytes ? recordRevision(recordKey, path, lifecycle, afterBytes) : null;
		records.push({ recordKey, projectId, kind, visibleId, path, lifecycle, revision });
		changes.push({
			recordKey,
			kind,
			visibleId,
			beforeRevision:
				prior?.path && beforeBytes ? recordRevision(recordKey, prior.path, prior.lifecycle, beforeBytes) : null,
			afterRevision: revision,
			before: beforeBytes ? Buffer.from(beforeBytes).toString("utf8") : null,
			after: afterBytes ? Buffer.from(afterBytes).toString("utf8") : null,
		});
	}
	return { records, changes };
}

function existingResult(operation: OperationView): Response {
	if (operation.state === "completed" && operation.result) return responseFromResult(operation.result);
	if (operation.resolvedBy)
		throw new MutationError(
			"This interrupted operation was resolved separately. Review the current data before another change.",
			409,
			"OPERATION_RESOLVED",
			{
				operationId: operation.operationId,
				resolvedBy: operation.resolvedBy,
			},
		);
	if (operation.state === "pending")
		throw new MutationError("The operation is still running.", 409, "OPERATION_IN_PROGRESS", {
			operationId: operation.operationId,
		});
	if (operation.state === "not_applied")
		throw new MutationError("The operation was not applied.", 409, "OPERATION_NOT_APPLIED", {
			operationId: operation.operationId,
		});
	throw new MutationError("Project recovery is required before another write.", 503, "RECOVERY_REQUIRED", {
		operationId: operation.operationId,
	});
}

function physicalIdentity(entry: {
	kind: string;
	visibleId: string;
	identity: ObservedPathSnapshot["identity"];
}): string | null {
	const id = entry.identity;
	return id ? `${entry.kind}\0${entry.visibleId.toLowerCase()}\0${id.dev}\0${id.ino}\0${id.birthtimeNs}` : null;
}

function observedRevision(entry: ObservedPathSnapshot): string {
	return recordRevision(entry.recordKey, entry.path, entry.lifecycle, entry.recordBytes);
}

function observedText(entry: ObservedPathSnapshot): string {
	return Buffer.from(entry.recordBytes).toString("utf8");
}

function changedObservedRecord(
	before: ObservedPathSnapshot | undefined,
	after: ObservedPathSnapshot | undefined,
): boolean {
	if (!before || !after) return true;
	return (
		before.path !== after.path ||
		before.kind !== after.kind ||
		before.visibleId !== after.visibleId ||
		before.lifecycle !== after.lifecycle ||
		!fileEntriesEqual(before.entry, after.entry) ||
		observedRevision(before) !== observedRevision(after)
	);
}

function inventoryMatchesCheckpoint(
	current: readonly ScannedRecord[],
	stored: readonly ObservedPathSnapshot[],
): boolean {
	return (
		current.length === stored.length &&
		current.every((entry, index) => {
			const before = stored[index];
			return Boolean(
				before &&
					before.path === entry.path &&
					before.kind === entry.kind &&
					before.visibleId === entry.visibleId &&
					before.lifecycle === entry.lifecycle &&
					fileEntriesEqual(before.entry, entry.entry) &&
					Buffer.from(before.recordBytes).equals(Buffer.from(entry.recordBytes)) &&
					JSON.stringify(before.identity) === JSON.stringify(entry.identity),
			);
		})
	);
}

export class CentralMutations {
	readonly store: MutationStore;
	readonly observations: ObservationStore;
	private readonly queue = new MutationQueue();
	private readonly blocked = new Map<string, string | null>();
	private readonly resolved = new Set<string>();
	private readonly observationEnabled = new Set<string>();
	private readonly observedProjects = new Map<string, TrackedObservation>();
	private readonly activeObservations = new Map<string, Set<Promise<unknown>>>();

	constructor(
		dataDirectory: string,
		private readonly project: (id: string) => CentralProject | null,
		private readonly checkpoint?: MutationCheckpoint,
	) {
		this.store = new MutationStore(dataDirectory);
		this.observations = new ObservationStore(dataDirectory);
	}

	observationState(projectId: string): ObservationState {
		return this.observations.load(projectId).state;
	}

	private buildObservationCommit(
		projectId: string,
		inventory: ObservedInventory,
		prior: readonly ObservedPathSnapshot[],
		baseline: boolean,
		checkedAt: string,
	): {
		entries: ObservedPathSnapshot[];
		recordUpdates: StoredRecord[];
		event: HistoryEvent | null;
	} {
		const priorByPath = new Map(prior.map((entry) => [entry.path, entry]));
		const currentPaths = new Set(inventory.entries.map((entry) => entry.path));
		const vanishedByIdentity = new Map<string, ObservedPathSnapshot[]>();
		const arrivedByIdentity = new Map<string, ScannedRecord[]>();
		if (!baseline) {
			for (const old of prior) {
				if (currentPaths.has(old.path)) continue;
				const key = physicalIdentity(old);
				if (key) vanishedByIdentity.set(key, [...(vanishedByIdentity.get(key) ?? []), old]);
			}
			for (const current of inventory.entries) {
				if (priorByPath.has(current.path)) continue;
				const key = physicalIdentity(current);
				if (key) arrivedByIdentity.set(key, [...(arrivedByIdentity.get(key) ?? []), current]);
			}
		}
		const entries = inventory.entries.map((current) => {
			const old = priorByPath.get(current.path);
			let recordKey =
				old?.kind === current.kind && old.visibleId.toLowerCase() === current.visibleId.toLowerCase()
					? old.recordKey
					: undefined;
			if (!recordKey && !baseline) {
				const identity = physicalIdentity(current);
				const former = identity ? vanishedByIdentity.get(identity) : undefined;
				if (former?.length === 1 && arrivedByIdentity.get(identity as string)?.length === 1)
					recordKey = former[0]?.recordKey;
			}
			if (!recordKey && baseline) {
				const existing = this.store.findRecordByPath(projectId, current.path);
				if (existing?.kind === current.kind && existing.visibleId.toLowerCase() === current.visibleId.toLowerCase())
					recordKey = existing.recordKey;
			}
			return { ...current, recordKey: recordKey ?? randomUUID() } satisfies ObservedPathSnapshot;
		});
		const nextByKey = new Map(entries.map((entry) => [entry.recordKey, entry]));
		const oldByKey = new Map(prior.map((entry) => [entry.recordKey, entry]));
		const recordUpdates: StoredRecord[] = [];
		const changes: HistoryRecordChange[] = [];
		for (const key of new Set([...oldByKey.keys(), ...nextByKey.keys()])) {
			const before = oldByKey.get(key);
			const after = nextByKey.get(key);
			if (!baseline && !changedObservedRecord(before, after)) continue;
			if (after) {
				recordUpdates.push({
					recordKey: key,
					projectId,
					kind: after.kind,
					visibleId: after.visibleId,
					path: after.path,
					lifecycle: after.lifecycle,
					revision: observedRevision(after),
				});
			} else if (before) {
				recordUpdates.push({
					recordKey: key,
					projectId,
					kind: before.kind,
					visibleId: before.visibleId,
					path: null,
					lifecycle: "deleted",
					revision: null,
				});
			}
			if (baseline) continue;
			const record = after ?? before;
			if (!record) continue;
			changes.push({
				recordKey: key,
				kind: record.kind,
				visibleId: record.visibleId,
				beforeRevision: before ? observedRevision(before) : null,
				afterRevision: after ? observedRevision(after) : null,
				before: before ? observedText(before) : null,
				after: after ? observedText(after) : null,
			});
		}
		if (baseline) {
			for (const existing of this.store.listRecords(projectId)) {
				if (existing.lifecycle === "deleted" || nextByKey.has(existing.recordKey)) continue;
				recordUpdates.push({ ...existing, path: null, lifecycle: "deleted", revision: null });
			}
		}
		const operationId = randomUUID();
		const event: HistoryEvent | null = changes.length
			? {
					eventId: operationId,
					operationId,
					scope: { kind: "project", projectId },
					source: "external",
					actor: { kind: "unknown" },
					action: "external_file_change",
					occurredAt: null,
					detectedAt: checkedAt,
					changes,
				}
			: null;
		return { entries, recordUpdates, event };
	}

	async ensureObserved(
		project: CentralProject,
		scan: ObservationScan,
		hooks?: ObservationHooks,
	): Promise<ObservationState> {
		return await this.reconcileObserved(project, scan, hooks);
	}

	async reconcileObserved(
		project: CentralProject,
		scan: ObservationScan,
		hooks?: ObservationHooks,
	): Promise<ObservationState> {
		this.observationEnabled.add(project.id);
		const pending = this.queue.run(`project:${project.id}`, async () => {
			let prior = this.observations.load(project.id);
			if (this.project(project.id)?.tracking !== true) return prior.state;
			if (this.writeState(project.id).writeState === "recovery_required") return prior.state;
			if (hooks?.needsPublication?.() && prior.state.lastSuccessfulScanAt !== null) {
				try {
					await hooks.publish(prior.entries);
				} catch (error) {
					if (hooks.onPublicationFailure) await hooks.onPublicationFailure();
					throw error;
				}
			}
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const previousState = prior.state;
					let inventory: ObservedInventory;
					try {
						inventory = await scan(
							prior.entries.map((entry) => entry.path),
							prior.entries,
						);
					} catch (error) {
						inventory = {
							entries: [],
							missing: [],
							fingerprint: "",
							problems: [{ path: project.rootPath, state: "unreadable", error: String(error) }],
						};
					}
					const checkedAt = new Date().toISOString();
					if (this.project(project.id)?.tracking !== true) return this.observations.load(project.id).state;
					if (inventory.problems.length) {
						const first = inventory.problems[0];
						const displayPath = first ? relative(project.rootPath, first.path) : "";
						const degraded = this.observations.markDegraded(project.id, {
							expectedFingerprint: prior.fingerprint,
							checkedAt,
							error: `${first?.state ?? "unreadable"}: ${displayPath && !displayPath.startsWith("..") ? displayPath : "project files"}`,
						});
						if (previousState.state !== "degraded") hooks?.onState?.(degraded.state);
						return degraded.state;
					}
					const baseline = prior.state.lastSuccessfulScanAt === null;
					if (
						!baseline &&
						previousState.state === "ready" &&
						inventoryMatchesCheckpoint(inventory.entries, prior.entries)
					) {
						const lastChecked = prior.state.checkedAt ? Date.parse(prior.state.checkedAt) : 0;
						const elapsed = Date.now() - lastChecked;
						if (elapsed >= 0 && elapsed < OBSERVATION_PERIOD_MS) return prior.state;
						return this.observations.confirmUnchanged(project.id, {
							expectedFingerprint: prior.fingerprint,
							checkedAt,
						}).state;
					}
					const prepared = this.buildObservationCommit(project.id, inventory, prior.entries, baseline, checkedAt);
					const committed = this.observations.commit(project.id, {
						...prepared,
						expectedFingerprint: prior.fingerprint,
						checkedAt,
					});
					if (hooks && (baseline || prepared.event || previousState.state !== "ready")) {
						try {
							await hooks.publish(committed.entries);
						} catch (error) {
							if (hooks.onPublicationFailure) await hooks.onPublicationFailure();
							else throw error;
						}
					}
					if (previousState.state !== "ready") hooks?.onState?.(committed.state);
					return committed.state;
				} catch (error) {
					if (!(error instanceof ObservationConflictError)) throw error;
					if (this.project(project.id)?.tracking !== true) return this.observations.load(project.id).state;
					prior = this.observations.load(project.id);
				}
			}
			throw new ObservationConflictError();
		});
		let active = this.activeObservations.get(project.id);
		if (!active) {
			active = new Set();
			this.activeObservations.set(project.id, active);
		}
		active.add(pending);
		try {
			return await pending;
		} finally {
			active.delete(pending);
			if (active.size === 0) this.activeObservations.delete(project.id);
		}
	}

	setObservationTracking(project: CentralProject, scan: ObservationScan, hooks: ObservationHooks): void {
		const watchDirectory = hooks.watchDirectory ?? resolve(project.rootPath, "backlog");
		const current = this.observedProjects.get(project.id);
		if (
			current?.project.rootPath === project.rootPath &&
			current.watchDirectory === watchDirectory &&
			current.watchers.length >= 2
		) {
			current.project = project;
			current.scan = scan;
			current.hooks = hooks;
			return;
		}
		this.stopTrackingProject(project.id);
		this.observationEnabled.add(project.id);
		const watchers: FSWatcher[] = [];
		const schedule = () => {
			const tracked = this.observedProjects.get(project.id);
			if (!tracked) return;
			if (tracked.debounce) clearTimeout(tracked.debounce);
			tracked.debounce = setTimeout(() => this.runTrackedObservation(tracked), 150);
			tracked.debounce.unref?.();
		};
		try {
			const watcher = watch(project.rootPath, { recursive: false }, (_event, filename) => {
				const name = filename?.toString();
				if (!name || [basename(watchDirectory), "backlog.config.yml", "backlog", ".backlog"].includes(name)) schedule();
			});
			watcher.on("error", schedule);
			watcher.unref?.();
			watchers.push(watcher);
		} catch {
			// The periodic scan remains active if the root cannot be watched.
		}
		try {
			const watcher = watch(watchDirectory, { recursive: true }, (_event, filename) => {
				if (
					filename
						?.toString()
						.split(/[\\/]/)
						.some((part) => part.startsWith("."))
				)
					return;
				schedule();
			});
			watcher.on("error", schedule);
			watcher.unref?.();
			watchers.push(watcher);
		} catch {
			try {
				const watcher = watch(watchDirectory, (_event, filename) => {
					if (
						filename
							?.toString()
							.split(/[\\/]/)
							.some((part) => part.startsWith("."))
					)
						return;
					schedule();
				});
				watcher.on("error", schedule);
				watcher.unref?.();
				watchers.push(watcher);
			} catch {
				// The root watcher and periodic scan cover replacement or missing folders.
			}
		}
		const interval = setInterval(() => {
			const tracked = this.observedProjects.get(project.id);
			if (tracked) this.runTrackedObservation(tracked);
		}, OBSERVATION_PERIOD_MS);
		interval.unref?.();
		this.observedProjects.set(project.id, { project, scan, hooks, watchDirectory, watchers, interval });
	}

	private runTrackedObservation(tracked: TrackedObservation): void {
		if (tracked.running) {
			tracked.repeat = true;
			return;
		}
		const running = (async () => {
			do {
				tracked.repeat = false;
				await this.reconcileObserved(tracked.project, tracked.scan, tracked.hooks).catch(() => {});
			} while (tracked.repeat && this.observedProjects.get(tracked.project.id) === tracked);
		})();
		tracked.running = running;
		void running.finally(() => {
			if (tracked.running === running) tracked.running = undefined;
		});
	}

	private stopTrackingProject(projectId: string): void {
		const tracked = this.observedProjects.get(projectId);
		if (!tracked) return;
		this.observedProjects.delete(projectId);
		if (tracked.debounce) clearTimeout(tracked.debounce);
		clearInterval(tracked.interval);
		for (const watcher of tracked.watchers) watcher.close();
	}

	async stopObservationTracking(projectId: string): Promise<void> {
		this.stopTrackingProject(projectId);
		this.observationEnabled.delete(projectId);
		await Promise.allSettled([...(this.activeObservations.get(projectId) ?? [])]);
	}

	async stopObservation(): Promise<void> {
		for (const projectId of this.observedProjects.keys()) this.stopTrackingProject(projectId);
		await Promise.allSettled([...this.activeObservations.values()].flatMap((pending) => [...pending]));
	}

	writeState(projectId: string): { writeState: WriteState; pendingOperationId?: string } {
		let pendingOperationId = this.blocked.get(projectId);
		if (
			pendingOperationId &&
			!this.store.listRecoveryRequired(projectId).some((operation) => operation.operationId === pendingOperationId) &&
			!this.store.listPending().some((operation) => operation.operationId === pendingOperationId)
		) {
			this.blocked.delete(projectId);
			this.resolved.add(projectId);
			pendingOperationId = undefined;
		}
		if (!this.blocked.has(projectId)) return { writeState: "ready" };
		return pendingOperationId
			? { writeState: "recovery_required", pendingOperationId }
			: { writeState: "recovery_required" };
	}

	consumeResolved(projectId: string): boolean {
		return this.resolved.delete(projectId);
	}

	async runRead(
		projectId: string,
		revalidate: () => Response | null | Promise<Response | null>,
		read: () => Promise<Response>,
	): Promise<Response> {
		return this.queue.run(`project:${projectId}`, async () => (await revalidate()) ?? (await read()));
	}

	blockProject(projectId: string): void {
		this.blocked.set(projectId, null);
	}

	/** Resolve a whole read against one validated checkpoint, indexed by path. */
	recordKeysFor(
		projectId: string,
	): (...args: Parameters<NonNullable<ProjectMutationContext["recordKeyFor"]>>) => string | undefined {
		const checkpoint = this.observations.load(projectId);
		const paths = new Map(checkpoint.entries.map((entry) => [entry.path, entry]));
		return (kind, visibleId, recordPath, observed) => {
			if (checkpoint.state.lastSuccessfulScanAt !== null) {
				const match = paths.get(recordPath);
				if (match?.kind !== kind || match.visibleId !== visibleId) return undefined;
				if (
					observed &&
					(match.lifecycle !== observed.lifecycle ||
						!Buffer.from(match.recordBytes).equals(Buffer.from(observed.bytes)))
				)
					return undefined;
				return match.recordKey;
			}
			const matches = this.store.findRecords(projectId, kind, visibleId).filter((record) => record.path === recordPath);
			if (matches.length > 1) throw new MutationError("Record identity is ambiguous.", 409, "AMBIGUOUS_ID");
			return matches[0]?.recordKey;
		};
	}

	private async assertPreconditions(
		request: Request,
		payload: Record<string, unknown> | null,
		projectId: string,
		snapshot: () => Promise<CentralRecordSnapshot[]>,
	): Promise<void> {
		const path = new URL(request.url).pathname.replace(/^\/api\/projects\/[^/]+\//, "");
		if (path === "tasks/duplicates") return;
		const bulk = path === "tasks/move" || path === "tasks/reorder";
		const target = path.match(
			/^(tasks|task|drafts|docs|decisions|milestones)\/([^/]+)(?:\/(archive|restore|demote|promote|reviews\/(?:request|verify|respond|cancel)))?$/,
		);
		if (!bulk && !target && path !== "config") return;
		const snapshots = await snapshot();
		const recordKeyFor = this.recordKeysFor(projectId);
		const version = (current: CentralRecordSnapshot) => {
			const recordKey = recordKeyFor(current.kind, current.visibleId, current.recordPath, current);
			if (!recordKey)
				throw new MutationError("Record identity requires recovery inspection.", 503, "RECOVERY_REQUIRED");
			return { recordKey, revision: recordRevision(recordKey, current.recordPath, current.lifecycle, current.bytes) };
		};
		const check = (current: CentralRecordSnapshot, expected: unknown) => {
			const actual = version(current);
			if (typeof expected !== "string" || !expected)
				throw new MutationError("A current record revision is required.", 428, "PRECONDITION_REQUIRED", {
					recordKey: actual.recordKey,
				});
			if (expected !== actual.revision)
				throw new MutationError("The record has changed since it was opened.", 409, "REVISION_CONFLICT", {
					recordKey: actual.recordKey,
					expectedRevision: expected,
					currentRevision: actual.revision,
				});
		};
		if (bulk) {
			if (path === "tasks/reorder") {
				const expected = request.headers.get("if-match");
				if (!expected)
					throw new MutationError("A current task collection revision is required.", 428, "PRECONDITION_REQUIRED");
				const actual = taskCollectionRevision(
					snapshots.filter((record) => record.kind === "task" && record.lifecycle === "active").map(version),
				);
				if (expected !== actual)
					throw new MutationError("The task collection has changed.", 409, "REVISION_CONFLICT", {
						expectedRevision: expected,
						currentRevision: actual,
					});
			}
			const expected = payload?.expectedRevisions;
			if (!expected || typeof expected !== "object" || Array.isArray(expected))
				throw new MutationError("Expected record revisions are required.", 428, "PRECONDITION_REQUIRED");
			const ids =
				path === "tasks/move"
					? payload?.taskIds
					: [payload?.taskId, ...(Array.isArray(payload?.orderedTaskIds) ? payload.orderedTaskIds : [])];
			if (!Array.isArray(ids)) return;
			for (const id of new Set(ids.filter((value): value is string => typeof value === "string"))) {
				const matches = snapshots.filter(
					(record) =>
						record.kind === "task" &&
						record.lifecycle === "active" &&
						record.visibleId.toLowerCase() === id.toLowerCase(),
				);
				// Existing bulk handlers report missing/ambiguous IDs as partial failures.
				if (matches.length !== 1) continue;
				const current = matches[0];
				if (current) check(current, (expected as Record<string, unknown>)[version(current).recordKey]);
			}
			return;
		}
		const kind =
			path === "config"
				? "config"
				: target?.[1] === "docs"
					? "document"
					: target?.[1] === "decisions"
						? "decision"
						: target?.[1] === "milestones"
							? "milestone"
							: "task";
		const id = path === "config" ? "config" : decodeURIComponent(target?.[2] ?? "");
		const matches = snapshots.filter((record) => {
			if (record.kind !== kind) return false;
			if (kind !== "milestone") return record.visibleId.toLowerCase() === id.toLowerCase();
			if (record.lifecycle !== "active") return false;
			const milestone = parseMilestone(new TextDecoder("utf-8", { fatal: true }).decode(record.bytes));
			return [milestone.id, milestone.title, milestone.id.replace(/^m-/i, "")].some(
				(alias) => alias.toLowerCase() === id.trim().toLowerCase(),
			);
		});
		if (matches.length > 1) throw new MutationError("Record identity is ambiguous.", 409, "AMBIGUOUS_ID");
		if (!matches[0]) throw new MutationError("The record no longer exists.", 409, "REVISION_CONFLICT");
		check(matches[0], request.headers.get("if-match"));
	}

	/** Settle durable intent before the first HTTP write can be accepted. */
	async recoverPending(): Promise<void> {
		this.blocked.clear();
		this.resolved.clear();
		for (const operation of this.store.listRecoveryRequired()) {
			if (operation.scope.kind === "project") this.blocked.set(operation.scope.projectId, operation.operationId);
		}
		for (const operation of this.store.listPending()) {
			if (operation.scope.kind !== "project") {
				this.store.requireRecovery(operation.operationId, "A non-project operation was left pending.");
				continue;
			}
			const projectId = operation.scope.projectId;
			const project = this.project(projectId);
			const observed = project ? await observedFiles(project.rootPath, operation.files) : "mixed";
			if (observed === "after") this.store.finalize(operation.operationId);
			else if (observed === "before") this.store.markNotApplied(operation.operationId);
			else {
				this.store.requireRecovery(operation.operationId);
				this.blocked.set(projectId, operation.operationId);
			}
		}
	}

	/** One inventory event for an existing Markdown project, including an empty one. */
	async ensureBaseline(project: CentralProject, snapshot: () => Promise<CentralRecordSnapshot[]>): Promise<void> {
		if (this.store.hasBaseline(project.id) || this.blocked.has(project.id)) return;
		await this.queue.run(`project:${project.id}`, async () => {
			if (this.store.hasBaseline(project.id)) return;
			const snapshots = await snapshot();
			const seen = new Set<string>();
			const records: StoredRecord[] = [];
			const changes: HistoryRecordChange[] = [];
			for (const current of snapshots) {
				const identity = current.recordPath;
				if (seen.has(identity)) throw new Error("Baseline contains the same physical record twice.");
				seen.add(identity);
				const recordKey = randomUUID();
				const revision = recordRevision(recordKey, current.recordPath, current.lifecycle, current.bytes);
				records.push({
					recordKey,
					projectId: project.id,
					kind: current.kind,
					visibleId: current.visibleId,
					path: current.recordPath,
					lifecycle: current.lifecycle,
					revision,
				});
				changes.push({
					recordKey,
					kind: current.kind,
					visibleId: current.visibleId,
					beforeRevision: null,
					afterRevision: revision,
					before: null,
					after: Buffer.from(current.bytes).toString("utf8"),
				});
			}
			const operationId = randomUUID();
			const scope: MutationScope = { kind: "project", projectId: project.id };
			const event: HistoryEvent = {
				eventId: operationId,
				operationId,
				scope,
				source: "baseline",
				actor: { kind: "unknown" },
				action: "initial_inventory",
				occurredAt: new Date().toISOString(),
				changes,
			};
			this.store.begin({
				operationId,
				scope,
				actor: { kind: "unknown" },
				source: "baseline",
				requestHash: createHash("sha256").update(`baseline\0${project.id}`).digest("hex"),
				action: "initial_inventory",
				files: [],
				recordUpdates: records,
				plannedResult: {
					status: 200,
					body: { records: records.length },
					headers: { "content-type": "application/json" },
				},
				plannedEvent: event,
			});
			this.store.finalize(operationId);
		});
	}

	async runProject(
		request: Request,
		project: CentralProject,
		actor: MutationActor,
		revalidateRead: () => Response | null | Promise<Response | null>,
		dispatch: (context: ProjectMutationContext) => Promise<Response>,
		snapshot: () => Promise<CentralRecordSnapshot[]>,
		onPublicationFailure?: () => Promise<void>,
	): Promise<Response> {
		return this.queue.run(`project:${project.id}`, async () => {
			const denied = await revalidateRead();
			if (denied) return denied;
			const recovery = this.writeState(project.id);
			if (recovery.writeState === "recovery_required") {
				throw new MutationError("Project recovery is required before another write.", 503, "RECOVERY_REQUIRED", {
					operationId: recovery.pendingOperationId,
				});
			}
			if (this.observationEnabled.has(project.id) && this.observationState(project.id).state !== "ready") {
				throw new MutationError(
					"Project file observation is incomplete. Writes will resume after a safe scan.",
					503,
					"OBSERVATION_UNAVAILABLE",
				);
			}
			const operationId = requireOperationId(request);
			const hash = await requestHash(request);
			let payload: Record<string, unknown> | null = null;
			if (request.headers.get("content-type")?.includes("application/json")) {
				const value: unknown = await request
					.clone()
					.json()
					.catch(() => null);
				if (value && typeof value === "object" && !Array.isArray(value)) payload = value as Record<string, unknown>;
			}
			const scope: MutationScope = { kind: "project", projectId: project.id };
			const replay = this.store.checkReplay(operationId, { scope, actor, requestHash: hash });
			if (replay) return (await revalidateRead()) ?? existingResult(replay);
			const keys = new Map<string, string>();
			const resolveRecordKey: PreparedRecordKeyResolver = async ({
				kind,
				visibleId,
				recordPath,
				transitionFromPath,
			}) => {
				const cacheKey = `${kind}\0${visibleId}\0${recordPath}`;
				const transitioned = transitionFromPath ? this.store.findRecordByPath(project.id, transitionFromPath) : null;
				if (transitioned) {
					keys.set(cacheKey, transitioned.recordKey);
					return transitioned.recordKey;
				}
				const cached = keys.get(cacheKey);
				if (cached) return cached;
				const matches = this.store.findRecords(project.id, kind, visibleId);
				const exact = matches.find((record) => record.path === recordPath);
				if (matches.length > 1 && !exact) throw new MutationError("Record identity is ambiguous.", 409, "AMBIGUOUS_ID");
				const recordKey =
					exact?.recordKey ?? (matches.length === 1 ? matches[0]?.recordKey : undefined) ?? randomUUID();
				keys.set(cacheKey, recordKey);
				return recordKey;
			};
			let committed = false;
			const context: ProjectMutationContext = {
				resolveRecordKey,
				recordKeyFor: this.recordKeysFor(project.id),
				commit: async (mutation, apply, publish, revalidateWrite) => {
					const revoked = revalidateWrite();
					if (revoked) throw new MutationAbortResponse(revoked);
					await this.assertPreconditions(request, payload, project.id, snapshot);
					mutation.response.headers.set("X-Backlog-Operation-Id", operationId);
					const plannedResult = await safeResult(mutation.response);
					const files = mutation.files.filter((file) => !fileEntriesEqual(file.before, file.after));
					const { records, changes } = plannedRecordChanges(this.store, project.id, project.rootPath, files);
					const plannedEvent: HistoryEvent | null = changes.length
						? {
								eventId: operationId,
								operationId,
								scope,
								source:
									actor.kind === "agent"
										? "agent"
										: request.headers.get("X-Backlog-Client") === "cli"
											? "server-cli"
											: "browser",
								actor,
								action: mutation.action,
								occurredAt: new Date().toISOString(),
								changes,
							}
						: null;
					const intent: MutationIntent = {
						operationId,
						scope,
						actor,
						source:
							actor.kind === "agent"
								? "agent"
								: request.headers.get("X-Backlog-Client") === "cli"
									? "server-cli"
									: "browser",
						requestHash: hash,
						action: mutation.action,
						files,
						recordUpdates: records,
						plannedResult,
						plannedEvent,
					};
					const latestDenied = revalidateWrite();
					if (latestDenied) throw new MutationAbortResponse(latestDenied);
					await this.checkpoint?.("before_intent", operationId);
					const finalDenied = revalidateWrite();
					if (finalDenied) throw new MutationAbortResponse(finalDenied);
					const begun = this.store.begin(intent, () => {
						const transactionDenied = revalidateWrite();
						if (transactionDenied) throw new MutationAbortResponse(transactionDenied);
					});
					if (!begun.created) throw new MutationAbortResponse(existingResult(begun.operation));
					try {
						await this.checkpoint?.("after_intent", operationId);
						await apply((index) => this.checkpoint?.("after_file", operationId, index));
						await this.checkpoint?.("before_finalize", operationId);
						this.store.finalize(operationId);
						committed = true;
					} catch {
						const observed = await observedFiles(project.rootPath, files);
						let notApplied = false;
						this.blocked.set(project.id, operationId);
						try {
							if (observed === "after") {
								this.store.finalize(operationId);
								this.blocked.delete(project.id);
								committed = true;
							} else if (observed === "before") {
								this.store.markNotApplied(operationId);
								this.blocked.delete(project.id);
								notApplied = true;
							} else this.store.requireRecovery(operationId);
						} catch {
							// Pending intent remains durable if the database is temporarily unavailable.
						}
						if (!committed)
							throw new MutationError(
								notApplied ? "The operation was not applied." : "Project recovery is required.",
								notApplied ? 409 : 503,
								notApplied ? "OPERATION_NOT_APPLIED" : "RECOVERY_REQUIRED",
								{ operationId },
								!notApplied,
							);
					}
					await this.checkpoint?.("after_finalize", operationId);
					try {
						await publish();
					} catch {
						if (onPublicationFailure) await onPublicationFailure();
						else throw new Error("The finalized operation could not refresh its project view.");
					}
				},
			};
			try {
				const response = await dispatch(context);
				if (response.status < 400 && !committed)
					throw new Error("A central write bypassed its durable operation record.");
				return response;
			} catch (error) {
				const latestDenied = await revalidateRead();
				if (latestDenied) throw new MutationAbortResponse(latestDenied);
				throw error;
			}
		});
	}

	async runManagement(
		request: Request,
		scope: Extract<MutationScope, { kind: "admin" | "registration" }>,
		actor: MutationActor,
		secretBody: boolean,
		revalidate: () => Response | null,
		dispatch: (context: ManagementMutationContext) => Promise<Response>,
		authorizeReplay?: (operation: OperationView) => Response | null,
	): Promise<Response> {
		return this.queue.run(scope.kind, async () => {
			const denied = revalidate();
			if (denied) return denied;
			const operationId = secretBody ? randomUUID() : requireOperationId(request);
			const hash = secretBody
				? createHash("sha256")
						.update(`${operationId}\0${request.method}\0${new URL(request.url).pathname}`)
						.digest("hex")
				: await requestHash(request);
			if (!secretBody) {
				const prior = this.store.checkReplay(operationId, { scope, actor, requestHash: hash });
				if (prior) return revalidate() ?? authorizeReplay?.(prior) ?? existingResult(prior);
			}
			let audited = false;
			const context: ManagementMutationContext = {
				operationId,
				audit: (action, options = {}) => {
					const append = managementAudit(this.store, {
						operationId,
						scope,
						actor,
						source: "browser",
						requestHash: hash,
						action,
						expectedRevision: request.headers.get("if-match"),
						...options,
					});
					return (database, changes, result) => {
						const latestDenied = revalidate();
						if (latestDenied) throw new MutationAbortResponse(latestDenied);
						append(database, changes, result);
						audited = true;
					};
				},
			};
			const response = await dispatch(context);
			if (response.status < 400 && !audited) throw new Error("A management write bypassed atomic audit.");
			if (audited) response.headers.set("X-Backlog-Operation-Id", operationId);
			return response;
		});
	}

	operation(operationId: string, actor: MutationActor, admin = false): OperationView | null {
		return this.store.loadOperation(operationId, { actor, admin });
	}
}
