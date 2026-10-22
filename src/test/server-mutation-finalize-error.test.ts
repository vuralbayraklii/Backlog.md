import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("central same-process all-after finalize error", () => {
	let testDir: string;
	let dataDir: string;
	let server: CentralServer;
	let base: string;
	let cookie: string;
	let csrf: string;
	let sourcePath: string;
	let archivePath: string;
	let injected: number;

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-finalize-error-");
		dataDir = join(testDir, "data");
		const root = join(testDir, "project");
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Finalize error project");
		sourcePath = await core.fs.saveTask({
			id: "TASK-1",
			title: "Before",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
		});
		archivePath = join(core.fs.archiveTasksDir, basename(sourcePath));
		await new ProjectStore(dataDir).register("Finalize error project", root);
		const password = "finalize checkpoint password";
		const auth = new AuthStore(dataDir);
		await auth.initializeAdmin("admin", password);
		const login = await auth.login("admin", password);
		const changed = await auth.changePassword(login.token, password, `${password} changed`);
		cookie = `backlog_session=${changed.token}`;
		csrf = changed.session.csrfToken;
		injected = 0;
		server = new CentralServer(dataDir, {
			mutationCheckpoint: (stage) => {
				if (stage === "before_finalize") {
					injected++;
					throw new Error("Injected after the complete physical file set.");
				}
			},
		});
		const port = await findNextAvailablePort(35000);
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

	it("finalizes the saved result and one event when every physical effect preceded an exception", async () => {
		const path = "/api/projects/1/tasks/TASK-1";
		const opened = (await (await request(path)).json()) as { revision: string };
		const operationId = randomUUID();
		const write = () =>
			request(`${path}/archive`, {
				method: "POST",
				headers: { "Idempotency-Key": operationId, "If-Match": opened.revision },
			});
		const first = await write();
		expect(first.status, await first.clone().text()).toBe(200);
		expect(injected).toBe(1);
		expect(await Bun.file(sourcePath).exists()).toBe(false);
		expect(await Bun.file(archivePath).exists()).toBe(true);
		const store = new MutationStore(dataDir);
		expect(store.loadOperation(operationId, { actor: { kind: "unknown" }, admin: true })?.state).toBe("completed");
		expect(
			store
				.listHistory({ scope: { kind: "project", projectId: "1" } })
				.items.filter((event) => event.operationId === operationId),
		).toHaveLength(1);
		const replay = await write();
		expect(replay.status).toBe(200);
		expect(injected).toBe(1);
		expect(
			store
				.listHistory({ scope: { kind: "project", projectId: "1" } })
				.items.filter((event) => event.operationId === operationId),
		).toHaveLength(1);
		expect(((await (await request("/api/projects/1")).json()) as { writeState: string }).writeState).toBe("ready");
	});
});
