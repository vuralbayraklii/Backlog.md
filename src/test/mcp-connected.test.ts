import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnectedMcpServer } from "../mcp/connected.ts";

const originalFetch = globalThis.fetch;
let directory: string | null = null;

const task = {
	id: "TASK-1",
	title: "Existing task",
	status: "To Do",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-01-01",
	rawContent: "",
	recordKey: "task-key-1",
	revision: "task-rev-1",
};

async function setup(handler: (path: string, init: RequestInit) => Response | Promise<Response>) {
	directory = await mkdtemp(join(tmpdir(), "backlog-connected-mcp-"));
	const keyFile = join(directory, "agent-key");
	await writeFile(keyFile, "test-agent-secret\n", { mode: 0o600 });
	let initialConfigRead = true;
	globalThis.fetch = (async (input, init = {}) => {
		const url = new URL(String(input));
		expect(url.origin).toBe("http://127.0.0.1:23111");
		expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-agent-secret");
		if (url.pathname === "/api/projects/1/config" && !init.method && initialConfigRead) {
			initialConfigRead = false;
			return Response.json({ statuses: ["To Do", "Done"], priorities: ["High"], definitionOfDone: ["Run tests"] });
		}
		return handler(url.pathname + url.search, init);
	}) as typeof fetch;
	return createConnectedMcpServer({
		serverUrl: "http://127.0.0.1:23111",
		serverProject: "1",
		agentKeyFile: keyFile,
		allowHttpLoopback: true,
	});
}

afterEach(async () => {
	globalThis.fetch = originalFetch;
	if (directory) await rm(directory, { recursive: true, force: true });
	directory = null;
});

describe("connected MCP adapter", () => {
	it("uses fixed project tools and requires the read revision for task edits", async () => {
		const writes: Array<{ path: string; init: RequestInit }> = [];
		const server = await setup((path, init) => {
			if (path === "/api/projects/1/tasks" && !init.method) return Response.json([task]);
			if (path === "/api/projects/1/tasks/archived" && !init.method) return Response.json([]);
			if (path === "/api/projects/1/tasks/TASK-1" && !init.method) return Response.json(task);
			if (path === "/api/projects/1/tasks/TASK-1" && init.method === "PUT") {
				writes.push({ path, init });
				if (new Headers(init.headers).get("If-Match") !== "task-rev-1")
					return Response.json({ error: "Another edit was saved", code: "REVISION_CONFLICT" }, { status: 409 });
				return Response.json({ ...task, status: "Done", revision: "task-rev-2" });
			}
			throw new Error(path);
		});
		const tools = server.testInterface.listTools().tools;
		expect(tools).toHaveLength(24);
		expect(tools.map((item) => item.name)).toEqual(
			expect.arrayContaining([
				"task_list",
				"task_search",
				"task_view",
				"task_create",
				"task_edit",
				"task_archive",
				"task_restore",
				"task_delete",
				"document_list",
				"document_view",
				"document_create",
				"document_update",
				"document_archive",
				"document_restore",
				"document_delete",
				"document_search",
				"milestone_list",
				"milestone_add",
				"milestone_rename",
				"milestone_remove",
				"milestone_archive",
				"definition_of_done_defaults_get",
				"definition_of_done_defaults_upsert",
				"get_backlog_instructions",
			]),
		);
		expect(server.testInterface.readResource("backlog://workflow/overview")).toContain("revision");
		const listed = await server.testInterface.callTool("task_list", { status: "To Do" });
		expect(listed.structuredContent?.data).toEqual([expect.objectContaining({ id: "TASK-1", revision: "task-rev-1" })]);
		const missing = await server.testInterface.callTool("task_edit", { id: "TASK-1", status: "Done" });
		expect(missing.isError).toBe(true);
		expect(writes).toHaveLength(0);
		const operationId = "11111111-1111-4111-8111-111111111111";
		const edited = await server.testInterface.callTool("task_edit", {
			id: "TASK-1",
			revision: "task-rev-1",
			status: "Done",
			operationId,
		});
		expect(edited.isError).not.toBe(true);
		expect(writes).toHaveLength(1);
		expect(JSON.parse(String(writes[0]?.init.body))).toEqual({ editArgs: { status: "Done" } });
		expect(new Headers(writes[0]?.init.headers).get("If-Match")).toBe("task-rev-1");
		expect(new Headers(writes[0]?.init.headers).get("Idempotency-Key")).toBe(operationId);
		const stale = await server.testInterface.callTool("task_edit", { id: "TASK-1", revision: "stale", status: "Done" });
		expect(stale.isError).toBe(true);
		expect(stale.structuredContent?.code).toBe("REVISION_CONFLICT");
		expect(writes).toHaveLength(2);
		expect(await readFile(join(directory as string, "agent-key"), "utf8")).toBe("test-agent-secret\n");
		expect(await Bun.file(join(directory as string, "backlog", "config.yml")).exists()).toBe(false);
	});

	it("counts an archived Done dependency as ready in task_list", async () => {
		const dependent = { ...task, dependencies: ["TASK-2"] };
		const archived = { ...task, id: "TASK-2", status: "Done", source: "archived" };
		const server = await setup((path, init) => {
			if (path === "/api/projects/1/tasks" && !init.method) return Response.json([dependent]);
			if (path === "/api/projects/1/tasks/archived" && !init.method) return Response.json([archived]);
			throw new Error(path);
		});
		const listed = await server.testInterface.callTool("task_list", { ready: true });
		expect(listed.isError).not.toBe(true);
		expect(listed.structuredContent?.data).toEqual([expect.objectContaining({ id: "TASK-1", isReady: true })]);
	});

	it("maps create AC and DoD once, reads live defaults, and refuses config writes", async () => {
		let createBody: Record<string, unknown> | null = null;
		let configReads = 0;
		const server = await setup((path, init) => {
			if (path === "/api/projects/1/tasks" && init.method === "POST") {
				createBody = JSON.parse(String(init.body));
				return Response.json(task, { status: 201 });
			}
			if (path === "/api/projects/1/tasks/TASK-1" && !init.method) return Response.json(task);
			if (path === "/api/projects/1/config" && !init.method) {
				configReads++;
				return Response.json({ definitionOfDone: ["Current default"] });
			}
			throw new Error(path);
		});
		const created = await server.testInterface.callTool("task_create", {
			title: "New task",
			acceptanceCriteria: ["Reviewed"],
			definitionOfDoneAdd: ["Verified"],
		});
		expect(created.isError).not.toBe(true);
		expect(createBody).toMatchObject({
			title: "New task",
			acceptanceCriteriaItems: [{ text: "Reviewed", checked: false }],
			definitionOfDoneAdd: ["Verified"],
		});
		expect(createBody).not.toHaveProperty("acceptanceCriteria");
		const defaults = await server.testInterface.callTool("definition_of_done_defaults_get");
		expect(defaults.structuredContent?.data).toEqual({ items: ["Current default"] });
		expect(configReads).toBe(1);
		const rejected = await server.testInterface.callTool("definition_of_done_defaults_upsert", { items: ["Change"] });
		expect(rejected.isError).toBe(true);
		expect(rejected.structuredContent?.code).toBe("UNSUPPORTED_CONNECTED_WRITE");
	});

	it("maps document and milestone writes to the project API with explicit revisions", async () => {
		const writes: Array<{ path: string; method: string; body: unknown; headers: Headers }> = [];
		const document = {
			id: "doc-1",
			title: "Runbook",
			type: "other",
			rawContent: "Before",
			recordKey: "doc-key",
			revision: "doc-rev",
		};
		const milestone = { id: "m-1", title: "Release", recordKey: "milestone-key", revision: "milestone-rev" };
		const server = await setup((path, init) => {
			if (path === "/api/projects/1/docs/doc-1" && !init.method) return Response.json(document);
			if (path === "/api/projects/1/docs/doc-1" && init.method === "PUT") {
				writes.push({
					path,
					method: init.method,
					body: JSON.parse(String(init.body)),
					headers: new Headers(init.headers),
				});
				return Response.json({ ...document, rawContent: "After", revision: "doc-rev-2" });
			}
			if (path === "/api/projects/1/milestones" && !init.method) return Response.json([milestone]);
			if (path === "/api/projects/1/milestones/archived" && !init.method) return Response.json([]);
			if (path === "/api/projects/1/tasks" && !init.method) return Response.json([{ ...task, milestone: "Legacy" }]);
			if (path === "/api/projects/1/milestones/Release" && init.method === "PUT") {
				writes.push({
					path,
					method: init.method,
					body: JSON.parse(String(init.body)),
					headers: new Headers(init.headers),
				});
				return Response.json({ success: true, milestone: { ...milestone, title: "Launch" } });
			}
			throw new Error(path);
		});
		const missing = await server.testInterface.callTool("document_update", { id: "doc-1", content: "After" });
		expect(missing.isError).toBe(true);
		const updated = await server.testInterface.callTool("document_update", {
			id: "doc-1",
			content: "After",
			revision: "doc-rev",
		});
		expect(updated.isError).not.toBe(true);
		const renamed = await server.testInterface.callTool("milestone_rename", {
			from: "Release",
			to: "Launch",
			revision: "milestone-rev",
		});
		expect(renamed.isError).not.toBe(true);
		const listed = await server.testInterface.callTool("milestone_list");
		expect(listed.structuredContent?.data).toMatchObject({
			milestones: [milestone],
			unconfigured: ["Legacy"],
			archivedTaskValues: [],
		});
		expect(writes.map((write) => [write.path, write.method, write.headers.get("If-Match")])).toEqual([
			["/api/projects/1/docs/doc-1", "PUT", "doc-rev"],
			["/api/projects/1/milestones/Release", "PUT", "milestone-rev"],
		]);
		expect(writes[0]?.body).toEqual({ content: "After" });
		expect(writes[1]?.body).toEqual({ title: "Launch" });
	});
});
