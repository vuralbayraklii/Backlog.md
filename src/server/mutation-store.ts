import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { FileEntry, PreparedFileChange } from "../file-system/prepared-change.ts";
import { ServerDatabase } from "./database.ts";
import type {
	HistoryEvent,
	HistoryKind,
	HistoryPage,
	MutationActor,
	MutationScope,
	MutationSource,
	OperationState,
	OperationView,
	RecordKind,
	SafeHttpResult,
} from "./mutation-types.ts";
import { checkpointManagedInTransaction } from "./observation-store.ts";

export interface StoredRecord {
	recordKey: string;
	projectId: string;
	kind: RecordKind;
	visibleId: string;
	path: string | null;
	lifecycle: "active" | "draft" | "archived" | "deleted";
	revision: string | null;
}

/** Everything required to finish a write after a process restart is durable at begin. */
export interface MutationIntent {
	operationId: string;
	scope: MutationScope;
	actor: MutationActor;
	source: MutationSource;
	requestHash: string;
	action: string;
	files: readonly PreparedFileChange[];
	recordUpdates: readonly StoredRecord[];
	plannedResult: SafeHttpResult;
	plannedEvent: HistoryEvent | null;
}

export interface StoredOperation extends OperationView {
	requestHash: string;
	action: string;
	files: PreparedFileChange[];
	recordUpdates: StoredRecord[];
	plannedResult: SafeHttpResult;
	plannedEvent: HistoryEvent | null;
}

export class MutationStoreError extends Error {
	constructor(
		message: string,
		readonly code: "AMBIGUOUS_ID" | "IDEMPOTENCY_KEY_REUSED" | "INVALID_OPERATION" | "OPERATION_IN_PROGRESS",
		readonly status = 409,
	) {
		super(message);
		this.name = "MutationStoreError";
	}
}

interface OperationRow {
	operation_id: string;
	scope_kind: MutationScope["kind"];
	project_id: number | null;
	actor_kind: "user" | "unknown";
	actor_id: string | null;
	source: MutationSource;
	request_hash: string;
	state: OperationState;
	action: string;
	created_at: string;
	updated_at: string;
	planned_result_json: string;
	planned_event_json: string | null;
	planned_records_json: string;
	result_json: string | null;
	error_json: string | null;
	resolved_by: string | null;
}

interface FileRow {
	path: string;
	record_json: string;
	no_replace: number;
	before_kind: "file" | "symlink" | null;
	before_bytes: Uint8Array | null;
	before_target: string | null;
	before_hash: string | null;
	after_kind: "file" | "symlink" | null;
	after_bytes: Uint8Array | null;
	after_target: string | null;
	after_hash: string | null;
}

interface RecordRow {
	record_key: string;
	project_id: number;
	kind: RecordKind;
	visible_id: string;
	path: string | null;
	lifecycle: StoredRecord["lifecycle"];
	revision: string | null;
}

const OPERATION_COLUMNS =
	"operation_id,scope_kind,project_id,actor_kind,actor_id,source,request_hash,state,action,created_at,updated_at,planned_result_json,planned_event_json,planned_records_json,result_json,error_json,resolved_by";
const RECORD_COLUMNS = "record_key,project_id,kind,visible_id,path,lifecycle,revision";
const FILE_COLUMNS =
	"path,record_json,no_replace,before_kind,before_bytes,before_target,before_hash,after_kind,after_bytes,after_target,after_hash";
const FORBIDDEN_KEY = /password|token|csrf|cookie|secret|credential|authorization/i;

function safeJson(value: unknown): string {
	let json: string | undefined;
	try {
		json = JSON.stringify(value, (key, child) => {
			if (FORBIDDEN_KEY.test(key) && !(key === "mustChangePassword" && typeof child === "boolean")) {
				throw new MutationStoreError(
					"Authentication secrets cannot enter operation history.",
					"INVALID_OPERATION",
					400,
				);
			}
			return child;
		});
	} catch (error) {
		if (error instanceof MutationStoreError) throw error;
		throw new MutationStoreError("Operation data must be JSON.", "INVALID_OPERATION", 400);
	}
	if (json === undefined) throw new MutationStoreError("Operation data must be JSON.", "INVALID_OPERATION", 400);
	return json;
}

function safeResultJson(result: SafeHttpResult): string {
	if (!Number.isInteger(result.status) || result.status < 100 || result.status > 599) {
		throw new MutationStoreError("Invalid stored response status.", "INVALID_OPERATION", 400);
	}
	for (const header of Object.keys(result.headers ?? {})) {
		if (!/^(etag|content-type|x-backlog-operation-id|x-backlog-tasks-revision)$/i.test(header)) {
			throw new MutationStoreError("Unsafe response header cannot be stored.", "INVALID_OPERATION", 400);
		}
	}
	return safeJson(result);
}

function utcTimestamp(value: string): boolean {
	const date = new Date(value);
	return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function scopeProjectId(scope: MutationScope): number | null {
	if (scope.kind !== "project") return null;
	if (!/^[1-9]\d*$/.test(scope.projectId)) {
		throw new MutationStoreError("Invalid project scope.", "INVALID_OPERATION", 400);
	}
	return Number(scope.projectId);
}

function sameScope(left: MutationScope, right: MutationScope): boolean {
	return left.kind === right.kind && (left.kind !== "project" || left.projectId === (right as typeof left).projectId);
}

function sameActor(left: MutationActor, right: MutationActor): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind === "user" && right.kind === "user") return left.userId === right.userId;
	if (left.kind === "agent" && right.kind === "agent")
		return left.agentKeyId === right.agentKeyId && left.userId === right.userId;
	return true;
}

function entryHash(entry: FileEntry): string | null {
	if (!entry) return null;
	const hash = createHash("sha256");
	if (entry.type === "file") hash.update("file\0").update(entry.bytes);
	else hash.update("symlink\0").update(entry.target);
	return hash.digest("hex");
}

function decodeEntry(
	kind: FileRow["before_kind"],
	bytes: Uint8Array | null,
	target: string | null,
	hash: string | null,
): FileEntry {
	const entry: FileEntry =
		kind === "file"
			? { type: "file", bytes: bytes ?? new Uint8Array() }
			: kind === "symlink"
				? { type: "symlink", target: target ?? "" }
				: null;
	if (entryHash(entry) !== hash) throw new Error("Stored physical change hash does not match its bytes.");
	return entry;
}

function rowScope(row: OperationRow): MutationScope {
	return row.scope_kind === "project"
		? { kind: "project", projectId: String(row.project_id) }
		: { kind: row.scope_kind };
}

function rowActor(database: Database, row: OperationRow): MutationActor {
	if (row.source === "agent") {
		const version = database.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
		if (version >= 5) {
			const agent = database
				.query<{ agent_key_id: string; user_id: string }, [string]>(
					"SELECT agent_key_id,user_id FROM operation_agents WHERE operation_id=?",
				)
				.get(row.operation_id);
			if (agent) {
				if (agent.user_id !== row.actor_id) throw new Error("Stored agent operation identity is inconsistent.");
				return { kind: "agent", agentKeyId: agent.agent_key_id, userId: agent.user_id };
			}
		}
	}
	return row.actor_kind === "user" ? { kind: "user", userId: row.actor_id ?? "" } : { kind: "unknown" };
}

function rowRecord(row: RecordRow): StoredRecord {
	return {
		recordKey: row.record_key,
		projectId: String(row.project_id),
		kind: row.kind,
		visibleId: row.visible_id,
		path: row.path,
		lifecycle: row.lifecycle,
		revision: row.revision,
	};
}

function loadRow(database: Database, operationId: string): OperationRow | null {
	return database
		.query<OperationRow, [string]>(`SELECT ${OPERATION_COLUMNS} FROM operations WHERE operation_id=?`)
		.get(operationId);
}

function loadFiles(database: Database, operationId: string): PreparedFileChange[] {
	return database
		.query<FileRow, [string]>(`SELECT ${FILE_COLUMNS} FROM operation_files WHERE operation_id=? ORDER BY ordinal`)
		.all(operationId)
		.map((row) => ({
			path: row.path,
			before: decodeEntry(row.before_kind, row.before_bytes, row.before_target, row.before_hash),
			after: decodeEntry(row.after_kind, row.after_bytes, row.after_target, row.after_hash),
			record: JSON.parse(row.record_json) as PreparedFileChange["record"],
			noReplace: Boolean(row.no_replace),
		}));
}

function operationView(database: Database, row: OperationRow): OperationView {
	return {
		operationId: row.operation_id,
		requestHash: row.request_hash,
		scope: rowScope(row),
		state: row.state,
		source: row.source,
		actor: rowActor(database, row),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		...(row.result_json ? { result: JSON.parse(row.result_json) as SafeHttpResult } : {}),
		...(row.error_json ? { error: JSON.parse(row.error_json) as OperationView["error"] } : {}),
		...(row.resolved_by ? { resolvedBy: row.resolved_by } : {}),
	};
}

function storedOperation(database: Database, row: OperationRow): StoredOperation {
	return {
		...operationView(database, row),
		requestHash: row.request_hash,
		action: row.action,
		files: loadFiles(database, row.operation_id),
		recordUpdates: JSON.parse(row.planned_records_json) as StoredRecord[],
		plannedResult: JSON.parse(row.planned_result_json) as SafeHttpResult,
		plannedEvent: row.planned_event_json ? (JSON.parse(row.planned_event_json) as HistoryEvent) : null,
	};
}

function assertIntent(intent: MutationIntent): { result: string; event: string | null; records: string } {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.operationId)) {
		throw new MutationStoreError("Operation ID must be a UUID.", "INVALID_OPERATION", 400);
	}
	if (!/^[0-9a-f]{64}$/i.test(intent.requestHash)) {
		throw new MutationStoreError("Request hash must be SHA-256.", "INVALID_OPERATION", 400);
	}
	if (!intent.action.trim()) throw new MutationStoreError("Operation action is required.", "INVALID_OPERATION", 400);
	scopeProjectId(intent.scope);
	if (
		(intent.actor.kind === "user" && !intent.actor.userId) ||
		(intent.actor.kind === "agent" && (!intent.actor.userId || !intent.actor.agentKeyId))
	) {
		throw new MutationStoreError("Verified actor ID is required.", "INVALID_OPERATION", 400);
	}
	if ((intent.source === "agent") !== (intent.actor.kind === "agent")) {
		throw new MutationStoreError("Agent source requires an agent actor.", "INVALID_OPERATION", 400);
	}
	if (intent.source === "external" && intent.actor.kind !== "unknown") {
		throw new MutationStoreError("External source requires an unknown actor.", "INVALID_OPERATION", 400);
	}
	const paths = new Set<string>();
	for (const file of intent.files) {
		if (!isAbsolute(file.path) || paths.has(file.path)) {
			throw new MutationStoreError("Prepared physical paths must be unique and absolute.", "INVALID_OPERATION", 400);
		}
		paths.add(file.path);
		entryHash(file.before);
		entryHash(file.after);
	}
	for (const record of intent.recordUpdates) {
		assertRecord(record);
		if (intent.scope.kind !== "project" || record.projectId !== intent.scope.projectId) {
			throw new MutationStoreError("Planned record belongs to a different project.", "INVALID_OPERATION", 400);
		}
	}
	if ((intent.files.length || intent.recordUpdates.length) && !intent.plannedEvent) {
		throw new MutationStoreError("A physical or record change requires one history event.", "INVALID_OPERATION", 400);
	}
	if (intent.plannedEvent) {
		const event = intent.plannedEvent;
		if (
			event.eventId !== intent.operationId ||
			event.operationId !== intent.operationId ||
			!sameScope(event.scope, intent.scope) ||
			!sameActor(event.actor, intent.actor) ||
			event.source !== intent.source ||
			event.action !== intent.action
		) {
			throw new MutationStoreError("Planned history event does not match the operation.", "INVALID_OPERATION", 400);
		}
		if (
			(event.source === "external"
				? event.occurredAt !== null || !event.detectedAt || !utcTimestamp(event.detectedAt)
				: event.occurredAt === null || !utcTimestamp(event.occurredAt)) ||
			(event.detectedAt !== undefined && !utcTimestamp(event.detectedAt))
		) {
			throw new MutationStoreError("History times must be UTC timestamps.", "INVALID_OPERATION", 400);
		}
	}
	return {
		result: safeResultJson(intent.plannedResult),
		event: intent.plannedEvent ? safeJson(intent.plannedEvent) : null,
		records: safeJson(intent.recordUpdates),
	};
}

function insertIntent(
	database: Database,
	intent: MutationIntent,
	json: { result: string; event: string | null; records: string },
): void {
	if (
		intent.actor.kind === "agent" &&
		!database
			.query(
				"SELECT 1 FROM agent_keys k JOIN users u ON u.id=k.user_id WHERE k.id=? AND k.user_id=? AND k.revoked_at IS NULL AND u.active=1 AND u.must_change_password=0",
			)
			.get(intent.actor.agentKeyId, intent.actor.userId)
	) {
		throw new MutationStoreError("Agent key is no longer active.", "INVALID_OPERATION", 403);
	}
	const now = new Date().toISOString();
	database
		.query(
			"INSERT INTO operations(operation_id,scope_kind,project_id,actor_kind,actor_id,source,request_hash,state,action,created_at,updated_at,planned_result_json,planned_event_json,planned_records_json,result_json,error_json,resolved_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			intent.operationId,
			intent.scope.kind,
			scopeProjectId(intent.scope),
			intent.actor.kind === "agent" ? "user" : intent.actor.kind,
			intent.actor.kind === "unknown" ? null : intent.actor.userId,
			intent.source,
			intent.requestHash,
			"pending",
			intent.action,
			now,
			now,
			json.result,
			json.event,
			json.records,
			null,
			null,
			null,
		);
	if (intent.actor.kind === "agent") {
		database
			.query("INSERT INTO operation_agents(operation_id,agent_key_id,user_id) VALUES(?,?,?)")
			.run(intent.operationId, intent.actor.agentKeyId, intent.actor.userId);
	}
	const insertFile = database.query(
		"INSERT INTO operation_files(operation_id,ordinal,path,record_key,record_json,no_replace,before_kind,before_bytes,before_target,before_hash,after_kind,after_bytes,after_target,after_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
	);
	for (const [ordinal, file] of intent.files.entries()) {
		insertFile.run(
			intent.operationId,
			ordinal,
			file.path,
			file.record.recordKey ?? null,
			safeJson(file.record),
			Number(file.noReplace ?? file.before === null),
			file.before?.type ?? null,
			file.before?.type === "file" ? file.before.bytes : null,
			file.before?.type === "symlink" ? file.before.target : null,
			entryHash(file.before),
			file.after?.type ?? null,
			file.after?.type === "file" ? file.after.bytes : null,
			file.after?.type === "symlink" ? file.after.target : null,
			entryHash(file.after),
		);
	}
}

function assertRecord(record: StoredRecord): void {
	if (
		!/^[1-9]\d*$/.test(record.projectId) ||
		!record.recordKey ||
		!record.visibleId ||
		!["task", "document", "decision", "milestone", "config"].includes(record.kind) ||
		!["active", "draft", "archived", "deleted"].includes(record.lifecycle) ||
		(record.path !== null && !isAbsolute(record.path)) ||
		(record.lifecycle !== "deleted" && !record.revision)
	) {
		throw new MutationStoreError("Invalid record identity.", "INVALID_OPERATION", 400);
	}
}

export function upsertRecordInTransaction(database: Database, record: StoredRecord): void {
	assertRecord(record);
	const prior = database
		.query<RecordRow, [string]>(`SELECT ${RECORD_COLUMNS} FROM records WHERE record_key=?`)
		.get(record.recordKey);
	if (
		prior &&
		(prior.project_id !== Number(record.projectId) ||
			prior.kind !== record.kind ||
			(prior.lifecycle === "deleted" && record.lifecycle !== "deleted"))
	) {
		throw new MutationStoreError("Record key cannot be reassigned to a new life.", "INVALID_OPERATION", 409);
	}
	database
		.query(
			"INSERT INTO records(record_key,project_id,kind,visible_id,path,lifecycle,revision) VALUES(?,?,?,?,?,?,?) ON CONFLICT(record_key) DO UPDATE SET visible_id=excluded.visible_id,path=excluded.path,lifecycle=excluded.lifecycle,revision=excluded.revision",
		)
		.run(
			record.recordKey,
			Number(record.projectId),
			record.kind,
			record.visibleId,
			record.path,
			record.lifecycle,
			record.revision,
		);
}

function finishInTransaction(database: Database, row: OperationRow): void {
	for (const record of JSON.parse(row.planned_records_json) as StoredRecord[])
		upsertRecordInTransaction(database, record);
	if (row.planned_event_json) {
		const event = JSON.parse(row.planned_event_json) as HistoryEvent;
		database
			.query(
				"INSERT INTO history_events(event_id,operation_id,scope_kind,project_id,occurred_at,detected_at,event_json) VALUES(?,?,?,?,?,?,?)",
			)
			.run(
				event.eventId,
				row.operation_id,
				row.scope_kind,
				row.project_id,
				event.occurredAt,
				event.detectedAt ?? null,
				row.planned_event_json,
			);
	}
	if (row.scope_kind === "project" && row.project_id !== null && row.source !== "external") {
		checkpointManagedInTransaction(database, String(row.project_id), loadFiles(database, row.operation_id));
	}
	database
		.query("UPDATE operations SET state='completed',updated_at=?,result_json=?,error_json=NULL WHERE operation_id=?")
		.run(new Date().toISOString(), row.planned_result_json, row.operation_id);
}

/** Persistent intent and history on the same connection policy as accounts and projects. */
export class MutationStore {
	readonly databasePath: string;
	private readonly database: ServerDatabase;

	constructor(dataDirectory: string) {
		this.database = new ServerDatabase(dataDirectory);
		this.databasePath = this.database.databasePath;
	}

	begin(intent: MutationIntent, beforeIntent?: () => void): { created: boolean; operation: StoredOperation } {
		return this.database.write((database) => {
			beforeIntent?.();
			const prior = loadRow(database, intent.operationId);
			if (prior) {
				if (
					!sameScope(rowScope(prior), intent.scope) ||
					!sameActor(rowActor(database, prior), intent.actor) ||
					prior.request_hash !== intent.requestHash
				) {
					throw new MutationStoreError("Operation key is already in use.", "IDEMPOTENCY_KEY_REUSED");
				}
				return { created: false, operation: storedOperation(database, prior) };
			}
			const json = assertIntent(intent);
			insertIntent(database, intent, json);
			const row = loadRow(database, intent.operationId);
			if (!row) throw new Error("Persisted operation could not be read.");
			return { created: true, operation: storedOperation(database, row) };
		});
	}

	finalize(operationId: string): StoredOperation {
		return this.database.write((database) => {
			const row = loadRow(database, operationId);
			if (!row) throw new MutationStoreError("Operation not found.", "INVALID_OPERATION", 404);
			if (row.state === "pending") finishInTransaction(database, row);
			else if (row.state !== "completed") {
				throw new MutationStoreError("Operation cannot be finalized in its current state.", "INVALID_OPERATION");
			}
			const finished = loadRow(database, operationId);
			if (!finished) throw new Error("Finalized operation could not be read.");
			return storedOperation(database, finished);
		});
	}

	markNotApplied(operationId: string): StoredOperation {
		return this.changeState(operationId, "not_applied", {
			code: "NOT_APPLIED",
			message: "No prepared file change was applied.",
		});
	}

	requireRecovery(
		operationId: string,
		message = "The observed files do not match a complete operation state.",
	): StoredOperation {
		return this.changeState(operationId, "recovery_required", { code: "RECOVERY_REQUIRED", message });
	}

	/** Commit a separately reviewed observation without making the interrupted write successful. */
	resolveObserved(originalId: string, recovery: MutationIntent): StoredOperation {
		if (
			recovery.source !== "recovery" ||
			recovery.scope.kind !== "project" ||
			recovery.files.length ||
			!recovery.plannedEvent
		) {
			throw new MutationStoreError(
				"Observed recovery needs a separate event without file writes.",
				"INVALID_OPERATION",
				400,
			);
		}
		const json = assertIntent(recovery);
		return this.database.write((database) => {
			const original = loadRow(database, originalId);
			if (original?.state !== "recovery_required" || !sameScope(rowScope(original), recovery.scope)) {
				throw new MutationStoreError("Recovery target is not an unresolved project operation.", "INVALID_OPERATION");
			}
			if (original.resolved_by) {
				const previous = original.resolved_by === recovery.operationId ? loadRow(database, recovery.operationId) : null;
				if (
					previous?.state === "completed" &&
					sameActor(rowActor(database, previous), recovery.actor) &&
					previous.request_hash === recovery.requestHash
				) {
					return storedOperation(database, previous);
				}
				throw new MutationStoreError("Recovery operation is already resolved.", "IDEMPOTENCY_KEY_REUSED");
			}
			if (recovery.operationId === originalId || loadRow(database, recovery.operationId)) {
				throw new MutationStoreError("Operation key is already in use.", "IDEMPOTENCY_KEY_REUSED");
			}
			const conflict = database
				.query<{ operation_id: string }, [number | null, string]>(
					"SELECT operation_id FROM operations WHERE scope_kind='project' AND project_id=? AND operation_id<>? AND (state='pending' OR (state='recovery_required' AND resolved_by IS NULL)) LIMIT 1",
				)
				.get(original.project_id, originalId);
			if (conflict) {
				throw new MutationStoreError("Another project operation is unresolved.", "OPERATION_IN_PROGRESS");
			}
			insertIntent(database, recovery, json);
			const row = loadRow(database, recovery.operationId);
			if (!row) throw new Error("Recovery operation could not be read.");
			finishInTransaction(database, row);
			database
				.query(
					"UPDATE operations SET resolved_by=? WHERE operation_id=? AND state='recovery_required' AND resolved_by IS NULL",
				)
				.run(recovery.operationId, originalId);
			const finished = loadRow(database, recovery.operationId);
			if (!finished) throw new Error("Recovery event could not be read.");
			return storedOperation(database, finished);
		});
	}

	private changeState(
		operationId: string,
		state: "not_applied" | "recovery_required",
		error: OperationView["error"],
	): StoredOperation {
		return this.database.write((database) => {
			const row = loadRow(database, operationId);
			if (!row) throw new MutationStoreError("Operation not found.", "INVALID_OPERATION", 404);
			if (row.state === "pending") {
				database
					.query("UPDATE operations SET state=?,updated_at=?,error_json=? WHERE operation_id=?")
					.run(state, new Date().toISOString(), safeJson(error), operationId);
			} else if (row.state !== state) {
				throw new MutationStoreError("Operation cannot change from its current state.", "INVALID_OPERATION");
			}
			const changed = loadRow(database, operationId);
			if (!changed) throw new Error("Updated operation could not be read.");
			return storedOperation(database, changed);
		});
	}

	loadOperation(
		operationId: string,
		viewer: { actor: MutationActor; scope?: MutationScope; admin?: boolean },
	): OperationView | null {
		return this.database.read(null, (database, version) => {
			if (version < 4) return null;
			const row = loadRow(database, operationId);
			if (!row || (viewer.scope && !sameScope(rowScope(row), viewer.scope))) return null;
			if (!viewer.admin && !sameActor(rowActor(database, row), viewer.actor)) return null;
			return operationView(database, row);
		});
	}

	/** Read before staging; begin repeats this ownership test inside the write transaction. */
	checkReplay(
		operationId: string,
		request: { scope: MutationScope; actor: MutationActor; requestHash: string },
	): OperationView | null {
		return this.database.read(null, (database, version) => {
			if (version < 4) return null;
			const row = loadRow(database, operationId);
			if (!row) return null;
			if (
				!sameScope(rowScope(row), request.scope) ||
				!sameActor(rowActor(database, row), request.actor) ||
				row.request_hash !== request.requestHash
			) {
				throw new MutationStoreError("Operation key is already in use.", "IDEMPOTENCY_KEY_REUSED");
			}
			return operationView(database, row);
		});
	}

	listPending(): StoredOperation[] {
		return this.listByState("pending");
	}

	listRecoveryRequired(projectId?: string): StoredOperation[] {
		return this.listByState("recovery_required", projectId);
	}

	hasBaseline(projectId: string): boolean {
		scopeProjectId({ kind: "project", projectId });
		return this.database.read(false, (database, version) =>
			version < 4
				? false
				: Boolean(
						database
							.query(
								"SELECT 1 FROM history_events h JOIN operations o ON o.operation_id=h.operation_id WHERE o.scope_kind='project' AND o.project_id=? AND o.source='baseline' AND o.action='initial_inventory' AND o.state='completed' LIMIT 1",
							)
							.get(projectId),
					),
		);
	}

	private listByState(state: "pending" | "recovery_required", projectId?: string): StoredOperation[] {
		return this.database.read([], (database, version) =>
			version < 4
				? []
				: database
						.query<OperationRow, [string, string | null, string | null]>(
							`SELECT ${OPERATION_COLUMNS} FROM operations WHERE state=? AND (? IS NULL OR project_id=?) AND resolved_by IS NULL ORDER BY created_at,operation_id`,
						)
						.all(state, projectId ?? null, projectId ?? null)
						.map((row) => storedOperation(database, row)),
		);
	}

	listHistory(options: {
		scope: MutationScope;
		recordKey?: string;
		kind?: HistoryKind;
		cursor?: string;
		limit?: number;
	}): HistoryPage {
		const limit = options.limit ?? 50;
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
			throw new MutationStoreError("History limit must be 1–100.", "INVALID_OPERATION", 400);
		}
		const cursor = options.cursor === undefined ? null : Number(options.cursor);
		if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1)) {
			throw new MutationStoreError("Invalid history cursor.", "INVALID_OPERATION", 400);
		}
		const projectId = scopeProjectId(options.scope);
		return this.database.read({ items: [], nextCursor: null }, (database, version) => {
			if (version < 4) return { items: [], nextCursor: null };
			const rows = database
				.query<
					{ sequence: number; event_json: string },
					[
						string,
						number | null,
						number | null,
						number | null,
						string | null,
						HistoryKind | null,
						string | null,
						string | null,
						HistoryKind | null,
						HistoryKind | null,
						number,
					]
				>(
					`SELECT sequence,event_json FROM history_events h
					 WHERE scope_kind=? AND project_id IS ? AND (? IS NULL OR sequence < ?)
					 AND ((? IS NULL AND ? IS NULL) OR EXISTS (
					   SELECT 1 FROM json_each(h.event_json,'$.changes') c
					   WHERE (? IS NULL OR json_extract(c.value,'$.recordKey')=?)
					     AND (? IS NULL OR json_extract(c.value,'$.kind')=?)))
					 ORDER BY sequence DESC LIMIT ?`,
				)
				.all(
					options.scope.kind,
					projectId,
					cursor,
					cursor,
					options.recordKey ?? null,
					options.kind ?? null,
					options.recordKey ?? null,
					options.recordKey ?? null,
					options.kind ?? null,
					options.kind ?? null,
					limit + 1,
				);
			const page = rows.slice(0, limit);
			return {
				items: page.map((row) => JSON.parse(row.event_json) as HistoryEvent),
				nextCursor: rows.length > limit ? String(page.at(-1)?.sequence) : null,
			};
		});
	}

	loadRecord(projectId: string, recordKey: string): StoredRecord | null {
		return this.database.read(null, (database, version) => {
			if (version < 4) return null;
			const row = database
				.query<RecordRow, [string, string]>(`SELECT ${RECORD_COLUMNS} FROM records WHERE project_id=? AND record_key=?`)
				.get(projectId, recordKey);
			return row ? rowRecord(row) : null;
		});
	}

	findRecordByPath(projectId: string, recordPath: string): StoredRecord | null {
		if (!isAbsolute(recordPath))
			throw new MutationStoreError("Record path must be absolute.", "INVALID_OPERATION", 400);
		return this.database.read(null, (database, version) => {
			if (version < 4) return null;
			const rows = database
				.query<RecordRow, [string, string]>(
					`SELECT ${RECORD_COLUMNS} FROM records WHERE project_id=? AND path=? AND lifecycle!='deleted' LIMIT 2`,
				)
				.all(projectId, recordPath);
			if (rows.length > 1) throw new MutationStoreError("More than one record uses this path.", "AMBIGUOUS_ID");
			return rows[0] ? rowRecord(rows[0]) : null;
		});
	}

	findRecords(projectId: string, kind: RecordKind, visibleId: string): StoredRecord[] {
		return this.database.read([], (database, version) =>
			version < 4
				? []
				: database
						.query<RecordRow, [string, RecordKind, string]>(
							`SELECT ${RECORD_COLUMNS} FROM records WHERE project_id=? AND kind=? AND visible_id=? AND lifecycle!='deleted' ORDER BY record_key`,
						)
						.all(projectId, kind, visibleId)
						.map(rowRecord),
		);
	}

	listRecords(projectId: string): StoredRecord[] {
		scopeProjectId({ kind: "project", projectId });
		return this.database.read([], (database, version) =>
			version < 4
				? []
				: database
						.query<RecordRow, [string]>(`SELECT ${RECORD_COLUMNS} FROM records WHERE project_id=? ORDER BY record_key`)
						.all(projectId)
						.map(rowRecord),
		);
	}

	upsertRecord(record: StoredRecord): void {
		this.database.write((database) => upsertRecordInTransaction(database, record));
	}

	/** The caller's account/project mutation and this safe audit entry commit or roll back together. */
	appendAuditInTransaction(database: Database, intent: MutationIntent): void {
		if (intent.files.length || intent.recordUpdates.length) {
			throw new MutationStoreError("A transaction-local audit cannot contain file effects.", "INVALID_OPERATION", 400);
		}
		const json = assertIntent(intent);
		if (loadRow(database, intent.operationId)) {
			throw new MutationStoreError("Operation key is already in use.", "IDEMPOTENCY_KEY_REUSED");
		}
		insertIntent(database, intent, json);
		const row = loadRow(database, intent.operationId);
		if (!row) throw new Error("Audit operation could not be read.");
		finishInTransaction(database, row);
	}

	/** One external event and its record updates, within the observer's snapshot transaction. */
	appendObservationInTransaction(database: Database, intent: MutationIntent): void {
		if (
			intent.source !== "external" ||
			intent.actor.kind !== "unknown" ||
			intent.scope.kind !== "project" ||
			intent.files.length ||
			!intent.plannedEvent
		) {
			throw new MutationStoreError("Invalid external observation operation.", "INVALID_OPERATION", 400);
		}
		const json = assertIntent(intent);
		if (loadRow(database, intent.operationId))
			throw new MutationStoreError("Operation key is already in use.", "IDEMPOTENCY_KEY_REUSED");
		insertIntent(database, intent, json);
		const row = loadRow(database, intent.operationId);
		if (!row) throw new Error("Observation operation could not be read.");
		finishInTransaction(database, row);
	}
}
