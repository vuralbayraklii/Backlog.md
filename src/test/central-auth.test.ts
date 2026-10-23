import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import type { AuthSession } from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { ProjectStore } from "../server/project-store.ts";
import { centralFixtureFetch } from "./central-test-client.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "initial long password";
const NEW_PASSWORD = "replacement long password";
interface BrowserSession {
	cookie: string;
	session: AuthSession;
}

describe("central authentication and authorization", () => {
	let root: string;
	let data: string;
	let base: string;
	let auth: AuthStore;
	let server: CentralServer;
	let admin: BrowserSession;
	let user: BrowserSession;
	let userId: string;
	let alpha: string;

	async function request(
		path: string,
		actor?: BrowserSession,
		method = "GET",
		body?: unknown,
		extra?: Record<string, string>,
	) {
		return centralFixtureFetch(`${base}${path}`, {
			method,
			headers: {
				Origin: base,
				...(actor ? { Cookie: actor.cookie, "X-CSRF-Token": actor.session.csrfToken } : {}),
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
				...extra,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			redirect: "manual",
		});
	}
	async function login(username: string, password = PASSWORD): Promise<BrowserSession> {
		const response = await request("/api/auth/login", undefined, "POST", { username, password });
		expect(response.status).toBe(200);
		return { cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", session: await response.json() };
	}
	async function change(actor: BrowserSession): Promise<BrowserSession> {
		const response = await request("/api/auth/password", actor, "POST", {
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
		});
		expect(response.status).toBe(200);
		return { cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", session: await response.json() };
	}
	async function seed(name: string) {
		const path = join(root, name);
		const core = new Core(path);
		await initializeFilesystemTestProject(core, name);
		await core.fs.saveTask({
			id: "TASK-1",
			title: name,
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-21",
		});
		await core.fs.saveDocument({
			id: "doc-1",
			title: name,
			type: "guide",
			createdDate: "2026-10-21",
			rawContent: name,
		});
		await core.fs.saveDecision({
			id: "decision-1",
			title: name,
			date: "2026-10-21",
			status: "proposed",
			context: name,
			decision: name,
			consequences: name,
			rawContent: name,
		});
		await new ProjectStore(data).register(name, path);
		return path;
	}
	beforeEach(async () => {
		root = createUniqueTestDir("central-auth");
		data = join(root, "data");
		auth = new AuthStore(data);
		await auth.initializeAdmin("Admin", PASSWORD);
		userId = (await auth.createUser({ username: "member", password: PASSWORD })).id;
		alpha = await seed("Alpha");
		await seed("Beta");
		auth.setMember("1", userId);
		const port = await findNextAvailablePort(19000);
		if (!port) throw new Error("No test port available");
		base = `http://127.0.0.1:${port}`;
		server = new CentralServer(data);
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
		admin = await change(await login("admin"));
		user = await change(await login("member"));
	});
	afterEach(async () => {
		await server?.stop();
		await safeCleanup(root);
	});

	it("requires explicit safe origins and initial admin before serving data", async () => {
		const empty = new CentralServer(join(root, "empty"));
		const port = Number(new URL(base).port) + 1;
		await expect(empty.start(port)).rejects.toThrow("--public-url");
		for (const publicUrl of [
			"http://example.com",
			"http://127.0.0.1",
			"https://example.com/path",
			"https://u:p@example.com",
			"https://example.com?x=1",
		]) {
			await expect(empty.start(port, false, { publicUrl })).rejects.toThrow();
		}
		await expect(empty.start(port, false, { publicUrl: base, allowHttpLoopback: true })).rejects.toThrow(
			"user init-admin",
		);
		expect(await Bun.file(join(root, "empty", "server.sqlite")).exists()).toBe(false);
	});

	it("enforces JSON and exact Origin without exposing credential distinctions", async () => {
		for (const origin of ["", "https://evil.example", `${base}/`, "null"])
			expect(
				(
					await request(
						"/api/auth/login",
						undefined,
						"POST",
						{ username: "admin", password: NEW_PASSWORD },
						{ Origin: origin },
					)
				).status,
			).toBe(403);
		expect((await request("/api/auth/login", undefined, "POST", {}, { "Content-Type": "text/plain" })).status).toBe(
			415,
		);
		const responses = [];
		for (const username of ["admin", "missing", "member"])
			responses.push(
				await (await request("/api/auth/login", undefined, "POST", { username, password: "wrong password" })).json(),
			);
		expect(responses[0]).toEqual(responses[1]);
		expect(responses[0]).toEqual(responses[2]);
		expect((await request("/api/projects")).status).toBe(401);
	});

	it("forces password replacement and rotates all old sessions including the current one", async () => {
		await auth.resetPassword(userId, PASSWORD);
		const first = await login("member");
		const other = await login("member");
		expect(first.session.user.mustChangePassword).toBe(true);
		for (const path of ["/api/projects", "/api/projects/1/tasks", "/api/admin/users"])
			expect((await request(path, first)).status).toBe(403);
		expect((await request("/api/auth/activity", first, "POST")).status).toBe(403);
		expect((await request("/api/auth/session", first)).status).toBe(200);
		const rotated = await change(first);
		expect(rotated.cookie).not.toBe(first.cookie);
		expect(rotated.session.user.mustChangePassword).toBe(false);
		for (const actor of [first, other]) expect((await request("/api/auth/session", actor)).status).toBe(401);
		expect((await request("/api/projects", rotated)).status).toBe(200);
	});

	it.each(["initial", "after reset", "voluntary"])(
		"rejects current-password reuse over HTTP during %s changes and preserves every session",
		async (stage) => {
			const username = stage === "initial" ? "new-member" : "member";
			const password = stage === "voluntary" ? NEW_PASSWORD : PASSWORD;
			if (stage === "initial") await auth.createUser({ username, password });
			if (stage === "after reset")
				expect((await request(`/api/admin/users/${userId}/reset-password`, admin, "POST", { password })).status).toBe(
					200,
				);
			const first = await login(username, password);
			const other = await login(username, password);
			expect(first.session.user.mustChangePassword).toBe(stage !== "voluntary");
			const before = await Bun.file(auth.databasePath).arrayBuffer();
			const rejected = await request("/api/auth/password", first, "POST", {
				currentPassword: password,
				newPassword: password,
			});
			expect(rejected.status).toBe(400);
			expect(await rejected.json()).toEqual({ error: "New password must be different from the current password." });
			expect(rejected.headers.get("set-cookie")).toBeNull();
			expect(await Bun.file(auth.databasePath).arrayBuffer()).toEqual(before);
			for (const actor of [first, other, admin]) {
				const preserved = await request("/api/auth/session", actor);
				expect(preserved.status).toBe(200);
				expect(await preserved.json()).toEqual(actor.session);
			}
			const accepted = await request("/api/auth/password", first, "POST", {
				currentPassword: password,
				newPassword: `${password} new`,
			});
			expect(accepted.status).toBe(200);
			const rotated = {
				cookie: accepted.headers.get("set-cookie")?.split(";")[0] ?? "",
				session: (await accepted.json()) as AuthSession,
			};
			expect(rotated.session.user.mustChangePassword).toBe(false);
			expect(rotated.cookie).not.toBe(first.cookie);
			for (const actor of [first, other]) expect((await request("/api/auth/session", actor)).status).toBe(401);
			expect((await request("/api/auth/session", rotated)).status).toBe(200);
			expect((await request("/api/auth/session", admin)).status).toBe(200);
		},
	);

	it("requires CSRF on all authenticated mutations and never trusts an external return URL", async () => {
		for (const headers of [
			{ "X-CSRF-Token": "" },
			{ "X-CSRF-Token": "wrong" },
			{ Origin: "https://evil.example" },
		] as Record<string, string>[]) {
			expect((await request("/api/projects/1/tasks", user, "POST", { title: "forbidden" }, headers)).status).toBe(403);
			expect((await request("/api/auth/logout", user, "POST", undefined, headers)).status).toBe(403);
		}
		const redirect = await request("/?returnTo=https://evil.example", admin);
		expect(redirect.headers.get("location")).toBe(`${base}/projects`);
		const logged = await request("/api/auth/login", undefined, "POST", { username: "member", password: NEW_PASSWORD });
		const cookie = logged.headers.get("set-cookie") ?? "";
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Path=/");
		expect(cookie).not.toContain("Domain=");
	});

	it("uses Secure cookies for a configured HTTPS origin and returns persistent rate limits", async () => {
		for (let attempt = 0; attempt < 5; attempt++)
			expect(
				(await request("/api/auth/login", undefined, "POST", { username: "unknown", password: PASSWORD })).status,
			).toBe(401);
		const limited = await request("/api/auth/login", undefined, "POST", { username: "unknown", password: PASSWORD });
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		await server.stop();
		server = new CentralServer(data);
		await server.start(Number(new URL(base).port), false, { publicUrl: "https://backlog.example" });
		const secure = await request(
			"/api/auth/login",
			undefined,
			"POST",
			{ username: "admin", password: NEW_PASSWORD },
			{ Origin: "https://backlog.example" },
		);
		expect(secure.status).toBe(200);
		expect(secure.headers.get("set-cookie")).toContain("; Secure");
		const afterRestart = await request(
			"/api/auth/login",
			undefined,
			"POST",
			{ username: "unknown", password: PASSWORD },
			{ Origin: "https://backlog.example" },
		);
		expect(afterRestart.status).toBe(429);
	});

	it("preserves sessions across restart without renewing idle time on reads", async () => {
		const before = await (await request("/api/auth/session", user)).json();
		await request("/api/projects/1/tasks", user);
		await server.stop();
		server = new CentralServer(data);
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		const after = await (await request("/api/auth/session", user)).json();
		expect(after).toEqual(before);
		expect(Date.parse(after.expiresAt) - Date.parse(after.createdAt)).toBe(12 * 60 * 60 * 1000);
		expect(Date.parse(after.idleExpiresAt) - Date.parse(after.lastActivityAt)).toBe(2 * 60 * 60 * 1000);
		expect((await request("/api/auth/activity", user, "POST")).status).toBe(200);
	});

	it("conceals nonmembers before checking source readability across every data surface", async () => {
		expect(await (await request("/api/projects", user)).json()).toEqual([
			{
				id: "1",
				name: "Alpha",
				observation: {
					state: "ready",
					error: null,
					checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
					lastSuccessfulScanAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
				},
			},
		]);
		for (const suffix of [
			"",
			"/tasks",
			"/task/TASK-1",
			"/docs/doc-1",
			"/decisions/decision-1",
			"/search?query=Beta",
			"/statistics",
			"/assets/secret.txt",
			"/tasks/archived",
			"/ws",
		])
			expect((await request(`/api/projects/2${suffix}`, user)).status).toBe(404);
		expect((await request("/projects/2/board", user)).status).toBe(404);
		await rename(join(root, "Beta"), join(root, "missing-beta"));
		expect((await request("/api/projects/2/tasks", user)).status).toBe(404);
		expect((await request("/api/projects/2/tasks", admin)).status).toBe(503);
		for (const kind of ["task/TASK-1", "docs/doc-1", "decisions/decision-1"])
			expect((await (await request(`/api/projects/1/${kind}`, user)).json()).title).toBe("Alpha");
	});

	it("applies operation permission changes immediately and retains admin access", async () => {
		auth.setMember("1", userId, { tasksWrite: false, docsWrite: false, decisionsWrite: false });
		for (const kind of ["tasks", "docs", "decisions", "milestones"])
			expect((await request(`/api/projects/1/${kind}`, user, "POST", { title: "Denied" })).status).toBe(403);
		expect((await request("/api/projects/1/config", user, "PUT", { hideEmptyColumns: true })).status).toBe(403);
		expect((await request("/api/projects/1/tasks/duplicates", user, "POST", {})).status).toBe(403);
		for (const kind of ["tasks", "docs", "decisions"]) {
			const id = kind === "tasks" ? "TASK-1" : kind === "docs" ? "doc-1" : "decision-1";
			expect((await request(`/api/projects/1/${kind}/${id}/archive`, user, "POST")).status).toBe(403);
			expect((await request(`/api/projects/1/${kind}/${id}`, user, "DELETE")).status).toBe(403);
		}
		auth.setMember("1", userId, { tasksWrite: true });
		expect((await request("/api/projects/1/tasks", user, "POST", { title: "Granted" })).status).toBe(201);
		auth.setMember("1", userId, { tasksWrite: false });
		expect((await request("/api/projects/1/tasks", user, "POST", { title: "Revoked" })).status).toBe(403);
		expect((await request("/api/projects/2/tasks", admin, "POST", { title: "Admin" })).status).toBe(201);
	});

	it("admin HTTP manages immutable accounts and memberships, with session revocation", async () => {
		expect((await request("/api/admin/users", user)).status).toBe(403);
		const created = await (
			await request("/api/admin/users", admin, "POST", {
				username: " New.User ",
				password: PASSWORD,
				displayName: "Yeni Kullanıcı",
			})
		).json();
		expect(created.username).toBe("new.user");
		expect(created).not.toHaveProperty("passwordHash");
		expect((await request(`/api/admin/users/${created.id}`, admin, "PATCH", { username: "changed" })).status).toBe(400);
		expect(
			(await request(`/api/admin/projects/2/members/${created.id}`, admin, "PUT", { permissions: { delete: true } }))
				.status,
		).toBe(200);
		expect(await (await request("/api/admin/projects/2/members", admin)).json()).toHaveLength(1);
		expect((await request(`/api/admin/projects/2/members/${created.id}`, admin, "DELETE")).status).toBe(200);
		expect(
			(await request(`/api/admin/users/${userId}/reset-password`, admin, "POST", { password: PASSWORD })).status,
		).toBe(200);
		expect((await request("/api/auth/session", user)).status).toBe(401);
		user = await change(await login("member"));
		expect((await request(`/api/admin/users/${userId}`, admin, "PATCH", { active: false })).status).toBe(200);
		expect((await request("/api/auth/session", user)).status).toBe(401);
		expect((await request(`/api/admin/users/${admin.session.user.id}`, admin, "PATCH", { active: false })).status).toBe(
			400,
		);
	});

	it("revokes idle WebSockets within one second and rejects foreign origins", async () => {
		const open = (headers: Record<string, string>) =>
			new WebSocket(`${base.replace("http", "ws")}/api/projects/1/ws`, { headers } as never);
		const socket = open({ Cookie: user.cookie, Origin: base });
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("WebSocket refused"));
		});
		const closed = new Promise<number>((resolve) => {
			socket.onclose = (event) => resolve(event.code);
		});
		auth.removeMember("1", userId);
		expect(await Promise.race([closed, Bun.sleep(1500).then(() => -1)])).toBe(1008);
		expect(
			(
				await request("/api/projects/1/ws", admin, "GET", undefined, {
					Origin: "https://evil.example",
					Upgrade: "websocket",
				})
			).status,
		).toBe(403);
	});

	it("restores and deletes all archived kinds without allowing active deletion", async () => {
		auth.setMember("1", userId, { archive: true, delete: true });
		for (const [kind, id] of [
			["tasks", "TASK-1"],
			["docs", "doc-1"],
			["decisions", "decision-1"],
		]) {
			const path = `/api/projects/1/${kind}/${id}`;
			expect((await request(path, user, "DELETE")).status).toBe(400);
			expect((await request(`${path}/archive`, user, "POST")).status).toBe(200);
			expect(
				(await (await request(`/api/projects/1/${kind}/archived`, user)).json()).some(
					(record: { id: string }) => record.id === id,
				),
			).toBe(true);
			expect((await request(path, user)).status).toBe(200);
			expect((await request(`${path}/restore`, user, "POST")).status).toBe(200);
			expect((await request(`${path}/archive`, user, "POST")).status).toBe(200);
			expect((await request(path, user, "DELETE")).status).toBe(200);
			expect((await request(path, user)).status).toBe(404);
		}
		expect(await Bun.file(join(alpha, "backlog", "tasks", "TASK-1.md")).exists()).toBe(false);
	});

	it("requires write preconditions and protects replay/result ownership with current permissions", async () => {
		const task = await (await request("/api/projects/1/tasks/TASK-1", user)).json();
		const body = JSON.stringify({ title: "One durable change" });
		const operationId = crypto.randomUUID();
		const write = (actor: BrowserSession, headers: Record<string, string>) =>
			fetch(`${base}/api/projects/1/tasks/TASK-1`, {
				method: "PUT",
				headers: {
					Origin: base,
					Cookie: actor.cookie,
					"X-CSRF-Token": actor.session.csrfToken,
					"Content-Type": "application/json",
					...headers,
				},
				body,
			});
		const missingKey = await write(user, { "If-Match": task.revision });
		expect(missingKey.status).toBe(428);
		const missingRevision = await write(user, { "Idempotency-Key": crypto.randomUUID() });
		expect(missingRevision.status).toBe(428);
		const headers = { "Idempotency-Key": operationId, "If-Match": task.revision };
		const saved = await write(user, headers);
		expect(saved.status, await saved.clone().text()).toBe(200);
		expect((await write(user, headers)).status).toBe(200);
		expect((await write(admin, headers)).status).toBe(409);
		const operation = await request(`/api/operations/${operationId}`, user);
		expect(operation.status).toBe(200);
		expect((await operation.json()).state).toBe("completed");
		expect((await request(`/api/operations/${operationId}`, admin)).status).toBe(200);
		const outsiderId = (await auth.createUser({ username: "outsider", password: PASSWORD })).id;
		const outsider = await change(await login("outsider"));
		expect(outsider.session.user.id).toBe(outsiderId);
		expect((await request(`/api/operations/${operationId}`, outsider)).status).toBe(404);
		auth.setMember("1", userId, { tasksWrite: false });
		expect((await write(user, headers)).status).toBe(403);
		const history = await (await request(`/api/projects/1/history?recordKey=${task.recordKey}`, admin)).json();
		expect(history.items.filter((event: { operationId: string }) => event.operationId === operationId)).toHaveLength(1);
		auth.removeMember("1", userId);
		expect((await request(`/api/operations/${operationId}`, user)).status).toBe(404);
		expect((await write(user, headers)).status).toBe(404);
	});
});
