import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { Core } from "../core/backlog.ts";
import type { ProjectAuthorization, ProjectPermission } from "../server/auth-types.ts";
import { BacklogServer, type ProjectMutationContext } from "../server/index.ts";
import { MutationAbortResponse, MutationError } from "../server/mutations.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

let testDir: string;
let core: Core;
let server: BacklogServer;
let projectQueue: Promise<void> = Promise.resolve();
const all: ProjectAuthorization = { check: () => null };

function permissions(...allowed: Array<ProjectPermission | "read" | "admin">): ProjectAuthorization {
	return {
		check: (permission) =>
			allowed.includes(permission) ? null : Response.json({ error: "Forbidden" }, { status: 403 }),
	};
}

function request(path: string, method = "GET", body?: unknown, authorization = all): Promise<Response> {
	const encoded = typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body);
	const keyFor = (kind: string, visibleId: string) => `${kind}:${visibleId.toLowerCase()}`;
	const context: ProjectMutationContext = {
		recordKeyFor: (kind, visibleId) => keyFor(kind, visibleId),
		resolveRecordKey: ({ kind, visibleId }) => keyFor(kind, visibleId),
		commit: async (_mutation, apply, publish, revalidate) => {
			const denied = revalidate();
			if (denied) throw new MutationAbortResponse(denied);
			await apply();
			await publish();
		},
	};
	const dispatch = () =>
		server
			.dispatchApi(new Request(`http://localhost${path}`, { method, body: encoded }), path, authorization, context)
			.catch((error) => {
				if (error instanceof MutationAbortResponse) return error.response;
				if (error instanceof MutationError) return error.response();
				throw error;
			});
	if (["GET", "HEAD", "OPTIONS"].includes(method)) return dispatch();
	const previous = projectQueue;
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	projectQueue = previous.catch(() => {}).then(() => gate);
	return previous
		.catch(() => {})
		.then(async () => {
			try {
				return await dispatch();
			} finally {
				release();
			}
		});
}

beforeEach(async () => {
	projectQueue = Promise.resolve();
	testDir = await createTestDirOutsideRepository("server-project-permissions");
	core = new Core(testDir, { serverMode: true });
	await initializeFilesystemTestProject(core, "Permissions");
	await core.createTask(
		{
			id: "TASK-1",
			title: "Target",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-21",
		},
		false,
	);
	await core.createDocumentFromInput({ title: "Target document", content: "Document content" });
	await core.createDecisionWithTitle("Target decision");
	server = new BacklogServer(testDir, { centralMode: true });
});

afterEach(async () => {
	await server.stop();
	await safeCleanup(testDir);
});

describe("project route authorization", () => {
	it("fails closed without request authorization and for unclassified operations", async () => {
		expect((await server.dispatchApi(new Request("http://localhost/api/tasks"), "/api/tasks")).status).toBe(401);
		expect((await request("/api/unknown", "POST")).status).toBe(404);
		expect((await request("/api/tasks/TASK-1", "PATCH")).status).toBe(404);
		expect((await request("/api/init", "POST")).status).toBe(404);
	});

	it("rejects a route handler without an explicit permission definition in central mode", async () => {
		let executed = false;
		(server as unknown as { apiRoutes(): unknown }).apiRoutes = () => ({
			"/api/unclassified": {
				POST: async () => {
					executed = true;
					return Response.json({ success: true });
				},
			},
		});
		expect((await request("/api/unclassified", "POST")).status).toBe(403);
		expect(executed).toBe(false);
	});

	it.each([
		["POST", "/api/tasks", "tasksWrite"],
		["PUT", "/api/tasks/TASK-1", "tasksWrite"],
		["POST", "/api/tasks/TASK-1/demote", "tasksWrite"],
		["POST", "/api/drafts/DRAFT-1/promote", "tasksWrite"],
		["POST", "/api/tasks/reorder", "tasksWrite"],
		["POST", "/api/tasks/move", "tasksWrite"],
		["POST", "/api/milestones", "tasksWrite"],
		["PUT", "/api/milestones/m-1", "tasksWrite"],
		["POST", "/api/docs", "docsWrite"],
		["PUT", "/api/docs/doc-1", "docsWrite"],
		["POST", "/api/decisions", "decisionsWrite"],
		["PUT", "/api/decisions/decision-1", "decisionsWrite"],
		["POST", "/api/tasks/TASK-1/archive", "archive"],
		["POST", "/api/tasks/TASK-1/restore", "archive"],
		["POST", "/api/docs/doc-1/archive", "archive"],
		["POST", "/api/docs/doc-1/restore", "archive"],
		["POST", "/api/decisions/decision-1/archive", "archive"],
		["POST", "/api/decisions/decision-1/restore", "archive"],
		["GET", "/api/tasks/cleanup", "archive"],
		["POST", "/api/tasks/cleanup/execute", "archive"],
		["POST", "/api/milestones/m-1/archive", "archive"],
		["DELETE", "/api/milestones/m-1", "delete"],
		["DELETE", "/api/tasks/TASK-1", "delete"],
		["DELETE", "/api/docs/doc-1", "delete"],
		["DELETE", "/api/decisions/decision-1", "delete"],
		["PUT", "/api/config", "admin"],
		["GET", "/api/tasks/duplicates", "admin"],
		["POST", "/api/tasks/duplicates", "admin"],
	])("%s %s requires %s before handling the body", async (method, path, expected) => {
		const checks: string[] = [];
		const authorization: ProjectAuthorization = {
			check: (permission) => {
				checks.push(permission);
				return new Response(null, { status: 403 });
			},
		};
		expect((await request(path, method, undefined, authorization)).status).toBe(403);
		expect(checks).toEqual([expected]);
	});

	it.each([
		"/api/tasks",
		"/api/docs",
		"/api/decisions",
		"/api/search",
		"/api/statistics",
		"/assets/secret.txt",
		"/api/tasks/archived",
		"/api/docs/archived",
		"/api/decisions/archived",
	])("%s checks reading before loading project data", async (path) => {
		const checks: string[] = [];
		const authorization: ProjectAuthorization = {
			check: (permission) => {
				checks.push(permission);
				return new Response(null, { status: 404 });
			},
		};
		expect((await request(path, "GET", undefined, authorization)).status).toBe(404);
		expect(checks).toEqual(["read"]);
	});

	it("allows writes with their individual grant and applies a changed grant on the next request", async () => {
		let allowed = true;
		const authorization: ProjectAuthorization = {
			check: (permission) => (permission === "tasksWrite" && allowed ? null : new Response(null, { status: 403 })),
		};
		expect((await request("/api/tasks/TASK-1", "PUT", { title: "Changed" }, authorization)).status).toBe(200);
		allowed = false;
		expect((await request("/api/tasks/TASK-1", "PUT", { title: "Forbidden" }, authorization)).status).toBe(403);
		expect((await core.getTask("TASK-1"))?.title).toBe("Changed");
		expect((await request("/api/docs/doc-1", "PUT", { content: "Changed" }, permissions("docsWrite"))).status).toBe(
			200,
		);
		expect(
			(
				await request(
					"/api/decisions/decision-1",
					"PUT",
					"---\nstatus: proposed\n---\n## Context\nChanged",
					permissions("decisionsWrite"),
				)
			).status,
		).toBe(200);
	});
});

describe("decision status authorization", () => {
	it("allocates separate decision identities for concurrent creates", async () => {
		const created = await Promise.all(
			Array.from({ length: 4 }, (_, index) =>
				request("/api/decisions", "POST", { title: `Concurrent ${index}` }, permissions("decisionsWrite")),
			),
		);
		const records = await Promise.all(created.map((response) => response.json()));
		expect(created.every((response) => response.status === 201)).toBe(true);
		expect(new Set(records.map((record) => record.id)).size).toBe(4);
	});

	it("uses the Markdown parser for quoted keys, YAML values and omitted statuses", async () => {
		const ordinary = permissions("decisionsWrite");
		for (const statusLine of ["status: accepted", '"status": accepted', "status: true", "status: [proposed]"]) {
			expect(
				(await request("/api/decisions/decision-1", "PUT", `---\n${statusLine}\n---\n## Context\nForbidden`, ordinary))
					.status,
			).toBe(403);
		}
		expect(
			(await request("/api/decisions/decision-1", "PUT", "---\ntitle: Renamed\n---\n## Context\nAllowed", ordinary))
				.status,
		).toBe(200);
		expect((await core.getDecision("decision-1"))?.status).toBe("proposed");
		expect(
			(
				await request(
					"/api/decisions/decision-1",
					"PUT",
					"---\nstatus: accepted\n---",
					permissions("decisionsWrite", "decisionsManage"),
				)
			).status,
		).toBe(200);
		expect((await request("/api/decisions/decision-1", "PUT", "## Context\nForbidden edit", ordinary)).status).toBe(
			403,
		);
	});

	it("serializes alias IDs and checks the state produced by the preceding write", async () => {
		const internal = (server as unknown as { core: Core }).core;
		const update = internal.updateDecisionFromContent.bind(internal);
		let release = () => {};
		let entered = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let writes = 0;
		internal.updateDecisionFromContent = async (...args) => {
			writes++;
			if (writes === 1) {
				entered();
				await blocked;
			}
			return update(...args);
		};
		const first = request("/api/decisions/decision-1", "PUT", "---\nstatus: accepted\n---", all);
		await started;
		const second = request(
			"/api/decisions/001",
			"PUT",
			"---\nstatus: proposed\n---\n## Context\nStale",
			permissions("decisionsWrite"),
		);
		release();
		expect((await first).status).toBe(200);
		expect((await second).status).toBe(403);
		expect(writes).toBe(1);
		expect((await core.getDecision("decision-1"))?.status).toBe("accepted");
	});

	it("rechecks permission after waiting in the decision queue", async () => {
		const internal = (server as unknown as { core: Core }).core;
		const update = internal.updateDecisionFromContent.bind(internal);
		let release = () => {};
		let entered = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		internal.updateDecisionFromContent = async (...args) => {
			entered();
			await blocked;
			return update(...args);
		};
		const first = request("/api/decisions/decision-1", "PUT", "## Context\nFirst", all);
		await started;
		let allowed = true;
		const authorization: ProjectAuthorization = { check: () => (allowed ? null : new Response(null, { status: 403 })) };
		const second = request("/api/decisions/decision-1", "PUT", "## Context\nRevoked", authorization);
		allowed = false;
		release();
		expect((await first).status).toBe(200);
		expect((await second).status).toBe(403);
		expect((await core.getDecision("decision-1"))?.context).toBe("First");
	});
});

describe("archive lifecycle", () => {
	it.each([
		["tasks", "TASK-1"],
		["docs", "doc-1"],
		["decisions", "decision-1"],
	])("lists, views, restores and permanently deletes archived %s", async (kind, id) => {
		const path = `/api/${kind}/${id}`;
		expect((await request(path, "DELETE")).status).toBe(400);
		expect((await request(`${path}/archive`, "POST")).status).toBe(200);
		const records = await (await request(`/api/${kind}/archived`)).json();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ id, archived: true });
		expect(await (await request(path)).json()).toMatchObject({ id, archived: true });
		expect((await request(`${path}/restore`, "POST")).status).toBe(200);
		expect(await (await request(`/api/${kind}/archived`)).json()).toEqual([]);
		expect((await request(path, "DELETE")).status).toBe(400);
		expect((await request(`${path}/archive`, "POST")).status).toBe(200);
		expect(await (await request(path, "DELETE")).json()).toMatchObject({ success: true });
		expect((await request(path)).status).toBe(404);
	});

	it("keeps archive/restore independent of document editing and decision management", async () => {
		const archiveOnly = permissions("read", "archive");
		expect((await request("/api/docs/doc-1", "PUT", { content: "Denied" }, archiveOnly)).status).toBe(403);
		expect((await request("/api/docs/doc-1/archive", "POST", undefined, archiveOnly)).status).toBe(200);
		expect((await request("/api/docs/doc-1", "DELETE", undefined, archiveOnly)).status).toBe(403);
		expect((await request("/api/docs/doc-1/restore", "POST", undefined, archiveOnly)).status).toBe(200);
		expect((await request("/api/decisions/decision-1", "PUT", "---\nstatus: accepted\n---", all)).status).toBe(200);
		expect(
			(await request("/api/decisions/decision-1", "PUT", "## Context\nDenied", permissions("decisionsManage"))).status,
		).toBe(403);
		expect((await request("/api/decisions/decision-1/archive", "POST", undefined, archiveOnly)).status).toBe(200);
		expect((await request("/api/decisions/decision-1/restore", "POST", undefined, archiveOnly)).status).toBe(200);
		expect((await core.getDecision("decision-1"))?.status).toBe("accepted");
	});

	it("preserves task subtask refusal and reports reference cleanup", async () => {
		await core.createTask(
			{
				id: "TASK-1.1",
				parentTaskId: "TASK-1",
				title: "Child",
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-10-21",
			},
			false,
		);
		await core.archiveTask("TASK-1");
		const refused = await request("/api/tasks/TASK-1", "DELETE");
		expect(refused.status).toBe(400);
		expect((await refused.json()).error).toContain("subtasks exist");
		await core.archiveTask("TASK-1.1");
		expect((await request("/api/tasks/TASK-1.1", "DELETE")).status).toBe(200);
		await core.createTask(
			{
				id: "TASK-2",
				title: "Linked",
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: ["TASK-1"],
				references: ["TASK-1"],
				createdDate: "2026-10-21",
			},
			false,
		);
		expect(await (await request("/api/tasks/TASK-1", "DELETE")).json()).toEqual({
			success: true,
			cleanedTaskIds: ["TASK-2"],
		});
		expect((await core.getTask("TASK-2"))?.dependencies).toEqual([]);
		expect((await core.getTask("TASK-2"))?.references).toEqual([]);
	});

	it("reports documentation references without changing them", async () => {
		await core.updateTaskFromInput("TASK-1", { documentation: ["backlog/docs/doc-1 - Target-document.md"] });
		await request("/api/docs/doc-1/archive", "POST");
		const restored = await request("/api/docs/doc-1/restore", "POST");
		expect(await restored.json()).toMatchObject({ success: true, id: "doc-1", listedAsDocumentationBy: [] });
		await request("/api/docs/doc-1/archive", "POST");
		expect(await (await request("/api/docs/doc-1", "DELETE")).json()).toMatchObject({
			success: true,
			id: "doc-1",
			listedAsDocumentationBy: ["TASK-1"],
		});
		expect((await core.getTask("TASK-1"))?.documentation).toEqual(["backlog/docs/doc-1 - Target-document.md"]);
	});
});

describe("assets and live delivery", () => {
	it("rejects symlink escapes and serves active content as a sandboxed download", async () => {
		const assets = join(testDir, "backlog", "assets");
		await mkdir(assets, { recursive: true });
		await Bun.write(join(testDir, "secret.txt"), "secret");
		await symlink(join(testDir, "secret.txt"), join(assets, "escape.txt"));
		expect((await request("/assets/escape.txt")).status).toBe(404);
		await Bun.write(join(assets, "unsafe.svg"), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
		const svg = await request("/assets/unsafe.svg");
		expect(svg.status).toBe(200);
		expect(svg.headers.get("Content-Type")).toBe("application/octet-stream");
		expect(svg.headers.get("Content-Disposition")).toStartWith("attachment;");
		expect(svg.headers.get("Content-Security-Policy")).toContain("sandbox");
		expect(svg.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});

	it("checks every loading and broadcast send and closes revoked connections", async () => {
		let allowed = true;
		const messages: string[] = [];
		const closes: number[] = [];
		const ws = {
			send: (message: string) => messages.push(message),
			close: (code: number) => closes.push(code),
		} as unknown as ServerWebSocket<unknown>;
		server.acceptSocket(ws, () => allowed);
		expect(messages.length).toBeGreaterThan(0);
		allowed = false;
		const previous = messages.length;
		(server as unknown as { broadcastConfigUpdated(): void }).broadcastConfigUpdated();
		expect(messages.length).toBe(previous);
		expect(closes).toEqual([1008]);
	});
});
