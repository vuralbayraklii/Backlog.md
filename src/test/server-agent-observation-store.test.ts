import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { AgentStore } from "../server/agent-store.ts";
import type { AgentGrant } from "../server/agent-types.ts";
import { AuthStore } from "../server/auth-store.ts";
import { ADMIN_PERMISSIONS } from "../server/auth-types.ts";
import { ServerDatabase } from "../server/database.ts";
import { type MutationIntent, MutationStore, type StoredRecord } from "../server/mutation-store.ts";
import type { HistoryEvent } from "../server/mutation-types.ts";
import { managementAudit } from "../server/mutations.ts";
import { ObservationConflictError, ObservationStore } from "../server/observation-store.ts";
import type { ObservedPathSnapshot } from "../server/observation-types.ts";
import { createTestDirOutsideRepository, safeCleanup } from "./test-utils.ts";

const WHEN = "2026-10-23T08:00:00.000Z";
const LATER = "2026-10-23T08:01:00.000Z";
const LATEST = "2026-10-23T08:02:00.000Z";
const bytes = (text: string) => new TextEncoder().encode(text);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("A-05 agent keys and trusted observation store", () => {
	let testDir: string;
	let dataDir: string;
	let database: ServerDatabase;
	let agents: AgentStore;
	let mutations: MutationStore;
	let observations: ObservationStore;
	let taskPath: string;

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-agent-observation-");
		dataDir = join(testDir, "data");
		database = new ServerDatabase(dataDir);
		agents = new AgentStore(dataDir);
		mutations = new MutationStore(dataDir);
		observations = new ObservationStore(dataDir);
		taskPath = join(testDir, "project", "backlog", "tasks", "task-1.md");
	});

	afterEach(async () => safeCleanup(testDir));

	function seed(): void {
		database.write((db) => {
			db.query("INSERT INTO projects(id,name,root_path,created_at) VALUES(7,'P',?,'2026-10-23')").run(
				join(testDir, "project"),
			);
			db.query(
				"INSERT INTO users(id,username,display_name,role,active,password_hash,must_change_password) VALUES('u1','alice','Alice','user',1,'hash',0)",
			).run();
			db.query(
				"INSERT INTO users(id,username,display_name,role,active,password_hash,must_change_password) VALUES('u2','admin','Admin','admin',1,'hash',0)",
			).run();
			db.query(
				"INSERT INTO project_members(project_id,user_id,tasks_write,docs_write,decisions_write,decisions_manage,archive,permanent_delete) VALUES(7,'u1',1,0,1,0,0,0)",
			).run();
		});
	}

	function grant(projectId = "7"): AgentGrant {
		return { projectId, permissions: { ...ADMIN_PERMISSIONS } };
	}

	function snapshot(text: string, recordKey = "record-1", path = taskPath): ObservedPathSnapshot {
		const content = bytes(text);
		return {
			path,
			entry: { type: "file", bytes: content },
			recordBytes: content,
			recordKey,
			kind: "task",
			visibleId: "TASK-1",
			lifecycle: "active",
			identity: { dev: "10", ino: "20", birthtimeNs: "30" },
		};
	}

	function record(revision: string, path = taskPath, recordKey = "record-1"): StoredRecord {
		return { recordKey, projectId: "7", kind: "task", visibleId: "TASK-1", path, lifecycle: "active", revision };
	}

	function externalEvent(operationId: string, before: string, after: string): HistoryEvent {
		return {
			eventId: operationId,
			operationId,
			scope: { kind: "project", projectId: "7" },
			source: "external",
			actor: { kind: "unknown" },
			action: "observed_change",
			occurredAt: null,
			detectedAt: LATER,
			changes: [
				{
					recordKey: "record-1",
					kind: "task",
					visibleId: "TASK-1",
					beforeRevision: before,
					afterRevision: after,
					before: { title: before },
					after: { title: after },
				},
			],
		};
	}

	it("keeps reads absent and hashes the only returned bearer secret", () => {
		expect(agents.list("u1")).toEqual([]);
		expect(agents.load(randomUUID())).toBeNull();
		expect(agents.authenticate("bad")).toBeNull();
		expect(observations.load("7")).toMatchObject({ fingerprint: "0", entries: [], state: { state: "checking" } });
		expect(Bun.file(database.databasePath).exists()).resolves.toBe(false);
		seed();
		const created = agents.create({ userId: "u1", name: "Laptop", grants: [grant()] });
		expect(created.secret).toStartWith(`bk_${created.key.id}_`);
		expect(JSON.stringify(created.key)).not.toContain(created.secret);
		expect(agents.authenticate(created.secret)).toEqual({
			kind: "agent",
			agentKeyId: created.key.id,
			userId: "u1",
		});
		expect(agents.authenticate(`${created.secret}x`)).toBeNull();
		expect(agents.list("u1")).toEqual([created.key]);
		expect(agents.list()).toEqual([created.key]);
		const raw = new Database(database.databasePath, { readonly: true });
		const row = raw.query<{ secret_hash: string }, []>("SELECT secret_hash FROM agent_keys").get();
		expect(row?.secret_hash).toBe(hash(created.secret));
		expect(row?.secret_hash).not.toContain(created.secret);
		raw.close();
	});

	it("upgrades a populated v4 operation/history database without changing read-only evidence", async () => {
		seed();
		const operationId = randomUUID();
		const actor = { kind: "user" as const, userId: "u1" };
		const event: HistoryEvent = {
			eventId: operationId,
			operationId,
			scope: { kind: "project", projectId: "7" },
			source: "browser",
			actor,
			action: "legacy",
			occurredAt: WHEN,
			changes: [],
		};
		mutations.begin({
			operationId,
			scope: event.scope,
			actor,
			source: "browser",
			requestHash: hash("legacy"),
			action: "legacy",
			files: [],
			recordUpdates: [],
			plannedResult: { status: 200, body: { old: true } },
			plannedEvent: event,
		});
		mutations.finalize(operationId);
		const raw = new Database(database.databasePath);
		raw.exec(
			"DROP TABLE observed_paths; DROP TABLE observation_projects; DROP TABLE operation_agents; DROP TABLE agent_key_grants; DROP TABLE agent_keys; ALTER TABLE history_events RENAME TO history_events_v5",
		);
		raw.exec(`CREATE TABLE history_events (
			sequence INTEGER PRIMARY KEY AUTOINCREMENT,
			event_id TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL UNIQUE REFERENCES operations(operation_id),
			scope_kind TEXT NOT NULL CHECK(scope_kind IN ('project','admin','registration')),
			project_id INTEGER REFERENCES projects(id), occurred_at TEXT NOT NULL, event_json TEXT NOT NULL,
			CHECK((scope_kind='project' AND project_id IS NOT NULL) OR (scope_kind IN ('admin','registration') AND project_id IS NULL))
		) STRICT`);
		raw.exec(
			"INSERT INTO history_events(sequence,event_id,operation_id,scope_kind,project_id,occurred_at,event_json) SELECT sequence,event_id,operation_id,scope_kind,project_id,occurred_at,event_json FROM history_events_v5; DROP TABLE history_events_v5; CREATE INDEX history_scope ON history_events(scope_kind,project_id,sequence); PRAGMA user_version=4",
		);
		raw.close();
		const before = await Bun.file(database.databasePath).arrayBuffer();
		expect(database.read(-1, (_db, version) => version)).toBe(4);
		expect(agents.list("u1")).toEqual([]);
		expect(observations.load("7")).toMatchObject({ fingerprint: "0", entries: [] });
		expect(mutations.loadOperation(operationId, { actor })?.result?.body).toEqual({ old: true });
		expect(mutations.listHistory({ scope: event.scope }).items).toEqual([event]);
		expect(await Bun.file(database.databasePath).arrayBuffer()).toEqual(before);
		expect(() =>
			database.write(() => {
				throw new Error("rollback migration");
			}),
		).toThrow("rollback migration");
		expect(await Bun.file(database.databasePath).arrayBuffer()).toEqual(before);
		database.write(() => null);
		expect(database.read(-1, (_db, version) => version)).toBe(5);
		expect(mutations.loadOperation(operationId, { actor })?.result?.body).toEqual({ old: true });
		expect(mutations.listHistory({ scope: event.scope }).items).toEqual([event]);
		const upgraded = new Database(database.databasePath, { readonly: true });
		expect(
			upgraded.query("SELECT occurred_at,detected_at FROM history_events WHERE event_id=?").get(operationId),
		).toEqual({ occurred_at: WHEN, detected_at: null });
		upgraded.close();
	});

	it("intersects grants with current member permissions, tracking, and account state", () => {
		seed();
		const key = agents.create({ userId: "u1", name: "Laptop", grants: [grant()] });
		expect(agents.permissions(key.key.id, "7")).toEqual({
			tasksWrite: true,
			docsWrite: false,
			decisionsWrite: true,
			decisionsManage: false,
			archive: false,
			delete: false,
		});
		database.write((db) =>
			db.query("UPDATE project_members SET tasks_write=0 WHERE project_id=7 AND user_id='u1'").run(),
		);
		expect(agents.permissions(key.key.id, "7")?.tasksWrite).toBe(false);
		database.write((db) => db.query("UPDATE projects SET tracking=0 WHERE id=7").run());
		expect(agents.permissions(key.key.id, "7")).toBeNull();
		database.write((db) => db.query("UPDATE projects SET tracking=1").run());
		const adminKey = agents.create({
			userId: "u2",
			name: "Admin laptop",
			grants: [{ projectId: "7", permissions: { ...ADMIN_PERMISSIONS, delete: false } }],
		});
		expect(agents.permissions(adminKey.key.id, "7")?.delete).toBe(false);
		database.write((db) => db.query("UPDATE users SET active=0 WHERE id='u1'").run());
		expect(agents.permissions(key.key.id, "7")).toBeNull();
		expect(agents.authenticate(key.secret)).toBeNull();
	});

	it("stores only safe key metadata in atomic management audit and revision replay", () => {
		seed();
		const operationId = randomUUID();
		const actor = { kind: "user" as const, userId: "u2" };
		const scope = { kind: "admin" as const };
		const created = agents.create(
			{ userId: "u1", name: "A", grants: [grant()] },
			managementAudit(mutations, {
				operationId,
				scope,
				actor,
				source: "browser",
				requestHash: hash("create key"),
				action: "agent_key_create",
				status: 201,
				resultBody: (result) => result,
			}),
		);
		const replay = mutations.checkReplay(operationId, { scope, actor, requestHash: hash("create key") });
		expect(replay?.result?.body).toEqual({ key: created.key });
		expect(JSON.stringify(replay)).not.toContain(created.secret);
		expect(JSON.stringify(mutations.listHistory({ scope }).items)).not.toContain(created.secret);
		const raw = new Database(database.databasePath, { readonly: true });
		const stored = raw
			.query<{ planned_result_json: string; planned_event_json: string }, [string]>(
				"SELECT planned_result_json,planned_event_json FROM operations WHERE operation_id=?",
			)
			.get(operationId);
		expect(JSON.stringify(stored)).not.toContain(created.secret);
		raw.close();
		const revokeOperation = randomUUID();
		const revoked = agents.revoke(
			created.key.id,
			"u1",
			managementAudit(mutations, {
				operationId: revokeOperation,
				scope,
				actor,
				source: "browser",
				requestHash: hash("revoke key"),
				action: "agent_key_revoke",
				requireRevision: true,
				expectedRevision: created.key.revision,
				resultBody: (result) => result,
			}),
		);
		expect(revoked.revokedAt).not.toBeNull();
		expect(() =>
			agents.create({ userId: "u1", name: "rollback", grants: [grant()] }, () => {
				throw new Error("audit failed");
			}),
		).toThrow("audit failed");
		expect(agents.list("u1")).toHaveLength(1);
	});

	it("revokes by owner, on deactivation and admin reset, with audit rollback", async () => {
		seed();
		const user = new AuthStore(dataDir);
		const first = agents.create({ userId: "u1", name: "A", grants: [grant()] });
		const second = agents.create({ userId: "u1", name: "B", grants: [grant()] });
		expect(() => agents.revoke(first.key.id, "u2")).toThrow("not found");
		expect(() =>
			agents.revoke(first.key.id, "u1", () => {
				throw new Error("audit failed");
			}),
		).toThrow("audit failed");
		expect(agents.authenticate(first.secret)).not.toBeNull();
		const revoked = agents.revoke(first.key.id, "u1");
		expect(revoked.revokedAt).not.toBeNull();
		expect(agents.authenticate(first.secret)).toBeNull();
		expect(() =>
			user.editUser("u1", { active: false }, () => {
				throw new Error("audit failed");
			}),
		).toThrow("audit failed");
		expect(agents.authenticate(second.secret)).not.toBeNull();
		user.editUser("u1", { active: false });
		expect(agents.load(second.key.id)?.revokedAt).not.toBeNull();
		database.write((db) => db.query("UPDATE users SET active=1 WHERE id='u1'").run());
		const third = agents.create({ userId: "u1", name: "C", grants: [grant()] });
		await user.resetPassword("u1", "new password long enough");
		expect(agents.load(third.key.id)?.revokedAt).not.toBeNull();
		expect(agents.authenticate(third.secret)).toBeNull();
	});

	it("keeps agent operation replay and history scoped to the exact key", () => {
		seed();
		const first = agents.create({ userId: "u1", name: "A", grants: [grant()] });
		const second = agents.create({ userId: "u1", name: "B", grants: [grant()] });
		const operationId = randomUUID();
		const actor = agents.authenticate(first.secret);
		if (!actor) throw new Error("Missing agent actor.");
		const event: HistoryEvent = {
			eventId: operationId,
			operationId,
			scope: { kind: "project", projectId: "7" },
			source: "agent",
			actor,
			action: "test",
			occurredAt: WHEN,
			changes: [],
		};
		const intent: MutationIntent = {
			operationId,
			scope: event.scope,
			actor,
			source: "agent",
			requestHash: hash("agent test"),
			action: "test",
			files: [],
			recordUpdates: [],
			plannedResult: { status: 200, body: { success: true } },
			plannedEvent: event,
		};
		mutations.begin(intent);
		mutations.finalize(operationId);
		expect(mutations.loadOperation(operationId, { actor })).toMatchObject({ actor });
		expect(mutations.listHistory({ scope: event.scope }).items).toEqual([event]);
		const other = agents.authenticate(second.secret);
		if (!other) throw new Error("Missing second agent actor.");
		expect(mutations.loadOperation(operationId, { actor: other })).toBeNull();
		expect(() =>
			mutations.checkReplay(operationId, { scope: event.scope, actor: other, requestHash: intent.requestHash }),
		).toThrow("already in use");
		expect(mutations.loadOperation(operationId, { actor: { kind: "user", userId: "u1" } })).toBeNull();
		agents.revoke(first.key.id, "u1");
		expect(() =>
			mutations.begin({
				...intent,
				operationId: randomUUID(),
				plannedEvent: null,
			}),
		).toThrow("no longer active");
	});

	it("commits initial inventory without invented history, then stores unknown external time atomically", () => {
		seed();
		const first = observations.commit("7", {
			expectedFingerprint: "0",
			entries: [snapshot("before")],
			recordUpdates: [record("r1")],
			event: null,
			checkedAt: WHEN,
		});
		expect(first).toMatchObject({ fingerprint: "1", state: { state: "ready", lastSuccessfulScanAt: WHEN } });
		expect(mutations.listHistory({ scope: { kind: "project", projectId: "7" } }).items).toEqual([]);
		const operationId = randomUUID();
		const event = externalEvent(operationId, "r1", "r2");
		const second = observations.commit("7", {
			expectedFingerprint: first.fingerprint,
			entries: [snapshot("after")],
			recordUpdates: [record("r2")],
			event,
			checkedAt: LATER,
		});
		expect(second.entries[0]?.recordBytes).toEqual(bytes("after"));
		expect(mutations.loadRecord("7", "record-1")?.revision).toBe("r2");
		expect(mutations.listHistory({ scope: event.scope }).items).toEqual([event]);
		const raw = new Database(database.databasePath, { readonly: true });
		expect(raw.query("SELECT occurred_at,detected_at FROM history_events WHERE event_id=?").get(operationId)).toEqual({
			occurred_at: null,
			detected_at: LATER,
		});
		raw.close();
		expect(
			observations.commit("7", {
				expectedFingerprint: first.fingerprint,
				entries: [snapshot("after")],
				recordUpdates: [record("r2")],
				event,
				checkedAt: LATER,
			}),
		).toEqual(second);
		expect(() =>
			observations.commit("7", {
				expectedFingerprint: first.fingerprint,
				entries: [snapshot("stale")],
				recordUpdates: [],
				event: null,
				checkedAt: LATER,
			}),
		).toThrow(ObservationConflictError);
		expect(() =>
			observations.commit("7", {
				expectedFingerprint: second.fingerprint,
				entries: [snapshot("unrecorded")],
				recordUpdates: [],
				event: null,
				checkedAt: LATER,
			}),
		).toThrow("requires an external event");
	});

	it("keeps trusted bytes while degraded and rolls back invalid observation events", () => {
		seed();
		const first = observations.commit("7", {
			expectedFingerprint: "0",
			entries: [snapshot("trusted")],
			recordUpdates: [record("r1")],
			event: null,
			checkedAt: WHEN,
		});
		const checking = observations.markChecking("7", first.fingerprint);
		const degraded = observations.markDegraded("7", {
			expectedFingerprint: checking.fingerprint,
			checkedAt: LATER,
			error: "Parse failed",
		});
		expect(degraded.state).toEqual({
			state: "degraded",
			lastSuccessfulScanAt: WHEN,
			checkedAt: LATER,
			error: "Parse failed",
		});
		expect(degraded.entries[0]?.recordBytes).toEqual(bytes("trusted"));
		const event = externalEvent(randomUUID(), "r1", "r2");
		expect(() =>
			observations.commit("7", {
				expectedFingerprint: degraded.fingerprint,
				entries: [snapshot("untrusted")],
				recordUpdates: [{ ...record("r2"), projectId: "8" }],
				event,
				checkedAt: LATER,
			}),
		).toThrow();
		expect(observations.load("7")).toEqual(degraded);
		expect(mutations.listHistory({ scope: event.scope }).items).toEqual([]);
	});

	it("confirms unchanged guarded content with one status write and no new event", () => {
		seed();
		expect(() => observations.confirmUnchanged("7", { expectedFingerprint: "0", checkedAt: WHEN })).toThrow(
			ObservationConflictError,
		);
		const first = observations.commit("7", {
			expectedFingerprint: "0",
			entries: [snapshot("trusted")],
			recordUpdates: [record("r1")],
			event: null,
			checkedAt: WHEN,
		});
		const confirmed = observations.confirmUnchanged("7", {
			expectedFingerprint: first.fingerprint,
			checkedAt: LATER,
		});
		expect(confirmed.entries).toEqual(first.entries);
		expect(confirmed.state).toEqual({ state: "ready", lastSuccessfulScanAt: LATER, checkedAt: LATER, error: null });
		expect(confirmed.fingerprint).not.toBe(first.fingerprint);
		expect(() =>
			observations.confirmUnchanged("7", { expectedFingerprint: first.fingerprint, checkedAt: LATEST }),
		).toThrow(ObservationConflictError);
		expect(mutations.listHistory({ scope: { kind: "project", projectId: "7" } }).items).toEqual([]);
		expect(mutations.loadRecord("7", "record-1")?.revision).toBe("r1");
	});

	it("does not advance trusted observation while project operation evidence is unresolved", () => {
		seed();
		const first = observations.commit("7", {
			expectedFingerprint: "0",
			entries: [snapshot("trusted")],
			recordUpdates: [record("r1")],
			event: null,
			checkedAt: WHEN,
		});
		const operationId = randomUUID();
		mutations.begin({
			operationId,
			scope: { kind: "project", projectId: "7" },
			actor: { kind: "user", userId: "u1" },
			source: "browser",
			requestHash: hash("pending"),
			action: "pending",
			files: [],
			recordUpdates: [],
			plannedResult: { status: 200, body: { pending: true } },
			plannedEvent: null,
		});
		const commit = () =>
			observations.commit("7", {
				expectedFingerprint: first.fingerprint,
				entries: [snapshot("trusted")],
				recordUpdates: [],
				event: null,
				checkedAt: LATER,
			});
		expect(commit).toThrow(ObservationConflictError);
		expect(() =>
			observations.confirmUnchanged("7", { expectedFingerprint: first.fingerprint, checkedAt: LATER }),
		).toThrow(ObservationConflictError);
		mutations.requireRecovery(operationId);
		expect(commit).toThrow(ObservationConflictError);
		expect(observations.load("7")).toEqual(first);
	});

	it("refuses an observation commit if admin untracks the project during its scan", () => {
		seed();
		const first = observations.commit("7", {
			expectedFingerprint: "0",
			entries: [snapshot("before")],
			recordUpdates: [record("r1")],
			event: null,
			checkedAt: WHEN,
		});
		const checking = observations.markChecking("7", first.fingerprint);
		database.write((db) => db.query("UPDATE projects SET tracking=0 WHERE id=7").run());
		const event = externalEvent(randomUUID(), "r1", "r2");
		expect(() =>
			observations.commit("7", {
				expectedFingerprint: checking.fingerprint,
				entries: [snapshot("after")],
				recordUpdates: [record("r2")],
				event,
				checkedAt: LATER,
			}),
		).toThrow(ObservationConflictError);
		expect(() => observations.markChecking("7", checking.fingerprint)).toThrow(ObservationConflictError);
		expect(() =>
			observations.markDegraded("7", {
				expectedFingerprint: checking.fingerprint,
				checkedAt: LATER,
				error: "unavailable",
			}),
		).toThrow(ObservationConflictError);
		expect(() =>
			observations.confirmUnchanged("7", { expectedFingerprint: checking.fingerprint, checkedAt: LATER }),
		).toThrow(ObservationConflictError);
		expect(observations.load("7")).toEqual(checking);
		expect(mutations.listHistory({ scope: event.scope }).items).toEqual([]);
		expect(mutations.loadRecord("7", "record-1")?.revision).toBe("r1");
	});

	it("advances the managed checkpoint inside finalize and handles two-path moves", () => {
		seed();
		const first = observations.commit("7", {
			expectedFingerprint: "0",
			entries: [snapshot("before")],
			recordUpdates: [record("r1")],
			event: null,
			checkedAt: WHEN,
		});
		const movedPath = join(testDir, "project", "backlog", "archive", "task-1.md");
		const operationId = randomUUID();
		const actor = { kind: "user" as const, userId: "u1" };
		const event: HistoryEvent = {
			eventId: operationId,
			operationId,
			scope: { kind: "project", projectId: "7" },
			source: "browser",
			actor,
			action: "archive",
			occurredAt: LATER,
			changes: [],
		};
		mutations.begin({
			operationId,
			scope: event.scope,
			actor,
			source: "browser",
			requestHash: hash("move"),
			action: "archive",
			files: [
				{
					path: movedPath,
					before: null,
					after: { type: "file", bytes: bytes("before") },
					record: { recordKey: "record-1", kind: "task", visibleId: "TASK-1", lifecycle: "archived" },
				},
				{
					path: taskPath,
					before: { type: "file", bytes: bytes("before") },
					after: null,
					record: { recordKey: "record-1", kind: "task", visibleId: "TASK-1", lifecycle: "archived" },
				},
			],
			recordUpdates: [record("r2", movedPath)],
			plannedResult: { status: 200, body: { success: true } },
			plannedEvent: event,
		});
		mutations.finalize(operationId);
		const checkpoint = observations.load("7");
		expect(checkpoint.fingerprint).toBe("2");
		expect(checkpoint.entries).toHaveLength(1);
		expect(checkpoint.entries[0]).toMatchObject({ path: movedPath, lifecycle: "archived", identity: null });
		expect(() =>
			observations.commit("7", {
				expectedFingerprint: first.fingerprint,
				entries: [],
				recordUpdates: [],
				event: null,
				checkedAt: LATER,
			}),
		).toThrow(ObservationConflictError);
		expect(mutations.listHistory({ scope: event.scope }).items).toEqual([event]);
	});

	it("keeps a symlink pathname while checkpointing managed referent bytes", () => {
		seed();
		const linkPath = taskPath;
		const targetPath = join(testDir, "project", "backlog", "tasks", "real.md");
		const before = bytes("before");
		observations.commit("7", {
			expectedFingerprint: "0",
			entries: [{ ...snapshot("before"), entry: { type: "symlink", target: "real.md" }, recordBytes: before }],
			recordUpdates: [record("r1")],
			event: null,
			checkedAt: WHEN,
		});
		const operationId = randomUUID();
		const actor = { kind: "user" as const, userId: "u1" };
		const event: HistoryEvent = {
			eventId: operationId,
			operationId,
			scope: { kind: "project", projectId: "7" },
			source: "browser",
			actor,
			action: "edit",
			occurredAt: LATER,
			changes: [],
		};
		mutations.begin({
			operationId,
			scope: event.scope,
			actor,
			source: "browser",
			requestHash: hash("symlink edit"),
			action: "edit",
			files: [
				{
					path: targetPath,
					before: { type: "file", bytes: before },
					after: { type: "file", bytes: bytes("after") },
					record: {
						recordKey: "record-1",
						kind: "task",
						visibleId: "TASK-1",
						lifecycle: "active",
						recordPath: linkPath,
					},
				},
			],
			recordUpdates: [record("r2")],
			plannedResult: { status: 200, body: { success: true } },
			plannedEvent: event,
		});
		mutations.finalize(operationId);
		expect(observations.load("7").entries[0]).toMatchObject({
			path: linkPath,
			entry: { type: "symlink", target: "real.md" },
			recordBytes: bytes("after"),
			identity: null,
		});
	});
});
