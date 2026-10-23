import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { FileEntry, PreparedFileChange } from "../file-system/prepared-change.ts";
import { ServerDatabase } from "./database.ts";
import { type MutationIntent, MutationStore, upsertRecordInTransaction } from "./mutation-store.ts";
import type { HistoryEvent } from "./mutation-types.ts";
import type {
	ObservationCheckpoint,
	ObservationCommit,
	ObservationState,
	ObservedPathSnapshot,
} from "./observation-types.ts";

interface StateRow {
	generation: number;
	state: ObservationState["state"];
	last_successful_scan_at: string | null;
	checked_at: string | null;
	error: string | null;
}

interface PathRow {
	path: string;
	record_key: string;
	kind: ObservedPathSnapshot["kind"];
	visible_id: string;
	lifecycle: ObservedPathSnapshot["lifecycle"];
	entry_kind: "file" | "symlink";
	entry_bytes: Uint8Array | null;
	link_target: string | null;
	record_bytes: Uint8Array;
	entry_hash: string;
	record_hash: string;
	file_dev: string | null;
	file_ino: string | null;
	birthtime_ns: string | null;
}

const EMPTY_STATE: ObservationState = {
	state: "checking",
	lastSuccessfulScanAt: null,
	checkedAt: null,
	error: null,
};

export class ObservationConflictError extends Error {
	constructor() {
		super("Observation checkpoint changed during the scan.");
		this.name = "ObservationConflictError";
	}
}

function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function entryHash(entry: Exclude<FileEntry, null>): string {
	return sha256(
		entry.type === "file" ? Buffer.concat([Buffer.from("file\0"), entry.bytes]) : `symlink\0${entry.target}`,
	);
}

function validTime(value: string): boolean {
	const date = new Date(value);
	return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function loadState(database: Database, projectId: string): StateRow | null {
	return database
		.query<StateRow, [string]>(
			"SELECT generation,state,last_successful_scan_at,checked_at,error FROM observation_projects WHERE project_id=?",
		)
		.get(projectId);
}

function decodePath(row: PathRow): ObservedPathSnapshot {
	const entry: Exclude<FileEntry, null> =
		row.entry_kind === "file"
			? { type: "file", bytes: row.entry_bytes ?? new Uint8Array() }
			: { type: "symlink", target: row.link_target ?? "" };
	if (entryHash(entry) !== row.entry_hash || sha256(row.record_bytes) !== row.record_hash) {
		throw new Error("Stored observation snapshot hash does not match its bytes.");
	}
	return {
		path: row.path,
		entry,
		recordBytes: row.record_bytes,
		recordKey: row.record_key,
		kind: row.kind,
		visibleId: row.visible_id,
		lifecycle: row.lifecycle,
		identity:
			row.file_dev === null || row.file_ino === null || row.birthtime_ns === null
				? null
				: { dev: row.file_dev, ino: row.file_ino, birthtimeNs: row.birthtime_ns },
	};
}

function checkpoint(database: Database, projectId: string): ObservationCheckpoint {
	const row = loadState(database, projectId);
	const entries = database
		.query<PathRow, [string]>("SELECT * FROM observed_paths WHERE project_id=? ORDER BY path")
		.all(projectId)
		.map(decodePath);
	if (!row && entries.length) throw new Error("Observation paths lack a project checkpoint.");
	return {
		state: row
			? {
					state: row.state,
					lastSuccessfulScanAt: row.last_successful_scan_at,
					checkedAt: row.checked_at,
					error: row.error,
				}
			: { ...EMPTY_STATE },
		entries,
		fingerprint: String(row?.generation ?? 0),
	};
}

function assertProject(projectId: string): void {
	if (!/^[1-9]\d*$/.test(projectId)) throw new Error("Invalid observation project ID.");
}

function assertFingerprint(row: StateRow | null, expected: string): void {
	if (String(row?.generation ?? 0) !== expected) throw new ObservationConflictError();
}

function assertTrackedProject(database: Database, projectId: string): void {
	if (!database.query("SELECT 1 FROM projects WHERE id=? AND tracking=1").get(projectId)) {
		throw new ObservationConflictError();
	}
}

function assertNoUnresolvedOperation(database: Database, projectId: string): void {
	if (
		database
			.query(
				"SELECT 1 FROM operations WHERE scope_kind='project' AND project_id=? AND (state='pending' OR (state='recovery_required' AND resolved_by IS NULL)) LIMIT 1",
			)
			.get(projectId)
	) {
		throw new ObservationConflictError();
	}
}

function assertEntry(entry: ObservedPathSnapshot): void {
	if (
		!isAbsolute(entry.path) ||
		!entry.recordKey ||
		!entry.visibleId ||
		!entry.entry ||
		!(entry.recordBytes instanceof Uint8Array) ||
		!["task", "document", "decision", "milestone", "config"].includes(entry.kind) ||
		!["active", "draft", "archived"].includes(entry.lifecycle) ||
		(entry.entry.type === "file" && !Buffer.from(entry.entry.bytes).equals(Buffer.from(entry.recordBytes))) ||
		(entry.identity !== null &&
			(!/^\d+$/.test(entry.identity.dev) ||
				!/^\d+$/.test(entry.identity.ino) ||
				!/^\d+$/.test(entry.identity.birthtimeNs)))
	) {
		throw new Error("Invalid trusted observation snapshot.");
	}
}

function contentSignature(entry: ObservedPathSnapshot): string {
	return JSON.stringify({
		path: entry.path,
		recordKey: entry.recordKey,
		kind: entry.kind,
		visibleId: entry.visibleId,
		lifecycle: entry.lifecycle,
		entryHash: entryHash(entry.entry),
		recordHash: sha256(entry.recordBytes),
	});
}

function upsertPath(database: Database, projectId: string, entry: ObservedPathSnapshot): void {
	assertEntry(entry);
	database
		.query(
			`INSERT INTO observed_paths(project_id,path,record_key,kind,visible_id,lifecycle,
			 entry_kind,entry_bytes,link_target,record_bytes,entry_hash,record_hash,file_dev,file_ino,birthtime_ns)
			 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
			 ON CONFLICT(project_id,path) DO UPDATE SET record_key=excluded.record_key,kind=excluded.kind,
			 visible_id=excluded.visible_id,lifecycle=excluded.lifecycle,entry_kind=excluded.entry_kind,
			 entry_bytes=excluded.entry_bytes,link_target=excluded.link_target,record_bytes=excluded.record_bytes,
			 entry_hash=excluded.entry_hash,record_hash=excluded.record_hash,file_dev=excluded.file_dev,
			 file_ino=excluded.file_ino,birthtime_ns=excluded.birthtime_ns`,
		)
		.run(
			Number(projectId),
			entry.path,
			entry.recordKey,
			entry.kind,
			entry.visibleId,
			entry.lifecycle,
			entry.entry.type,
			entry.entry.type === "file" ? entry.entry.bytes : null,
			entry.entry.type === "symlink" ? entry.entry.target : null,
			entry.recordBytes,
			entryHash(entry.entry),
			sha256(entry.recordBytes),
			entry.identity?.dev ?? null,
			entry.identity?.ino ?? null,
			entry.identity?.birthtimeNs ?? null,
		);
}

/** The already-durable central operation and its observation point finish in one SQLite transaction. */
export function checkpointManagedInTransaction(
	database: Database,
	projectId: string,
	files: readonly PreparedFileChange[],
): void {
	const state = loadState(database, projectId);
	if (!state || files.length === 0) return;
	const prior = checkpoint(database, projectId).entries;
	for (const effect of files) {
		if (!effect.record.recordKey) continue;
		const path = effect.after?.type === "file" ? (effect.record.recordPath ?? effect.path) : effect.path;
		if (!effect.after) {
			database.query("DELETE FROM observed_paths WHERE project_id=? AND path=?").run(projectId, effect.path);
			continue;
		}
		const existing = prior.find((item) => item.path === path);
		const fromLife = prior.find((item) => item.recordKey === effect.record.recordKey);
		const entry = path === effect.path ? effect.after : existing?.entry;
		const recordBytes =
			effect.after.type === "file" ? effect.after.bytes : (existing?.recordBytes ?? fromLife?.recordBytes);
		if (!entry || !recordBytes) continue;
		upsertPath(database, projectId, {
			path,
			entry,
			recordBytes,
			recordKey: effect.record.recordKey,
			kind: effect.record.kind,
			visibleId: effect.record.visibleId,
			lifecycle: effect.record.lifecycle,
			identity: null,
		});
	}
	database.query("UPDATE observation_projects SET generation=generation+1 WHERE project_id=?").run(projectId);
}

/** Trusted per-path content and parser identity for the A-05 observer. */
export class ObservationStore {
	private readonly database: ServerDatabase;
	private readonly mutations: MutationStore;

	constructor(dataDirectory: string) {
		this.database = new ServerDatabase(dataDirectory);
		this.mutations = new MutationStore(dataDirectory);
	}

	load(projectId: string): ObservationCheckpoint {
		assertProject(projectId);
		return this.database.read({ state: { ...EMPTY_STATE }, entries: [], fingerprint: "0" }, (database, version) =>
			version < 5 ? { state: { ...EMPTY_STATE }, entries: [], fingerprint: "0" } : checkpoint(database, projectId),
		);
	}

	markChecking(projectId: string, expectedFingerprint: string): ObservationCheckpoint {
		assertProject(projectId);
		return this.database.write((database) => {
			assertTrackedProject(database, projectId);
			const row = loadState(database, projectId);
			assertFingerprint(row, expectedFingerprint);
			if (row)
				database
					.query(
						"UPDATE observation_projects SET state='checking',generation=generation+1,error=NULL WHERE project_id=?",
					)
					.run(projectId);
			else
				database
					.query(
						"INSERT INTO observation_projects(project_id,generation,state,last_successful_scan_at,checked_at,error) VALUES(?,1,'checking',NULL,NULL,NULL)",
					)
					.run(projectId);
			return checkpoint(database, projectId);
		});
	}

	markDegraded(
		projectId: string,
		input: { expectedFingerprint: string; checkedAt: string; error: string },
	): ObservationCheckpoint {
		assertProject(projectId);
		if (!validTime(input.checkedAt) || !input.error.trim()) throw new Error("Invalid degraded observation state.");
		return this.database.write((database) => {
			assertTrackedProject(database, projectId);
			const row = loadState(database, projectId);
			assertFingerprint(row, input.expectedFingerprint);
			database
				.query(
					`INSERT INTO observation_projects(project_id,generation,state,last_successful_scan_at,checked_at,error)
					 VALUES(?,1,'degraded',NULL,?,?) ON CONFLICT(project_id) DO UPDATE SET
					 generation=generation+1,state='degraded',checked_at=excluded.checked_at,error=excluded.error`,
				)
				.run(projectId, input.checkedAt, input.error);
			return checkpoint(database, projectId);
		});
	}

	/** A full guarded scan saw exactly the same trusted content and identity. */
	confirmUnchanged(
		projectId: string,
		input: { expectedFingerprint: string; checkedAt: string },
	): ObservationCheckpoint {
		assertProject(projectId);
		if (!validTime(input.checkedAt)) throw new Error("Observation detection time must be UTC.");
		return this.database.write((database) => {
			assertTrackedProject(database, projectId);
			assertNoUnresolvedOperation(database, projectId);
			const row = loadState(database, projectId);
			assertFingerprint(row, input.expectedFingerprint);
			if (!row?.last_successful_scan_at) throw new ObservationConflictError();
			database
				.query(
					"UPDATE observation_projects SET generation=generation+1,state='ready',last_successful_scan_at=?,checked_at=?,error=NULL WHERE project_id=?",
				)
				.run(input.checkedAt, input.checkedAt, projectId);
			return checkpoint(database, projectId);
		});
	}

	commit(projectId: string, input: ObservationCommit): ObservationCheckpoint {
		assertProject(projectId);
		if (!validTime(input.checkedAt)) throw new Error("Observation detection time must be UTC.");
		const seen = new Set<string>();
		for (const entry of input.entries) {
			assertEntry(entry);
			if (seen.has(entry.path)) throw new Error("Observation path appears more than once.");
			seen.add(entry.path);
		}
		if (input.event) this.assertExternalEvent(input.event, projectId, input.checkedAt);
		return this.database.write((database) => {
			assertTrackedProject(database, projectId);
			const row = loadState(database, projectId);
			assertNoUnresolvedOperation(database, projectId);
			if (input.recordUpdates.length && !input.event && row?.last_successful_scan_at) {
				throw new Error("Observed record changes require an event after the first scan.");
			}
			if (input.event) {
				const prior = database
					.query<{ event_json: string }, [string]>("SELECT event_json FROM history_events WHERE event_id=?")
					.get(input.event.eventId);
				if (prior) {
					if (JSON.stringify(JSON.parse(prior.event_json)) !== JSON.stringify(input.event))
						throw new ObservationConflictError();
					return checkpoint(database, projectId);
				}
			}
			assertFingerprint(row, input.expectedFingerprint);
			if (!input.event && row?.last_successful_scan_at) {
				const previous = checkpoint(database, projectId).entries.map(contentSignature).sort();
				const incoming = input.entries.map(contentSignature).sort();
				if (JSON.stringify(previous) !== JSON.stringify(incoming)) {
					throw new Error("Changed observation content requires an external event.");
				}
			}
			if (input.event) {
				const event = input.event;
				const intent: MutationIntent = {
					operationId: event.operationId,
					scope: event.scope,
					actor: event.actor,
					source: "external",
					requestHash: sha256(JSON.stringify(event)),
					action: event.action,
					files: [],
					recordUpdates: input.recordUpdates,
					plannedResult: { status: 200, body: { observed: true } },
					plannedEvent: event,
				};
				this.mutations.appendObservationInTransaction(database, intent);
			} else for (const record of input.recordUpdates) upsertRecordInTransaction(database, record);
			database.query("DELETE FROM observed_paths WHERE project_id=?").run(projectId);
			for (const entry of input.entries) upsertPath(database, projectId, entry);
			database
				.query(
					`INSERT INTO observation_projects(project_id,generation,state,last_successful_scan_at,checked_at,error)
					 VALUES(?,1,'ready',?,?,NULL) ON CONFLICT(project_id) DO UPDATE SET
					 generation=generation+1,state='ready',last_successful_scan_at=excluded.last_successful_scan_at,
					 checked_at=excluded.checked_at,error=NULL`,
				)
				.run(projectId, input.checkedAt, input.checkedAt);
			return checkpoint(database, projectId);
		});
	}

	private assertExternalEvent(event: HistoryEvent, projectId: string, checkedAt: string): void {
		if (
			event.scope.kind !== "project" ||
			event.scope.projectId !== projectId ||
			event.source !== "external" ||
			event.actor.kind !== "unknown" ||
			event.occurredAt !== null ||
			event.detectedAt !== checkedAt
		) {
			throw new Error("External observation event does not match its scan.");
		}
	}
}
