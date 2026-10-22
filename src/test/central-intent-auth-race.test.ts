import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import type { CentralMutations } from "../server/mutations.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "intent lock authority password";

describe("central authority after durable-intent lock wait", () => {
	let testDir: string;
	let dataDir: string;
	let server: CentralServer;
	let base: string;
	let cookie: string;
	let csrf: string;
	let memberId: string;
	let taskPath: string;

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-intent-auth-race-");
		dataDir = join(testDir, "data");
		const root = join(testDir, "project");
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Authority race project");
		taskPath = await core.fs.saveTask({
			id: "TASK-1",
			title: "Original",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
		});
		const project = await new ProjectStore(dataDir).register("Authority race project", root);
		const auth = new AuthStore(dataDir);
		await auth.initializeAdmin("admin", PASSWORD);
		const member = await auth.createUser({ username: "member", password: PASSWORD });
		memberId = member.id;
		auth.setMember(project.id, member.id, { tasksWrite: true });
		const login = await auth.login("member", PASSWORD);
		const changed = await auth.changePassword(login.token, PASSWORD, `${PASSWORD} changed`);
		cookie = `backlog_session=${changed.token}`;
		csrf = changed.session.csrfToken;
		server = new CentralServer(dataDir);
		const port = await findNextAvailablePort(36500);
		if (!port) throw new Error("No test port available.");
		base = `http://127.0.0.1:${port}`;
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
	});

	afterEach(async () => {
		await server.stop();
		await safeCleanup(testDir);
	});

	function request(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set("Cookie", cookie);
		headers.set("Origin", base);
		headers.set("X-CSRF-Token", csrf);
		return fetch(`${base}${path}`, { ...init, headers });
	}

	it("rejects a task edit when membership is revoked while BEGIN IMMEDIATE waits", async () => {
		const opened = (await (await request("/api/projects/1/tasks/TASK-1")).json()) as { revision: string };
		const originalBytes = await Bun.file(taskPath).arrayBuffer();
		const operationId = randomUUID();
		const commitSignal = join(testDir, "commit-member-revocation");
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				`
				import { Database } from "bun:sqlite";
				import { watch } from "node:fs";
				const watchdog = setTimeout(() => process.exit(2), 8000);
				const commit = new Promise((resolve) => {
				  const watcher = watch(process.env.A04_RACE_ROOT, (_event, name) => {
				    if (String(name) === "commit-member-revocation") { watcher.close(); resolve(); }
				  });
				});
				const database = new Database(process.env.A04_RACE_DATABASE);
				database.exec("BEGIN IMMEDIATE");
				database.query("UPDATE project_members SET tasks_write=0 WHERE project_id=1 AND user_id=?").run(process.env.A04_RACE_MEMBER);
				console.log("locked");
				await commit;
				await new Promise((resolve) => setTimeout(resolve, 150));
				database.exec("COMMIT");
				database.close();
				clearTimeout(watchdog);
			`,
			],
			{
				env: {
					...process.env,
					A04_RACE_ROOT: testDir,
					A04_RACE_DATABASE: join(dataDir, "server.sqlite"),
					A04_RACE_MEMBER: memberId,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const reader = child.stdout.getReader();
		const centralMutations = Reflect.get(server, "mutations") as CentralMutations;
		const store = centralMutations.store;
		const begin = store.begin.bind(store);
		let enteredBegin = false;
		let beginWaitMs = 0;
		try {
			const signal = await reader.read();
			expect(new TextDecoder().decode(signal.value)).toContain("locked");
			store.begin = (intent, beforeIntent) => {
				enteredBegin = true;
				writeFileSync(commitSignal, "commit");
				const started = Date.now();
				try {
					return begin(intent, beforeIntent);
				} finally {
					beginWaitMs = Date.now() - started;
				}
			};
			const response = await request("/api/projects/1/tasks/TASK-1", {
				method: "PUT",
				headers: { "Content-Type": "application/json", "Idempotency-Key": operationId, "If-Match": opened.revision },
				body: JSON.stringify({ title: "Should not write" }),
			});
			expect(enteredBegin).toBe(true);
			expect(beginWaitMs).toBeGreaterThanOrEqual(100);
			expect(response.status, await response.clone().text()).toBe(403);
			expect(await Bun.file(taskPath).arrayBuffer()).toEqual(originalBytes);
			expect(
				new MutationStore(dataDir).loadOperation(operationId, { actor: { kind: "user", userId: memberId } }),
			).toBeNull();
			expect(
				new MutationStore(dataDir)
					.listHistory({ scope: { kind: "project", projectId: "1" } })
					.items.filter((event) => event.operationId === operationId),
			).toEqual([]);
			const auth = new AuthStore(dataDir);
			const current = auth.loadUser(memberId);
			if (!current) throw new Error("Member disappeared during the test.");
			expect(auth.permissions(current, "1")?.tasksWrite).toBe(false);
		} finally {
			store.begin = begin;
			writeFileSync(commitSignal, "commit");
			reader.releaseLock();
			await child.exited;
		}
		expect(child.exitCode).toBe(0);
	});
});
