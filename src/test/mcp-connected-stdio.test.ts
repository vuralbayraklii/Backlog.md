import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

let directory: string | null = null;
let http: ReturnType<typeof Bun.serve> | null = null;

afterEach(async () => {
	http?.stop(true);
	http = null;
	if (directory) await rm(directory, { recursive: true, force: true });
	directory = null;
});

describe("connected MCP stdio transport", () => {
	it("serves the fixed project through HTTP without opening a local backlog root", async () => {
		directory = await mkdtemp(join(tmpdir(), "backlog-mcp-stdio-connected-"));
		const keyFile = join(directory, "agent-key");
		await writeFile(keyFile, "stdio-test-key\n", { mode: 0o600 });
		const calls: Array<{ path: string; method: string; ifMatch: string | null }> = [];
		const task = {
			id: "TASK-1",
			title: "Remote task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-01-01",
			rawContent: "",
			recordKey: "record-1",
			revision: "revision-1",
		};
		http = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (request.headers.get("Authorization") !== "Bearer stdio-test-key")
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				calls.push({ path: url.pathname, method: request.method, ifMatch: request.headers.get("If-Match") });
				if (url.pathname === "/api/projects/1/config")
					return Response.json({ statuses: ["To Do", "Done"], definitionOfDone: ["Reviewed"] });
				if (url.pathname === "/api/projects/1/tasks" && request.method === "GET") return Response.json([task]);
				if (url.pathname === "/api/projects/1/tasks/archived" && request.method === "GET") return Response.json([]);
				if (url.pathname === "/api/projects/1/tasks/TASK-1" && request.method === "GET") return Response.json(task);
				if (url.pathname === "/api/projects/1/tasks/TASK-1" && request.method === "PUT")
					return Response.json({ ...task, status: "Done", revision: "revision-2" });
				return Response.json({ error: "Not Found" }, { status: 404 });
			},
		});
		const transport = new StdioClientTransport({
			command: "bun",
			args: [
				join(import.meta.dir, "..", "cli.ts"),
				"--server-url",
				`http://127.0.0.1:${http.port}`,
				"--server-project",
				"1",
				"--agent-key-file",
				keyFile,
				"--allow-http-loopback",
				"mcp",
				"start",
			],
			cwd: directory,
			stderr: "pipe",
		});
		let stderr = "";
		transport.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		const client = new Client(
			{ name: "Connected Stdio Test", version: "1.0.0" },
			{ capabilities: { roots: { listChanged: true } } },
		);
		let rootsReads = 0;
		client.setRequestHandler(ListRootsRequestSchema, async () => {
			rootsReads++;
			return { roots: [{ uri: `file://${directory}` }] };
		});
		try {
			await client.connect(transport);
			const listed = await client.listTools();
			expect(listed.tools.map((tool) => tool.name)).toContain("task_edit");
			const guide = await client.readResource({ uri: "backlog://workflow/overview" });
			const guideContent = guide.contents[0];
			expect(guideContent && "text" in guideContent ? guideContent.text : "").toContain("Connected server project");
			const tasks = await client.callTool({ name: "task_list", arguments: {} });
			expect(JSON.stringify(tasks.structuredContent)).toContain("Remote task");
			const missing = await client.callTool({ name: "task_edit", arguments: { id: "TASK-1", status: "Done" } });
			expect(missing.isError).toBe(true);
			expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
			const edited = await client.callTool({
				name: "task_edit",
				arguments: { id: "TASK-1", status: "Done", revision: "revision-1" },
			});
			expect(edited.isError).not.toBe(true);
			expect(calls.find((call) => call.method === "PUT")?.ifMatch).toBe("revision-1");
			expect(rootsReads).toBe(0);
			expect(await Bun.file(join(directory, "backlog", "config.yml")).exists()).toBe(false);
		} catch (error) {
			throw new Error(`${error instanceof Error ? error.message : String(error)}\nMCP stderr: ${stderr}`);
		} finally {
			await client.close();
		}
	});
});
