import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { type AuthSession, DEFAULT_PERMISSIONS } from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { ProjectStore } from "../server/project-store.ts";
import type { FolderArea, ProjectPreview } from "../server/registration-types.ts";
import { centralFixtureFetch } from "./central-test-client.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "registration initial password";
interface Actor {
	cookie: string;
	session: AuthSession;
}

async function snapshot(root: string): Promise<Record<string, string>> {
	const entries: Record<string, string> = {};
	async function walk(path: string) {
		const metadata = await lstat(path);
		const key = relative(root, path);
		if (metadata.isSymbolicLink()) entries[key] = `link:${await readlink(path)}`;
		else if (metadata.isDirectory()) {
			entries[key] = "directory";
			for (const name of (await readdir(path)).sort()) await walk(join(path, name));
		} else
			entries[key] = createHash("sha256")
				.update(Buffer.from(await Bun.file(path).arrayBuffer()))
				.digest("hex");
	}
	await walk(root);
	return entries;
}

describe("central prepared-project registration", () => {
	let root: string;
	let data: string;
	let ownArea: string;
	let otherArea: string;
	let base: string;
	let auth: AuthStore;
	let projects: ProjectStore;
	let server: CentralServer;
	let admin: Actor;
	let member: Actor;
	let other: Actor;

	async function actor(username: string): Promise<Actor> {
		const login = await auth.login(username, PASSWORD);
		const changed = await auth.changePassword(login.token, PASSWORD, `${username} replacement password`);
		return { cookie: `backlog_session=${changed.token}`, session: changed.session };
	}
	async function request(path: string, who?: Actor, method = "GET", body?: unknown, headers?: Record<string, string>) {
		return centralFixtureFetch(`${base}${path}`, {
			method,
			headers: {
				Origin: base,
				...(who ? { Cookie: who.cookie, "X-CSRF-Token": who.session.csrfToken } : {}),
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
				...headers,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			redirect: "manual",
		});
	}
	async function grant(who = member, path = ownArea): Promise<FolderArea> {
		const response = await request("/api/admin/folder-areas", admin, "POST", { userId: who.session.user.id, path });
		expect(response.status).toBe(200);
		return response.json();
	}
	async function seed(path: string, name = "Prepared", directory?: string) {
		const core = new Core(path);
		await initializeFilesystemTestProject(core, name, directory);
		await core.fs.saveTask({
			id: "TASK-1",
			title: `${name} task`,
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
		});
		await core.fs.saveDocument({
			id: "doc-1",
			title: `${name} document`,
			type: "guide",
			createdDate: "2026-10-22",
			rawContent: "Prepared document",
		});
		await core.fs.saveDecision({
			id: "decision-1",
			title: `${name} decision`,
			date: "2026-10-22",
			status: "proposed",
			context: "Context",
			decision: "Draft",
			consequences: "None",
			rawContent: "",
		});
		await Bun.write(join(core.fs.backlogDir, "assets", "example.txt"), "prepared asset");
		return core.fs;
	}
	async function preview(path: string, who = member): Promise<ProjectPreview> {
		const response = await request("/api/projects/preview", who, "POST", { name: "Display", path });
		expect(response.status).toBe(200);
		return response.json();
	}
	async function connect(id: string, who = member) {
		const socket = new WebSocket(`${base.replace("http:", "ws:")}/api/projects/${id}/ws`, {
			headers: { Origin: base, Cookie: who.cookie },
		} as never);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("WebSocket failed"));
		});
		return socket;
	}

	beforeEach(async () => {
		root = await createTestDirOutsideRepository("backlog-central-registration-");
		data = join(root, "data");
		ownArea = join(root, "areas", "member");
		otherArea = join(root, "areas", "other");
		await mkdir(ownArea, { recursive: true });
		await mkdir(otherArea, { recursive: true });
		auth = new AuthStore(data);
		projects = new ProjectStore(data);
		await auth.initializeAdmin("admin", PASSWORD);
		await auth.createUser({ username: "member", password: PASSWORD });
		await auth.createUser({ username: "other", password: PASSWORD });
		admin = await actor("admin");
		member = await actor("member");
		other = await actor("other");
		const port = await findNextAvailablePort(22100);
		if (!port) throw new Error("No test port available");
		base = `http://127.0.0.1:${port}`;
		server = new CentralServer(data);
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
	});
	afterEach(async () => {
		await server?.stop();
		await safeCleanup(root);
	});

	it("uses session identity, Origin and CSRF, and shows only personal registration areas", async () => {
		const path = join(ownArea, "project");
		await seed(path);
		expect((await request("/api/projects/preview", undefined, "POST", { name: "Example", path })).status).toBe(401);
		expect((await request("/api/projects/preview", member, "POST", { name: "Example", path })).status).toBe(403);
		expect(await (await request("/api/projects/registration", member)).json()).toEqual({ allowed: false, areas: [] });
		const own = await grant();
		await grant(other, otherArea);
		expect(await (await request("/api/projects/registration", member)).json()).toEqual({ allowed: true, areas: [own] });
		expect((await request("/api/admin/folder-areas", member)).status).toBe(403);
		expect((await request("/api/admin/projects", member)).status).toBe(403);
		for (const route of ["/api/projects/preview", "/api/projects"]) {
			expect(
				(await request(route, member, "POST", { name: "Example", path, userId: admin.session.user.id })).status,
			).toBe(400);
			expect(
				(await request(route, member, "POST", { name: "Example", path }, { "X-CSRF-Token": "wrong" })).status,
			).toBe(403);
			expect(
				(await request(route, member, "POST", { name: "Example", path }, { Origin: "https://foreign.example" })).status,
			).toBe(403);
		}
		expect(projects.list()).toEqual([]);
	});

	it("assigns canonical non-overlapping areas and keeps the same ID on upsert", async () => {
		const assigned = await grant();
		expect(await grant()).toEqual(assigned);
		const nested = join(ownArea, "nested");
		await mkdir(nested);
		for (const path of [ownArea, nested, join(root, "areas")]) {
			const response = await request("/api/admin/folder-areas", admin, "POST", { userId: other.session.user.id, path });
			expect(response.status).toBe(409);
		}
		const alias = join(root, "area-alias");
		await symlink(ownArea, alias);
		expect(await grant(member, alias)).toEqual(assigned);
		expect(await (await request("/api/admin/folder-areas", admin)).json()).toEqual([assigned]);
	});

	it.each([undefined, ".backlog", "planning/work"])(
		"previews and binds %s layout without source changes",
		async (directory) => {
			await grant();
			const path = join(ownArea, "ready");
			const fs = await seed(path, "Source name", directory);
			const before = await snapshot(path);
			const inspected = await preview(path);
			expect(inspected).toMatchObject({
				name: "Display",
				rootPath: path,
				backlogPath: fs.backlogDir,
				canRegister: true,
				counts: { tasks: 1, documents: 1, decisions: 1 },
			});
			expect(inspected.config?.projectName).toBe("Source name");
			expect(await snapshot(path)).toEqual(before);
			const registered = await request("/api/projects", member, "POST", { name: "Display", path });
			expect(registered.status).toBe(201);
			const project = await registered.json();
			expect(project).toMatchObject({ id: "1", name: "Display", rootPath: path, tracking: true });
			expect(auth.listMembers(project.id)).toEqual([
				{ projectId: project.id, userId: member.session.user.id, permissions: DEFAULT_PERMISSIONS },
			]);
			expect(await (await request("/api/projects", member)).json()).toEqual([{ id: project.id, name: "Display" }]);
			expect((await request(`/api/projects/${project.id}/tasks`, member)).status).toBe(200);
			expect((await request(`/api/projects/${project.id}/tasks`, other)).status).toBe(404);
			expect(await snapshot(path)).toEqual(before);
		},
	);

	it("rejects unprepared directories without creating files or a partial central record", async () => {
		await grant();
		const path = join(ownArea, "unprepared");
		await mkdir(path);
		const before = await snapshot(path);
		expect(await preview(path)).toMatchObject({ canRegister: false });
		expect((await request("/api/projects", member, "POST", { name: "No setup", path })).status).toBe(400);
		expect(projects.list()).toEqual([]);
		expect(await snapshot(path)).toEqual(before);
	});

	it("does not reveal foreign projects and rechecks revoked folder permission after preview", async () => {
		const assigned = await grant();
		const foreign = join(otherArea, "private-project");
		await seed(foreign);
		await projects.register("SECRET PROJECT NAME", foreign);
		for (const endpoint of ["/api/projects/preview", "/api/projects"]) {
			const response = await request(endpoint, member, "POST", { name: "Attempt", path: foreign });
			expect(response.status).toBe(403);
			const text = await response.text();
			expect(text).not.toContain("SECRET");
			expect(text).not.toContain(otherArea);
		}
		const path = join(ownArea, "ready");
		await seed(path);
		expect((await preview(path)).canRegister).toBe(true);
		expect((await request(`/api/admin/folder-areas/${assigned.id}`, admin, "DELETE")).status).toBe(200);
		expect((await request("/api/projects", member, "POST", { name: "Denied", path })).status).toBe(403);
		expect(projects.list()).toHaveLength(1);
	});

	it("rechecks retargeted aliases and internal file boundaries after preview", async () => {
		await grant();
		const safe = join(ownArea, "ready");
		const fs = await seed(safe);
		const outside = join(otherArea, "private");
		await seed(outside);
		const alias = join(ownArea, "alias");
		await symlink(safe, alias);
		expect((await preview(alias)).canRegister).toBe(true);
		await rm(alias);
		await symlink(outside, alias);
		expect((await request("/api/projects", member, "POST", { name: "Changed", path: alias })).status).toBe(403);
		expect((await preview(safe)).canRegister).toBe(true);
		await symlink(join(outside, "backlog", "tasks"), join(fs.backlogDir, "assets", "escape"));
		const blocked = await request("/api/projects", member, "POST", { name: "Changed files", path: safe });
		expect(blocked.status).toBe(400);
		expect(projects.list()).toEqual([]);
	});

	it("serializes duplicate registrations with exactly one standard membership", async () => {
		await grant();
		const path = join(ownArea, "ready");
		await seed(path);
		expect((await preview(path)).canRegister).toBe(true);
		const attempts = await Promise.all(
			["First", "Second"].map((name) => request("/api/projects", member, "POST", { name, path })),
		);
		expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);
		expect(projects.list()).toHaveLength(1);
		expect(auth.listMembers("1")).toEqual([
			{ projectId: "1", userId: member.session.user.id, permissions: DEFAULT_PERMISSIONS },
		]);
		const duplicate = await preview(path);
		expect(duplicate.canRegister).toBe(false);
		expect(JSON.stringify(duplicate.issues)).not.toContain(projects.load("1")?.name ?? "unexpected");
	});

	it("replays registration once and checks current project access before revealing its result", async () => {
		await grant();
		const path = join(ownArea, "replay");
		await seed(path);
		const operationId = crypto.randomUUID();
		const body = { name: "One registration", path };
		const headers = { "Idempotency-Key": operationId };
		const first = await request("/api/projects", member, "POST", body, headers);
		expect(first.status, await first.clone().text()).toBe(201);
		const registered = await first.json();
		const replay = await request("/api/projects", member, "POST", body, headers);
		expect(replay.status).toBe(201);
		expect(await replay.json()).toEqual(registered);
		expect(projects.list()).toHaveLength(1);
		expect((await request(`/api/operations/${operationId}`, member)).status).toBe(200);
		expect((await request(`/api/operations/${operationId}`, other)).status).toBe(404);
		const history = await (await request("/api/admin/history?scope=registration", admin)).json();
		expect(history.items).toHaveLength(1);
		expect(history.items[0].changes.map((change: { kind: string }) => change.kind)).toEqual(["project", "membership"]);
		auth.removeMember(registered.id, member.session.user.id);
		expect((await request(`/api/operations/${operationId}`, member)).status).toBe(404);
		expect((await request("/api/projects", member, "POST", body, headers)).status).toBe(404);
	});

	it("revokes a deactivated account between preview and register without a partial project", async () => {
		await grant();
		const path = join(ownArea, "ready");
		await seed(path);
		expect((await preview(path)).canRegister).toBe(true);
		auth.editUser(member.session.user.id, { active: false });
		expect((await request("/api/projects", member, "POST", { name: "Revoked", path })).status).toBe(401);
		expect(projects.list()).toEqual([]);
	});

	it("stops API/page/live access, preserves membership, and revalidates before resuming the same project", async () => {
		const assigned = await grant();
		const path = join(ownArea, "ready");
		const fs = await seed(path);
		const before = await snapshot(path);
		expect((await request("/api/projects", member, "POST", { name: "Same identity", path })).status).toBe(201);
		const members = auth.listMembers("1");
		const socket = await connect("1");
		const closed = new Promise<number>((resolve) => {
			socket.onclose = (event) => resolve(event.code);
		});
		expect((await request("/api/admin/projects/1/tracking", member, "PUT", { tracking: false })).status).toBe(403);
		expect((await request("/api/admin/projects/1/tracking", admin, "PUT", { tracking: false })).status).toBe(200);
		expect(await closed).toBe(1008);
		expect(await (await request("/api/projects", member)).json()).toEqual([]);
		for (const route of [
			"/api/projects/1",
			"/api/projects/1/tasks",
			"/api/projects/1/assets/example.txt",
			"/projects/1/board",
		])
			expect((await request(route, member)).status).toBe(404);
		expect((await request("/api/admin/projects", admin)).status).toBe(200);
		expect(projects.load("1")?.tracking).toBe(false);
		expect(auth.listMembers("1")).toEqual(members);
		expect((await request(`/api/admin/folder-areas/${assigned.id}`, admin, "DELETE")).status).toBe(200);
		expect(auth.listMembers("1")).toEqual(members);
		const outside = join(root, "outside.txt");
		await Bun.write(outside, "secret outside content");
		const outsideLink = join(fs.backlogDir, "assets", "escape.txt");
		await symlink(outside, outsideLink);
		expect((await request("/api/admin/projects/1/tracking", admin, "PUT", { tracking: true })).status).toBe(400);
		expect(projects.load("1")?.tracking).toBe(false);
		await rm(outsideLink);
		const resumed = await request("/api/admin/projects/1/tracking", admin, "PUT", { tracking: true });
		expect(resumed.status).toBe(200);
		expect(await resumed.json()).toMatchObject({ id: "1", tracking: true, name: "Same identity" });
		expect(auth.listMembers("1")).toEqual(members);
		expect((await request("/api/projects/1/tasks", member)).status).toBe(200);
		expect(await snapshot(path)).toEqual(before);
	});

	it("closes live access when local CLI tracking changes the same database", async () => {
		await grant();
		const path = join(ownArea, "ready");
		await seed(path);
		await projects.register("Local tracking", path, member.session.user.id);
		const socket = await connect("1");
		const closed = new Promise<number>((resolve) => {
			socket.onclose = (event) => resolve(event.code);
		});
		await new ProjectStore(data).setTracking("1", false);
		expect(await closed).toBe(1008);
		expect((await request("/api/projects/1/tasks", member)).status).toBe(404);
	});

	it("never serves persistent or transient outside record content through a warmed cache or watcher", async () => {
		await grant();
		const path = join(ownArea, "ready");
		const fs = await seed(path);
		await projects.register("Safe", path, member.session.user.id);
		expect((await request("/api/projects/1/tasks", member)).status).toBe(200);
		const socket = await connect("1");
		const events: string[] = [];
		socket.onmessage = (event) => events.push(String(event.data));
		const taskPath = (await fs.listTasks())[0]?.filePath;
		if (!taskPath) throw new Error("Fixture task missing");
		const saved = await Bun.file(taskPath).text();
		const outside = join(root, "outside.md");
		await Bun.write(outside, saved.replace("Prepared task", "OUTSIDE_SECRET_SENTINEL"));
		await rename(taskPath, `${taskPath}.saved`);
		await symlink(outside, taskPath);
		await Bun.sleep(200);
		await rm(taskPath);
		await rename(`${taskPath}.saved`, taskPath);
		const afterTransient = await request("/api/projects/1/tasks", member);
		expect([200, 503]).toContain(afterTransient.status);
		expect(await afterTransient.text()).not.toContain("OUTSIDE_SECRET_SENTINEL");
		expect(events.join("\n")).not.toContain("OUTSIDE_SECRET_SENTINEL");
		await rm(taskPath);
		await symlink(outside, taskPath);
		const blocked = await request("/api/projects/1/tasks", member);
		expect(blocked.status).toBe(503);
		expect(await blocked.text()).not.toContain("OUTSIDE_SECRET_SENTINEL");
		socket.close();
	});
});
