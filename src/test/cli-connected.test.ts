import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Core } from "../core/backlog.ts";
import { createConnectedMcpServer } from "../mcp/connected.ts";
import { AgentStore } from "../server/agent-store.ts";
import { AuthStore } from "../server/auth-store.ts";
import { ADMIN_PERMISSIONS } from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { ServerClient } from "../server/client.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import { ProjectStore } from "../server/project-store.ts";
import type { Task } from "../types/index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("CLI connection to the local application", () => {
	let dir: string;
	let cwd: string;
	let root: string;
	let data: string;
	let server: CentralServer;
	let origin: string;
	let keyFile: string;
	let userId: string;
	let projectId: string;
	let secret: string;
	let client: ServerClient;
	const cli = getTestCliPath();

	beforeEach(async () => {
		dir = await createTestDirOutsideRepository("backlog-connected-cli-");
		cwd = join(dir, "uninitialized-client");
		root = join(dir, "project");
		data = join(dir, "data");
		keyFile = join(dir, "agent.key");
		await mkdir(cwd);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Connected fixture");
		const auth = new AuthStore(data);
		const user = await auth.initializeAdmin("admin", "initial password long enough");
		userId = user.id;
		const login = await auth.login("admin", "initial password long enough");
		await auth.changePassword(login.token, "initial password long enough", "replacement password long enough");
		const project = await new ProjectStore(data).register("Connected fixture", root);
		projectId = project.id;
		secret = new AgentStore(data).create({
			userId,
			name: "CLI fixture",
			grants: [{ projectId, permissions: { ...ADMIN_PERMISSIONS } }],
		}).secret;
		await writeFile(keyFile, secret, { mode: 0o600 });
		const port = await findNextAvailablePort(33000);
		if (!port) throw new Error("No test port available.");
		origin = `http://127.0.0.1:${port}`;
		server = new CentralServer(data);
		await server.start(port, false, { publicUrl: origin, allowHttpLoopback: true });
		client = await ServerClient.connect({
			serverUrl: origin,
			serverProject: projectId,
			agentKeyFile: keyFile,
			allowHttpLoopback: true,
		});
	});

	afterEach(async () => {
		await server?.stop();
		await safeCleanup(dir);
	});

	async function run(args: string[], connected = true) {
		const flags = connected
			? ["--server-url", origin, "--server-project", projectId, "--agent-key-file", keyFile, "--allow-http-loopback"]
			: [];
		const child = Bun.spawn([process.execPath, cli, ...flags, ...args], {
			cwd,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, code };
	}
	async function task(title = "Connected task") {
		const result = await run([
			"task",
			"create",
			title,
			"--ac",
			"One acceptance criterion",
			"--dod",
			"One done criterion",
			"--plain",
		]);
		expect(result.code, result.stderr).toBe(0);
		const tasks = await client.read<Array<Task & { revision: string; recordKey: string }>>("tasks");
		const found = tasks.find((value) => value.title === title);
		if (!found) throw new Error("Created task missing.");
		return found;
	}

	it("creates, reads and edits through the application without initializing the client folder", async () => {
		const created = await task();
		expect(created.acceptanceCriteriaItems).toMatchObject([{ text: "One acceptance criterion", checked: false }]);
		expect(created.definitionOfDoneItems).toMatchObject([{ text: "One done criterion", checked: false }]);
		const viewed = await run(["task", created.id, "--json"]);
		expect(viewed.code, viewed.stderr).toBe(0);
		expect(JSON.parse(viewed.stdout).task).toMatchObject({
			id: created.id,
			recordKey: created.recordKey,
			revision: created.revision,
		});
		const missing = await run(["task", "edit", created.id, "--title", "Unsafe replacement"]);
		expect(missing.code).toBe(1);
		expect(missing.stderr).toContain("--if-match");
		const operationId = randomUUID();
		const args = [
			"--if-match",
			created.revision,
			"--operation-id",
			operationId,
			"task",
			"edit",
			created.id,
			"--append-notes",
			"One implementation note",
			"--check-ac",
			"1",
			"--plain",
		];
		const edited = await run(args);
		expect(edited.code, edited.stderr).toBe(0);
		const repeated = await run(args);
		expect(repeated.code, repeated.stderr).toBe(0);
		const current = await client.read<Task>(`tasks/${created.id}`);
		expect(current.implementationNotes).toBe("One implementation note");
		expect(current.acceptanceCriteriaItems?.[0]?.checked).toBe(true);
		const events = new MutationStore(data).listHistory({ scope: { kind: "project", projectId } }).items;
		expect(events.filter((event) => event.operationId === operationId)).toHaveLength(1);
		expect(events.filter((event) => event.source === "external")).toHaveLength(0);
		expect(events.find((event) => event.operationId === operationId)?.actor.kind).toBe("agent");
		const stale = await run(["--if-match", created.revision, "task", "edit", created.id, "--title", "Stale title"]);
		expect(stale.code).toBe(1);
		expect(stale.stderr).toContain("changed");
		expect(await readdir(cwd)).toEqual([]);
	});

	it("keeps list filtering and versioned JSON while supporting documents, decisions and milestones", async () => {
		const created = await task();
		const listed = await run(["task", "list", "--search", "Connected", "--json", "--max-count", "1"]);
		expect(listed.code, listed.stderr).toBe(0);
		expect(JSON.parse(listed.stdout).tasks[0]).toMatchObject({ id: created.id, revision: created.revision });
		const searched = await run(["search", "Connected", "--json"]);
		expect(searched.code, searched.stderr).toBe(0);
		expect(JSON.parse(searched.stdout)).toMatchObject({
			kind: "search",
			results: expect.arrayContaining([
				expect.objectContaining({
					type: "task",
					data: expect.objectContaining({ id: created.id, revision: created.revision }),
				}),
			]),
		});
		const docCreate = await run(["doc", "create", "Guide", "--type", "guide"]);
		expect(docCreate.code, docCreate.stderr).toBe(0);
		const doc = JSON.parse(docCreate.stdout);
		const docUpdate = await run(["--if-match", doc.revision, "doc", "update", doc.id, "--content", "Guide body"]);
		expect(docUpdate.code, docUpdate.stderr).toBe(0);
		expect((await client.read<{ rawContent: string }>(`docs/${doc.id}`)).rawContent).toBe("Guide body");
		const decisionCreate = await run(["decision", "create", "A decision", "--status", "proposed", "--plain"]);
		expect(decisionCreate.code, decisionCreate.stderr).toBe(0);
		const decision = JSON.parse(decisionCreate.stdout);
		const decisionUpdate = await run([
			"--if-match",
			decision.revision,
			"decision",
			"edit",
			decision.id,
			"--status",
			"accepted",
		]);
		expect(decisionUpdate.code, decisionUpdate.stderr).toBe(0);
		expect((await client.read<{ status: string }>(`decisions/${decision.id}`)).status).toBe("accepted");
		const milestoneCreate = await run(["milestone", "add", "Release"]);
		expect(milestoneCreate.code, milestoneCreate.stderr).toBe(0);
		const milestone = JSON.parse(milestoneCreate.stdout);
		const milestoneUpdate = await run([
			"--if-match",
			milestone.revision,
			"milestone",
			"rename",
			milestone.id,
			"Renamed release",
		]);
		expect(milestoneUpdate.code, milestoneUpdate.stderr).toBe(0);
		expect((await client.read<Array<{ title: string }>>("milestones"))[0]?.title).toBe("Renamed release");
		const history = await run(["history", "list", "--json"]);
		expect(history.code, history.stderr).toBe(0);
		expect(JSON.parse(history.stdout).items.length).toBeGreaterThan(4);
	});

	it("does not fall back to local operations on incomplete configuration, denied commands or an unreachable application", async () => {
		const incomplete = await run(["--server-url", origin, "task", "create", "Not local"], false);
		expect(incomplete.code).toBe(1);
		expect(incomplete.stderr).toContain("requires");
		const unsupported = await run(["init", "--defaults"]);
		expect(unsupported.code).toBe(1);
		expect(unsupported.stderr).toContain("not supported");
		await server.stop();
		const offline = await run(["task", "create", "No fallback", "--plain"]);
		expect(offline.code).toBe(1);
		expect(offline.stdout).not.toContain(secret);
		expect(offline.stderr).not.toContain(secret);
		expect(await readdir(cwd)).toEqual([]);
	});

	it("sends search text and repeated filters, including configured task types", async () => {
		const filesystem = new Core(root).fs;
		const config = await filesystem.loadConfig();
		if (!config) throw new Error("Missing fixture config");
		await filesystem.saveConfig({ ...config, projects: ["Alpha", "Beta"] });
		const created = await task("UniqueNeedle");
		const unrelated = await task("UnrelatedZebra");
		await client.write(
			`tasks/${created.id}`,
			"PUT",
			{ editArgs: { type: "feature", project: "Alpha", status: "In Progress", modifiedFiles: ["src/needle.ts"] } },
			{ revision: created.revision },
		);
		await client.write(
			`tasks/${unrelated.id}`,
			"PUT",
			{ editArgs: { type: "bug", project: "Beta", modifiedFiles: ["src/zebra.ts"] } },
			{ revision: unrelated.revision },
		);
		await client.write("docs", "POST", { title: "UniqueNeedle", content: "Guide" });
		await client.write("docs", "POST", { title: "UnrelatedZebra", content: "Other" });
		const search = await run(["search", "UniqueNeedle", "--type", "task", "--type", "document", "--json"]);
		expect(search.code, search.stderr).toBe(0);
		const results = JSON.parse(search.stdout).results;
		expect(results.map((entry: { type: string }) => entry.type).sort()).toEqual(["document", "task"]);
		expect(JSON.stringify(results)).not.toContain("UnrelatedZebra");
		const docs = await run(["doc", "search", "UniqueNeedle"]);
		expect(docs.code, docs.stderr).toBe(0);
		expect(docs.stdout).toContain("UniqueNeedle");
		expect(docs.stdout).not.toContain("UnrelatedZebra");
		const feature = await run(["search", "--type", "task", "--task-type", "FEATURE", "--json"]);
		expect(feature.code, feature.stderr).toBe(0);
		expect(JSON.parse(feature.stdout).results.map((entry: { data: { id: string } }) => entry.data.id)).toEqual([
			created.id,
		]);
		const statuses = await run([
			"search",
			"--type",
			"task",
			"--task-type",
			"feature",
			"--task-type",
			"bug",
			"--status",
			"To Do",
			"--status",
			"In Progress",
			"--project",
			"Alpha",
			"--project",
			"Beta",
			"--modified-file",
			"needle",
			"--modified-file",
			"zebra",
			"--json",
		]);
		expect(statuses.code, statuses.stderr).toBe(0);
		expect(JSON.parse(statuses.stdout).results).toHaveLength(2);
		const excluded = await run([
			"search",
			"--type",
			"task",
			"--exclude-status",
			"To Do",
			"--exclude-status",
			"Done",
			"--json",
		]);
		expect(excluded.code, excluded.stderr).toBe(0);
		expect(JSON.parse(excluded.stdout).results.map((entry: { data: { id: string } }) => entry.data.id)).toEqual([
			created.id,
		]);
		const invalid = await run(["search", "--task-type", "nonexistent", "--json"]);
		expect(invalid.code).toBe(1);
		expect(invalid.stderr).toContain("Unsupported task type");
		const wrongType = await run(["search", "--type", "document", "--task-type", "feature", "--json"]);
		expect(wrongType.code).toBe(1);
	});

	it("keeps decision revisions and paginates JSON with the shared list window", async () => {
		const first = await client.write<{ id: string; revision: string; recordKey: string }>("decisions", "POST", {
			title: "First",
			status: "proposed",
			context: "",
			decision: "",
			consequences: "",
		});
		await client.write("decisions", "POST", {
			title: "Second",
			status: "proposed",
			context: "",
			decision: "",
			consequences: "",
		});
		const listed = await run(["decision", "list", "--json", "--max-count", "1"]);
		expect(listed.code, listed.stderr).toBe(0);
		const page = JSON.parse(listed.stdout);
		expect(page).toMatchObject({ kind: "decision-list", total: 2, nextSkip: 1 });
		expect(page.decisions).toEqual([
			expect.objectContaining({ id: first.id, recordKey: first.recordKey, revision: first.revision }),
		]);
		const next = await run(["decision", "list", "--json", "--max-count", "1", "--skip", "1"]);
		expect(next.code, next.stderr).toBe(0);
		expect(JSON.parse(next.stdout)).toMatchObject({
			total: 2,
			nextSkip: null,
			decisions: [expect.objectContaining({ title: "Second" })],
		});
		const plain = await run(["decision", "list", "--plain"]);
		expect(plain.code, plain.stderr).toBe(0);
		expect(plain.stdout).toContain(first.recordKey);
		expect(plain.stdout).toContain(first.revision);
		const count = await run(["decision", "list", "--count"]);
		expect(count.code, count.stderr).toBe(0);
		expect(count.stdout.trim()).toBe("2");
	});

	it("replays document updates with their original revision and rejects changed retry bodies", async () => {
		const doc = await client.write<{ id: string; revision: string }>("docs", "POST", {
			title: "Guide",
			content: "Before",
		});
		const operationId = randomUUID();
		const args = [
			"--if-match",
			doc.revision,
			"--operation-id",
			operationId,
			"doc",
			"update",
			doc.id,
			"--content",
			"After",
		];
		const updated = await run(args);
		expect(updated.code, updated.stderr).toBe(0);
		const repeated = await run(args);
		expect(repeated.code, repeated.stderr).toBe(0);
		expect(repeated.stdout).toBe(updated.stdout);
		const mcp = await createConnectedMcpServer({
			serverUrl: origin,
			serverProject: projectId,
			agentKeyFile: keyFile,
			allowHttpLoopback: true,
		});
		const crossSurface = await mcp.testInterface.callTool("document_update", {
			id: doc.id,
			content: "After",
			revision: doc.revision,
			operationId,
		});
		expect(crossSurface.isError, JSON.stringify(crossSurface)).not.toBe(true);
		expect(crossSurface.structuredContent?.data).toMatchObject({ id: doc.id, rawContent: "After" });
		const changed = await run([...args.slice(0, -1), "Different"]);
		expect(changed.code).toBe(1);
		expect(changed.stderr).toContain("Operation key is already in use");
		const stale = await run(["--if-match", doc.revision, "doc", "update", doc.id, "--content", "Stale"]);
		expect(stale.code).toBe(1);
		expect(stale.stderr).toContain("changed");
		expect(
			new MutationStore(data)
				.listHistory({ scope: { kind: "project", projectId } })
				.items.filter((event) => event.operationId === operationId),
		).toHaveLength(1);
	});

	it("replays milestone rename, archive and remove by the original name in CLI and MCP", async () => {
		const mcp = await createConnectedMcpServer({
			serverUrl: origin,
			serverProject: projectId,
			agentKeyFile: keyFile,
			allowHttpLoopback: true,
		});
		for (const surface of ["cli", "mcp"]) {
			for (const action of ["rename", "archive", "remove"]) {
				const name = `${surface} ${action} release`;
				const milestone = await client.write<{ id: string; revision: string }>("milestones", "POST", { title: name });
				const operationId = randomUUID();
				if (surface === "cli") {
					const args = [
						"--if-match",
						milestone.revision,
						"--operation-id",
						operationId,
						"milestone",
						action,
						name,
						...(action === "rename" ? ["Renamed release"] : []),
					];
					const result = await run(args);
					expect(result.code, result.stderr).toBe(0);
					const retry = await run(args);
					expect(retry.code, retry.stderr).toBe(0);
					expect(retry.stdout).toBe(result.stdout);
					const changed = await run(
						action === "rename" ? [...args.slice(0, -1), "Different"] : [...args.slice(0, -1), "Different name"],
					);
					expect(changed.code).toBe(1);
					expect(changed.stderr).toContain("Operation key is already in use");
				} else {
					const input = {
						revision: milestone.revision,
						operationId,
						...(action === "rename" ? { from: name, to: "Renamed MCP release" } : { name }),
					};
					const tool = `milestone_${action}`;
					const result = await mcp.testInterface.callTool(tool, input);
					expect(result.isError, JSON.stringify(result)).not.toBe(true);
					const retry = await mcp.testInterface.callTool(tool, input);
					expect(retry).toEqual(result);
					const changed = await mcp.testInterface.callTool(tool, {
						...input,
						...(action === "rename" ? { to: "Different" } : { name: "Different name" }),
					});
					expect(changed.isError).toBe(true);
					expect(changed.structuredContent?.code).toBe("IDEMPOTENCY_KEY_REUSED");
				}
				expect(
					new MutationStore(data)
						.listHistory({ scope: { kind: "project", projectId } })
						.items.filter((event) => event.operationId === operationId),
				).toHaveLength(1);
			}
		}
	});

	it("streams changed JSON snapshots with the same connected list command", async () => {
		const created = await task();
		const child = Bun.spawn(
			[
				process.execPath,
				cli,
				"--server-url",
				origin,
				"--server-project",
				projectId,
				"--agent-key-file",
				keyFile,
				"--allow-http-loopback",
				"task",
				"list",
				"--json",
				"--watch",
			],
			{ cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const reader = child.stdout.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		async function next(): Promise<{ tasks: Array<{ id: string; title: string }> }> {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				return await Promise.race([
					(async () => {
						for (;;) {
							const end = buffer.indexOf("\n}\n");
							if (end >= 0) {
								const value = JSON.parse(buffer.slice(0, end + 3));
								buffer = buffer.slice(end + 3);
								return value;
							}
							const chunk = await reader.read();
							if (chunk.done) throw new Error("Connected watch ended.");
							buffer += decoder.decode(chunk.value, { stream: true });
						}
					})(),
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(() => reject(new Error("Connected watch timed out.")), 5000);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
			}
		}
		try {
			expect((await next()).tasks[0]?.id).toBe(created.id);
			await client.write(
				`tasks/${created.id}`,
				"PUT",
				{ editArgs: { title: "Watch changed" } },
				{ revision: created.revision },
			);
			expect((await next()).tasks[0]?.title).toBe("Watch changed");
		} finally {
			child.kill("SIGTERM");
			await child.exited;
			await reader.cancel();
		}
		expect(await readdir(cwd)).toEqual([]);
	});

	it.each(["network", "body"])(
		"recovers a lost %s response through its durable result without a second write",
		async (failure) => {
			const originalFetch = globalThis.fetch;
			let dropped = false;
			globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const response = await originalFetch(input, init);
				if (!dropped && init?.method === "POST") {
					dropped = true;
					await response.arrayBuffer();
					if (failure === "body")
						return new Response("{", { status: response.status, headers: { "Content-Type": "application/json" } });
					throw new TypeError("Injected lost response");
				}
				return response;
			}) as typeof fetch;
			try {
				const result = await client.write<Task>("tasks", "POST", { title: "Lost response" });
				expect(result.title).toBe("Lost response");
			} finally {
				globalThis.fetch = originalFetch;
			}
			expect(dropped).toBe(true);
			expect((await client.read<Task[]>("tasks")).filter((value) => value.title === "Lost response")).toHaveLength(1);
			expect(
				new MutationStore(data)
					.listHistory({ scope: { kind: "project", projectId } })
					.items.filter((event) => event.source === "agent"),
			).toHaveLength(1);
		},
	);

	it("does not mistake an older operation result for a changed request that never reached the application", async () => {
		const operationId = randomUUID();
		await client.write("tasks", "POST", { title: "Original request" }, { operationId });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			if (init?.method === "POST") throw new TypeError("Injected failure before delivery");
			return originalFetch(input, init);
		}) as typeof fetch;
		let failure: unknown;
		try {
			await client.write("tasks", "POST", { title: "Changed request" }, { operationId });
		} catch (error) {
			failure = error;
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(failure).toMatchObject({ code: "OPERATION_RESULT_UNKNOWN", operationId });
		expect((await client.read<Task[]>("tasks")).map((value) => value.title)).toEqual(["Original request"]);
	});

	it("preserves the generated operation ID if access is revoked before a lost response can be inspected", async () => {
		const originalFetch = globalThis.fetch;
		let dropped = false;
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const response = await originalFetch(input, init);
			if (!dropped && init?.method === "POST") {
				dropped = true;
				await response.arrayBuffer();
				const agents = new AgentStore(data);
				const key = agents.list(userId).find((value) => value.name === "CLI fixture");
				if (!key) throw new Error("Fixture key missing.");
				agents.revoke(key.id, userId);
				throw new TypeError("Injected response loss after key revocation");
			}
			return response;
		}) as typeof fetch;
		let failure: unknown;
		try {
			await client.write("tasks", "POST", { title: "Committed before revocation" });
		} catch (error) {
			failure = error;
		} finally {
			globalThis.fetch = originalFetch;
		}
		const event = new MutationStore(data)
			.listHistory({ scope: { kind: "project", projectId } })
			.items.find((value) => value.source === "agent");
		expect(event?.operationId).toBeTruthy();
		expect(failure).toMatchObject({ code: "OPERATION_RESULT_UNKNOWN", operationId: event?.operationId });
		expect(String(failure)).toContain(event?.operationId ?? "missing");
	});

	it("provides canonical admin key commands without returning secrets in later reads or revocation", async () => {
		const grantsFile = join(dir, "grants.json");
		await writeFile(grantsFile, JSON.stringify([{ projectId, permissions: ADMIN_PERMISSIONS }]));
		const args = ["server", "--data-dir", data, "agent-key"];
		const created = await run(
			[...args, "create", userId, "--name", "Second key", "--grants-file", grantsFile, "--json"],
			false,
		);
		expect(created.code, created.stderr).toBe(0);
		const result = JSON.parse(created.stdout);
		expect(result.secret).toMatch(/^bk_/);
		const listed = await run([...args, "list", "--json"], false);
		expect(listed.code, listed.stderr).toBe(0);
		expect(listed.stdout).not.toContain(result.secret);
		const revoked = await run([...args, "revoke", result.key.id, "--json"], false);
		expect(revoked.code, revoked.stderr).toBe(0);
		expect(revoked.stdout).not.toContain(result.secret);
		expect(JSON.parse(revoked.stdout).key.revokedAt).toBeTruthy();
		expect(new AgentStore(data).authenticate(result.secret)).toBeNull();
	});

	it("starts the local application with its documented HTTP loopback flag after connection options are registered", async () => {
		await server.stop();
		const child = Bun.spawn(
			[
				process.execPath,
				cli,
				"server",
				"--data-dir",
				data,
				"start",
				"--port",
				new URL(origin).port,
				"--public-url",
				origin,
				"--allow-http-loopback",
			],
			// The JS test bundle's HTML manifest resolves assets from its output directory.
			// Shipped native binaries embed those assets and are verified separately.
			{
				cwd: process.env.BACKLOG_TEST_CLI_BUNDLE ? dirname(cli) : cwd,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const stdout = new Response(child.stdout).text();
		const stderr = new Response(child.stderr).text();
		let ready = false;
		try {
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline && child.exitCode === null) {
				try {
					ready = (await fetch(`${origin}/api/version`, { signal: AbortSignal.timeout(300) })).ok;
				} catch {}
				if (ready) break;
				await Bun.sleep(25);
			}
		} finally {
			if (child.exitCode === null) child.kill("SIGTERM");
			await child.exited;
		}
		const errors = await stderr;
		expect(ready, errors).toBe(true);
		expect(await stdout).toContain("server running");
		expect(errors).not.toContain("requires HTTPS");
	});
});
