import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AgentStore } from "../server/agent-store.ts";
import type { AgentKey } from "../server/agent-types.ts";
import { AuthStore } from "../server/auth-store.ts";
import { ADMIN_PERMISSIONS, type AuthSession } from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import { type MutationCheckpoint, requestHash } from "../server/mutations.ts";
import { ProjectStore } from "../server/project-store.ts";
import { centralFixtureFetch } from "./central-test-client.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "agent access initial password";
const CHANGED = "agent access changed password";

interface Browser {
	cookie: string;
	session: AuthSession;
}

describe("A-05 agent bearer access through the central HTTP server", () => {
	let root: string;
	let data: string;
	let base: string;
	let server: CentralServer;
	let auth: AuthStore;
	let admin: Browser;
	let member: Browser;
	let memberId: string;
	let taskPath: string;

	async function request(path: string, init: RequestInit = {}): Promise<Response> {
		return centralFixtureFetch(`${base}${path}`, { redirect: "manual", ...init });
	}

	async function browser(path: string, actor: Browser, method = "GET", body?: unknown, extra?: Record<string, string>) {
		return request(path, {
			method,
			headers: {
				Origin: base,
				Cookie: actor.cookie,
				"X-CSRF-Token": actor.session.csrfToken,
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
				...extra,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}

	async function bearer(path: string, secret: string, method = "GET", body?: unknown, extra?: Record<string, string>) {
		return request(path, {
			method,
			headers: {
				Authorization: `Bearer ${secret}`,
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
				...extra,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}

	async function key(userId = memberId, permissions = ADMIN_PERMISSIONS, operationId = randomUUID()) {
		const result = await browser(
			"/api/admin/agent-keys",
			admin,
			"POST",
			{ userId, name: `Agent ${operationId}`, grants: [{ projectId: "1", permissions }] },
			{ "Idempotency-Key": operationId },
		);
		expect(result.status, await result.clone().text()).toBe(201);
		return (await result.json()) as { key: AgentKey; secret: string };
	}

	async function browserSession(username: string): Promise<Browser> {
		const login = await auth.login(username, PASSWORD);
		const changed = await auth.changePassword(login.token, PASSWORD, CHANGED);
		return { cookie: `backlog_session=${changed.token}`, session: changed.session };
	}

	beforeEach(async () => {
		root = await createTestDirOutsideRepository("backlog-agent-access-");
		data = join(root, "data");
		const projectPath = join(root, "project");
		const core = new Core(projectPath);
		await initializeFilesystemTestProject(core, "Agent access");
		taskPath = await core.fs.saveTask({
			id: "TASK-1",
			title: "Original",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-23",
		});
		await new ProjectStore(data).register("Agent access", projectPath);
		auth = new AuthStore(data);
		await auth.initializeAdmin("admin", PASSWORD);
		memberId = (await auth.createUser({ username: "member", password: PASSWORD })).id;
		auth.setMember("1", memberId, { tasksWrite: true, docsWrite: false, archive: false });
		admin = await browserSession("admin");
		member = await browserSession("member");
		const port = await findNextAvailablePort(41000);
		if (!port) throw new Error("No test port available.");
		base = `http://127.0.0.1:${port}`;
		server = new CentralServer(data);
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
	});

	afterEach(async () => {
		await server?.stop();
		await safeCleanup(root);
	});

	it("creates once, replays metadata without secret, and keeps browser CSRF", async () => {
		const operationId = randomUUID();
		const body = {
			userId: memberId,
			name: "Laptop",
			grants: [{ projectId: "1", permissions: ADMIN_PERMISSIONS }],
		};
		const missingCsrf = await browser("/api/admin/agent-keys", admin, "POST", body, {
			"Idempotency-Key": randomUUID(),
			"X-CSRF-Token": "wrong",
		});
		expect(missingCsrf.status).toBe(403);
		const first = await browser("/api/admin/agent-keys", admin, "POST", body, { "Idempotency-Key": operationId });
		expect(first.status, await first.clone().text()).toBe(201);
		const created = (await first.json()) as { key: AgentKey; secret: string };
		expect(created.secret).toStartWith(`bk_${created.key.id}_`);
		const replay = await browser("/api/admin/agent-keys", admin, "POST", body, { "Idempotency-Key": operationId });
		expect(replay.status, await replay.clone().text()).toBe(201);
		expect(await replay.json()).toEqual({ key: created.key });
		const list = await browser("/api/admin/agent-keys", admin);
		expect(await list.json()).toEqual([created.key]);
		const raw = new Database(join(data, "server.sqlite"), { readonly: true });
		expect(raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM agent_keys").get()?.count).toBe(1);
		const values = raw.query<{ secret_hash: string }, []>("SELECT secret_hash FROM agent_keys").get();
		expect(values?.secret_hash).not.toBe(created.secret);
		raw.close();
		expect(JSON.stringify(new MutationStore(data).listHistory({ scope: { kind: "admin" } }).items)).not.toContain(
			created.secret,
		);
	});

	it("intersects live grants, tags real agent history, and separates keys of one owner", async () => {
		const first = await key();
		const second = await key();
		const project = await bearer("/api/projects/1", first.secret);
		expect(project.status).toBe(200);
		expect((await project.json()).permissions).toMatchObject({ tasksWrite: true, docsWrite: false, archive: false });
		const opened = await bearer("/api/projects/1/tasks/TASK-1", first.secret);
		expect(opened.status).toBe(200);
		const revision = ((await opened.json()) as { revision: string }).revision;
		const operationId = randomUUID();
		const updated = await bearer(
			"/api/projects/1/tasks/TASK-1",
			first.secret,
			"PUT",
			{ title: "Agent edit" },
			{ "Idempotency-Key": operationId, "If-Match": revision, "X-Backlog-Source": "browser" },
		);
		expect(updated.status, await updated.clone().text()).toBe(200);
		const own = await bearer(`/api/operations/${operationId}`, first.secret);
		expect(own.status).toBe(200);
		const ownOperation = await own.json();
		expect(ownOperation).toMatchObject({
			source: "agent",
			actor: { kind: "agent", agentKeyId: first.key.id, userId: memberId },
		});
		const attempted = (title: string) =>
			new Request(`${base}/api/projects/1/tasks/TASK-1`, {
				method: "PUT",
				headers: { "Content-Type": "application/json", "If-Match": revision },
				body: JSON.stringify({ title }),
			});
		expect(ownOperation.requestHash).toBe(await requestHash(attempted("Agent edit")));
		expect(ownOperation.requestHash).not.toBe(await requestHash(attempted("Different edit")));
		expect((await bearer(`/api/operations/${operationId}`, second.secret)).status).toBe(404);
		const history = await bearer("/api/projects/1/history", first.secret);
		expect(((await history.json()) as { items: Array<{ operationId: string; source: string }> }).items).toContainEqual(
			expect.objectContaining({ operationId, source: "agent" }),
		);
		auth.setMember("1", memberId, { tasksWrite: false });
		expect(
			(await bearer("/api/projects/1", first.secret).then((response) => response.json())).permissions.tasksWrite,
		).toBe(false);
		const blocked = await bearer(
			"/api/projects/1/tasks",
			first.secret,
			"POST",
			{ title: "Denied" },
			{ "Idempotency-Key": randomUUID() },
		);
		expect(blocked.status).toBe(403);
	});

	it("never lets a bearer key borrow admin, registration, config write, or browser cookie authority", async () => {
		const created = await key(admin.session.user.id);
		for (const path of ["/api/admin/users", "/api/admin/agent-keys", "/api/projects/registration"])
			expect((await bearer(path, created.secret)).status).toBe(403);
		expect(
			(
				await bearer(
					"/api/projects",
					created.secret,
					"POST",
					{ name: "Denied", path: root },
					{ "Idempotency-Key": randomUUID() },
				)
			).status,
		).toBe(403);
		expect(
			(
				await bearer(
					"/api/projects/1/config",
					created.secret,
					"PUT",
					{ projectName: "Denied" },
					{ "Idempotency-Key": randomUUID() },
				)
			).status,
		).toBe(403);
		expect(
			(
				await bearer("/api/admin/users", created.secret, "GET", undefined, {
					Cookie: admin.cookie,
					Origin: base,
					"X-CSRF-Token": admin.session.csrfToken,
				})
			).status,
		).toBe(403);
		expect(
			(await browser("/api/projects/1", member, "GET", undefined, { Authorization: "Bearer invalid" })).status,
		).toBe(401);
	});

	it("revokes immediately through explicit revoke, account disable, and admin password reset", async () => {
		const first = await key();
		const revoke = await browser(`/api/admin/agent-keys/${first.key.id}/revoke`, admin, "POST", undefined, {
			"Idempotency-Key": randomUUID(),
			"If-Match": first.key.revision,
		});
		expect(revoke.status, await revoke.clone().text()).toBe(200);
		expect((await revoke.json()).key.revokedAt).not.toBeNull();
		expect((await bearer("/api/projects/1", first.secret)).status).toBe(401);
		const second = await key();
		const user = await browser(`/api/admin/users/${memberId}`, admin);
		const current = (await user.json()) as { revision: string };
		const disable = await browser(
			`/api/admin/users/${memberId}`,
			admin,
			"PUT",
			{ active: false },
			{ "Idempotency-Key": randomUUID(), "If-Match": current.revision },
		);
		expect(disable.status, await disable.clone().text()).toBe(200);
		expect((await bearer("/api/projects/1", second.secret)).status).toBe(401);
		const disabled = (await disable.json()) as { revision: string };
		const enable = await browser(
			`/api/admin/users/${memberId}`,
			admin,
			"PUT",
			{ active: true },
			{ "Idempotency-Key": randomUUID(), "If-Match": disabled.revision },
		);
		expect(enable.status, await enable.clone().text()).toBe(200);
		const third = await key();
		const reset = await browser(
			`/api/admin/users/${memberId}/reset-password`,
			admin,
			"POST",
			{ password: "another long reset password" },
			{ "Idempotency-Key": randomUUID() },
		);
		expect(reset.status, await reset.clone().text()).toBe(200);
		expect((await bearer("/api/projects/1", third.secret)).status).toBe(401);
		const keys = new AgentStore(data).list(memberId);
		expect(keys).toHaveLength(3);
		expect(keys.every((item) => item.revokedAt !== null)).toBe(true);
	});

	it("rechecks a revoked bearer before durable intent after asynchronous staging", async () => {
		const created = await key();
		const opened = await bearer("/api/projects/1/tasks/TASK-1", created.secret);
		const revision = ((await opened.json()) as { revision: string }).revision;
		const original = await Bun.file(taskPath).arrayBuffer();
		const operationId = randomUUID();
		const mutation = Reflect.get(server, "mutations") as { store: MutationStore };
		const originalBegin = mutation.store.begin.bind(mutation.store);
		let entered = false;
		try {
			mutation.store.begin = (intent, beforeIntent) => {
				entered = true;
				new AgentStore(data).revoke(created.key.id, memberId);
				return originalBegin(intent, beforeIntent);
			};
			const response = await bearer(
				"/api/projects/1/tasks/TASK-1",
				created.secret,
				"PUT",
				{ title: "Refused" },
				{ "Idempotency-Key": operationId, "If-Match": revision },
			);
			expect(entered).toBe(true);
			expect(response.status, await response.clone().text()).toBe(401);
			expect(await Bun.file(taskPath).arrayBuffer()).toEqual(original);
			expect(
				new MutationStore(data).loadOperation(operationId, {
					actor: { kind: "agent", agentKeyId: created.key.id, userId: memberId },
				}),
			).toBeNull();
		} finally {
			mutation.store.begin = originalBegin;
		}
	});

	it("denies a queued second write after key revocation while the first intent finishes", async () => {
		const created = await key();
		const opened = await bearer("/api/projects/1/tasks/TASK-1", created.secret);
		const revision = ((await opened.json()) as { revision: string }).revision;
		const port = Number(new URL(base).port);
		await server.stop();
		const firstOperation = randomUUID();
		const secondOperation = randomUUID();
		let reachedFinalize: () => void = () => {};
		let releaseFinalize: () => void = () => {};
		const reached = new Promise<void>((resolve) => {
			reachedFinalize = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			releaseFinalize = resolve;
		});
		const checkpoint: MutationCheckpoint = async (stage, operationId) => {
			if (stage === "before_finalize" && operationId === firstOperation) {
				reachedFinalize();
				await gate;
			}
		};
		server = new CentralServer(data, { mutationCheckpoint: checkpoint });
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
		let first: Promise<Response> | null = null;
		let second: Promise<Response> | null = null;
		try {
			first = bearer(
				"/api/projects/1/tasks/TASK-1",
				created.secret,
				"PUT",
				{ title: "First" },
				{ "Idempotency-Key": firstOperation, "If-Match": revision },
			);
			await reached;
			second = bearer(
				"/api/projects/1/tasks/TASK-1",
				created.secret,
				"PUT",
				{ title: "Second" },
				{ "Idempotency-Key": secondOperation, "If-Match": revision },
			);
			const revoked = await browser(`/api/admin/agent-keys/${created.key.id}/revoke`, admin, "POST", undefined, {
				"Idempotency-Key": randomUUID(),
				"If-Match": created.key.revision,
			});
			expect(revoked.status, await revoked.clone().text()).toBe(200);
		} finally {
			releaseFinalize();
		}
		if (!first || !second) throw new Error("Queued requests were not started.");
		const responses = await Promise.all([first, second]);
		expect([200, 401]).toContain(responses[0]?.status);
		expect(responses[1]?.status).toBe(401);
		const store = new MutationStore(data);
		const actor = { kind: "agent" as const, agentKeyId: created.key.id, userId: memberId };
		expect(store.loadOperation(firstOperation, { actor })?.state).toBe("completed");
		expect(store.loadOperation(secondOperation, { actor })).toBeNull();
		const operationIds = new Set<string>([firstOperation, secondOperation]);
		expect(
			store
				.listHistory({ scope: { kind: "project", projectId: "1" } })
				.items.filter((event) => operationIds.has(event.operationId)),
		).toHaveLength(1);
	});
});
