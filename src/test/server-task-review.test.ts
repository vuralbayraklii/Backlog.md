import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { appendTaskReview } from "../core/task-review.ts";
import { AgentStore } from "../server/agent-store.ts";
import { AuthStore } from "../server/auth-store.ts";
import { ADMIN_PERMISSIONS } from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { ServerClient } from "../server/client.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import type { MutationCheckpoint } from "../server/mutations.ts";
import { ProjectStore } from "../server/project-store.ts";
import { historyActionLabel } from "../types/history.ts";
import type { Task } from "../types/index.ts";
import type { ReviewAction, TaskReviewView } from "../types/task-review.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const initial = "review initial password";
const password = "review changed password";
type SavedTask = Task & { revision: string; recordKey: string };

describe("authenticated task reviews", () => {
	let root: string;
	let base: string;
	let readerId: string;
	let adminId: string;
	let server: CentralServer;
	let auth: AuthStore;
	let core: Core;
	let agent: ServerClient;
	let admin: ServerClient;
	let reader: ServerClient;
	let agentFile: string;
	let readerFile: string;
	let checkpoint: MutationCheckpoint | undefined;
	beforeEach(async () => {
		checkpoint = undefined;
		root = await createTestDirOutsideRepository("server-review-");
		const data = join(root, "data");
		for (let index = 1; index <= 2; index++) {
			const instance = new Core(join(root, `project${index}`));
			await initializeFilesystemTestProject(instance, `Reviews ${index}`);
			await instance.fs.saveTask({
				id: "TASK-1",
				title: `Project ${index}`,
				status: "Done",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-10-23",
				rawContent: "Review this work",
			});
			await new ProjectStore(data).register(`Reviews ${index}`, join(root, `project${index}`));
			if (index === 1) core = instance;
		}
		auth = new AuthStore(data);
		adminId = (await auth.initializeAdmin("admin", initial)).id;
		readerId = (await auth.createUser({ username: "reader", password: initial })).id;
		auth.setMember("1", readerId, { tasksWrite: false, docsWrite: false });
		const port = await findNextAvailablePort(43000);
		if (!port) throw new Error("No port available");
		base = `http://127.0.0.1:${port}`;
		server = new CentralServer(data, {
			mutationCheckpoint: async (...args) => {
				await checkpoint?.(...args);
			},
		});
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
		async function human(name: string) {
			const sessionFile = join(root, `${name}.session`);
			const options = { serverUrl: base, serverProject: "1", sessionFile, allowHttpLoopback: true };
			await ServerClient.auth(options, "login", { username: name, password: initial });
			await ServerClient.auth(options, "password", { currentPassword: initial, newPassword: password });
			return ServerClient.connect(options);
		}
		admin = await human("admin");
		reader = await human("reader");
		readerFile = join(root, "reader.session");
		const key = new AgentStore(data).create({
			userId: adminId,
			name: "Review agent",
			grants: ["1", "2"].map((projectId) => ({ projectId, permissions: ADMIN_PERMISSIONS })),
		});
		agentFile = join(root, "agent.key");
		await writeFile(agentFile, key.secret, { mode: 0o600 });
		agent = await ServerClient.connect({
			serverUrl: base,
			serverProject: "1",
			agentKeyFile: agentFile,
			allowHttpLoopback: true,
		});
	});
	afterEach(async () => {
		await server?.stop();
		await safeCleanup(root);
	});
	const task = (client = agent) => client.read<SavedTask>("tasks/TASK-1");
	async function act(client: ServerClient, verb: string, action: ReviewAction) {
		return client.write<SavedTask>(`tasks/TASK-1/reviews/${verb}`, "POST", action, {
			revision: (await task(client)).revision,
		});
	}
	const request = (type: "review" | "decision" | "acceptance" = "acceptance") =>
		act(agent, "request", {
			kind: "request",
			type,
			reviewer: { userId: readerId, name: "reader" },
			reason: "Please review the delivery",
		});
	const verify = () =>
		act(agent, "verify", {
			kind: "verification",
			result: "passed",
			notes: "Tests passed",
			evidence: ["test report: 12 passed"],
			commit: "example-commit",
		});
	const response = {
		kind: "response",
		requestId: 1,
		outcome: "approved",
		notes: "Accepted by the assigned human",
	} as const;

	it("accepts an agent verification and assigned read-only human response as distinct authenticated events", async () => {
		await request();
		await verify();
		await expect(act(agent, "respond", response)).rejects.toMatchObject({ status: 403 });
		await expect(act(admin, "respond", response)).rejects.toMatchObject({ status: 403 });
		const saved = await act(reader, "respond", response);
		expect(saved.review?.at(-1)).toMatchObject({
			kind: "response",
			verificationId: 2,
			author: { kind: "user", userId: readerId },
		});
		const view = await reader.read<TaskReviewView>("tasks/TASK-1/reviews");
		expect(view.trustedEntryIds).toEqual(expect.arrayContaining([1, 2, 3]));
		expect((await reader.read<{ requests: unknown[] }>("reviews")).requests).toHaveLength(0);
		const events = new MutationStore(join(root, "data")).listHistory({
			scope: { kind: "project", projectId: "1" },
		}).items;
		expect(events.filter((event) => event.action.endsWith("/reviews/respond"))).toHaveLength(1);
		expect(events.find((event) => event.action.endsWith("/reviews/verify"))?.actor.kind).toBe("agent");
	});

	it("does not authenticate a request whose type was changed after a general approval", async () => {
		await request("review");
		await act(reader, "respond", response);
		const local = await core.fs.loadTask("TASK-1");
		if (!local?.review) throw new Error("Missing review fixture");
		local.review = local.review.map((entry) => (entry.kind === "request" ? { ...entry, type: "acceptance" } : entry));
		await core.fs.saveTask(local);
		const view = await reader.read<TaskReviewView>("tasks/TASK-1/reviews");
		expect(view.trustedEntryIds).not.toContain(1);
		expect(view.trustedEntryIds).not.toContain(2);
		expect(view.staleEntryIds).toEqual([]);
	});

	it.each(["response", "cancellation"] as const)(
		"does not bind an old authenticated %s to a new request with a reused number",
		async (kind) => {
			await request("review");
			await verify();
			const closed = await (kind === "response"
				? act(reader, "respond", response)
				: act(agent, "cancel", { kind: "cancellation", requestId: 1, reason: "Reassign" }));
			const oldClosure = closed.review?.at(-1);
			const local = await core.fs.loadTask("TASK-1");
			if (!local || !oldClosure) throw new Error("Missing review fixture");
			local.review = [];
			await core.fs.saveTask(local);
			await request();
			await verify();
			const current = await core.fs.loadTask("TASK-1");
			if (!current?.review) throw new Error("Missing replacement request");
			current.review.push(oldClosure);
			await core.fs.saveTask(current);

			const view = await reader.read<TaskReviewView>("tasks/TASK-1/reviews");
			expect(view.trustedEntryIds).toEqual(expect.arrayContaining([1, 2]));
			expect(view.trustedEntryIds).not.toContain(3);
			expect((await reader.read<{ requests: unknown[] }>("reviews")).requests).toHaveLength(1);
			await act(reader, "respond", response);
			expect((await reader.read<TaskReviewView>("tasks/TASK-1/reviews")).trustedEntryIds).toContain(4);
			expect((await reader.read<{ requests: unknown[] }>("reviews")).requests).toHaveLength(0);
		},
	);

	it("preserves authenticated acceptance when YAML object keys are reordered", async () => {
		await request();
		await verify();
		await act(reader, "respond", response);
		const before = await reader.read<TaskReviewView>("tasks/TASK-1/reviews");
		const local = await core.fs.loadTask("TASK-1");
		if (!local?.review) throw new Error("Missing review fixture");
		local.review = JSON.parse(
			JSON.stringify(local.review, (_key, value) =>
				value && typeof value === "object" && !Array.isArray(value)
					? Object.fromEntries(Object.entries(value).reverse())
					: value,
			),
		);
		await core.fs.saveTask(local);
		const after = await reader.read<TaskReviewView>("tasks/TASK-1/reviews");
		expect(after).toMatchObject({
			contentHash: before.contentHash,
			trustedEntryIds: before.trustedEntryIds,
			staleEntryIds: before.staleEntryIds,
		});
		expect(after.trustedEntryIds).toEqual(expect.arrayContaining([1, 2, 3]));
		expect((await reader.read<{ requests: unknown[] }>("reviews")).requests).toHaveLength(0);
	});

	it.each(["Acceptance Criteria", "Definition of Done"])(
		"allows a response after serializing an existing empty %s block",
		async (heading) => {
			const local = await core.fs.loadTask("TASK-1");
			if (!local?.filePath) throw new Error("Missing task fixture");
			const marker = heading === "Acceptance Criteria" ? "AC" : "DOD";
			await Bun.write(
				local.filePath,
				`${await Bun.file(local.filePath).text()}\n## ${heading}\n<!-- ${marker}:BEGIN -->\n<!-- ${marker}:END -->\n`,
			);
			await request();
			await verify();
			await act(reader, "respond", response);
			const view = await reader.read<TaskReviewView>("tasks/TASK-1/reviews");
			expect((await task()).review?.every((entry) => entry.contentHash === view.contentHash)).toBe(true);
			expect(view.trustedEntryIds).toEqual(expect.arrayContaining([1, 2, 3]));
			expect(view.staleEntryIds).toEqual([]);
			expect((await reader.read<{ requests: unknown[] }>("reviews")).requests).toHaveLength(0);
		},
	);

	it("requires explicit revisions and replays the original operation exactly once", async () => {
		const action: ReviewAction = {
			kind: "request",
			type: "review",
			reviewer: { userId: readerId, name: "reader" },
			reason: "Check this plan",
		};
		await expect(agent.write("tasks/TASK-1/reviews/request", "POST", action)).rejects.toMatchObject({ status: 428 });
		const before = await task();
		const operationId = randomUUID();
		const options = { revision: before.revision, operationId };
		const first = await agent.write<SavedTask>("tasks/TASK-1/reviews/request", "POST", action, options);
		expect(await agent.write<SavedTask>("tasks/TASK-1/reviews/request", "POST", action, options)).toEqual(first);
		await expect(
			agent.write("tasks/TASK-1/reviews/request", "POST", { ...action, reason: "Different" }, options),
		).rejects.toMatchObject({ status: 409 });
		await expect(
			agent.write(
				"tasks/TASK-1/reviews/verify",
				"POST",
				{ kind: "verification", result: "passed", notes: "Pass", evidence: ["report"] },
				{ revision: before.revision },
			),
		).rejects.toMatchObject({ status: 409 });
		expect((await task()).review).toHaveLength(1);
	});

	it("keeps general decisions independent of verification and rejects stale review content", async () => {
		await request("decision");
		await act(reader, "respond", {
			...response,
			outcome: "answered",
			notes: "Choose the existing approach",
			decision: "decision-1",
		});
		await request();
		await verify();
		const current = await task();
		await agent.write("tasks/TASK-1", "PUT", { status: "In Progress" }, { revision: current.revision });
		await expect(act(reader, "respond", { ...response, requestId: 3 })).rejects.toMatchObject({ status: 409 });
		expect((await reader.read<{ requests: { stale: boolean }[] }>("reviews")).requests[0]?.stale).toBe(true);
	});

	it("does not trust a verification declared through direct file changes", async () => {
		await request();
		const local = await core.fs.loadTask("TASK-1");
		if (!local) throw new Error("No fixture task");
		local.review = appendTaskReview(
			local,
			{ kind: "verification", result: "passed", notes: "Claimed pass", evidence: ["claimed report"] },
			{ author: { kind: "user", userId: adminId, name: "admin" }, canWrite: true },
		);
		await core.fs.saveTask(local);
		expect((await reader.read<TaskReviewView>("tasks/TASK-1/reviews")).trustedEntryIds).not.toContain(2);
		await expect(act(reader, "respond", response)).rejects.toThrow("authenticated verification");
		for (const mode of ["--plain", "--json"]) {
			const child = Bun.spawn(
				[
					process.execPath,
					getTestCliPath(),
					"--server-url",
					base,
					"--server-project",
					"1",
					"--allow-http-loopback",
					"--session-file",
					readerFile,
					"task",
					"view",
					"TASK-1",
					mode,
				],
				{ cwd: root, stdout: "pipe", stderr: "pipe" },
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(code, stderr).toBe(0);
			if (mode === "--plain") expect(stdout).toContain("Declared identity: admin");
			else expect(JSON.parse(stdout).task.reviewView.trustedEntryIds).not.toContain(2);
		}
		const history = await reader.read<{ items: { occurredAt: null; detectedAt: string }[] }>("history", {
			actor: "unknown",
			source: "external",
			action: "external",
			from: "2000-01-01T00:00:00Z",
			until: "2100-01-01T00:00:00Z",
		});
		expect(history.items[0]?.occurredAt).toBeNull();
		expect(history.items[0]?.detectedAt).toBeString();
	});

	it("requires a new review even when an observed external edit is later reverted", async () => {
		await request();
		await verify();
		const local = await core.fs.loadTask("TASK-1");
		if (!local) throw new Error("No fixture task");
		await core.fs.saveTask({ ...local, title: "External edit" });
		await task();
		await core.fs.saveTask(local);
		await task();
		expect((await reader.read<TaskReviewView>("tasks/TASK-1/reviews")).staleEntryIds).toEqual(
			expect.arrayContaining([1, 2]),
		);
		expect((await reader.read<{ requests: { stale: boolean }[] }>("reviews")).requests[0]?.stale).toBe(true);
		await expect(act(reader, "respond", response)).rejects.toMatchObject({ status: 409 });
	});

	it("shares history pages across tasks and requests in both summary endpoints", async () => {
		await request("review");
		await request("decision");
		const second = await agent.write<SavedTask>("tasks", "POST", { title: "Second task" });
		await agent.write(
			`tasks/${second.id}/reviews/request`,
			"POST",
			{
				kind: "request",
				type: "review",
				reviewer: { userId: readerId, name: "reader" },
				reason: "Review second task",
			},
			{ revision: second.revision },
		);
		const history = spyOn(MutationStore.prototype, "listHistory");
		try {
			const summary = await reader.read<{ requests: { taskId: string; stale: boolean }[] }>("reviews");
			expect(summary.requests).toHaveLength(3);
			expect(summary.requests.every((request) => !request.stale)).toBe(true);
			expect(history.mock.calls).toHaveLength(1);
			expect(history.mock.calls[0]?.[0].recordKey).toBeUndefined();
			history.mockClear();
			const raw = JSON.parse(await Bun.file(readerFile).text());
			const response = await fetch(`${base}/api/me/reviews`, { headers: { Cookie: `backlog_session=${raw.token}` } });
			expect(response.status).toBe(200);
			const mine = (await response.json()) as { projects: { requests: unknown[] }[] };
			expect(mine.projects[0]?.requests).toHaveLength(3);
			expect(history.mock.calls).toHaveLength(1);
		} finally {
			history.mockRestore();
		}
	});

	it("keeps an externally claimed acceptance pending and allows the real reviewer to respond", async () => {
		await request();
		await verify();
		const local = await core.fs.loadTask("TASK-1");
		if (!local) throw new Error("No fixture task");
		local.review = appendTaskReview(local, response, {
			author: { kind: "user", userId: readerId, name: "reader" },
			canWrite: false,
		});
		await core.fs.saveTask(local);
		const view = await reader.read<TaskReviewView>("tasks/TASK-1/reviews");
		expect(view.trustedEntryIds).not.toContain(3);
		expect((await reader.read<{ requests: unknown[] }>("reviews")).requests).toHaveLength(1);
		expect((await act(reader, "respond", response)).review?.at(-1)?.id).toBe(4);
	});

	it("applies access revocation and refuses generic edits of review records", async () => {
		await request();
		await verify();
		await expect(
			agent.write("tasks/TASK-1", "PUT", { review: [] }, { revision: (await task()).revision }),
		).rejects.toMatchObject({ status: 400 });
		await expect(
			agent.write("tasks/TASK-1", "PUT", { editArgs: 4 }, { revision: (await task()).revision }),
		).rejects.toMatchObject({ status: 400 });
		auth.removeMember("1", readerId);
		await expect(task(reader)).rejects.toMatchObject({ status: 404 });
		await expect(act(reader, "respond", response)).rejects.toMatchObject({ status: 404 });
		await expect(request()).rejects.toThrow("Reviewer");
	});

	it("rechecks cancellation ownership after an admin loses the role while retaining task-write access", async () => {
		await auth.createUser({ username: "backup-admin", password: initial, role: "admin" });
		const writer = await auth.createUser({ username: "other-writer", password: initial });
		const login = await auth.login("other-writer", initial);
		await auth.changePassword(login.token, initial, password);
		auth.setMember("1", writer.id, { tasksWrite: true });
		auth.setMember("1", adminId, { tasksWrite: true });
		const key = new AgentStore(join(root, "data")).create({
			userId: writer.id,
			name: "Other owner",
			grants: [{ projectId: "1", permissions: ADMIN_PERMISSIONS }],
		});
		const file = join(root, "writer.key");
		await writeFile(file, key.secret, { mode: 0o600 });
		const owner = await ServerClient.connect({
			serverUrl: base,
			serverProject: "1",
			agentKeyFile: file,
			allowHttpLoopback: true,
		});
		await act(owner, "request", {
			kind: "request",
			type: "review",
			reviewer: { userId: readerId, name: "reader" },
			reason: "Owned by another account",
		});
		const operationId = randomUUID();
		checkpoint = async (stage, id) => {
			if (stage === "before_intent" && id === operationId) auth.editUser(adminId, { role: "user" });
		};
		await expect(
			admin.write(
				"tasks/TASK-1/reviews/cancel",
				"POST",
				{ kind: "cancellation", requestId: 1, reason: "No longer admin" },
				{ revision: (await task(admin)).revision, operationId },
			),
		).rejects.toMatchObject({ status: 403 });
		expect((await reader.read<{ requests: unknown[] }>("reviews")).requests).toHaveLength(1);
	});

	it("rejects ambiguous CLI reviewer identities and accepts an explicit @username", async () => {
		const collision = await auth.createUser({ username: adminId, password: initial });
		auth.setMember("1", collision.id, { tasksWrite: false });
		async function run(to: string) {
			const child = Bun.spawn(
				[
					process.execPath,
					getTestCliPath(),
					"--server-url",
					base,
					"--server-project",
					"1",
					"--allow-http-loopback",
					"--agent-key-file",
					agentFile,
					"--if-match",
					(await task()).revision,
					"task",
					"review",
					"request",
					"TASK-1",
					"--type",
					"review",
					"--to",
					to,
					"--reason",
					"Choose explicitly",
					"--json",
				],
				{ cwd: root, stdout: "pipe", stderr: "pipe" },
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			return { stdout, stderr, code };
		}
		const ambiguous = await run(adminId);
		expect(ambiguous.code).not.toBe(0);
		expect(ambiguous.stderr).toContain("ambiguous");
		const selected = await run(`@${adminId}`);
		expect(selected.code, selected.stderr).toBe(0);
		expect((await task()).review?.[0]).toMatchObject({ reviewer: { userId: collision.id } });
	});

	it("does not let another agent key of the same owner cancel the request", async () => {
		await request();
		const key = new AgentStore(join(root, "data")).create({
			userId: adminId,
			name: "Other agent",
			grants: [{ projectId: "1", permissions: ADMIN_PERMISSIONS }],
		});
		const path = join(root, "other-agent.key");
		await writeFile(path, key.secret, { mode: 0o600 });
		const other = await ServerClient.connect({
			serverUrl: base,
			serverProject: "1",
			agentKeyFile: path,
			allowHttpLoopback: true,
		});
		await expect(
			act(other, "cancel", { kind: "cancellation", requestId: 1, reason: "Cancel another key's request" }),
		).rejects.toMatchObject({ status: 403 });
		await act(agent, "cancel", { kind: "cancellation", requestId: 1, reason: "Reassign" });
		expect((await reader.read<{ requests: unknown[] }>("reviews")).requests).toHaveLength(0);
	});

	it("isolates identical task IDs and history filters across projects", async () => {
		await request();
		await verify();
		const second = await ServerClient.connect({
			serverUrl: base,
			serverProject: "2",
			agentKeyFile: agentFile,
			allowHttpLoopback: true,
		});
		expect((await task(second)).review).toBeUndefined();
		const history = await agent.read<{ items: { source: string; action: string }[]; nextCursor: string | null }>(
			"history",
			{ actor: adminId, source: "agent", limit: 1, from: "2000-01-01T00:00:00Z", until: "2100-01-01T00:00:00Z" },
		);
		expect(history.items).toHaveLength(1);
		expect(history.items[0]?.action).toEndWith("/reviews/verify");
		const next = await agent.read<{ items: { action: string }[] }>("history", {
			actor: adminId,
			source: "agent",
			limit: 1,
			cursor: history.nextCursor ?? undefined,
		});
		expect(next.items[0]?.action).toEndWith("/reviews/request");
		expect(
			(await second.read<{ items: unknown[] }>("history", { actor: adminId, source: "agent" })).items,
		).toHaveLength(0);
		await expect(agent.read("history", { from: "bad" })).rejects.toMatchObject({ status: 400 });
		const beforeMove = await task();
		await agent.write("tasks/move", "POST", {
			taskIds: ["TASK-1"],
			targetStatus: "In Progress",
			expectedRevisions: { [beforeMove.recordKey]: beforeMove.revision },
		});
		const updates = await agent.read<{ items: { action: string }[] }>("history", { action: "update" });
		expect(updates.items[0]?.action).toEndWith("/tasks/move");
		expect(historyActionLabel("POST /api/tasks/move", "browser")).toBe("Updated");
		expect(historyActionLabel("POST /api/tasks/cleanup", "browser")).toBe("Archived");
	});

	it("uses the same workflow through the connected agent and human CLI", async () => {
		async function run(fileOption: string, file: string, args: string[]) {
			const child = Bun.spawn(
				[
					process.execPath,
					getTestCliPath(),
					"--server-url",
					base,
					"--server-project",
					"1",
					"--allow-http-loopback",
					fileOption,
					file,
					...args,
				],
				{ cwd: root, stdout: "pipe", stderr: "pipe" },
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(code, stderr).toBe(0);
			const result = JSON.parse(stdout);
			expect(result.schemaVersion).toBe(1);
			return result;
		}
		const list = await run("--session-file", readerFile, ["task", "--json", "review", "list", "TASK-1"]);
		expect(list).toMatchObject({ schemaVersion: 1, kind: "task-review", taskId: "TASK-1" });
		await run("--agent-key-file", agentFile, [
			"--if-match",
			(await task()).revision,
			"task",
			"--json",
			"review",
			"request",
			"TASK-1",
			"--type",
			"acceptance",
			"--to",
			"reader",
			"--reason",
			"Please accept",
		]);
		await run("--agent-key-file", agentFile, [
			"--if-match",
			(await task()).revision,
			"task",
			"--json",
			"review",
			"verify",
			"TASK-1",
			"--result",
			"passed",
			"--notes",
			"Passed",
			"--evidence",
			"report",
		]);
		await run("--session-file", readerFile, [
			"--if-match",
			(await task()).revision,
			"task",
			"--json",
			"review",
			"respond",
			"TASK-1",
			"--request",
			"1",
			"--outcome",
			"approved",
			"--notes",
			"Accepted",
		]);
		expect((await run("--session-file", readerFile, ["reviews", "list", "--json"])).requests).toHaveLength(0);
		expect(
			(
				await run("--session-file", readerFile, [
					"history",
					"list",
					"--actor",
					readerId,
					"--source",
					"server-cli",
					"--action",
					"review-response",
					"--json",
				])
			).items,
		).toHaveLength(1);
		const local = Bun.spawn(
			[
				process.execPath,
				getTestCliPath(),
				"server",
				"--data-dir",
				join(root, "data"),
				"history",
				"list",
				"--project",
				"1",
				"--actor",
				readerId,
				"--source",
				"server-cli",
				"--action",
				"review-response",
				"--json",
			],
			{ cwd: root, stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, stderr, code] = await Promise.all([
			new Response(local.stdout).text(),
			new Response(local.stderr).text(),
			local.exited,
		]);
		expect(code, stderr).toBe(0);
		expect(JSON.parse(stdout).items).toHaveLength(1);
	});
});
