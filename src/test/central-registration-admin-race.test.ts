import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import type { AuthSession } from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { ProjectStore } from "../server/project-store.ts";
import type { ProjectPreview } from "../server/registration-types.ts";
import { centralFixtureFetch } from "./central-test-client.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "registration review initial password";
interface Actor {
	token: string;
	session: AuthSession;
}

describe("central registration authority and preview privacy", () => {
	let root: string;
	let data: string;
	let base: string;
	let auth: AuthStore;
	let server: CentralServer;
	let admin: Actor;
	let member: Actor;

	async function actor(username: string): Promise<Actor> {
		const login = await auth.login(username, PASSWORD);
		return auth.changePassword(login.token, PASSWORD, `${username} replacement review password`);
	}
	function request(path: string, who: Actor, method = "GET", body?: unknown) {
		return centralFixtureFetch(`${base}${path}`, {
			method,
			headers: {
				Cookie: `backlog_session=${who.token}`,
				Origin: base,
				"X-CSRF-Token": who.session.csrfToken,
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}

	beforeEach(async () => {
		root = await createTestDirOutsideRepository("backlog-registration-review-");
		data = join(root, "data");
		auth = new AuthStore(data);
		await auth.initializeAdmin("admin", PASSWORD);
		await auth.createUser({ username: "recovery", password: PASSWORD, role: "admin" });
		await auth.createUser({ username: "member", password: PASSWORD });
		admin = await actor("admin");
		member = await actor("member");
		const port = await findNextAvailablePort(22900);
		if (!port) throw new Error("No test port available");
		base = `http://127.0.0.1:${port}`;
		server = new CentralServer(data);
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
	});

	afterEach(async () => {
		await server?.stop();
		await safeCleanup(root);
	});

	it("rechecks current admin authority after a folder removal waits for the SQLite write lock", async () => {
		const folder = join(root, "folder");
		await mkdir(folder);
		const area = await auth.upsertFolderArea(member.session.user.id, folder);
		const commitSignal = join(root, "commit-admin-revocation");
		// Handshakes make the ordering deterministic: the child holds a write lock until
		// DELETE has checked the old session and is about to enter removeFolderArea.
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				`
				import { Database } from "bun:sqlite";
				import { watch } from "node:fs";
				const watchdog = setTimeout(() => process.exit(2), 5000);
				const commit = new Promise((resolve) => {
					const watcher = watch(process.env.A03_REVIEW_ROOT, (_event, name) => {
						if (String(name) === "commit-admin-revocation") { watcher.close(); resolve(); }
					});
				});
				const database = new Database(process.env.A03_REVIEW_DATABASE);
				database.exec("BEGIN IMMEDIATE");
				database.query("UPDATE users SET role='user' WHERE id=?").run(process.env.A03_REVIEW_ADMIN);
				database.query("DELETE FROM sessions WHERE user_id=?").run(process.env.A03_REVIEW_ADMIN);
				console.log("locked");
				await commit;
				database.exec("COMMIT");
				database.close();
				clearTimeout(watchdog);
			`,
			],
			{
				env: {
					...process.env,
					A03_REVIEW_ROOT: root,
					A03_REVIEW_DATABASE: auth.databasePath,
					A03_REVIEW_ADMIN: admin.session.user.id,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const reader = child.stdout.getReader();
		const requestAuth = Reflect.get(server, "auth") as AuthStore;
		const remove = requestAuth.removeFolderArea.bind(requestAuth);
		try {
			const signal = await reader.read();
			expect(new TextDecoder().decode(signal.value)).toContain("locked");
			requestAuth.removeFolderArea = (id, beforeCommit, audit) => {
				writeFileSync(commitSignal, "commit");
				remove(id, beforeCommit, audit);
			};
			const response = await request(`/api/admin/folder-areas/${area.id}`, admin, "DELETE");
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "Authentication required." });
			expect(auth.loadSession(admin.token)).toBeNull();
			expect(auth.loadUser(admin.session.user.id)?.role).toBe("user");
			expect(auth.listFolderAreas()).toEqual([area]);
		} finally {
			requestAuth.removeFolderArea = remove;
			writeFileSync(commitSignal, "commit");
			reader.releaseLock();
			await child.exited;
		}
		expect(child.exitCode).toBe(0);
	});

	it("does not inspect an already registered private project covered by a registration area", async () => {
		const ownArea = join(root, "personal");
		const privateRoot = join(ownArea, "private");
		const core = new Core(privateRoot);
		await initializeFilesystemTestProject(core, "PRIVATE CONFIGURATION");
		await core.fs.saveTask({
			id: "TASK-1",
			title: "PRIVATE TASK",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
		});
		const project = await new ProjectStore(data).register("PRIVATE BINDING", privateRoot);
		await auth.upsertFolderArea(member.session.user.id, ownArea);
		expect(auth.permissions(member.session.user, project.id)).toBeNull();
		expect((await request(`/api/projects/${project.id}`, member)).status).toBe(404);
		const response = await request("/api/projects/preview", member, "POST", { name: "Attempt", path: privateRoot });
		expect(response.status).toBe(200);
		const result: ProjectPreview = await response.json();
		expect(result.canRegister).toBe(false);
		expect(result.config).toBeNull();
		expect(result.configPath).toBeNull();
		expect(result.backlogPath).toBeNull();
		expect(result.counts).toEqual({ tasks: 0, drafts: 0, documents: 0, decisions: 0, archived: 0 });
		expect(result.issues).toEqual([
			{ severity: "error", message: "Project root is already registered or overlaps an existing project." },
		]);
		expect(JSON.stringify(result)).not.toContain("PRIVATE");
		expect(JSON.stringify(result)).not.toContain(join(privateRoot, "backlog"));
	});
});
