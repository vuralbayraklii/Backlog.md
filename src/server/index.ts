import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import net from "node:net";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { DEFAULT_STATUSES } from "../constants/index.ts";
import {
	ChangeNotCommittedError,
	CONTENT_RECORD_WORDS,
	Core,
	formatCleanupResult,
	RecordRefusedError,
	TaskDeletionAppliedError,
} from "../core/backlog.ts";
import type { ContentStore } from "../core/content-store.ts";
import { initializeProject } from "../core/init.ts";
import type { SearchService } from "../core/search-service.ts";
import { getTaskStatistics } from "../core/statistics.ts";
import { loadTaskDetail } from "../core/task-detail.ts";
import { isCreateLockError, isTaskLockError } from "../file-system/operations.ts";
import {
	type FileEntry,
	type PreparedAfterFile,
	type PreparedFileChange,
	type PreparedRecordKeyResolver,
	recordFileSnapshot,
	snapshotFileEntry,
} from "../file-system/prepared-change.ts";
import { parseFrontmatter } from "../markdown/frontmatter.ts";
import { parseMilestone, parseTask } from "../markdown/parser.ts";
import { BacklogToolError } from "../mcp/errors/mcp-errors.ts";
import { MilestoneHandlers } from "../mcp/tools/milestones/handlers.ts";
import {
	type ContentRecordKind,
	DOCUMENT_TYPE_VALUES,
	type Document,
	type SearchPriorityFilter,
	type SearchResultType,
	type Task,
	type TaskUpdateInput,
} from "../types/index.ts";
import { launchBrowser } from "../utils/browser-launch.ts";
import type { BrowserLoadingState } from "../utils/browser-loading-state.ts";
import { normalizeDueDate } from "../utils/due-date.ts";
import { isAmbiguousIdError } from "../utils/entity-id.ts";
import { resolveMilestoneInputForStorage } from "../utils/milestone-storage.ts";
import { DRAFT_PREFIX, extractAnyPrefix, getTaskPrefixError } from "../utils/prefix-config.ts";
import { formatValidPriorityValues, resolvePriorityValue } from "../utils/priority-config.ts";
import {
	formatValidProjectValues,
	getProjectValues,
	noProjectsConfiguredMessage,
	resolveProjectValues,
} from "../utils/project-config.ts";
import { formatValidStatuses, getCanonicalStatuses, getValidStatuses } from "../utils/status.ts";
import { isValidTaskId } from "../utils/task-id.ts";
import { isAmbiguousTaskIdError, LOCAL_TASK_LOOKUP_HINT, taskNotFoundMessage } from "../utils/task-path.ts";
import { getVersion } from "../utils/version.ts";
import { AuthStoreError } from "./auth-store.ts";
import type { ProjectAuthorization, ProjectPermission } from "./auth-types.ts";
import { MutationAbortResponse, MutationError, recordRevision, taskCollectionRevision } from "./mutations.ts";
import { assertProjectBoundary, readProjectFile } from "./project-paths.ts";

// Regex pattern to match any prefix (letters followed by dash)
const PREFIX_PATTERN = /^[a-zA-Z]+-/i;
const DEFAULT_PREFIX = "task-";
const DOCUMENT_TYPES = new Set<Document["type"]>(DOCUMENT_TYPE_VALUES);
const DECISION_MANAGE_RECHECK = Symbol("decisionManageRecheck");

/**
 * The task routes serve drafts too, so only an explicit DRAFT- id addresses a draft.
 * A prefix-less id such as "2" keeps naming a task, which is what the task store resolves it to.
 */
function isDraftId(taskId: string): boolean {
	return extractAnyPrefix(taskId) === DRAFT_PREFIX;
}

/**
 * Lookups stay local on every surface, but the CLI's hint ends by telling the reader to open
 * 'backlog browser' - nonsensical once the rejected save already happened there. Same fact,
 * addressed to a reader who is already in the browser.
 */
const WEB_TASK_LOOKUP_HINT =
	"Task lookups read only the local working copy; a task that exists only on another branch cannot be referenced yet.";

function formatErrorForWeb(message: string): string {
	return message.replace(LOCAL_TASK_LOOKUP_HINT, WEB_TASK_LOOKUP_HINT);
}

type RecordRequest = Request & { params: { id: string } };
type RoutePermission = ProjectPermission | "read" | "admin";
type ProjectRouteHandler = ((req: Request) => Promise<Response>) & { permission?: RoutePermission };

export interface ProjectReadContext {
	recordKeyFor?: (
		kind: "task" | "document" | "decision" | "milestone" | "config",
		visibleId: string,
		recordPath: string,
		observed?: { lifecycle: "active" | "draft" | "archived"; bytes: Uint8Array },
	) => string | undefined | Promise<string | undefined>;
}

export interface ProjectMutationContext extends ProjectReadContext {
	resolveRecordKey?: PreparedRecordKeyResolver;
	commit(
		mutation: { action: string; files: PreparedFileChange[]; response: Response },
		apply: (afterFile?: PreparedAfterFile) => Promise<void>,
		publish: () => Promise<void>,
		revalidate: () => Response | null,
	): Promise<void>;
}

type DueDatePayloadResult = { ok: true; value: string | null | undefined } | { ok: false; error: string };

/**
 * Read the marker core attaches when a mutation failed after the record had already moved. The
 * response carries it so a client refreshes and reports what happened instead of retrying a move
 * that already took place.
 */
function readMovedState(error: unknown, key: "archiveState" | "demotionState"): "moved" | "partial" | undefined {
	const state = typeof error === "object" && error !== null ? (error as Record<string, unknown>)[key] : undefined;
	return state === "moved" || state === "partial" ? state : undefined;
}

function readDemotionFailureCause(error: unknown): "cleanup" | "commit" | undefined {
	const cause =
		typeof error === "object" && error !== null ? (error as Record<string, unknown>).demotionFailureCause : undefined;
	return cause === "cleanup" || cause === "commit" ? cause : undefined;
}

function parseDueDatePayload(value: unknown, clearable: boolean): DueDatePayloadResult {
	if (value === undefined) return { ok: true, value: undefined };
	if (value === null) {
		return clearable ? { ok: true, value: null } : { ok: false, error: "Due date must be a string." };
	}
	if (typeof value !== "string") {
		return { ok: false, error: `Due date must be a string${clearable ? " or null" : ""}.` };
	}
	try {
		return { ok: true, value: normalizeDueDate(value, "Due date") };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

class DocumentPayloadValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DocumentPayloadValidationError";
	}
}

function parseDocumentType(value: unknown): Document["type"] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new DocumentPayloadValidationError("Document type must be a string.");
	}
	if (!DOCUMENT_TYPES.has(value as Document["type"])) {
		throw new DocumentPayloadValidationError(`Document type must be one of: ${DOCUMENT_TYPE_VALUES.join(", ")}.`);
	}
	return value as Document["type"];
}

function parseDocumentTags(value: unknown): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw new DocumentPayloadValidationError("Document tags must be an array of strings.");
	}
	if (value.some((tag) => typeof tag !== "string")) {
		throw new DocumentPayloadValidationError("Document tags must be an array of strings.");
	}
	return Array.from(new Set(value.map((tag) => tag.trim()).filter((tag) => tag.length > 0)));
}

function parseCreateDocumentPath(value: unknown): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new DocumentPayloadValidationError("Document path must be a string.");
	}
	return value;
}

function parseUpdateDocumentPath(value: unknown): string | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === null || typeof value === "string") {
		return value;
	}
	throw new DocumentPayloadValidationError("Document path must be a string or null.");
}

function collectDelimitedSearchParams(url: URL, names: string[]): string[] {
	const values = names.flatMap((name) => url.searchParams.getAll(name));
	return values
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function isDocumentValidationError(error: Error): boolean {
	return (
		error instanceof DocumentPayloadValidationError ||
		error.message.startsWith("Document type ") ||
		error.message.startsWith("Document path ") ||
		error.message === "Title is required to create a document." ||
		error.message === "Document title cannot be empty."
	);
}

/**
 * Ensure an ID has a prefix. If it already has one, return as-is.
 * Otherwise, add the default "task-" prefix.
 */
function ensurePrefix(id: string): string {
	if (PREFIX_PATTERN.test(id)) {
		return id;
	}
	return `${DEFAULT_PREFIX}${id}`;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") return true;
		if (normalized === "false") return false;
	}
	return undefined;
}

import indexHtml from "../web/index.html";

const NO_STORE_HEADERS = {
	"Cache-Control": "no-store, max-age=0, must-revalidate",
	Pragma: "no-cache",
	Expires: "0",
} as const;

function applyNoStoreHeaders(headers: Headers): void {
	for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
		headers.set(name, value);
	}
}

export function markHtmlBundleNoStore(bundle: Bun.HTMLBundle): Bun.HTMLBundle {
	if (!bundle.files) {
		return bundle;
	}

	for (const file of bundle.files) {
		if (file.loader === "html" && file.isEntry) {
			Object.assign(file.headers, NO_STORE_HEADERS);
		}
	}

	return bundle;
}

export const spaIndexHtml = markHtmlBundleNoStore(indexHtml);
const BUNDLE_ASSET_DIR_ENV = "BACKLOG_BUNDLE_ASSET_DIR";
const BROWSER_HOST = "127.0.0.1";
const MIN_PORT = 1;
const MAX_PORT = 65535;

export async function isPortAvailable(port: number): Promise<boolean> {
	if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return false;
	return new Promise((resolve) => {
		const srv = net.createServer();
		srv.listen(port, BROWSER_HOST, () => srv.close(() => resolve(true)));
		srv.on("error", () => resolve(false));
	});
}

export async function findNextAvailablePort(startPort: number, maxPort = MAX_PORT): Promise<number | null> {
	if (!Number.isInteger(startPort) || !Number.isInteger(maxPort)) return null;

	const firstPort = Math.max(startPort, MIN_PORT);
	const lastPort = Math.min(maxPort, MAX_PORT);
	for (let port = firstPort; port <= lastPort; port++) {
		if (await isPortAvailable(port)) {
			return port;
		}
	}
	return null;
}

export class BacklogServer {
	private core: Core;
	private readonly centralMode: boolean;
	private server: Server<unknown> | null = null;
	private runtimeWorkingDirectory: string | null = null;
	private projectName = "Untitled Project";
	private sockets = new Map<ServerWebSocket<unknown>, (() => boolean) | undefined>();
	private decisionWrite: Promise<Response> | null = null;
	private contentStore: ContentStore | null = null;
	private searchService: SearchService | null = null;
	private servicesReadyPromise: Promise<void> | null = null;
	private servicesInitialized = false;
	private browserLoadingState: BrowserLoadingState = { type: "loading", message: null };
	private unsubscribeContentStore?: () => void;
	private taskBroadcastTimer?: ReturnType<typeof setTimeout>;
	private pendingDataBroadcastScope: "tasks" | "milestones" = "tasks";
	private storeReadyBroadcasted = false;
	private preparedMutationBroadcasts = false;
	private queuedMutationBroadcastScope: "tasks" | "milestones" | null = null;
	private queuedConfigBroadcast = false;
	private readonly boundaryPaths = new Set<string>();
	private boundaryFailure: Error | null = null;

	constructor(projectPath: string, options?: { centralMode?: boolean; projectName?: string }) {
		this.centralMode = options?.centralMode ?? false;
		// Config discovery itself reads a candidate file, so check before constructing Core.
		if (this.centralMode) assertProjectBoundary(projectPath);
		this.core = new Core(projectPath, {
			enableWatchers: true,
			serverMode: this.centralMode,
			fileReader: this.centralMode
				? (path) => {
						try {
							return readProjectFile(projectPath, path);
						} catch (error) {
							// Normal file deletion can race a watcher read. Only an actual boundary
							// refusal invalidates the handler and its previously published caches.
							if (error instanceof AuthStoreError) this.boundaryFailure = error;
							throw error;
						}
					}
				: undefined,
		});
		this.assertBoundary();
		if (options?.projectName) this.projectName = options.projectName;
	}

	/** Guarded physical inventory for first central attachment and startup recovery. */
	async listCentralRecordSnapshots(): Promise<
		Array<{
			kind: "task" | "document" | "decision" | "milestone" | "config";
			visibleId: string;
			lifecycle: "active" | "draft" | "archived";
			recordPath: string;
			entry: FileEntry;
			bytes: Uint8Array;
		}>
	> {
		this.assertBoundary();
		const fs = this.core.filesystem;
		type Snapshot = Awaited<ReturnType<BacklogServer["listCentralRecordSnapshots"]>>[number];
		const snapshots: Snapshot[] = [];
		const add = async (kind: Snapshot["kind"], visibleId: string, lifecycle: Snapshot["lifecycle"], path: string) => {
			this.assertBoundary();
			const entry = await snapshotFileEntry(path);
			if (!entry) throw new Error(`Record disappeared during inventory: ${path}`);
			const bytes = await fs.readBytes(path);
			this.assertBoundary();
			snapshots.push({ kind, visibleId, lifecycle, recordPath: path, entry, bytes });
		};
		const [tasks, archivedTasks, drafts, documents, archivedDocuments, decisions, archivedDecisions] =
			await Promise.all([
				fs.listTasks(),
				fs.listArchivedTasks(),
				fs.listHealthyDrafts(),
				fs.listDocuments(),
				fs.listArchivedDocuments(),
				fs.listDecisions(),
				fs.listArchivedDecisions(),
			]);
		for (const task of tasks) if (task.filePath) await add("task", task.id, "active", task.filePath);
		for (const task of archivedTasks) if (task.filePath) await add("task", task.id, "archived", task.filePath);
		for (const draft of drafts) if (draft.filePath) await add("task", draft.id, "draft", draft.filePath);
		for (const document of [...documents, ...archivedDocuments]) {
			await add(
				"document",
				document.id,
				document.archived ? "archived" : "active",
				fs.contentRecordFilePath("document", document),
			);
		}
		for (const decision of [...decisions, ...archivedDecisions]) {
			await add(
				"decision",
				decision.id,
				decision.archived ? "archived" : "active",
				fs.contentRecordFilePath("decision", decision),
			);
		}
		for (const [directory, lifecycle] of [
			[fs.milestonesDir, "active"],
			[fs.archiveMilestonesDir, "archived"],
		] as const) {
			const filenames = await Array.fromAsync(new Bun.Glob("m-*.md").scan({ cwd: directory })).catch(() => []);
			for (const filename of filenames) {
				const path = join(directory, filename);
				const milestone = parseMilestone(await fs.readText(path));
				await add("milestone", milestone.id, lifecycle, path);
			}
		}
		const archivedDraftsDir = join(fs.backlogDir, "archive/drafts");
		const archivedDraftFiles = await Array.fromAsync(new Bun.Glob("draft-*.md").scan({ cwd: archivedDraftsDir })).catch(
			() => [],
		);
		for (const filename of archivedDraftFiles) {
			const path = join(archivedDraftsDir, filename);
			const draft = parseTask(await fs.readText(path));
			await add("task", draft.id, "archived", path);
		}
		if (await snapshotFileEntry(fs.configFilePath)) await add("config", "config", "active", fs.configFilePath);
		return snapshots.sort((a, b) => a.recordPath.localeCompare(b.recordPath));
	}

	private assertBoundary(): void {
		if (!this.centralMode) return;
		if (this.boundaryFailure) throw this.boundaryFailure;
		try {
			// Config changes can rebind FileSystem while a previous watcher or pending read
			// still holds the old layout. Keep every observed path guarded until retirement.
			this.boundaryPaths.add(this.core.filesystem.backlogDir);
			this.boundaryPaths.add(this.core.filesystem.configFilePath);
			assertProjectBoundary(this.core.filesystem.rootDir, [...this.boundaryPaths]);
		} catch (error) {
			this.boundaryFailure = error instanceof Error ? error : new Error(String(error));
			throw error;
		}
	}

	private boundaryDenied(): Response | null {
		try {
			this.assertBoundary();
			return null;
		} catch {
			return Response.json({ error: "Project files are unavailable" }, { status: 503 });
		}
	}

	private async versionRecord<T extends { id: string }>(
		record: T,
		kind: "task" | "document" | "decision" | "milestone",
		lifecycle: "active" | "draft" | "archived",
		context?: ProjectReadContext,
	): Promise<T & { recordKey?: string; revision?: string }> {
		if (!this.centralMode) return record;
		const snapshot = recordFileSnapshot(record);
		if (!snapshot || !context?.recordKeyFor) {
			throw new MutationError(
				"Record version is unavailable. Reopen the project before editing.",
				503,
				"RECOVERY_REQUIRED",
			);
		}
		const recordKey = await context.recordKeyFor(kind, record.id, snapshot.recordPath, {
			lifecycle,
			bytes: snapshot.bytes,
		});
		if (!recordKey) {
			throw new MutationError(
				"Record identity is unavailable. Reopen the project before editing.",
				503,
				"RECOVERY_REQUIRED",
			);
		}
		return {
			...record,
			recordKey,
			revision: recordRevision(recordKey, snapshot.recordPath, lifecycle, snapshot.bytes),
		};
	}

	private async taskCollectionHeader(context?: ProjectReadContext): Promise<Record<string, string>> {
		if (!this.centralMode) return {};
		const store = await this.getContentStoreInstance();
		const versions = await Promise.all(
			store.getTasks().map(async (task) => {
				const record = await this.versionRecord(task, "task", "active", context);
				return { recordKey: record.recordKey as string, revision: record.revision as string };
			}),
		);
		return { "X-Backlog-Tasks-Revision": taskCollectionRevision(versions) };
	}

	private async projectedTaskCollectionHeader(
		files: PreparedFileChange[],
		context: ProjectReadContext,
	): Promise<string> {
		const store = await this.getContentStoreInstance();
		const current = await Promise.all(
			store.getTasks().map(async (task) => {
				const version = await this.versionRecord(task, "task", "active", context);
				return [version.recordKey as string, version.revision as string] as const;
			}),
		);
		const versions = new Map(current);
		const taskEffects = files.filter((file) => file.record.kind === "task");
		for (const recordKey of new Set(
			taskEffects.map((file) => file.record.recordKey).filter((key): key is string => !!key),
		)) {
			const effects = taskEffects.filter((file) => file.record.recordKey === recordKey);
			const final = effects.findLast((file) => file.after !== null && file.record.lifecycle === "active");
			if (final) versions.set(recordKey, (await this.preparedEffectVersion(final)).revision);
			else versions.delete(recordKey);
		}
		return taskCollectionRevision([...versions].map(([recordKey, revision]) => ({ recordKey, revision })));
	}

	private async versionReturnedTask(
		task: Task,
		files: PreparedFileChange[],
		context: ProjectReadContext,
	): Promise<Task> {
		const effect = files.findLast(
			(file) =>
				file.record.kind === "task" &&
				file.record.lifecycle === "active" &&
				file.record.visibleId.toLowerCase() === task.id.toLowerCase() &&
				file.after !== null,
		);
		if (effect) return { ...task, ...(await this.preparedEffectVersion(effect)) };
		const bound = recordFileSnapshot(task)
			? task
			: (await this.getContentStoreInstance()).getTasks().find((candidate) => candidate.id === task.id);
		if (!bound) throw new MutationError("Task version is unavailable for this result.", 503, "RECOVERY_REQUIRED");
		const version = await this.versionRecord(bound, "task", "active", context);
		return { ...task, recordKey: version.recordKey, revision: version.revision };
	}

	private async versionPreparedResponse(
		req: Request,
		response: Response,
		files: PreparedFileChange[],
		context: ProjectReadContext,
	): Promise<Response> {
		if (!this.centralMode || response.status >= 400) return response;
		const body = await response
			.clone()
			.json()
			.catch(() => null);
		const bodyObject = body && typeof body === "object" && !Array.isArray(body) ? body : null;
		const nestedMilestone =
			bodyObject?.milestone && typeof bodyObject.milestone === "object" && !Array.isArray(bodyObject.milestone)
				? bodyObject.milestone
				: null;
		const bodyId =
			(typeof bodyObject?.id === "string" ? bodyObject.id : undefined) ??
			(typeof nestedMilestone?.id === "string" ? nestedMilestone.id : undefined);
		const requestPath = new URL(req.url).pathname;
		if (requestPath.endsWith("/config")) {
			const config = files.find((file) => file.record.kind === "config" && file.after !== null);
			if (!config || !body || typeof body !== "object" || Array.isArray(body)) return response;
			const version = await this.preparedEffectVersion(config);
			const headers = new Headers(response.headers);
			headers.set("ETag", version.revision);
			return Response.json({ ...body, ...version }, { status: response.status, headers });
		}
		if ((requestPath.endsWith("/tasks/move") || requestPath.endsWith("/tasks/reorder")) && bodyObject) {
			const headers = new Headers(response.headers);
			headers.set("X-Backlog-Tasks-Revision", await this.projectedTaskCollectionHeader(files, context));
			return Response.json(
				{
					...bodyObject,
					...(bodyObject.task && { task: await this.versionReturnedTask(bodyObject.task as Task, files, context) }),
					...(Array.isArray(bodyObject.tasks) && {
						tasks: await Promise.all(
							bodyObject.tasks.map((task: Task) => this.versionReturnedTask(task, files, context)),
						),
					}),
					...(Array.isArray(bodyObject.changedTasks) && {
						changedTasks: await Promise.all(
							bodyObject.changedTasks.map((task: Task) => this.versionReturnedTask(task, files, context)),
						),
					}),
				},
				{ status: response.status, headers },
			);
		}
		if (files.length === 0) {
			if (req.method === "PUT" && requestPath.includes("/milestones/") && nestedMilestone && bodyId) {
				const current = await this.core.filesystem.loadMilestone(bodyId);
				if (!current) return response;
				const version = await this.versionRecord(current, "milestone", "active", context);
				const headers = new Headers(response.headers);
				headers.set("ETag", version.revision as string);
				return Response.json(
					{
						...bodyObject,
						milestone: { ...nestedMilestone, recordKey: version.recordKey, revision: version.revision },
					},
					{ status: response.status, headers },
				);
			}
			if (req.method !== "PUT" || !new URL(req.url).pathname.includes("/tasks/") || !bodyId) return response;
			const current = isDraftId(bodyId)
				? await this.core.filesystem.loadDraft(bodyId)
				: await this.core.getTask(bodyId, { refreshCrossBranch: false });
			if (!current) return response;
			const versioned = await this.versionRecord(current, "task", isDraftId(bodyId) ? "draft" : "active", context);
			const headers = new Headers(response.headers);
			headers.set("ETag", versioned.revision as string);
			return Response.json(
				{ ...body, recordKey: versioned.recordKey, revision: versioned.revision },
				{
					status: response.status,
					headers,
				},
			);
		}
		const pathId = requestPath.match(/\/(?:tasks|docs|decisions|drafts|milestones)\/([^/]+)(?:\/|$)/)?.[1];
		const id = bodyId ?? pathId;
		if (!id) return response;
		const effect = files.find(
			(file) => file.after !== null && file.record.visibleId.toLowerCase() === id.toLowerCase(),
		);
		if (!effect) return response;
		const { recordKey, revision } = await this.preparedEffectVersion(effect);
		const headers = new Headers(response.headers);
		headers.set("ETag", revision);
		if (nestedMilestone && effect.record.kind === "milestone") {
			return Response.json(
				{ ...bodyObject, milestone: { ...nestedMilestone, recordKey, revision } },
				{ status: response.status, headers },
			);
		}
		if (!body || typeof body !== "object" || Array.isArray(body) || !bodyId) {
			return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
		}
		return Response.json({ ...body, recordKey, revision }, { status: response.status, headers });
	}

	private async preparedEffectVersion(effect: PreparedFileChange): Promise<{ recordKey: string; revision: string }> {
		const recordKey = effect.record.recordKey;
		if (!recordKey) {
			throw new MutationError("Record identity is unavailable for this write.", 503, "RECOVERY_REQUIRED");
		}
		const recordPath = effect.record.recordPath ?? effect.path;
		const bytes =
			effect.after?.type === "file"
				? effect.after.bytes
				: effect.record.transitionFromPath
					? await this.core.filesystem.readBytes(effect.record.transitionFromPath)
					: null;
		if (!bytes) throw new MutationError("Record bytes are unavailable for this write.", 503, "RECOVERY_REQUIRED");
		const revision = recordRevision(recordKey, recordPath, effect.record.lifecycle, bytes);
		return { recordKey, revision };
	}

	private conflictResponse(error: unknown, message: string): Response {
		const code = isAmbiguousIdError(error) || isAmbiguousTaskIdError(error) ? "AMBIGUOUS_ID" : "WRITE_LOCKED";
		return Response.json(this.centralMode ? { error: message, code } : { error: message }, { status: 409 });
	}

	private async resolveMilestoneInput(milestone: string): Promise<string> {
		const [activeMilestones, archivedMilestones] = await Promise.all([
			this.core.filesystem.listMilestones(),
			this.core.filesystem.listArchivedMilestones(),
		]);
		return resolveMilestoneInputForStorage(milestone, activeMilestones, archivedMilestones);
	}

	private async ensureServicesReady(): Promise<void> {
		this.assertBoundary();
		if (!this.servicesReadyPromise) {
			this.publishBrowserLoadingState({ type: "loading", message: null });
			const readyPromise = this.initializeServices()
				.then(() => {
					this.assertBoundary();
					this.publishBrowserLoadingState({ type: "loaded" });
				})
				.catch((error) => {
					if (this.servicesReadyPromise === readyPromise) this.servicesReadyPromise = null;
					this.publishBrowserLoadingState({
						type: "error",
						message: error instanceof Error ? error.message : String(error),
					});
					throw error;
				});
			this.servicesReadyPromise = readyPromise;
		}
		await this.servicesReadyPromise;
		this.assertBoundary();
	}

	private async initializeServices(): Promise<void> {
		const store = await this.core.getContentStore((message) => {
			this.publishBrowserLoadingState({ type: "loading", message });
		});
		this.assertBoundary();
		this.contentStore = store;

		if (!this.unsubscribeContentStore) {
			this.unsubscribeContentStore = store.subscribe((event) => {
				if (this.boundaryDenied()) return;
				if (event.type === "config") {
					this.storeReadyBroadcasted = true;
					if (!this.centralMode) this.projectName = event.config.projectName;
					this.broadcastConfigUpdated();
					return;
				}

				if (event.type === "ready") {
					if (!this.storeReadyBroadcasted) {
						this.storeReadyBroadcasted = true;
						return;
					}
					this.broadcastDataUpdated();
					return;
				}

				// Broadcast for tasks/documents/decisions so clients refresh caches/search
				this.storeReadyBroadcasted = true;
				this.broadcastDataUpdated();
			});
		}

		const search = await this.core.getSearchService();
		this.assertBoundary();
		this.searchService = search;
		this.servicesInitialized = true;
	}

	private async getContentStoreInstance(): Promise<ContentStore> {
		await this.ensureServicesReady();
		if (!this.contentStore) {
			throw new Error("Content store not initialized");
		}
		return this.contentStore;
	}

	private async getSearchServiceInstance(): Promise<SearchService> {
		await this.ensureServicesReady();
		if (!this.searchService) {
			throw new Error("Search service not initialized");
		}
		return this.searchService;
	}

	getPort(): number | null {
		return this.server?.port ?? null;
	}

	private broadcastDataUpdated(scope: "tasks" | "milestones" = "tasks") {
		if (this.preparedMutationBroadcasts) {
			this.queuedMutationBroadcastScope =
				scope === "milestones" || this.queuedMutationBroadcastScope === "milestones" ? "milestones" : "tasks";
			return;
		}
		// Milestone changes widen the message so clients also refetch milestone
		// entities; the debounce keeps the widest scope seen in the window.
		if (scope === "milestones") this.pendingDataBroadcastScope = "milestones";
		if (this.taskBroadcastTimer) clearTimeout(this.taskBroadcastTimer);
		this.taskBroadcastTimer = setTimeout(() => {
			this.taskBroadcastTimer = undefined;
			const message = this.pendingDataBroadcastScope === "milestones" ? "milestones-updated" : "tasks-updated";
			this.pendingDataBroadcastScope = "tasks";
			for (const ws of this.sockets.keys()) {
				this.sendSocket(ws, message);
			}
		}, 75);
	}

	private broadcastConfigUpdated() {
		if (this.preparedMutationBroadcasts) {
			this.queuedConfigBroadcast = true;
			return;
		}
		for (const ws of this.sockets.keys()) {
			this.sendSocket(ws, "config-updated");
		}
	}

	private finishPreparedMutationBroadcasts(publish: boolean, freeze = false): void {
		if (freeze) return;
		this.preparedMutationBroadcasts = false;
		const scope = this.queuedMutationBroadcastScope;
		const config = this.queuedConfigBroadcast;
		this.queuedMutationBroadcastScope = null;
		this.queuedConfigBroadcast = false;
		if (!publish) return;
		if (scope) this.broadcastDataUpdated(scope);
		if (config) this.broadcastConfigUpdated();
	}

	private publishBrowserLoadingState(state: BrowserLoadingState) {
		this.browserLoadingState = state;
		const message = JSON.stringify(state);
		for (const ws of this.sockets.keys()) {
			this.sendSocket(ws, message);
		}
	}

	private apiRoutes(
		authorization?: ProjectAuthorization,
		mutationContext?: ProjectReadContext | ProjectMutationContext,
	) {
		// The operation's permission lives beside its handler on both HTTP surfaces.
		const route = <T extends Request>(permission: RoutePermission, handler: (req: T) => Promise<Response>) =>
			Object.assign(
				async (req: T): Promise<Response> => {
					if (this.centralMode && !authorization)
						return Response.json({ error: "Authentication required" }, { status: 401 });
					const denied = authorization?.check(permission);
					if (denied) return denied;
					const unsafe = this.boundaryDenied();
					if (unsafe) return unsafe;
					let response: Response;
					if (this.centralMode && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
						if (!mutationContext || !("commit" in mutationContext)) {
							return Response.json({ error: "Central write context is unavailable" }, { status: 503 });
						}
						await this.ensureServicesReady();
						this.preparedMutationBroadcasts = true;
						let prepared: {
							result: Response;
							files: PreparedFileChange[];
							apply: (afterFile?: PreparedAfterFile) => Promise<void>;
							publish: () => Promise<void>;
							abort: (freeze: boolean) => Promise<void>;
						};
						try {
							prepared = await this.core.prepareWrite(
								(path) => {
									this.assertBoundary();
									assertProjectBoundary(this.core.filesystem.rootDir, [path]);
								},
								mutationContext.resolveRecordKey,
								() => handler(req),
							);
						} catch (error) {
							this.finishPreparedMutationBroadcasts(false);
							throw error;
						}
						try {
							response = await this.versionPreparedResponse(req, prepared.result, prepared.files, mutationContext);
							if (response.status >= 400) {
								await prepared.abort(false);
								this.finishPreparedMutationBroadcasts(false);
							} else {
								await mutationContext.commit(
									{ action: `${req.method} ${new URL(req.url).pathname}`, files: prepared.files, response },
									prepared.apply,
									prepared.publish,
									() =>
										authorization?.check(permission) ??
										((req as Request & { [DECISION_MANAGE_RECHECK]?: boolean })[DECISION_MANAGE_RECHECK]
											? authorization?.check("decisionsManage")
											: null) ??
										this.boundaryDenied(),
								);
								this.finishPreparedMutationBroadcasts(true);
							}
						} catch (error) {
							const freeze =
								error instanceof MutationError || error instanceof MutationAbortResponse
									? error.freezePublication
									: true;
							await prepared.abort(freeze);
							this.finishPreparedMutationBroadcasts(false, freeze);
							throw error;
						}
					} else {
						response = await handler(req);
					}
					return authorization?.check(permission) ?? this.boundaryDenied() ?? response;
				},
				{ permission },
			);
		const decisionRoute = <T extends Request>(permission: ProjectPermission, handler: (req: T) => Promise<Response>) =>
			route(permission, (req: T) =>
				this.withDecisionWrite(async () => {
					const denied = authorization?.check(permission);
					return denied ?? (await handler(req));
				}),
			);
		return {
			"/api/tasks": {
				GET: route("read", async (req: Request) => this.handleListTasks(req, mutationContext)),
				POST: route("tasksWrite", async (req: Request) => this.handleCreateTask(req)),
			},
			"/api/tasks/archived": {
				GET: route("read", async () => this.handleListArchived("task", mutationContext)),
			},
			"/api/task/:id": {
				GET: route("read", async (req: RecordRequest) => this.handleGetTask(req.params.id, mutationContext)),
			},
			"/api/tasks/:id": {
				GET: route("read", async (req: RecordRequest) => this.handleGetTask(req.params.id, mutationContext)),
				PUT: route("tasksWrite", async (req: RecordRequest) => this.handleUpdateTask(req, req.params.id)),
				DELETE: route("delete", async (req: RecordRequest) =>
					this.handleRecordLifecycle("task", req.params.id, "delete"),
				),
			},
			"/api/tasks/:id/archive": {
				POST: route("archive", async (req: RecordRequest) => this.handleArchiveTask(req.params.id)),
			},
			"/api/tasks/:id/restore": {
				POST: route("archive", async (req: RecordRequest) =>
					this.handleRecordLifecycle("task", req.params.id, "restore"),
				),
			},
			"/api/tasks/:id/demote": {
				POST: route("tasksWrite", async (req: RecordRequest) => this.handleDemoteTask(req.params.id)),
			},
			"/api/statuses": {
				GET: route("read", async () => this.handleGetStatuses()),
			},
			"/api/config": {
				GET: route("read", async () => this.handleGetConfig(mutationContext)),
				PUT: route("admin", async (req: Request) => this.handleUpdateConfig(req)),
			},
			"/api/docs": {
				GET: route("read", async () => this.handleListDocs(mutationContext)),
				POST: route("docsWrite", async (req: Request) => this.handleCreateDoc(req)),
			},
			"/api/docs/archived": {
				GET: route("read", async () => this.handleListArchived("document", mutationContext)),
			},
			"/api/doc/:id": {
				GET: route("read", async (req: RecordRequest) => this.handleGetDoc(req.params.id, mutationContext)),
			},
			"/api/docs/:id": {
				GET: route("read", async (req: RecordRequest) => this.handleGetDoc(req.params.id, mutationContext)),
				PUT: route("docsWrite", async (req: RecordRequest) => this.handleUpdateDoc(req, req.params.id)),
				DELETE: route("delete", async (req: RecordRequest) =>
					this.handleRecordLifecycle("document", req.params.id, "delete"),
				),
			},
			"/api/docs/:id/archive": {
				POST: route("archive", async (req: RecordRequest) =>
					this.handleArchiveContentRecord("document", req.params.id),
				),
			},
			"/api/docs/:id/restore": {
				POST: route("archive", async (req: RecordRequest) =>
					this.handleRecordLifecycle("document", req.params.id, "restore"),
				),
			},
			"/api/decisions": {
				GET: route("read", async () => this.handleListDecisions(mutationContext)),
				POST: decisionRoute("decisionsWrite", async (req: Request) => this.handleCreateDecision(req)),
			},
			"/api/decisions/archived": {
				GET: route("read", async () => this.handleListArchived("decision", mutationContext)),
			},
			"/api/decision/:id": {
				GET: route("read", async (req: RecordRequest) => this.handleGetDecision(req.params.id, mutationContext)),
			},
			"/api/decisions/:id": {
				GET: route("read", async (req: RecordRequest) => this.handleGetDecision(req.params.id, mutationContext)),
				PUT: decisionRoute("decisionsWrite", async (req: RecordRequest) =>
					this.handleUpdateDecision(req, req.params.id, authorization),
				),
				DELETE: decisionRoute("delete", async (req: RecordRequest) =>
					this.handleRecordLifecycle("decision", req.params.id, "delete"),
				),
			},
			"/api/decisions/:id/archive": {
				POST: decisionRoute("archive", async (req: RecordRequest) =>
					this.handleArchiveContentRecord("decision", req.params.id),
				),
			},
			"/api/decisions/:id/restore": {
				POST: decisionRoute("archive", async (req: RecordRequest) =>
					this.handleRecordLifecycle("decision", req.params.id, "restore"),
				),
			},
			"/api/drafts": {
				GET: route("read", async () => this.handleListDrafts(mutationContext)),
			},
			"/api/drafts/:id/promote": {
				POST: route("tasksWrite", async (req: RecordRequest) => this.handlePromoteDraft(req.params.id)),
			},
			"/api/milestones": {
				GET: route("read", async () => this.handleListMilestones(mutationContext)),
				POST: route("tasksWrite", async (req: Request) => this.handleCreateMilestone(req)),
			},
			"/api/milestones/archived": {
				GET: route("read", async () => this.handleListArchivedMilestones(mutationContext)),
			},
			"/api/milestones/:id": {
				GET: route("read", async (req: RecordRequest) => this.handleGetMilestone(req.params.id, mutationContext)),
				PUT: route("tasksWrite", async (req: RecordRequest) => this.handleUpdateMilestone(req, req.params.id)),
				DELETE: route("delete", async (req: RecordRequest) => this.handleRemoveMilestone(req, req.params.id)),
			},
			"/api/milestones/:id/archive": {
				POST: route("archive", async (req: RecordRequest) => this.handleArchiveMilestone(req.params.id)),
			},
			"/api/tasks/reorder": {
				POST: route("tasksWrite", async (req: Request) => this.handleReorderTask(req)),
			},
			"/api/tasks/move": {
				POST: route("tasksWrite", async (req: Request) => this.handleMoveTasks(req)),
			},
			"/api/tasks/cleanup": {
				GET: route("archive", async (req: Request) => this.handleCleanupPreview(req)),
			},
			"/api/tasks/duplicates": {
				GET: route("admin", async () => this.handleGetDuplicateTasks()),
				POST: route("admin", async (req: Request) => this.handleRepairDuplicateTasks(req)),
			},
			"/api/tasks/cleanup/execute": {
				POST: route("archive", async (req: Request) => this.handleCleanupExecute(req)),
			},
			"/api/version": {
				GET: route("read", async () => this.handleGetVersion()),
			},
			"/api/statistics": {
				GET: route("read", async () => this.handleGetStatistics()),
			},
			"/api/status": {
				GET: route("read", async () => this.handleGetStatus()),
			},
			"/api/init": {
				POST: route("admin", async (req: Request) => this.handleInit(req)),
			},
			"/api/search": {
				GET: route("read", async (req: Request) => this.handleSearch(req, mutationContext)),
			},
			"/assets/*": {
				GET: route("read", async (req: Request) => this.handleAssetRequest(req)),
			},
		};
	}

	private matchApiRoute(
		req: Request,
		localPath: string,
		authorization?: ProjectAuthorization,
		mutationContext?: ProjectReadContext | ProjectMutationContext,
	): { handler: ProjectRouteHandler; params: Record<string, string | undefined>; url: URL } | null {
		const url = new URL(req.url);
		url.pathname = localPath;
		const routes = this.apiRoutes(authorization, mutationContext) as unknown as Record<
			string,
			Record<string, ProjectRouteHandler>
		>;
		const patterns = Object.keys(routes).sort((left, right) => {
			const dynamicCount = (path: string) => (path.match(/[:*]/g) ?? []).length;
			return dynamicCount(left) - dynamicCount(right) || right.length - left.length;
		});
		for (const path of patterns) {
			const match = new URLPattern({ pathname: path }).exec(url);
			if (!match) continue;
			const handler = routes[path]?.[req.method];
			return handler ? { handler, params: match.pathname.groups, url } : null;
		}
		return null;
	}

	/** Check the matched route's existing permission before idempotent replay reveals its result. */
	async authorizeApi(req: Request, localPath: string, authorization?: ProjectAuthorization): Promise<Response | null> {
		if (this.centralMode && !authorization) return Response.json({ error: "Authentication required" }, { status: 401 });
		if (this.centralMode && localPath === "/api/init") return new Response("Not Found", { status: 404 });
		const matched = this.matchApiRoute(req, localPath, authorization);
		if (!matched) return new Response("Not Found", { status: 404 });
		if (this.centralMode && !matched.handler.permission)
			return Response.json({ error: "Operation has no permission definition" }, { status: 403 });
		const denied =
			(matched.handler.permission ? authorization?.check(matched.handler.permission) : null) ?? this.boundaryDenied();
		if (denied) return denied;
		if (req.method === "PUT" && localPath.startsWith("/api/decisions/") && authorization) {
			return (await this.checkDecisionWriteAuthorization(req, matched.params.id ?? "", authorization)).denied;
		}
		return null;
	}

	async dispatchApi(
		req: Request,
		localPath: string,
		authorization?: ProjectAuthorization,
		mutationContext?: ProjectReadContext | ProjectMutationContext,
	): Promise<Response> {
		if (this.centralMode && !authorization) return Response.json({ error: "Authentication required" }, { status: 401 });
		if (this.centralMode && localPath === "/api/init") return new Response("Not Found", { status: 404 });
		const matched = this.matchApiRoute(req, localPath, authorization, mutationContext);
		if (!matched) return new Response("Not Found", { status: 404 });
		if (this.centralMode && !matched.handler.permission)
			return Response.json({ error: "Operation has no permission definition" }, { status: 403 });
		const localRequest = new Request(matched.url, req);
		Object.defineProperty(localRequest, "params", { value: matched.params });
		return await matched.handler(localRequest);
	}

	acceptSocket(ws: ServerWebSocket<unknown>, authorize?: () => boolean): void {
		this.sockets.set(ws, authorize);
		if (!this.sendSocket(ws, JSON.stringify(this.browserLoadingState))) return;
		if (this.browserLoadingState.type === "loading") void this.ensureServicesReady().catch(() => {});
	}

	private sendSocket(ws: ServerWebSocket<unknown>, message: string): boolean {
		try {
			const authorize = this.sockets.get(ws);
			if (
				!this.sockets.has(ws) ||
				(this.centralMode && !authorize) ||
				(authorize && !authorize()) ||
				this.boundaryDenied()
			) {
				this.removeSocket(ws);
				ws.close(1008, "Authorization expired");
				return false;
			}
			ws.send(message);
			return true;
		} catch {
			this.removeSocket(ws);
			ws.close(1008, "Authorization expired");
			return false;
		}
	}

	removeSocket(ws: ServerWebSocket<unknown>): void {
		this.sockets.delete(ws);
	}

	private async withDecisionWrite(operation: () => Promise<Response>): Promise<Response> {
		// One project-local queue also protects decision ID allocation during concurrent creates.
		const current = (this.decisionWrite ?? Promise.resolve()).catch(() => {}).then(operation);
		this.decisionWrite = current;
		try {
			return await current;
		} finally {
			if (this.decisionWrite === current) this.decisionWrite = null;
		}
	}

	async start(port?: number, openBrowser = true): Promise<void> {
		// Prevent duplicate starts (e.g., accidental re-entry)
		if (this.server) {
			console.log("Server already running");
			return;
		}
		this._stopping = false;
		// Load config (migration is handled globally by CLI)
		const config = await this.core.filesystem.loadConfig();

		// Use config default port if no port specified
		const finalPort = port ?? config?.defaultPort ?? 6420;
		this.projectName = config?.projectName || "Untitled Project";

		// Check if browser should open (config setting or CLI override)
		// Default to true if autoOpenBrowser is not explicitly set to false
		const shouldOpenBrowser = openBrowser && (config?.autoOpenBrowser ?? true);

		try {
			const serveOptions = {
				port: finalPort,
				hostname: BROWSER_HOST,
				development: process.env.NODE_ENV === "development",
				routes: {
					"/": spaIndexHtml,
					"/tasks": spaIndexHtml,
					"/tasks/*": spaIndexHtml,
					"/board": spaIndexHtml,
					"/board/*": spaIndexHtml,
					"/milestones": spaIndexHtml,
					"/drafts": spaIndexHtml,
					"/documentation": spaIndexHtml,
					"/documentation/*": spaIndexHtml,
					"/decisions": spaIndexHtml,
					"/decisions/*": spaIndexHtml,
					"/statistics": spaIndexHtml,
					"/settings": spaIndexHtml,

					...this.apiRoutes(),
				},
				fetch: async (req: Request, server: Server<unknown>) => {
					const res = await this.handleRequest(req, server);

					// Disable caching for GET/HEAD so browser always fetches latest content
					if (req.method === "GET" || req.method === "HEAD") {
						applyNoStoreHeaders(res.headers);
					}

					return res;
				},
				error: this.handleError.bind(this),
				websocket: {
					open: (ws: ServerWebSocket) => {
						this.acceptSocket(ws);
					},
					message: (ws: ServerWebSocket) => {
						this.sendSocket(ws, "pong");
					},
					close: (ws: ServerWebSocket) => {
						this.removeSocket(ws);
					},
				},
				/* biome-ignore format: keep cast on single line below for type narrowing */
			};
			const bundleAssetDirectory = process.env[BUNDLE_ASSET_DIR_ENV]?.trim();
			if (bundleAssetDirectory) {
				this.runtimeWorkingDirectory = process.cwd();
				process.chdir(bundleAssetDirectory);
			}

			try {
				this.server = Bun.serve(serveOptions as unknown as Parameters<typeof Bun.serve>[0]) as Server<unknown>;
			} catch (error) {
				this.restoreRuntimeWorkingDirectory();
				throw error;
			}
			const url = `http://${BROWSER_HOST}:${finalPort}`;
			console.log(`🚀 Backlog.md browser interface running at ${url}`);
			console.log(`📊 Project: ${this.projectName}`);
			const stopKey = process.platform === "darwin" ? "Cmd+C" : "Ctrl+C";
			console.log(`⏹️  Press ${stopKey} to stop the server`);

			if (shouldOpenBrowser) {
				console.log("🌐 Opening browser...");
				await this.openBrowser(url);
			} else {
				console.log("💡 Open your browser and navigate to the URL above");
			}
		} catch (error) {
			// Handle port already in use error
			const errorCode = (error as { code?: string })?.code;
			const errorMessage = (error as Error)?.message;
			if (errorCode === "EADDRINUSE" || errorMessage?.includes("address already in use")) {
				console.error(`\n❌ Error: Port ${finalPort} is already in use. Use --port to specify a different port.\n`);
				process.exit(1);
			}

			// Handle other errors
			console.error("❌ Failed to start server:", errorMessage || error);
			process.exit(1);
		}
	}

	private _stopping = false;

	private restoreRuntimeWorkingDirectory(): void {
		if (!this.runtimeWorkingDirectory) return;
		process.chdir(this.runtimeWorkingDirectory);
		this.runtimeWorkingDirectory = null;
	}

	async stop(): Promise<void> {
		if (this.taskBroadcastTimer) clearTimeout(this.taskBroadcastTimer);
		if (this._stopping) return;
		this._stopping = true;
		await this.servicesReadyPromise?.catch(() => {});

		// Stop filesystem watcher first to reduce churn
		try {
			this.unsubscribeContentStore?.();
			this.unsubscribeContentStore = undefined;
		} catch {}

		this.core.disposeSearchService();
		this.core.disposeContentStore();
		this.restoreRuntimeWorkingDirectory();
		this.searchService = null;
		this.contentStore = null;
		this.servicesReadyPromise = null;
		this.servicesInitialized = false;
		this.browserLoadingState = { type: "loading", message: null };
		this.storeReadyBroadcasted = false;

		// Proactively close WebSocket connections
		for (const ws of this.sockets.keys()) {
			try {
				ws.close();
			} catch {}
		}
		this.sockets.clear();

		// Attempt to stop the server but don't hang forever
		if (this.server) {
			const serverRef = this.server;
			const stopPromise = (async () => {
				try {
					await serverRef.stop();
				} catch {}
			})();
			const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
			await Promise.race([stopPromise, timeout]);
			this.server = null;
			console.log("Server stopped");
		}

		this._stopping = false;
	}

	private async openBrowser(url: string): Promise<void> {
		try {
			await launchBrowser(url);
		} catch (error) {
			console.warn("⚠️  Failed to open browser automatically:", error);
			console.log("💡 Please open your browser manually and navigate to the URL above");
		}
	}

	private async handleAssetRequest(req: Request): Promise<Response> {
		try {
			const pathname = decodeURIComponent(new URL(req.url).pathname);
			if (!pathname.startsWith("/assets/")) return new Response("Not Found", { status: 404 });
			const relPath = pathname.slice("/assets/".length);
			if (relPath.includes("..") || relPath.includes("\\") || relPath.includes("\0")) {
				return new Response("Not Found", { status: 404 });
			}
			const assetsRoot = join(dirname(this.core.filesystem.docsDir), "assets");
			const [projectRoot, realAssetsRoot, filePath] = await Promise.all([
				realpath(this.core.filesystem.rootDir),
				realpath(assetsRoot),
				realpath(join(assetsRoot, relPath)),
			]);
			const within = (root: string, path: string) => {
				const rel = relative(root, path);
				return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
			};
			if (!within(projectRoot, filePath) || !within(realAssetsRoot, filePath)) {
				return new Response("Not Found", { status: 404 });
			}
			const file = Bun.file(filePath);
			if (!(await file.exists())) return new Response("Not Found", { status: 404 });
			const ext = (filePath.match(/\.([^./]+)$/) || [])[1]?.toLowerCase() || "";
			const mimeMap: Record<string, string> = {
				png: "image/png",
				jpg: "image/jpeg",
				jpeg: "image/jpeg",
				gif: "image/gif",
				webp: "image/webp",
				avif: "image/avif",
				txt: "text/plain",
			};
			const headers = new Headers({
				"Content-Type": mimeMap[ext] ?? "application/octet-stream",
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "default-src 'none'; sandbox",
			});
			// SVG, HTML, scripts and other active formats must never execute on the application origin.
			if (!mimeMap[ext])
				headers.set("Content-Disposition", `attachment; filename="${basename(filePath).replace(/["\r\n]/g, "_")}"`);
			// A Bun.file response reads lazily after authorization; central delivery uses
			// bytes checked through an opened file before releasing the response.
			return new Response(this.centralMode ? new Uint8Array(await this.core.filesystem.readBytes(filePath)) : file, {
				headers,
			});
		} catch (error) {
			if (
				error instanceof URIError ||
				(error as NodeJS.ErrnoException).code === "ENOENT" ||
				(error as NodeJS.ErrnoException).code === "ENOTDIR"
			) {
				return new Response("Not Found", { status: 404 });
			}
			console.error("Error serving asset:", error);
			return new Response("Internal Server Error", { status: 500 });
		}
	}

	private async handleRequest(req: Request, server: Server<unknown>): Promise<Response> {
		// Handle WebSocket upgrade
		if (req.headers.get("upgrade") === "websocket") {
			const success = server.upgrade(req, { data: undefined });
			if (success) {
				return new Response(null, { status: 101 }); // WebSocket upgrade response
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		// For all other routes, return 404 since routes should handle all valid paths
		return new Response("Not Found", { status: 404 });
	}

	// Task handlers
	private async handleListTasks(req: Request, context?: ProjectReadContext): Promise<Response> {
		let refreshCrossBranch = !this.centralMode && this.servicesInitialized;
		await this.ensureServicesReady();
		const url = new URL(req.url);
		const status = url.searchParams.get("status") || undefined;
		const assignee = url.searchParams.get("assignee") || undefined;
		const parent = url.searchParams.get("parent") || undefined;
		const priorityParam = url.searchParams.get("priority") || undefined;
		// The browser reads the cross-branch corpus the server already keeps in the content store, so
		// the default must not fall back to re-reading the working copy on every list request.
		const crossBranch = !this.centralMode && url.searchParams.get("crossBranch") !== "false";
		const excludeStatusParams = collectDelimitedSearchParams(url, [
			"excludeStatus",
			"exclude-status",
			"excludeStatuses",
			"exclude-statuses",
		]);
		const labelParams = [...url.searchParams.getAll("label"), ...url.searchParams.getAll("labels")];
		const labelsCsv = url.searchParams.get("labels");
		if (labelsCsv) {
			labelParams.push(...labelsCsv.split(","));
		}
		const labels = labelParams.map((label) => label.trim()).filter((label) => label.length > 0);

		const config = await this.core.filesystem.loadConfig();
		let priority: string | undefined;
		if (priorityParam) {
			const normalizedPriority = resolvePriorityValue(priorityParam, config);
			if (!normalizedPriority) {
				return Response.json(
					{ error: `Invalid priority filter. Valid values are: ${formatValidPriorityValues(config)}` },
					{ status: 400 },
				);
			}
			priority = normalizedPriority;
		}

		let excludeStatus: string[] | undefined;
		if (excludeStatusParams.length > 0) {
			const { values, invalid, validStatuses } = await getCanonicalStatuses(excludeStatusParams, this.core);
			if (invalid.length > 0) {
				return Response.json(
					{
						error: `Invalid excludeStatus filter: ${invalid.join(", ")}. Valid statuses are: ${formatValidStatuses(validStatuses)}`,
					},
					{ status: 400 },
				);
			}
			excludeStatus = values.length > 0 ? values : undefined;
		}

		// Resolve parent task ID if provided
		let parentTaskId: string | undefined;
		if (parent) {
			let parentTask: Task | null;
			try {
				parentTask = await this.core.getTask(parent, { refreshCrossBranch });
				refreshCrossBranch = false;
				if (!parentTask) {
					parentTask = await this.core.getTask(ensurePrefix(parent), { refreshCrossBranch: false });
				}
			} catch (error) {
				if (isAmbiguousTaskIdError(error)) {
					return this.conflictResponse(error, error.message);
				}
				throw error;
			}
			if (!parentTask) {
				const normalizedParent = ensurePrefix(parent);
				return Response.json({ error: `Parent task ${normalizedParent} not found` }, { status: 404 });
			}
			parentTaskId = parentTask.id;
		}

		const store = await this.getContentStoreInstance();
		for (let attempt = 0; attempt < 3; attempt++) {
			const version = store.publicationVersion();
			// Use Core.queryTasks which handles all filtering and cross-branch logic.
			const tasks = await this.core.queryTasks({
				filters: {
					status,
					excludeStatus,
					assignee,
					priority,
					parentTaskId,
					labels: labels.length > 0 ? labels : undefined,
				},
				includeCrossBranch: crossBranch,
				refreshCrossBranch,
			});
			const records = this.centralMode
				? await Promise.all(tasks.map((task) => this.versionRecord(task, "task", "active", context)))
				: tasks;
			const headers = await this.taskCollectionHeader(context);
			if (!this.centralMode || version === store.publicationVersion()) return Response.json(records, { headers });
		}
		throw new MutationError("Task collection changed while it was read. Retry the request.", 409, "REVISION_CONFLICT");
	}

	private async handleSearch(req: Request, context?: ProjectReadContext): Promise<Response> {
		try {
			const url = new URL(req.url);
			const query = url.searchParams.get("query") ?? undefined;
			const limitParam = url.searchParams.get("limit");
			const typeParams = [...url.searchParams.getAll("type"), ...url.searchParams.getAll("types")];
			const statusParams = url.searchParams.getAll("status");
			const excludeStatusParams = collectDelimitedSearchParams(url, [
				"excludeStatus",
				"exclude-status",
				"excludeStatuses",
				"exclude-statuses",
			]);
			const priorityParamsRaw = url.searchParams.getAll("priority");
			const projectParamsRaw = url.searchParams.getAll("project");
			const assigneeParamsRaw = [...url.searchParams.getAll("assignee"), ...url.searchParams.getAll("assignees")];
			const labelParamsRaw = [...url.searchParams.getAll("label"), ...url.searchParams.getAll("labels")];
			const modifiedFileParamsRaw = [
				...url.searchParams.getAll("modifiedFile"),
				...url.searchParams.getAll("modifiedFiles"),
			];
			const assigneesCsv = url.searchParams.get("assignees");
			if (assigneesCsv) {
				assigneeParamsRaw.push(...assigneesCsv.split(","));
			}
			const labelsCsv = url.searchParams.get("labels");
			if (labelsCsv) {
				labelParamsRaw.push(...labelsCsv.split(","));
			}
			const modifiedFilesCsv = url.searchParams.get("modifiedFiles");
			if (modifiedFilesCsv) {
				modifiedFileParamsRaw.push(...modifiedFilesCsv.split(","));
			}

			let limit: number | undefined;
			if (limitParam) {
				const parsed = Number.parseInt(limitParam, 10);
				if (Number.isNaN(parsed) || parsed <= 0) {
					return Response.json({ error: "limit must be a positive integer" }, { status: 400 });
				}
				limit = parsed;
			}

			let types: SearchResultType[] | undefined;
			if (typeParams.length > 0) {
				const allowed: SearchResultType[] = ["task", "document", "decision"];
				const normalizedTypes = typeParams
					.map((value) => value.toLowerCase())
					.filter((value): value is SearchResultType => {
						return allowed.includes(value as SearchResultType);
					});
				if (normalizedTypes.length === 0) {
					return Response.json({ error: "type must be task, document, or decision" }, { status: 400 });
				}
				types = normalizedTypes;
			}

			const filters: {
				status?: string | string[];
				excludeStatus?: string | string[];
				priority?: SearchPriorityFilter | SearchPriorityFilter[];
				project?: string | string[];
				assignee?: string | string[];
				labels?: string | string[];
				modifiedFiles?: string | string[];
			} = {};

			if (statusParams.length === 1) {
				filters.status = statusParams[0];
			} else if (statusParams.length > 1) {
				filters.status = statusParams;
			}

			if (excludeStatusParams.length > 0) {
				const { values, invalid, validStatuses } = await getCanonicalStatuses(excludeStatusParams, this.core);
				if (invalid.length > 0) {
					return Response.json(
						{
							error: `Invalid excludeStatus filter: ${invalid.join(", ")}. Valid statuses are: ${formatValidStatuses(validStatuses)}`,
						},
						{ status: 400 },
					);
				}
				filters.excludeStatus = values.length === 1 ? values[0] : values;
			}

			if (priorityParamsRaw.length > 0) {
				const config = await this.core.filesystem.loadConfig();
				const normalizedPriorities = priorityParamsRaw.map((value) => resolvePriorityValue(value, config));
				const invalidPriority = priorityParamsRaw[normalizedPriorities.findIndex((value) => !value)];
				if (invalidPriority) {
					return Response.json(
						{
							error: `Unsupported priority '${invalidPriority}'. Use ${formatValidPriorityValues(config)}.`,
						},
						{ status: 400 },
					);
				}
				const casted = normalizedPriorities.filter((value): value is SearchPriorityFilter => Boolean(value));
				filters.priority = casted.length === 1 ? casted[0] : casted;
			}

			if (projectParamsRaw.length > 0) {
				const config = await this.core.filesystem.loadConfig();
				if (getProjectValues(config).length === 0) {
					return Response.json(
						{ error: noProjectsConfiguredMessage(this.core.filesystem.configFilePath) },
						{ status: 400 },
					);
				}
				const { values: canonicalProjects, invalid } = resolveProjectValues(projectParamsRaw, config);
				if (invalid.length > 0) {
					return Response.json(
						{
							error: `Unsupported project '${invalid[0]}'. Use ${formatValidProjectValues(config)}.`,
						},
						{ status: 400 },
					);
				}
				filters.project = canonicalProjects.length === 1 ? canonicalProjects[0] : canonicalProjects;
			}

			if (assigneeParamsRaw.length > 0) {
				const normalizedAssignees = assigneeParamsRaw.map((value) => value.trim()).filter((value) => value.length > 0);
				if (normalizedAssignees.length > 0) {
					filters.assignee = normalizedAssignees.length === 1 ? normalizedAssignees[0] : normalizedAssignees;
				}
			}

			if (labelParamsRaw.length > 0) {
				const normalizedLabels = labelParamsRaw.map((value) => value.trim()).filter((value) => value.length > 0);
				if (normalizedLabels.length > 0) {
					filters.labels = normalizedLabels.length === 1 ? normalizedLabels[0] : normalizedLabels;
				}
			}

			if (modifiedFileParamsRaw.length > 0) {
				const normalizedModifiedFiles = modifiedFileParamsRaw
					.map((value) => value.trim())
					.filter((value) => value.length > 0);
				if (normalizedModifiedFiles.length > 0) {
					filters.modifiedFiles =
						normalizedModifiedFiles.length === 1 ? normalizedModifiedFiles[0] : normalizedModifiedFiles;
				}
			}

			const servicesWereReady = this.servicesInitialized;
			const searchService = await this.getSearchServiceInstance();
			if (servicesWereReady && (!types || types.includes("task"))) {
				await this.core.refreshTasksForTaskRead();
			}

			const store = await this.getContentStoreInstance();
			for (let attempt = 0; attempt < 3; attempt++) {
				const version = store.publicationVersion();
				const results = searchService.search({ query, limit, types, filters });
				const versioned = this.centralMode
					? await Promise.all(
							results.map(async (result) => {
								switch (result.type) {
									case "task":
										return { ...result, task: await this.versionRecord(result.task, "task", "active", context) };
									case "document":
										return {
											...result,
											document: await this.versionRecord(result.document, "document", "active", context),
										};
									case "decision":
										return {
											...result,
											decision: await this.versionRecord(result.decision, "decision", "active", context),
										};
								}
							}),
						)
					: results;
				const headers = await this.taskCollectionHeader(context);
				if (!this.centralMode || version === store.publicationVersion()) return Response.json(versioned, { headers });
			}
			throw new MutationError(
				"Search collection changed while it was read. Retry the request.",
				409,
				"REVISION_CONFLICT",
			);
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error performing search:", error);
			return Response.json({ error: "Search failed" }, { status: 500 });
		}
	}

	private async handleCreateTask(req: Request): Promise<Response> {
		const payload = await req.json();

		if (!payload || typeof payload.title !== "string" || payload.title.trim().length === 0) {
			return Response.json({ error: "Title is required" }, { status: 400 });
		}
		const dueDate = parseDueDatePayload(payload.dueDate, false);
		if (!dueDate.ok) return Response.json({ error: dueDate.error }, { status: 400 });

		const acceptanceCriteria = Array.isArray(payload.acceptanceCriteriaItems)
			? payload.acceptanceCriteriaItems
					.map((item: { text?: string; checked?: boolean }) => ({
						text: String(item?.text ?? "").trim(),
						checked: Boolean(item?.checked),
					}))
					.filter((item: { text: string }) => item.text.length > 0)
			: [];
		const definitionOfDoneAdd = Array.isArray(payload.definitionOfDoneAdd)
			? payload.definitionOfDoneAdd
					.map((item: unknown) => String(item ?? "").trim())
					.filter((item: string) => item.length > 0)
			: [];
		const disableDefinitionOfDoneDefaults = Boolean(payload.disableDefinitionOfDoneDefaults);

		try {
			const milestone =
				typeof payload.milestone === "string" ? await this.resolveMilestoneInput(payload.milestone) : undefined;

			const { task: createdTask } = await this.core.createTaskFromInput({
				title: payload.title,
				dueDate: dueDate.value ?? undefined,
				description: payload.description,
				status: payload.status,
				priority: payload.priority,
				type: typeof payload.type === "string" ? payload.type : undefined,
				project: typeof payload.project === "string" ? payload.project : undefined,
				milestone,
				labels: payload.labels,
				assignee: payload.assignee,
				dependencies: payload.dependencies,
				references: payload.references,
				modifiedFiles: payload.modifiedFiles,
				parentTaskId: payload.parentTaskId,
				implementationPlan: payload.implementationPlan,
				implementationNotes: payload.implementationNotes,
				finalSummary: payload.finalSummary,
				acceptanceCriteria,
				definitionOfDoneAdd,
				disableDefinitionOfDoneDefaults,
			});
			return Response.json(createdTask, { status: 201 });
		} catch (error) {
			if (isCreateLockError(error)) {
				const message = error instanceof Error ? error.message : "Failed to create task";
				return this.conflictResponse(error, message);
			}
			const message = formatErrorForWeb(error instanceof Error ? error.message : "Failed to create task");
			return Response.json({ error: message }, { status: 400 });
		}
	}

	/**
	 * Resolve the one task a detail read is about, or the response that explains why it could not be
	 * resolved. Shared so every detail endpoint fails closed on an ambiguous ID the same way.
	 */
	private async resolveDetailTask(taskId: string): Promise<Task | Response> {
		if (!isValidTaskId(taskId)) return Response.json({ error: `Invalid task ID: ${taskId}` }, { status: 400 });
		if (isDraftId(taskId)) {
			try {
				const draft = await this.core.filesystem.loadDraft(taskId);
				return draft ?? Response.json({ error: `Task ${taskId} not found` }, { status: 404 });
			} catch (error) {
				if (isAmbiguousIdError(error)) {
					return this.conflictResponse(error, error.message);
				}
				throw error;
			}
		}
		let resolvedTask: Task | null;
		try {
			resolvedTask = await this.core.getTask(taskId);
		} catch (error) {
			if (!isAmbiguousTaskIdError(error)) throw error;
			const message = error.candidates.some((candidate) => !isAbsolute(candidate))
				? `Task ID ${taskId} is ambiguous. Repair duplicate task IDs before opening it.`
				: error.message;
			return this.conflictResponse(error, message);
		}
		return resolvedTask ?? Response.json({ error: `Task ${taskId} not found` }, { status: 404 });
	}

	/**
	 * One task, as a detail read returns it: the record plus the relationships derived at read time,
	 * so the browser gets the dependency graph in the same response that opens the task.
	 */
	private async handleGetTask(taskId: string, context?: ProjectReadContext): Promise<Response> {
		const resolved = await this.resolveDetailTask(taskId);
		if (resolved instanceof Response) return resolved;
		await this.ensureServicesReady();
		const detail = {
			...(await loadTaskDetail(this.core, resolved, { includeCrossBranch: !this.centralMode })),
			...(resolved.source === "archived" && { archived: true }),
		};
		const record = await this.versionRecord(
			resolved,
			"task",
			resolved.source === "archived" ? "archived" : isDraftId(resolved.id) ? "draft" : "active",
			context,
		);
		return Response.json(
			{ ...detail, ...(record.recordKey && { recordKey: record.recordKey, revision: record.revision }) },
			{
				headers: record.revision ? { ETag: record.revision } : undefined,
			},
		);
	}

	private async handleUpdateTask(req: Request, taskId: string): Promise<Response> {
		const updates = await req.json();
		const dueDate = parseDueDatePayload(updates?.dueDate, true);
		if (!dueDate.ok) return Response.json({ error: dueDate.error }, { status: 400 });

		const updateInput: TaskUpdateInput = {};
		for (const [field, inputField] of [
			["definitionOfDoneRemove", "removeDefinitionOfDone"],
			["definitionOfDoneCheck", "checkDefinitionOfDone"],
			["definitionOfDoneUncheck", "uncheckDefinitionOfDone"],
		] as const) {
			if (!(field in updates)) continue;
			const indices = updates[field];
			if (
				!Array.isArray(indices) ||
				indices.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value))
			) {
				return Response.json({ error: `${field} must be an array of finite numbers.` }, { status: 400 });
			}
			updateInput[inputField] = indices;
		}

		if ("title" in updates && typeof updates.title === "string") {
			updateInput.title = updates.title;
		}

		if ("dueDate" in updates) {
			updateInput.dueDate = dueDate.value ?? null;
		}

		if ("description" in updates && typeof updates.description === "string") {
			updateInput.description = updates.description;
		}

		if ("status" in updates && typeof updates.status === "string") {
			updateInput.status = updates.status;
		}

		if ("priority" in updates && typeof updates.priority === "string") {
			updateInput.priority = updates.priority;
		}

		if ("type" in updates && typeof updates.type === "string") {
			updateInput.type = updates.type;
		}

		if ("project" in updates && (typeof updates.project === "string" || updates.project === null)) {
			updateInput.project = updates.project;
		}

		if ("milestone" in updates && (typeof updates.milestone === "string" || updates.milestone === null)) {
			if (typeof updates.milestone === "string") {
				updateInput.milestone = await this.resolveMilestoneInput(updates.milestone);
			} else {
				updateInput.milestone = updates.milestone;
			}
		}

		if ("labels" in updates && Array.isArray(updates.labels)) {
			updateInput.labels = updates.labels;
		}

		if ("assignee" in updates && Array.isArray(updates.assignee)) {
			updateInput.assignee = updates.assignee;
		}

		if ("dependencies" in updates && Array.isArray(updates.dependencies)) {
			updateInput.dependencies = updates.dependencies;
		}

		if ("references" in updates && Array.isArray(updates.references)) {
			updateInput.references = updates.references;
		}

		if ("modifiedFiles" in updates && Array.isArray(updates.modifiedFiles)) {
			updateInput.modifiedFiles = updates.modifiedFiles;
		}

		if ("implementationPlan" in updates && typeof updates.implementationPlan === "string") {
			updateInput.implementationPlan = updates.implementationPlan;
		}

		if ("implementationNotes" in updates && typeof updates.implementationNotes === "string") {
			updateInput.implementationNotes = updates.implementationNotes;
		}

		if ("commentsAppend" in updates && Array.isArray(updates.commentsAppend)) {
			const author =
				typeof updates.commentAuthor === "string" && updates.commentAuthor.trim().length > 0
					? updates.commentAuthor.trim()
					: undefined;
			updateInput.appendComments = updates.commentsAppend
				.map((body: unknown) => ({
					body: String(body ?? "").trim(),
					...(author && { author }),
				}))
				.filter((comment: { body: string }) => comment.body.length > 0);
		}

		if ("finalSummary" in updates && typeof updates.finalSummary === "string") {
			updateInput.finalSummary = updates.finalSummary;
		}

		if ("acceptanceCriteriaItems" in updates && Array.isArray(updates.acceptanceCriteriaItems)) {
			updateInput.acceptanceCriteria = updates.acceptanceCriteriaItems
				.map((item: { text?: string; checked?: boolean }) => ({
					text: String(item?.text ?? "").trim(),
					checked: Boolean(item?.checked),
				}))
				.filter((item: { text: string }) => item.text.length > 0);
		}

		if ("definitionOfDoneAdd" in updates && Array.isArray(updates.definitionOfDoneAdd)) {
			updateInput.addDefinitionOfDone = updates.definitionOfDoneAdd
				.map((item: unknown) => ({ text: String(item ?? "").trim(), checked: false }))
				.filter((item: { text: string }) => item.text.length > 0);
		}

		try {
			// editTaskOrDraft keeps a draft a draft, or promotes it when a real status is requested.
			const updatedTask = isDraftId(taskId)
				? (await this.core.editTaskOrDraft(taskId, updateInput)).task
				: await this.core.updateTaskFromInput(taskId, updateInput);
			return Response.json(updatedTask);
		} catch (error) {
			const message = formatErrorForWeb(error instanceof Error ? error.message : "Failed to update task");
			// Editing a task into the Draft status demotes it, so the same "already moved" report the
			// demote endpoint makes applies here: refresh, and do not invite a retry.
			const demotionState = readMovedState(error, "demotionState");
			if (demotionState) {
				this.broadcastDataUpdated();
				const demotionFailureCause = readDemotionFailureCause(error);
				return Response.json(
					{ error: message, demotionState, ...(demotionFailureCause ? { demotionFailureCause } : {}) },
					{ status: 500 },
				);
			}
			const conflict = isAmbiguousIdError(error) || isAmbiguousTaskIdError(error) || isTaskLockError(error);
			return conflict ? this.conflictResponse(error, message) : Response.json({ error: message }, { status: 400 });
		}
	}

	/**
	 * POST /api/docs/<id>/archive and POST /api/decisions/<id>/archive: the archive the CLI runs, for
	 * the Archive button of the document and decision pages. Core decides everything; this maps its
	 * answer to HTTP the way the task archive route does: 404 when no record claims the ID, 409 for an
	 * ambiguous ID, 400 with core's message for a refusal, and 500 with `archiveState` when the record
	 * moved and only the commit failed, so the page treats it as archived.
	 */
	private async handleArchiveContentRecord(kind: ContentRecordKind, id: string): Promise<Response> {
		try {
			const result = await this.core.archiveContentRecord(kind, id);
			if (!result) {
				return Response.json({ error: CONTENT_RECORD_WORDS[kind].notFound(id) }, { status: 404 });
			}
			this.broadcastDataUpdated();
			return Response.json({ success: true, ...result });
		} catch (error) {
			if (isAmbiguousIdError(error)) {
				return this.conflictResponse(error, error.message);
			}
			if (error instanceof RecordRefusedError) {
				return Response.json({ error: error.message }, { status: 400 });
			}
			const archiveState = readMovedState(error, "archiveState");
			if (archiveState) {
				this.broadcastDataUpdated();
				console.error(`Error archiving ${kind} after it moved:`, error);
				return Response.json({ error: (error as Error).message, archiveState }, { status: 500 });
			}
			throw error;
		}
	}

	private async handleListArchived(kind: "task" | ContentRecordKind, context?: ProjectReadContext): Promise<Response> {
		const records = await (kind === "task"
			? this.core.filesystem.listArchivedTasks()
			: kind === "document"
				? this.core.filesystem.listArchivedDocuments()
				: this.core.filesystem.listArchivedDecisions());
		const versioned = this.centralMode
			? await Promise.all(records.map((record) => this.versionRecord(record, kind, "archived", context)))
			: records;
		return Response.json(versioned.map((record) => ({ ...record, archived: true })));
	}

	private async handleRecordLifecycle(
		kind: "task" | ContentRecordKind,
		id: string,
		operation: "restore" | "delete",
	): Promise<Response> {
		try {
			const result =
				kind === "task"
					? operation === "restore"
						? await this.core.restoreTask(id)
						: await this.core.deleteTask(id)
					: operation === "restore"
						? await this.core.restoreContentRecord(kind, id)
						: await this.core.deleteContentRecord(kind, id);
			if (!result || (typeof result === "object" && "success" in result && !result.success)) {
				return Response.json(
					{ error: kind === "task" ? taskNotFoundMessage(id) : CONTENT_RECORD_WORDS[kind].notFound(id) },
					{ status: 404 },
				);
			}
			this.broadcastDataUpdated();
			return Response.json({ success: true, ...(typeof result === "object" ? result : {}) });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (
				isAmbiguousIdError(error) ||
				isAmbiguousTaskIdError(error) ||
				isTaskLockError(error) ||
				isCreateLockError(error)
			) {
				return this.conflictResponse(error, message);
			}
			if (error instanceof RecordRefusedError) return Response.json({ error: message }, { status: 400 });
			if (error instanceof ChangeNotCommittedError || error instanceof TaskDeletionAppliedError) {
				this.broadcastDataUpdated();
				return Response.json(
					{ error: message, ...(operation === "restore" ? { restoreState: "moved" } : { deleteState: "applied" }) },
					{ status: 500 },
				);
			}
			throw error;
		}
	}

	private async handleArchiveTask(taskId: string): Promise<Response> {
		try {
			if (!(await this.core.archiveTask(taskId))) {
				return Response.json({ error: taskNotFoundMessage(taskId) }, { status: 404 });
			}
			this.broadcastDataUpdated();
			return Response.json({ success: true });
		} catch (error) {
			if (error instanceof RecordRefusedError) {
				return Response.json({ error: error.message }, { status: 400 });
			}
			// The task reached the archive and the commit after that failed. Say so, and refresh:
			// a client told only "error" would offer to archive a task that is already archived.
			const archiveState = readMovedState(error, "archiveState");
			if (archiveState) {
				this.broadcastDataUpdated();
				const message = error instanceof Error ? error.message : "Failed to archive task";
				console.error("Error archiving task after it moved:", error);
				return Response.json({ error: message, archiveState }, { status: 500 });
			}
			if (isAmbiguousTaskIdError(error) || isTaskLockError(error) || isCreateLockError(error)) {
				return this.conflictResponse(error, error.message);
			}
			throw error;
		}
	}

	private async handleDemoteTask(taskId: string): Promise<Response> {
		try {
			const { success, cleanedTaskIds } = await this.core.demoteTask(taskId);
			if (!success) {
				return Response.json({ error: taskNotFoundMessage(taskId) }, { status: 404 });
			}

			this.broadcastDataUpdated();
			return Response.json({ success: true, cleanedTaskIds });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to demote task";
			const conflict = isAmbiguousTaskIdError(error) || isCreateLockError(error) || isTaskLockError(error);
			const knownDemotionState = readMovedState(error, "demotionState");
			const demotionFailureCause = readDemotionFailureCause(error);
			if (knownDemotionState) {
				this.broadcastDataUpdated();
			}
			if (!conflict) {
				console.error("Error demoting task:", error);
			}
			const status = knownDemotionState ? 500 : conflict ? 409 : 500;
			return Response.json(
				{
					error: message,
					...(conflict && this.centralMode
						? { code: isAmbiguousTaskIdError(error) ? "AMBIGUOUS_ID" : "WRITE_LOCKED" }
						: {}),
					...(knownDemotionState ? { demotionState: knownDemotionState } : {}),
					...(demotionFailureCause ? { demotionFailureCause } : {}),
				},
				{ status },
			);
		}
	}

	private async handleGetStatuses(): Promise<Response> {
		const statuses = await getValidStatuses(this.core);
		return Response.json(statuses);
	}

	// Documentation handlers
	private async handleListDocs(context?: ProjectReadContext): Promise<Response> {
		try {
			const store = await this.getContentStoreInstance();
			const docs = store.getDocuments();
			const versioned = this.centralMode
				? await Promise.all(docs.map((doc) => this.versionRecord(doc, "document", "active", context)))
				: docs;
			const docFiles = versioned.map((doc) => ({
				name: doc.path?.split(/[\\/]+/).pop() ?? `${doc.title}.md`,
				id: doc.id,
				title: doc.title,
				type: doc.type,
				path: doc.path,
				createdDate: doc.createdDate,
				updatedDate: doc.updatedDate,
				lastModified: doc.updatedDate || doc.createdDate,
				tags: doc.tags || [],
				...(doc.recordKey && { recordKey: doc.recordKey, revision: doc.revision }),
			}));
			return Response.json(docFiles);
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error listing documents:", error);
			return Response.json([]);
		}
	}

	private async handleGetDoc(docId: string, context?: ProjectReadContext): Promise<Response> {
		try {
			const doc = await this.core.getDocument(docId);
			if (!doc) {
				return Response.json({ error: "Document not found" }, { status: 404 });
			}
			const versioned = await this.versionRecord(doc, "document", doc.archived ? "archived" : "active", context);
			return Response.json(versioned, { headers: versioned.revision ? { ETag: versioned.revision } : undefined });
		} catch (error) {
			if (error instanceof MutationError) throw error;
			if (isAmbiguousIdError(error)) {
				return this.conflictResponse(error, error.message);
			}
			console.error("Error loading document:", error);
			return Response.json({ error: "Document not found" }, { status: 404 });
		}
	}

	private async handleCreateDoc(req: Request): Promise<Response> {
		try {
			const body = await req.json();
			const filename = typeof body?.filename === "string" ? body.filename : undefined;
			const title = typeof body?.title === "string" ? body.title : filename?.replace(/\.md$/i, "");
			if (!title || title.trim().length === 0) {
				return Response.json({ error: "Document title is required" }, { status: 400 });
			}
			const type = parseDocumentType(body?.type);
			const path = parseCreateDocumentPath(body?.path);
			const tags = parseDocumentTags(body?.tags);

			const document = await this.core.createDocumentFromInput({
				title,
				content: typeof body?.content === "string" ? body.content : "",
				type,
				path,
				tags,
			});
			return Response.json({ success: true, ...document }, { status: 201 });
		} catch (error) {
			if (error instanceof SyntaxError) {
				return Response.json({ error: "Invalid request payload" }, { status: 400 });
			}
			if (error instanceof Error && isDocumentValidationError(error)) {
				return Response.json({ error: error.message }, { status: 400 });
			}
			console.error("Error creating document:", error);
			return Response.json({ error: "Failed to create document" }, { status: 500 });
		}
	}

	private async handleUpdateDoc(req: Request, docId: string): Promise<Response> {
		try {
			const body = await req.json();
			const content = typeof body?.content === "string" ? body.content : undefined;
			const title = typeof body?.title === "string" ? body.title : undefined;
			const path = parseUpdateDocumentPath(body?.path);
			const type = parseDocumentType(body?.type);
			const tags = parseDocumentTags(body?.tags);

			if (typeof content !== "string") {
				return Response.json({ error: "Document content is required" }, { status: 400 });
			}

			let normalizedTitle: string | undefined;

			if (typeof title === "string") {
				normalizedTitle = title.trim();
				if (normalizedTitle.length === 0) {
					return Response.json({ error: "Document title cannot be empty" }, { status: 400 });
				}
			}

			const document = await this.core.updateDocumentFromInput({
				id: docId,
				content,
				...(normalizedTitle && { title: normalizedTitle }),
				...(path !== undefined && { path }),
				...(type !== undefined && { type }),
				...(tags !== undefined && { tags }),
			});
			return Response.json({ success: true, ...document });
		} catch (error) {
			if (error instanceof SyntaxError) {
				return Response.json({ error: "Invalid request payload" }, { status: 400 });
			}
			if (isAmbiguousIdError(error)) {
				return this.conflictResponse(error, error.message);
			}
			// Core refused the save, for example because the document is archived. Its message is the answer.
			if (error instanceof RecordRefusedError) {
				return Response.json({ error: error.message }, { status: 400 });
			}
			if (error instanceof Error) {
				if (error.message.startsWith("Document not found")) {
					return Response.json({ error: error.message }, { status: 404 });
				}
				if (isDocumentValidationError(error)) {
					return Response.json({ error: error.message }, { status: 400 });
				}
			}
			console.error("Error updating document:", error);
			return Response.json({ error: "Failed to update document" }, { status: 500 });
		}
	}

	// Decision handlers
	private async handleListDecisions(context?: ProjectReadContext): Promise<Response> {
		try {
			const store = await this.getContentStoreInstance();
			const decisions = store.getDecisions();
			const versioned = this.centralMode
				? await Promise.all(decisions.map((decision) => this.versionRecord(decision, "decision", "active", context)))
				: decisions;
			const decisionFiles = versioned.map((decision) => ({
				id: decision.id,
				title: decision.title,
				status: decision.status,
				date: decision.date,
				context: decision.context,
				decision: decision.decision,
				consequences: decision.consequences,
				alternatives: decision.alternatives,
				...(decision.recordKey && { recordKey: decision.recordKey, revision: decision.revision }),
			}));
			return Response.json(decisionFiles);
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error listing decisions:", error);
			return Response.json([]);
		}
	}

	private async handleGetDecision(decisionId: string, context?: ProjectReadContext): Promise<Response> {
		try {
			// Resolve from disk through core, not the content store: the store keys decisions by raw ID
			// and would silently drop one of two files that share an ID before the ambiguity check
			// could run. Core searches the decisions folder and the archive together.
			const decision = await this.core.getDecision(decisionId);

			if (!decision) {
				return Response.json({ error: "Decision not found" }, { status: 404 });
			}

			const versioned = await this.versionRecord(
				decision,
				"decision",
				decision.archived ? "archived" : "active",
				context,
			);
			return Response.json(versioned, { headers: versioned.revision ? { ETag: versioned.revision } : undefined });
		} catch (error) {
			if (error instanceof MutationError) throw error;
			if (isAmbiguousIdError(error)) {
				return this.conflictResponse(error, error.message);
			}
			console.error("Error loading decision:", error);
			return Response.json({ error: "Decision not found" }, { status: 404 });
		}
	}

	private async handleCreateDecision(req: Request): Promise<Response> {
		const { title } = await req.json();

		try {
			const decision = await this.core.createDecisionWithTitle(title);
			return Response.json(decision, { status: 201 });
		} catch (error) {
			console.error("Error creating decision:", error);
			return Response.json({ error: "Failed to create decision" }, { status: 500 });
		}
	}

	private async checkDecisionWriteAuthorization(
		req: Request,
		decisionId: string,
		authorization: ProjectAuthorization,
		content?: string,
	): Promise<{ denied: Response | null; requiresManage: boolean }> {
		let current: Awaited<ReturnType<Core["getDecision"]>>;
		try {
			current = await this.core.getDecision(decisionId);
		} catch (error) {
			if (isAmbiguousIdError(error))
				return { denied: this.conflictResponse(error, error.message), requiresManage: false };
			throw error;
		}
		if (!current)
			return { denied: Response.json({ error: "Decision not found" }, { status: 404 }), requiresManage: false };
		// Use Core's parser and fallback for both first execution and authorized replay.
		const nextStatus = parseFrontmatter(content ?? (await req.clone().text())).data.status || current.status;
		const requiresManage = current.status !== "proposed" || nextStatus !== current.status;
		return { denied: requiresManage ? authorization.check("decisionsManage") : null, requiresManage };
	}

	private async handleUpdateDecision(
		req: Request,
		decisionId: string,
		authorization?: ProjectAuthorization,
	): Promise<Response> {
		const content = await req.text();

		try {
			if (authorization) {
				const permission = await this.checkDecisionWriteAuthorization(req, decisionId, authorization, content);
				if (permission.requiresManage) {
					(req as Request & { [DECISION_MANAGE_RECHECK]?: boolean })[DECISION_MANAGE_RECHECK] = true;
				}
				if (permission.denied) return permission.denied;
			}
			await this.core.updateDecisionFromContent(decisionId, content);
			return Response.json({ success: true });
		} catch (error) {
			if (isAmbiguousIdError(error)) {
				return this.conflictResponse(error, error.message);
			}
			// Core refused the save, for example because the decision is archived. Its message is the answer.
			if (error instanceof RecordRefusedError) {
				return Response.json({ error: error.message }, { status: 400 });
			}
			if (error instanceof Error && error.message.includes("not found")) {
				return Response.json({ error: "Decision not found" }, { status: 404 });
			}
			console.error("Error updating decision:", error);
			return Response.json({ error: "Failed to update decision" }, { status: 500 });
		}
	}

	private async handleGetConfig(context?: ProjectReadContext): Promise<Response> {
		try {
			const fs = this.core.filesystem;
			const path = fs.configFilePath;
			const bytes = this.centralMode ? await fs.readBytes(path).catch(() => null) : null;
			const config = bytes ? fs.parseConfig(new TextDecoder().decode(bytes)) : await fs.loadConfig();
			if (!config) {
				return Response.json({ error: "Configuration not found" }, { status: 404 });
			}
			if (!this.centralMode) return Response.json(config);
			if (!bytes) throw new MutationError("Configuration version is unavailable.", 503, "RECOVERY_REQUIRED");
			const recordKey = await context?.recordKeyFor?.("config", "config", path, { lifecycle: "active", bytes });
			if (!recordKey) {
				throw new MutationError("Configuration version is unavailable.", 503, "RECOVERY_REQUIRED");
			}
			const revision = recordRevision(recordKey, path, "active", bytes);
			return Response.json(
				{ ...config, projectName: this.projectName, recordKey, revision },
				{ headers: { ETag: revision } },
			);
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error loading config:", error);
			return Response.json({ error: "Failed to load configuration" }, { status: 500 });
		}
	}

	private async handleUpdateConfig(req: Request): Promise<Response> {
		try {
			const updatedConfig = await req.json();
			if (this.centralMode) {
				if (!updatedConfig || typeof updatedConfig !== "object" || Array.isArray(updatedConfig)) {
					return Response.json({ error: "Configuration must be an object." }, { status: 400 });
				}
				const allowed = new Set([
					"defaultStatus",
					"definitionOfDone",
					"dateFormat",
					"hideEmptyColumns",
					"maxColumnWidth",
				]);
				const forbidden = Object.keys(updatedConfig).filter((key) => !allowed.has(key));
				if (forbidden.length)
					return Response.json({ error: `Unsupported settings: ${forbidden.join(", ")}` }, { status: 400 });
				const current = await this.core.filesystem.loadConfig();
				if (!current) return Response.json({ error: "Configuration not found" }, { status: 503 });
				if (
					(updatedConfig.defaultStatus !== undefined &&
						(typeof updatedConfig.defaultStatus !== "string" ||
							!current.statuses.includes(updatedConfig.defaultStatus))) ||
					(updatedConfig.definitionOfDone !== undefined &&
						(!Array.isArray(updatedConfig.definitionOfDone) ||
							updatedConfig.definitionOfDone.some((item: unknown) => typeof item !== "string"))) ||
					(updatedConfig.dateFormat !== undefined && typeof updatedConfig.dateFormat !== "string") ||
					(updatedConfig.hideEmptyColumns !== undefined && typeof updatedConfig.hideEmptyColumns !== "boolean") ||
					(updatedConfig.maxColumnWidth !== undefined &&
						(!Number.isInteger(updatedConfig.maxColumnWidth) || updatedConfig.maxColumnWidth < 1))
				) {
					return Response.json({ error: "Invalid setting value." }, { status: 400 });
				}
				const merged = { ...current, ...updatedConfig };
				await this.core.filesystem.saveConfig(merged);
				return Response.json({ ...merged, projectName: this.projectName });
			}

			// Validate configuration
			if (!updatedConfig.projectName?.trim()) {
				return Response.json({ error: "Project name is required" }, { status: 400 });
			}

			if (updatedConfig.defaultPort && (updatedConfig.defaultPort < 1 || updatedConfig.defaultPort > 65535)) {
				return Response.json({ error: "Port must be between 1 and 65535" }, { status: 400 });
			}

			// Save configuration
			await this.core.filesystem.saveConfig(updatedConfig);

			// Update local project name if changed
			if (updatedConfig.projectName !== this.projectName) {
				this.projectName = updatedConfig.projectName;
			}

			return Response.json(updatedConfig);
		} catch (error) {
			console.error("Error updating config:", error);
			return Response.json({ error: "Failed to update configuration" }, { status: 500 });
		}
	}

	private handleError(error: Error): Response {
		console.error("Server Error:", error);
		return new Response("Internal Server Error", { status: 500 });
	}

	// Draft handlers
	private async handleListDrafts(context?: ProjectReadContext): Promise<Response> {
		try {
			const drafts = await this.core.filesystem.listDrafts();
			const versioned = this.centralMode
				? await Promise.all(drafts.map((draft) => this.versionRecord(draft, "task", "draft", context)))
				: drafts;
			return Response.json(versioned);
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error listing drafts:", error);
			return Response.json([]);
		}
	}

	private async handlePromoteDraft(draftId: string): Promise<Response> {
		try {
			const success = await this.core.promoteDraft(draftId);
			if (!success) {
				return Response.json({ error: "Draft not found" }, { status: 404 });
			}
			return Response.json({ success: true });
		} catch (error) {
			console.error("Error promoting draft:", error);
			if (isCreateLockError(error) || isAmbiguousIdError(error) || isTaskLockError(error)) {
				return this.conflictResponse(error, error.message);
			}
			return Response.json({ error: "Failed to promote draft" }, { status: 500 });
		}
	}

	// Milestone handlers
	private async readOptionalJsonBody(req: Request): Promise<Record<string, unknown>> {
		const text = await req.text();
		if (!text.trim()) {
			return {};
		}

		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new BacklogToolError("Request body must be valid JSON.", "VALIDATION_ERROR");
		}

		if (!body || typeof body !== "object" || Array.isArray(body)) {
			throw new BacklogToolError("Request body must be a JSON object.", "VALIDATION_ERROR");
		}

		return body as Record<string, unknown>;
	}

	private getMilestoneMutationMessage(result: { content: Array<{ type: string; text?: string }> }): string {
		return result.content
			.filter((item) => item.type === "text" && typeof item.text === "string")
			.map((item) => item.text)
			.join("\n");
	}

	private milestoneMutationErrorResponse(error: unknown, context: string): Response {
		const status =
			error instanceof BacklogToolError
				? error.code === "NOT_FOUND"
					? 404
					: error.code === "VALIDATION_ERROR"
						? 400
						: 500
				: 500;
		const message = error instanceof Error ? error.message : context;
		if (status === 500) {
			console.error(context, error);
		}
		return Response.json(
			{ error: message, code: error instanceof BacklogToolError ? error.code : "INTERNAL_ERROR" },
			{ status },
		);
	}

	private async handleListMilestones(context?: ProjectReadContext): Promise<Response> {
		try {
			const milestones = await this.core.filesystem.listMilestones();
			const versioned = this.centralMode
				? await Promise.all(
						milestones.map((milestone) => this.versionRecord(milestone, "milestone", "active", context)),
					)
				: milestones;
			return Response.json(versioned);
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error listing milestones:", error);
			return Response.json([]);
		}
	}

	private async handleListArchivedMilestones(context?: ProjectReadContext): Promise<Response> {
		try {
			const milestones = await this.core.filesystem.listArchivedMilestones();
			const versioned = this.centralMode
				? await Promise.all(
						milestones.map((milestone) => this.versionRecord(milestone, "milestone", "archived", context)),
					)
				: milestones;
			return Response.json(versioned);
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error listing archived milestones:", error);
			return Response.json([]);
		}
	}

	private async handleGetMilestone(milestoneId: string, context?: ProjectReadContext): Promise<Response> {
		try {
			const milestone = await this.core.filesystem.loadMilestone(milestoneId);
			if (!milestone) {
				return Response.json({ error: "Milestone not found" }, { status: 404 });
			}
			const versioned = await this.versionRecord(milestone, "milestone", "active", context);
			return Response.json(versioned, { headers: versioned.revision ? { ETag: versioned.revision } : undefined });
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error loading milestone:", error);
			return Response.json({ error: "Milestone not found" }, { status: 404 });
		}
	}

	private async handleCreateMilestone(req: Request): Promise<Response> {
		try {
			const body = (await req.json()) as { title?: string; description?: string; dueDate?: unknown };
			const title = body.title?.trim();

			if (!title) {
				return Response.json({ error: "Milestone title is required" }, { status: 400 });
			}
			const dueDate = parseDueDatePayload(body.dueDate, false);
			if (!dueDate.ok) return Response.json({ error: dueDate.error }, { status: 400 });

			// Check for duplicates
			const existingMilestones = await this.core.filesystem.listMilestones();
			const buildAliasKeys = (value: string): Set<string> => {
				const normalized = value.trim().toLowerCase();
				const keys = new Set<string>();
				if (!normalized) {
					return keys;
				}
				keys.add(normalized);
				if (/^\d+$/.test(normalized)) {
					const numeric = String(Number.parseInt(normalized, 10));
					keys.add(numeric);
					keys.add(`m-${numeric}`);
					return keys;
				}
				const match = normalized.match(/^m-(\d+)$/);
				if (match?.[1]) {
					const numeric = String(Number.parseInt(match[1], 10));
					keys.add(numeric);
					keys.add(`m-${numeric}`);
				}
				return keys;
			};
			const requestedKeys = buildAliasKeys(title);
			const duplicate = existingMilestones.find((milestone) => {
				const milestoneKeys = new Set<string>([...buildAliasKeys(milestone.id), ...buildAliasKeys(milestone.title)]);
				for (const key of requestedKeys) {
					if (milestoneKeys.has(key)) {
						return true;
					}
				}
				return false;
			});
			if (duplicate) {
				return Response.json({ error: "A milestone with this title or ID already exists" }, { status: 400 });
			}

			const milestone = await this.core.filesystem.createMilestone(title, body.description, dueDate.value ?? undefined);
			this.broadcastDataUpdated("milestones");
			return Response.json(milestone, { status: 201 });
		} catch (error) {
			console.error("Error creating milestone:", error);
			return Response.json({ error: "Failed to create milestone" }, { status: 500 });
		}
	}

	private async handleUpdateMilestone(req: Request, milestoneId: string): Promise<Response> {
		try {
			const body = await this.readOptionalJsonBody(req);
			const title = typeof body.title === "string" ? body.title.trim() : "";
			const updateTasks = typeof body.updateTasks === "boolean" ? body.updateTasks : true;
			const dueDate = parseDueDatePayload(body.dueDate, true);
			if (!dueDate.ok) return Response.json({ error: dueDate.error }, { status: 400 });

			if (!title) {
				return Response.json({ error: "Milestone title is required" }, { status: 400 });
			}

			const sourceMilestone = await this.core.filesystem.loadMilestone(milestoneId);
			const result = await new MilestoneHandlers(this.core).renameMilestone({
				from: milestoneId,
				to: title,
				updateTasks,
				dueDate: "dueDate" in body ? (dueDate.value ?? null) : undefined,
			});
			const milestone =
				(this.centralMode && sourceMilestone ? this.core.filesystem.preparedMilestone(sourceMilestone.id) : null) ??
				(await this.core.filesystem.loadMilestone(sourceMilestone?.id ?? milestoneId)) ??
				(await this.core.filesystem.loadMilestone(title));
			this.broadcastDataUpdated("milestones");
			return Response.json({
				success: true,
				milestone: milestone ?? null,
				message: this.getMilestoneMutationMessage(result),
			});
		} catch (error) {
			return this.milestoneMutationErrorResponse(error, "Error updating milestone");
		}
	}

	private async handleRemoveMilestone(req: Request, milestoneId: string): Promise<Response> {
		try {
			const body = await this.readOptionalJsonBody(req);
			const rawTaskHandling = body.taskHandling;
			const taskHandling =
				rawTaskHandling === undefined
					? "clear"
					: rawTaskHandling === "clear" || rawTaskHandling === "keep" || rawTaskHandling === "reassign"
						? rawTaskHandling
						: null;
			const reassignTo = typeof body.reassignTo === "string" ? body.reassignTo : undefined;

			if (!taskHandling) {
				return Response.json({ error: "taskHandling must be clear, keep, or reassign" }, { status: 400 });
			}

			const result = await new MilestoneHandlers(this.core).removeMilestone({
				name: milestoneId,
				taskHandling,
				reassignTo,
			});
			this.broadcastDataUpdated("milestones");
			return Response.json({
				success: true,
				message: this.getMilestoneMutationMessage(result),
			});
		} catch (error) {
			return this.milestoneMutationErrorResponse(error, "Error removing milestone");
		}
	}

	private async handleArchiveMilestone(milestoneId: string): Promise<Response> {
		try {
			const result = await this.core.archiveMilestone(milestoneId);
			if (!result.success) {
				return Response.json({ error: "Milestone not found" }, { status: 404 });
			}
			this.broadcastDataUpdated("milestones");
			return Response.json({ success: true, milestone: result.milestone ?? null });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to archive milestone";
			console.error("Error archiving milestone:", error);
			return Response.json({ error: message }, { status: 500 });
		}
	}

	private async handleGetVersion(): Promise<Response> {
		try {
			const version = await getVersion();
			return Response.json({ version });
		} catch (error) {
			console.error("Error getting version:", error);
			return Response.json({ error: "Failed to get version" }, { status: 500 });
		}
	}

	private async handleReorderTask(req: Request): Promise<Response> {
		try {
			const body = await req.json();
			const taskId = typeof body.taskId === "string" ? body.taskId : "";
			const targetStatus = typeof body.targetStatus === "string" ? body.targetStatus : "";
			const orderedTaskIds = Array.isArray(body.orderedTaskIds) ? body.orderedTaskIds : [];
			const targetMilestone =
				typeof body.targetMilestone === "string"
					? body.targetMilestone
					: body.targetMilestone === null
						? null
						: undefined;

			if (!taskId || !targetStatus || orderedTaskIds.length === 0) {
				return Response.json(
					{ error: "Missing required fields: taskId, targetStatus, and orderedTaskIds" },
					{ status: 400 },
				);
			}

			const { updatedTask, changedTasks } = await this.core.reorderTask({
				taskId,
				targetStatus,
				orderedTaskIds,
				targetMilestone,
				commitMessage: `Reorder tasks in ${targetStatus}`,
			});

			return Response.json({ success: true, task: updatedTask, changedTasks });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to reorder task";
			if (isAmbiguousTaskIdError(error)) {
				return this.conflictResponse(error, message);
			}
			// Cross-branch and validation errors are client errors (400), not server errors (500)
			const isCrossBranchError = message.includes("exists in branch");
			const isValidationError = message.includes("not found") || message.includes("Missing required");
			const status = isCrossBranchError || isValidationError ? 400 : 500;
			if (status === 500) {
				console.error("Error reordering task:", error);
			}
			return Response.json({ error: message }, { status });
		}
	}

	private async handleMoveTasks(req: Request): Promise<Response> {
		try {
			const body = await req.json();
			const taskIds = Array.isArray(body.taskIds) ? body.taskIds.filter((id: unknown) => typeof id === "string") : [];
			const targetStatus = typeof body.targetStatus === "string" ? body.targetStatus : "";
			// Same shape as the reorder endpoint: a string names a lane, null is the no-milestone lane,
			// and an absent field leaves each task's milestone alone.
			const targetMilestone =
				typeof body.targetMilestone === "string"
					? body.targetMilestone
					: body.targetMilestone === null
						? null
						: undefined;

			if (taskIds.length === 0 || !targetStatus) {
				return Response.json({ error: "Missing required fields: taskIds and targetStatus" }, { status: 400 });
			}

			const { movedTasks, changedTasks, failures } = await this.core.moveTasksToStatus({
				taskIds,
				targetStatus,
				targetMilestone,
				commitMessage: `Move ${taskIds.length} tasks to ${targetStatus}`,
			});

			return Response.json({ success: failures.length === 0, tasks: movedTasks, changedTasks, failures });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to move tasks";
			const isValidationError = message.includes("required");
			if (!isValidationError) {
				console.error("Error moving tasks:", error);
			}
			return Response.json({ error: message }, { status: isValidationError ? 400 : 500 });
		}
	}

	private async handleGetDuplicateTasks(): Promise<Response> {
		try {
			await this.ensureServicesReady();
			return Response.json(await this.core.previewDuplicateTaskIdRepair());
		} catch (error) {
			return Response.json({ error: String(error) }, { status: 500 });
		}
	}

	private async handleRepairDuplicateTasks(req: Request): Promise<Response> {
		try {
			const body = (await req.json()) as { fingerprint?: unknown };
			const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint.trim() : "";
			if (!fingerprint) {
				return Response.json({ error: "A repair preview fingerprint is required." }, { status: 400 });
			}
			const result = await this.core.repairDuplicateTaskIds(fingerprint);
			return Response.json(result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("changed after the preview") ? 409 : 400;
			return Response.json(
				status === 409 && this.centralMode ? { error: message, code: "REVISION_CONFLICT" } : { error: message },
				{ status },
			);
		}
	}

	private cleanupFingerprint(tasks: Task[]): string {
		const hash = createHash("sha256");
		for (const task of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
			const snapshot = recordFileSnapshot(task);
			if (!snapshot) {
				throw new MutationError("Cleanup preview version is unavailable.", 503, "RECOVERY_REQUIRED");
			}
			hash.update(task.id).update("\0").update(snapshot.recordPath).update("\0");
			hash.update(String(snapshot.bytes.byteLength)).update("\0").update(snapshot.bytes).update("\0");
		}
		return `p1-${hash.digest("hex")}`;
	}

	private async handleCleanupPreview(req: Request): Promise<Response> {
		try {
			const url = new URL(req.url);
			const ageParam = url.searchParams.get("age");

			if (!ageParam) {
				return Response.json({ error: "Missing age parameter" }, { status: 400 });
			}

			const age = Number.parseInt(ageParam, 10);
			if (Number.isNaN(age) || age < 0) {
				return Response.json({ error: "Invalid age parameter" }, { status: 400 });
			}

			const tasksToCleanup = await this.core.getTerminalStatusTasksByAge(age);

			// Return preview of tasks to be cleaned up
			const preview = tasksToCleanup.map((task) => ({
				id: task.id,
				title: task.title,
				updatedDate: task.updatedDate,
				createdDate: task.createdDate,
			}));

			return Response.json({
				count: preview.length,
				tasks: preview,
				...(this.centralMode && { fingerprint: this.cleanupFingerprint(tasksToCleanup) }),
			});
		} catch (error) {
			if (error instanceof MutationError) throw error;
			console.error("Error getting cleanup preview:", error);
			return Response.json({ error: "Failed to get cleanup preview" }, { status: 500 });
		}
	}

	private async handleCleanupExecute(req: Request): Promise<Response> {
		try {
			// The browser posts the IDs its preview showed, as `backlog cleanup` passes the IDs it listed,
			// so a task that became eligible after the preview is not archived.
			const body = (await req.json().catch(() => null)) as { taskIds?: unknown; fingerprint?: unknown } | null;
			const taskIds = body?.taskIds;
			if (
				!Array.isArray(taskIds) ||
				taskIds.length === 0 ||
				!taskIds.every((id): id is string => typeof id === "string" && id.trim() !== "")
			) {
				return Response.json({ error: "taskIds must be a non-empty list of task IDs" }, { status: 400 });
			}
			const totalCount = taskIds.length;
			if (this.centralMode) {
				if (typeof body?.fingerprint !== "string" || !body.fingerprint) {
					return Response.json(
						{ error: "A current cleanup preview fingerprint is required.", code: "PRECONDITION_REQUIRED" },
						{ status: 428 },
					);
				}
				const selected = await Promise.all(taskIds.map((id) => this.core.filesystem.loadTask(id)));
				if (selected.some((task) => !task) || this.cleanupFingerprint(selected as Task[]) !== body.fingerprint) {
					return Response.json(
						{ error: "The cleanup preview changed. Refresh it before executing.", code: "REVISION_CONFLICT" },
						{ status: 409 },
					);
				}
			}

			const result = await this.core.archiveTerminalStatusTasks(taskIds);
			const lines = formatCleanupResult(result, totalCount);
			for (const line of lines.failed) console.error(line);

			// Notify listeners to refresh
			this.broadcastDataUpdated();

			return Response.json({
				success: true,
				movedCount: result.archivedTaskIds.length,
				totalCount,
				failedTasks: result.failures.length > 0 ? result.failures.map((failure) => failure.taskId) : undefined,
				message: [...lines.skipped, ...lines.failed, lines.summary].join("\n"),
			});
		} catch (error) {
			if (error instanceof MutationError) throw error;
			if (isAmbiguousTaskIdError(error)) return this.conflictResponse(error, error.message);
			console.error("Error executing cleanup:", error);
			return Response.json({ error: "Failed to execute cleanup" }, { status: 500 });
		}
	}

	private async handleGetStatistics(): Promise<Response> {
		try {
			const servicesWereReady = this.servicesInitialized;
			const store = await this.getContentStoreInstance();
			const currentConfig = await this.core.filesystem.loadConfig();
			await store.ensureConfigWatcher();
			if (servicesWereReady) await this.core.refreshTasksForTaskRead();
			const corpus = store.getTaskCorpusSnapshot();
			const corpusConfig = corpus.config ?? currentConfig;
			const drafts = await this.core.filesystem.listDrafts();
			const statuses = (corpusConfig?.statuses || DEFAULT_STATUSES) as string[];
			const tasks = corpus.identityIndex?.getTasks(true) ?? corpus.activeTasks;
			const priorities = currentConfig?.priorities ?? corpusConfig?.priorities ?? [];

			// Calculate statistics using the exact same function as CLI
			const statistics = getTaskStatistics(tasks, drafts, statuses, priorities);

			// Convert Maps to objects for JSON serialization
			const response = {
				...statistics,
				statusCounts: Object.fromEntries(statistics.statusCounts),
				priorityCounts: Object.fromEntries(statistics.priorityCounts),
			};

			return Response.json(response);
		} catch (error) {
			console.error("Error getting statistics:", error);
			return Response.json({ error: "Failed to get statistics" }, { status: 500 });
		}
	}

	private async handleGetStatus(): Promise<Response> {
		try {
			const config = await this.core.filesystem.loadConfig();
			const backlogResolution = this.core.filesystem.resolveBacklogDirectoryInfo();
			return Response.json({
				initialized: !!config,
				projectPath: this.core.filesystem.rootDir,
				backlogDirectory: backlogResolution.backlogDir,
				backlogDirectorySource: backlogResolution.source,
				configLocation: backlogResolution.configSource,
				rootConfigPath: backlogResolution.rootConfigPath,
			});
		} catch (error) {
			console.error("Error getting status:", error);
			return Response.json({
				initialized: false,
				projectPath: this.core.filesystem.rootDir,
				backlogDirectory: null,
				backlogDirectorySource: null,
				configLocation: null,
				rootConfigPath: null,
			});
		}
	}

	private async handleInit(req: Request): Promise<Response> {
		try {
			const body = await req.json();
			const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
			const backlogDirectory = typeof body.backlogDirectory === "string" ? body.backlogDirectory.trim() : undefined;
			const backlogDirectorySource =
				body.backlogDirectorySource === "backlog" ||
				body.backlogDirectorySource === ".backlog" ||
				body.backlogDirectorySource === "custom"
					? body.backlogDirectorySource
					: undefined;
			const configLocation =
				body.configLocation === "folder" || body.configLocation === "root" ? body.configLocation : undefined;
			const integrationMode = body.integrationMode as "mcp" | "cli" | "none" | undefined;
			const mcpClients = Array.isArray(body.mcpClients) ? body.mcpClients : [];
			const agentInstructions = Array.isArray(body.agentInstructions) ? body.agentInstructions : [];
			const installClaudeAgentFlag = parseOptionalBoolean(body.installClaudeAgent) ?? false;
			const filesystemOnly = parseOptionalBoolean(body.filesystemOnly) ?? false;
			const advancedConfig = body.advancedConfig || {};

			// Input validation (browser layer responsibility)
			if (!projectName) {
				return Response.json({ error: "Project name is required" }, { status: 400 });
			}
			const taskPrefixError = getTaskPrefixError(
				typeof advancedConfig.taskPrefix === "string" ? advancedConfig.taskPrefix : "",
			);
			if (taskPrefixError) {
				return Response.json({ error: taskPrefixError }, { status: 400 });
			}

			// Check if already initialized (for browser, we don't allow re-init)
			const existingConfig = await this.core.filesystem.loadConfig();
			if (existingConfig) {
				return Response.json({ error: "Project is already initialized" }, { status: 400 });
			}

			// Call shared core init function
			const result = await initializeProject(this.core, {
				projectName,
				backlogDirectory,
				backlogDirectorySource,
				configLocation,
				integrationMode: integrationMode || "none",
				mcpClients,
				agentInstructions,
				installClaudeAgent: installClaudeAgentFlag,
				filesystemOnly,
				advancedConfig,
				existingConfig: null,
			});

			// Update server's project name
			this.projectName = result.projectName;

			// Ensure config watcher is set up now that config file exists
			if (this.contentStore) {
				await this.contentStore.ensureConfigWatcher();
			}

			return Response.json({
				success: result.success,
				projectName: result.projectName,
				mcpResults: result.mcpResults,
			});
		} catch (error) {
			console.error("Error initializing project:", error);
			const message = error instanceof Error ? error.message : "Failed to initialize project";
			return Response.json({ error: message }, { status: 500 });
		}
	}
}
