import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { ServerDatabase } from "../server/database.ts";
import { type MutationIntent, MutationStore, type StoredRecord } from "../server/mutation-store.ts";
import type { HistoryEvent } from "../server/mutation-types.ts";
import { createTestDirOutsideRepository, safeCleanup } from "./test-utils.ts";

const WHEN = "2026-10-22T08:00:00.000Z";
const requestHash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("persistent central mutation store", () => {
	let testDir: string;
	let dataDir: string;
	let store: MutationStore;
	let database: ServerDatabase;

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-mutation-store-");
		dataDir = join(testDir, "data");
		store = new MutationStore(dataDir);
		database = new ServerDatabase(dataDir);
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	function seedProjects(): void {
		database.write((db) => {
			db.query("INSERT INTO projects(id,name,root_path,created_at) VALUES(7,'A',?,'2026-10-21')").run(
				join(testDir, "a"),
			);
			db.query("INSERT INTO projects(id,name,root_path,created_at) VALUES(8,'B',?,'2026-10-21')").run(
				join(testDir, "b"),
			);
		});
	}

	function intent(
		options: {
			operationId?: string;
			projectId?: string;
			recordKey?: string;
			kind?: "task" | "decision";
			request?: string;
			withEvent?: boolean;
		} = {},
	): MutationIntent {
		const operationId = options.operationId ?? randomUUID();
		const projectId = options.projectId ?? "7";
		const recordKey = options.recordKey ?? randomUUID();
		const kind = options.kind ?? "task";
		const visibleId = kind === "task" ? "TASK-1" : "decision-1";
		const path = join(testDir, projectId, `${visibleId}.md`);
		const body = new TextEncoder().encode(`${visibleId}\n`);
		const event: HistoryEvent = {
			eventId: operationId,
			operationId,
			scope: { kind: "project", projectId },
			actor: { kind: "user", userId: "alice" },
			source: "browser",
			action: "create",
			occurredAt: WHEN,
			changes: [
				{
					recordKey,
					kind,
					visibleId,
					beforeRevision: null,
					afterRevision: "rev-1",
					before: null,
					after: { title: visibleId, createdDate: "2026-10-21" },
				},
			],
		};
		return {
			operationId,
			scope: { kind: "project", projectId },
			actor: { kind: "user", userId: "alice" },
			source: "browser",
			requestHash: requestHash(options.request ?? `${projectId}:${kind}:${visibleId}`),
			action: "create",
			files: [
				{
					path,
					before: null,
					after: { type: "file", bytes: body },
					record: { recordKey, kind, visibleId, lifecycle: "active" },
					noReplace: true,
				},
			],
			recordUpdates: [{ recordKey, projectId, kind, visibleId, path, lifecycle: "active", revision: "rev-1" }],
			plannedResult: { status: 201, body: { id: visibleId, recordKey }, headers: { ETag: "rev-1" } },
			plannedEvent: options.withEvent === false ? null : event,
		};
	}

	it("does not create or migrate the database on reads", async () => {
		expect(store.loadOperation(randomUUID(), { actor: { kind: "unknown" } })).toBeNull();
		expect(
			store.checkReplay(randomUUID(), {
				scope: { kind: "project", projectId: "7" },
				actor: { kind: "user", userId: "alice" },
				requestHash: requestHash("absent"),
			}),
		).toBeNull();
		expect(store.listPending()).toEqual([]);
		expect(store.hasBaseline("7")).toBe(false);
		expect(store.listHistory({ scope: { kind: "project", projectId: "7" } })).toEqual({
			items: [],
			nextCursor: null,
		});
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
	});

	it("remembers the first inventory event even when a project has no records", () => {
		seedProjects();
		const operationId = randomUUID();
		const baseline: MutationIntent = {
			operationId,
			scope: { kind: "project", projectId: "7" },
			actor: { kind: "unknown" },
			source: "baseline",
			requestHash: requestHash("baseline:7"),
			action: "initial_inventory",
			files: [],
			recordUpdates: [],
			plannedResult: { status: 200, body: { count: 0 } },
			plannedEvent: {
				eventId: operationId,
				operationId,
				scope: { kind: "project", projectId: "7" },
				actor: { kind: "unknown" },
				source: "baseline",
				action: "initial_inventory",
				occurredAt: WHEN,
				changes: [],
			},
		};
		store.begin(baseline);
		expect(store.hasBaseline("7")).toBe(false);
		store.finalize(operationId);
		expect(new MutationStore(dataDir).hasBaseline("7")).toBe(true);
		expect(store.hasBaseline("8")).toBe(false);
		if (!baseline.plannedEvent) throw new Error("Fixture missing a baseline event.");
		expect(store.listHistory({ scope: baseline.scope }).items).toEqual([baseline.plannedEvent]);
	});

	it("rechecks access after the SQLite write wait and rolls back a refused intent", () => {
		seedProjects();
		const pending = intent();
		expect(() =>
			store.begin(pending, () => {
				throw new Error("Access was revoked during the write wait.");
			}),
		).toThrow("Access was revoked");
		expect(store.loadOperation(pending.operationId, { actor: pending.actor })).toBeNull();
		expect(store.listPending()).toEqual([]);
		expect(store.listHistory({ scope: pending.scope }).items).toEqual([]);
	});

	it("retains v3 accounts, sessions, grants, project identities, and rollback behavior through v5", async () => {
		seedProjects();
		database.write((db) => {
			db.query(
				"INSERT INTO users(id,username,display_name,role,active,password_hash,must_change_password) VALUES('u1','alice','Alice','user',1,'hash',0)",
			).run();
			db.query(
				"INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_activity_at) VALUES('h','u1','c',1,2,1)",
			).run();
			db.query(
				"INSERT INTO project_members(project_id,user_id,tasks_write,docs_write,decisions_write,decisions_manage,archive,permanent_delete) VALUES(7,'u1',1,1,1,0,0,0)",
			).run();
			db.query("INSERT INTO folder_areas(id,user_id,root_path,created_at) VALUES('a1','u1','/tmp/area',?)").run(WHEN);
		});
		const old = new Database(store.databasePath);
		old.exec(
			"DROP TABLE observed_paths; DROP TABLE observation_projects; DROP TABLE operation_agents; DROP TABLE agent_key_grants; DROP TABLE agent_keys; DROP TABLE history_events; DROP TABLE operation_files; DROP TABLE operations; DROP TABLE records; PRAGMA user_version=3",
		);
		old.close();
		const before = await Bun.file(store.databasePath).arrayBuffer();
		expect(database.read(-1, (_db, version) => version)).toBe(3);
		expect(store.listPending()).toEqual([]);
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
		expect(() =>
			database.write(() => {
				throw new Error("cancel");
			}),
		).toThrow("cancel");
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
		database.write((db) => {
			expect(db.query("SELECT id FROM projects ORDER BY id").all()).toEqual([{ id: 7 }, { id: 8 }]);
			expect(db.query("SELECT username FROM users").all()).toEqual([{ username: "alice" }]);
			expect(db.query("SELECT token_hash FROM sessions").all()).toEqual([{ token_hash: "h" }]);
			expect(db.query("SELECT user_id FROM project_members").all()).toEqual([{ user_id: "u1" }]);
			expect(db.query("SELECT id FROM folder_areas").all()).toEqual([{ id: "a1" }]);
		});
		expect(database.read(-1, (_db, version) => version)).toBe(5);
	});

	it("keeps full physical evidence, ownership, safe response and one event across replay", () => {
		seedProjects();
		const input = intent();
		const first = store.begin(input);
		expect(first.created).toBe(true);
		expect(first.operation.state).toBe("pending");
		expect(first.operation.files[0]?.after).toEqual(input.files[0]?.after);
		expect(
			store.checkReplay(input.operationId, {
				scope: input.scope,
				actor: input.actor,
				requestHash: input.requestHash,
			}),
		).toMatchObject({ operationId: input.operationId, state: "pending" });
		expect(() =>
			store.checkReplay(input.operationId, {
				scope: input.scope,
				actor: input.actor,
				requestHash: requestHash("different"),
			}),
		).toThrow("Operation key is already in use.");
		expect(store.listHistory({ scope: input.scope }).items).toEqual([]);
		expect(store.begin(input)).toMatchObject({ created: false, operation: { operationId: input.operationId } });
		for (const retry of [
			{ ...input, requestHash: requestHash("different") },
			{ ...input, actor: { kind: "user" as const, userId: "bob" } },
		]) {
			try {
				store.begin(retry);
				throw new Error("Expected the operation key to be rejected.");
			} catch (error) {
				expect(error).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
			}
		}
		expect(store.loadOperation(input.operationId, { actor: { kind: "user", userId: "bob" } })).toBeNull();
		expect(
			store.loadOperation(input.operationId, { actor: input.actor, scope: { kind: "project", projectId: "8" } }),
		).toBeNull();
		const finished = store.finalize(input.operationId);
		expect(finished.state).toBe("completed");
		expect(finished.result).toEqual(input.plannedResult);
		expect(store.finalize(input.operationId).result).toEqual(input.plannedResult);
		expect(store.loadRecord("7", input.recordUpdates[0]?.recordKey ?? "")).toEqual(
			input.recordUpdates[0] as StoredRecord,
		);
		if (!input.plannedEvent) throw new Error("Fixture missing a history event.");
		expect(store.listHistory({ scope: input.scope }).items).toEqual([input.plannedEvent]);
		expect(store.listHistory({ scope: { kind: "project", projectId: "8" } }).items).toEqual([]);
	});

	it("claims the same operation key once across concurrent processes", async () => {
		seedProjects();
		const operationId = randomUUID();
		const gate = join(testDir, "go");
		const script = `
			const { MutationStore } = await import(Bun.argv[1]);
			while (!(await Bun.file(Bun.argv[4]).exists())) await new Promise((resolve) => setTimeout(resolve, 5));
			const store = new MutationStore(Bun.argv[2]);
			const result = store.begin({
				operationId: Bun.argv[3], scope: { kind: "project", projectId: "7" },
				actor: { kind: "user", userId: "alice" }, source: "browser",
				requestHash: "${requestHash("same request")}", action: "noop", files: [], recordUpdates: [],
				plannedResult: { status: 200, body: { success: true } }, plannedEvent: null,
			});
			console.log(JSON.stringify({ created: result.created, state: result.operation.state }));
		`;
		const launch = () =>
			Bun.spawn({
				cmd: [
					process.execPath,
					"-e",
					script,
					join(import.meta.dir, "../server/mutation-store.ts"),
					dataDir,
					operationId,
					gate,
				],
				stdout: "pipe",
				stderr: "pipe",
			});
		const children = [launch(), launch()];
		await Bun.write(gate, "go");
		const results = await Promise.all(
			children.map(async (child) => ({
				code: await child.exited,
				output: await new Response(child.stdout).text(),
				error: await new Response(child.stderr).text(),
			})),
		);
		for (const result of results) expect(result).toMatchObject({ code: 0, error: "" });
		expect(results.map((result) => JSON.parse(result.output).created).sort()).toEqual([false, true]);
		expect(store.listPending().map((operation) => operation.operationId)).toEqual([operationId]);
	});

	it("keeps link targets and target absence for moves, while no-op results add no event", () => {
		seedProjects();
		const input = intent();
		const record = input.files[0]?.record;
		if (!record) throw new Error("Fixture missing record.");
		const source = join(testDir, "source-link");
		const target = join(testDir, "archive-link");
		input.files = [
			{ path: target, before: null, after: { type: "symlink", target: "../docs/file.md" }, record, noReplace: true },
			{ path: source, before: { type: "symlink", target: "docs/file.md" }, after: null, record },
		];
		const pending = store.begin(input).operation;
		expect(pending.files).toEqual(input.files.map((file) => ({ ...file, noReplace: file.noReplace ?? false })));
		store.finalize(input.operationId);
		const noOp = intent({ request: "noop", withEvent: false });
		noOp.files = [];
		noOp.recordUpdates = [];
		store.begin(noOp);
		store.finalize(noOp.operationId);
		expect(store.listHistory({ scope: input.scope }).items.map((event) => event.operationId)).toEqual([
			input.operationId,
		]);
	});

	it("distinguishes an empty file from an absent path in durable intent", () => {
		seedProjects();
		const input = intent();
		const file = input.files[0];
		if (!file) throw new Error("Fixture missing a prepared file.");
		input.files = [{ ...file, after: { type: "file", bytes: new Uint8Array() } }];
		const stored = store.begin(input).operation.files[0];
		expect(stored?.before).toBeNull();
		expect(stored?.after).toEqual({ type: "file", bytes: new Uint8Array() });
	});

	it("filters history by kind alone and by record key with stable cursor pages", () => {
		seedProjects();
		const task = intent({ request: "task" });
		const decision = intent({ kind: "decision", request: "decision" });
		store.begin(task);
		store.finalize(task.operationId);
		store.begin(decision);
		store.finalize(decision.operationId);
		const scope = { kind: "project" as const, projectId: "7" };
		expect(store.listHistory({ scope, kind: "decision" }).items.map((event) => event.operationId)).toEqual([
			decision.operationId,
		]);
		expect(
			store.listHistory({ scope, recordKey: task.recordUpdates[0]?.recordKey }).items.map((event) => event.operationId),
		).toEqual([task.operationId]);
		const first = store.listHistory({ scope, limit: 1 });
		expect(first.items.map((event) => event.operationId)).toEqual([decision.operationId]);
		expect(first.nextCursor).toMatch(/^\d+$/);
		expect(
			store.listHistory({ scope, cursor: first.nextCursor ?? "", limit: 1 }).items.map((event) => event.operationId),
		).toEqual([task.operationId]);
	});

	it("keeps not-applied and recovery-required states terminal without adding success events", () => {
		seedProjects();
		const absent = intent({ request: "absent" });
		store.begin(absent);
		expect(store.markNotApplied(absent.operationId).state).toBe("not_applied");
		expect(() => store.finalize(absent.operationId)).toThrow("cannot be finalized");
		const mixed = intent({ request: "mixed" });
		store.begin(mixed);
		expect(store.requireRecovery(mixed.operationId).state).toBe("recovery_required");
		expect(() => store.finalize(mixed.operationId)).toThrow("cannot be finalized");
		expect(store.listPending()).toEqual([]);
		expect(new MutationStore(dataDir).listRecoveryRequired("7").map((operation) => operation.operationId)).toEqual([
			mixed.operationId,
		]);
		expect(store.listRecoveryRequired("8")).toEqual([]);
		expect(store.listHistory({ scope: absent.scope }).items).toEqual([]);
	});

	it("links a separate observed recovery event while the interrupted operation stays unsuccessful", () => {
		seedProjects();
		const interrupted = intent();
		store.begin(interrupted);
		store.requireRecovery(interrupted.operationId);
		const operationId = randomUUID();
		const recovery: MutationIntent = {
			operationId,
			scope: interrupted.scope,
			actor: { kind: "user", userId: "admin" },
			source: "recovery",
			requestHash: requestHash("reviewed fingerprint"),
			action: "accept_observed",
			files: [],
			recordUpdates: [],
			plannedResult: { status: 200, body: { resolved: interrupted.operationId } },
			plannedEvent: {
				eventId: operationId,
				operationId,
				scope: interrupted.scope,
				actor: { kind: "user", userId: "admin" },
				source: "recovery",
				action: "accept_observed",
				occurredAt: WHEN,
				changes: [],
			},
		};
		const competing = intent({ request: "other pending write" });
		store.begin(competing);
		expect(() => store.resolveObserved(interrupted.operationId, recovery)).toThrow(
			"Another project operation is unresolved",
		);
		store.markNotApplied(competing.operationId);
		expect(store.resolveObserved(interrupted.operationId, recovery).state).toBe("completed");
		expect(store.resolveObserved(interrupted.operationId, recovery).operationId).toBe(operationId);
		expect(new MutationStore(dataDir).listRecoveryRequired("7")).toEqual([]);
		expect(store.loadOperation(interrupted.operationId, { actor: interrupted.actor })?.state).toBe("recovery_required");
		expect(store.listHistory({ scope: interrupted.scope }).items.map((event) => event.operationId)).toEqual([
			operationId,
		]);
		const recoveryEvent = recovery.plannedEvent;
		if (!recoveryEvent) throw new Error("Fixture missing recovery event.");
		const otherId = randomUUID();
		expect(() =>
			store.resolveObserved(interrupted.operationId, {
				...recovery,
				operationId: otherId,
				plannedEvent: { ...recoveryEvent, eventId: otherId, operationId: otherId },
			}),
		).toThrow("already resolved");
	});

	it("preserves a record key across draft, promotion, archive and restore, but refuses a deleted life", () => {
		seedProjects();
		const recordKey = randomUUID();
		const draft: StoredRecord = {
			recordKey,
			projectId: "7",
			kind: "task",
			visibleId: "DRAFT-1",
			path: join(testDir, "draft.md"),
			lifecycle: "draft",
			revision: "r1",
		};
		store.upsertRecord(draft);
		const promoted = {
			...draft,
			visibleId: "TASK-1",
			lifecycle: "active" as const,
			path: join(testDir, "task.md"),
			revision: "r2",
		};
		store.upsertRecord(promoted);
		store.upsertRecord({ ...promoted, lifecycle: "archived", path: join(testDir, "archive.md") });
		store.upsertRecord(promoted);
		expect(store.findRecords("7", "task", "TASK-1")).toEqual([promoted]);
		expect(store.findRecordByPath("7", promoted.path ?? "")).toEqual(promoted);
		expect(store.findRecords("7", "task", "DRAFT-1")).toEqual([]);
		store.upsertRecord({ ...promoted, lifecycle: "deleted", path: null, revision: null });
		expect(() => store.upsertRecord(promoted)).toThrow("new life");
		const newLife = { ...promoted, recordKey: randomUUID() };
		store.upsertRecord(newLife);
		expect(store.findRecords("7", "task", "TASK-1")).toEqual([newLife]);
		store.upsertRecord({ ...newLife, recordKey: randomUUID(), visibleId: "TASK-2" });
		try {
			store.findRecordByPath("7", newLife.path ?? "");
			throw new Error("Expected ambiguous record path rejection.");
		} catch (error) {
			expect(error).toMatchObject({ code: "AMBIGUOUS_ID" });
		}
	});

	it("writes safe administration audit in the caller transaction and rejects secret payloads", () => {
		seedProjects();
		const operationId = randomUUID();
		const audit: MutationIntent = {
			operationId,
			scope: { kind: "admin" },
			actor: { kind: "user", userId: "admin" },
			source: "server-cli",
			requestHash: requestHash("audit"),
			action: "user.edit",
			files: [],
			recordUpdates: [],
			plannedResult: { status: 200, body: { id: "u1", mustChangePassword: false } },
			plannedEvent: {
				eventId: operationId,
				operationId,
				scope: { kind: "admin" },
				actor: { kind: "user", userId: "admin" },
				source: "server-cli",
				action: "user.edit",
				occurredAt: WHEN,
				changes: [
					{
						recordKey: "user:u1",
						kind: "user",
						visibleId: "u1",
						beforeRevision: null,
						afterRevision: "m1",
						before: null,
						after: { id: "u1", mustChangePassword: false },
					},
				],
			},
		};
		expect(() =>
			database.write((db) => {
				store.appendAuditInTransaction(db, audit);
				throw new Error("cancel");
			}),
		).toThrow("cancel");
		expect(store.loadOperation(operationId, { actor: audit.actor })).toBeNull();
		database.write((db) => store.appendAuditInTransaction(db, audit));
		expect(store.loadOperation(operationId, { actor: audit.actor })?.state).toBe("completed");
		expect(store.listHistory({ scope: audit.scope }).items.map((event) => event.operationId)).toEqual([operationId]);
		expect(store.listHistory({ scope: audit.scope, kind: "user" }).items.map((event) => event.operationId)).toEqual([
			operationId,
		]);
		expect(store.listHistory({ scope: { kind: "project", projectId: "7" } }).items).toEqual([]);
		const unsafeId = randomUUID();
		const unsafe = {
			...audit,
			operationId: unsafeId,
			plannedResult: { status: 200, body: { passwordHash: "private" } },
			plannedEvent: { ...audit.plannedEvent, eventId: unsafeId, operationId: unsafeId },
		} as MutationIntent;
		expect(() => database.write((db) => store.appendAuditInTransaction(db, unsafe))).toThrow("Authentication secrets");
		expect(store.loadOperation(unsafe.operationId, { actor: audit.actor })).toBeNull();
		const unsafeHeaderId = randomUUID();
		const unsafeHeader = {
			...audit,
			operationId: unsafeHeaderId,
			plannedEvent: { ...audit.plannedEvent, eventId: unsafeHeaderId, operationId: unsafeHeaderId },
			plannedResult: { status: 200, body: { success: true }, headers: { "Set-Cookie": "secret" } },
		} as MutationIntent;
		expect(() => database.write((db) => store.appendAuditInTransaction(db, unsafeHeader))).toThrow(
			"Unsafe response header",
		);
		const hiddenId = randomUUID();
		const hiddenSecret: MutationIntent = {
			...audit,
			operationId: hiddenId,
			plannedEvent: { ...audit.plannedEvent, eventId: hiddenId, operationId: hiddenId } as HistoryEvent,
			plannedResult: { status: 200, body: { toJSON: () => ({ passwordHash: "private" }) } },
		};
		expect(() => database.write((db) => store.appendAuditInTransaction(db, hiddenSecret))).toThrow(
			"Authentication secrets",
		);
	});
});
