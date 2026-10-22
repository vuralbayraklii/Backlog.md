import { createHash, randomUUID } from "node:crypto";
import { type FileEntry, fileEntriesEqual, snapshotFileEntry } from "../file-system/prepared-change.ts";
import { BacklogServer } from "./index.ts";
import { MutationStore, type StoredOperation, type StoredRecord } from "./mutation-store.ts";
import type { HistoryEvent, HistoryRecordChange, OperationView } from "./mutation-types.ts";
import { recordRevision } from "./mutations.ts";
import { assertProjectBoundary, inspectProject } from "./project-paths.ts";
import { ProjectStore } from "./project-store.ts";

type EntrySummary =
	| { type: "absent" }
	| { type: "file"; sha256: string; bytes: number }
	| { type: "symlink"; sha256: string; target: string };

export interface RecoveryFileReport {
	path: string;
	recordKey: string | null;
	noReplace: boolean;
	before: EntrySummary;
	after: EntrySummary;
	observed: EntrySummary | null;
}

export interface RecoveryReport {
	operationId: string;
	projectId: string;
	state: "pending" | "recovery_required";
	createdAt: string;
	action: string;
	classification: "before" | "after" | "mixed" | "unknown";
	fingerprint: string | null;
	files: RecoveryFileReport[];
	issue?: string;
}

function summarize(entry: FileEntry): EntrySummary {
	if (!entry) return { type: "absent" };
	if (entry.type === "file") {
		return {
			type: "file",
			sha256: createHash("sha256").update(entry.bytes).digest("hex"),
			bytes: entry.bytes.byteLength,
		};
	}
	return {
		type: "symlink",
		sha256: createHash("sha256").update(entry.target).digest("hex"),
		target: entry.target,
	};
}

function unresolved(store: MutationStore): StoredOperation[] {
	return [...store.listPending(), ...store.listRecoveryRequired()].sort(
		(left, right) => left.createdAt.localeCompare(right.createdAt) || left.operationId.localeCompare(right.operationId),
	);
}

async function report(dataDirectory: string, operation: StoredOperation): Promise<RecoveryReport> {
	if (
		operation.scope.kind !== "project" ||
		(operation.state !== "pending" && operation.state !== "recovery_required")
	) {
		throw new Error("Only an unresolved project operation has a physical recovery report.");
	}
	const projectId = operation.scope.projectId;
	const project = new ProjectStore(dataDirectory).load(projectId);
	const files: RecoveryFileReport[] = operation.files.map((file) => ({
		path: file.path,
		recordKey: file.record.recordKey ?? null,
		noReplace: file.noReplace ?? false,
		before: summarize(file.before),
		after: summarize(file.after),
		observed: null,
	}));
	const base = {
		operationId: operation.operationId,
		projectId,
		state: operation.state,
		createdAt: operation.createdAt,
		action: operation.action,
		files,
	};
	if (!project)
		return { ...base, classification: "unknown", fingerprint: null, issue: "Registered project is unavailable." };
	try {
		assertProjectBoundary(
			project.rootPath,
			operation.files.map((file) => file.path),
		);
		let allBefore = true;
		let allAfter = true;
		for (const [index, file] of operation.files.entries()) {
			const observed = await snapshotFileEntry(file.path);
			const item = files[index];
			if (item) item.observed = summarize(observed);
			allBefore &&= fileEntriesEqual(observed, file.before);
			allAfter &&= fileEntriesEqual(observed, file.after);
		}
		assertProjectBoundary(
			project.rootPath,
			operation.files.map((file) => file.path),
		);
		const classification = allAfter ? "after" : allBefore ? "before" : "mixed";
		const fingerprint = createHash("sha256")
			.update(JSON.stringify({ projectId, operationId: operation.operationId, state: operation.state, files }))
			.digest("hex");
		return { ...base, classification, fingerprint };
	} catch {
		return { ...base, classification: "unknown", fingerprint: null, issue: "A path is unsafe or unreadable." };
	}
}

export async function listRecovery(dataDirectory: string): Promise<RecoveryReport[]> {
	const store = new MutationStore(dataDirectory);
	return Promise.all(
		unresolved(store)
			.filter((operation) => operation.scope.kind === "project")
			.map((operation) => report(dataDirectory, operation)),
	);
}

export async function viewRecovery(dataDirectory: string, operationId: string): Promise<RecoveryReport> {
	const operation = unresolved(new MutationStore(dataDirectory)).find((entry) => entry.operationId === operationId);
	if (!operation) throw new Error(`Unresolved recovery operation ${operationId} was not found.`);
	return report(dataDirectory, operation);
}

function sameIdentity(left: StoredRecord, right: StoredRecord): boolean {
	return (
		left.visibleId === right.visibleId &&
		left.path === right.path &&
		left.lifecycle === right.lifecycle &&
		left.revision === right.revision
	);
}

/** Inspect a complete guarded inventory; never infer identity from an unmatched new path. */
async function acceptedObservation(
	dataDirectory: string,
	operation: StoredOperation,
): Promise<{ records: StoredRecord[]; changes: HistoryRecordChange[] }> {
	if (operation.scope.kind !== "project") throw new Error("Recovery requires a project operation.");
	const projectId = operation.scope.projectId;
	const project = new ProjectStore(dataDirectory).load(projectId);
	if (!project) throw new Error("Registered project is unavailable.");
	const preview = inspectProject(project.name, project.rootPath);
	if (!preview.canRegister || preview.issues.length) {
		throw new Error(
			"The project contains unreadable, invalid, or ambiguous records. Repair them before accepting an observation.",
		);
	}
	const handler = new BacklogServer(project.rootPath, { centralMode: true, projectName: project.name });
	let snapshots: Awaited<ReturnType<typeof handler.listCentralRecordSnapshots>>;
	try {
		snapshots = await handler.listCentralRecordSnapshots();
	} finally {
		await handler.stop();
	}
	const byPath = new Map(snapshots.map((snapshot) => [snapshot.recordPath, snapshot]));
	if (byPath.size !== snapshots.length) throw new Error("Project inventory contains an ambiguous record path.");
	const identities = new Set<string>();
	for (const snapshot of snapshots) {
		const identity = `${snapshot.kind}\0${snapshot.visibleId.toLowerCase()}`;
		if (identities.has(identity)) throw new Error(`Project inventory contains an ambiguous ${snapshot.kind} identity.`);
		identities.add(identity);
	}
	const store = new MutationStore(dataDirectory);
	const plans = new Map(operation.recordUpdates.map((record) => [record.recordKey, record]));
	const keys = new Set(operation.files.map((file) => file.record.recordKey));
	if (keys.has(undefined)) throw new Error("Interrupted intent has an unkeyed physical effect.");
	const records: StoredRecord[] = [];
	const changes: HistoryRecordChange[] = [];
	for (const recordKey of keys as Set<string>) {
		const planned = plans.get(recordKey);
		if (!planned) throw new Error("Interrupted intent has no record plan for an affected key.");
		const prior = store.loadRecord(projectId, recordKey);
		const effects = operation.files.filter((file) => file.record.recordKey === recordKey);
		const paths = new Set(
			[
				prior?.path,
				planned.path,
				...effects.flatMap((file) => [file.record.recordPath, file.record.transitionFromPath, file.path]),
			].filter((path): path is string => Boolean(path)),
		);
		const candidates = snapshots.filter((snapshot) => paths.has(snapshot.recordPath));
		if (candidates.length > 1) throw new Error("More than one observed record could inherit an affected record key.");
		const observed = candidates[0];
		if (observed && observed.kind !== planned.kind) throw new Error("Observed record kind changed unexpectedly.");
		if (!observed) {
			const names = [prior?.visibleId, planned.visibleId].filter((id): id is string => Boolean(id));
			if (
				snapshots.some(
					(snapshot) =>
						snapshot.kind === planned.kind && names.some((id) => id.toLowerCase() === snapshot.visibleId.toLowerCase()),
				)
			) {
				throw new Error("An affected identity moved outside the recorded physical paths.");
			}
		}
		const accepted: StoredRecord | null = observed
			? {
					recordKey,
					projectId,
					kind: observed.kind,
					visibleId: observed.visibleId,
					path: observed.recordPath,
					lifecycle: observed.lifecycle,
					revision: recordRevision(recordKey, observed.recordPath, observed.lifecycle, observed.bytes),
				}
			: prior
				? { ...prior, path: null, lifecycle: "deleted", revision: null }
				: null;
		if (!accepted || (prior && sameIdentity(prior, accepted))) continue;
		const original = operation.plannedEvent?.changes.find((change) => change.recordKey === recordKey);
		if (!original) throw new Error("Interrupted intent lacks before evidence for an affected record.");
		records.push(accepted);
		changes.push({
			recordKey,
			kind: accepted.kind,
			visibleId: accepted.visibleId,
			beforeRevision: original.beforeRevision,
			afterRevision: accepted.revision,
			before: original.before,
			after: observed ? Buffer.from(observed.bytes).toString("utf8") : null,
		});
	}
	return { records, changes };
}

/** The caller supplies the fingerprint shown by viewRecovery, never an inferred confirmation. */
export async function resolveRecovery(
	dataDirectory: string,
	operationId: string,
	expectedFingerprint: string,
): Promise<{ operation: OperationView; report: RecoveryReport }> {
	if (!/^[0-9a-f]{64}$/i.test(expectedFingerprint)) throw new Error("--expected-fingerprint must be a SHA-256 value.");
	const store = new MutationStore(dataDirectory);
	const interrupted = store.listRecoveryRequired().find((operation) => operation.operationId === operationId);
	if (interrupted?.scope.kind !== "project") throw new Error("An unresolved project recovery operation is required.");
	const first = await report(dataDirectory, interrupted);
	if (!first.fingerprint || first.fingerprint !== expectedFingerprint)
		throw new Error("Recovery fingerprint changed. View the operation again.");
	const projectId = interrupted.scope.projectId;
	if (
		store
			.listPending()
			.some((operation) => operation.scope.kind === "project" && operation.scope.projectId === projectId)
	) {
		throw new Error("Another project operation is still pending.");
	}
	if (store.listRecoveryRequired(projectId).some((operation) => operation.operationId !== operationId)) {
		throw new Error("Another project operation also requires recovery.");
	}
	const accepted = await acceptedObservation(dataDirectory, interrupted);
	const second = await report(dataDirectory, interrupted);
	if (!second.fingerprint || second.fingerprint !== expectedFingerprint)
		throw new Error("Recovery fingerprint changed during validation. View the operation again.");
	const recoveryId = randomUUID();
	const scope = interrupted.scope;
	const actor = { kind: "unknown" as const };
	const event: HistoryEvent = {
		eventId: recoveryId,
		operationId: recoveryId,
		scope,
		actor,
		source: "recovery",
		action: "accept_observed",
		occurredAt: new Date().toISOString(),
		changes: accepted.changes,
	};
	store.resolveObserved(operationId, {
		operationId: recoveryId,
		scope,
		actor,
		source: "recovery",
		requestHash: createHash("sha256")
			.update(`accept-observed\0${operationId}\0${expectedFingerprint}\0${recoveryId}`)
			.digest("hex"),
		action: "accept_observed",
		files: [],
		recordUpdates: accepted.records,
		plannedResult: { status: 200, body: { resolvedOperationId: operationId, fingerprint: expectedFingerprint } },
		plannedEvent: event,
	});
	const operation = store.loadOperation(recoveryId, { actor, admin: true });
	if (!operation) throw new Error("Committed recovery result could not be read.");
	return { operation, report: second };
}
