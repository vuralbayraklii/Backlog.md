import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, readFile, symlink, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Core } from "../core/backlog.ts";
import type { DuplicateRepairPlan, DuplicateRepairResult } from "../core/duplicate-task-repair.ts";
import { AuthStore } from "../server/auth-store.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import type { MutationCheckpoint } from "../server/mutations.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("central prepared duplicate repair", () => {
	let root: string;
	let projectRoot: string;
	let data: string;
	let base: string;
	let cookie: string;
	let csrf: string;
	let server: CentralServer;
	let sharedSource: string;
	let checkpoint: MutationCheckpoint | undefined;
	let release: (() => void) | undefined;

	beforeEach(async () => {
		root = await createTestDirOutsideRepository("backlog-central-repair-");
		data = join(root, "server");
		projectRoot = join(root, "project");
		const core = new Core(projectRoot);
		await initializeFilesystemTestProject(core, "Prepared repair");
		for (const title of ["Alpha", "Beta"]) {
			const path = await core.fs.saveTask({
				id: "TASK-1",
				title,
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-10-22",
				description: `${title} content`,
			});
			if (title === "Beta") {
				sharedSource = join(projectRoot, "original-beta.md");
				await Bun.write(sharedSource, await readFile(path));
				await unlink(path);
				await symlink(sharedSource, path);
			}
		}
		await new ProjectStore(data).register("Prepared repair", projectRoot);
		const auth = new AuthStore(data);
		await auth.initializeAdmin("admin", "repair initial password");
		const logged = await auth.login("admin", "repair initial password");
		const changed = await auth.changePassword(logged.token, "repair initial password", "repair replacement password");
		cookie = `backlog_session=${changed.token}`;
		csrf = changed.session.csrfToken;
		checkpoint = undefined;
		release = undefined;
		server = new CentralServer(data, { mutationCheckpoint: (...args) => checkpoint?.(...args) });
		const port = await findNextAvailablePort(31000);
		if (!port) throw new Error("No test port available");
		base = `http://127.0.0.1:${port}`;
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
	});
	afterEach(async () => {
		release?.();
		await server?.stop();
		await safeCleanup(root);
	});
	const request = (path: string, init: RequestInit = {}) =>
		fetch(`${base}${path}`, {
			...init,
			headers: { Origin: base, Cookie: cookie, "X-CSRF-Token": csrf, ...init.headers },
		});
	async function preview(): Promise<DuplicateRepairPlan> {
		const response = await request("/api/projects/1/tasks/duplicates");
		expect(response.status, await response.clone().text()).toBe(200);
		const plan = (await response.json()) as DuplicateRepairPlan;
		expect(plan.repairable).toBe(true);
		return plan;
	}
	const repair = (fingerprint: string, key: string) =>
		request("/api/projects/1/tasks/duplicates", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Idempotency-Key": key },
			body: JSON.stringify({ fingerprint }),
		});

	test("persists the complete plan before writing, preserves identity, and replays one repair", async () => {
		const plan = await preview();
		expect(plan.changes).toHaveLength(1);
		const change = plan.changes[0];
		if (!change) throw new Error("Missing repair change");
		const source = resolve(projectRoot, change.sourcePath);
		const target = resolve(projectRoot, change.targetPath);
		const original = await Bun.file(sharedSource).text();
		const store = new MutationStore(data);
		const recordKey = store.findRecordByPath("1", source)?.recordKey;
		expect(recordKey).toBeTruthy();
		const key = crypto.randomUUID();
		let entered = () => {};
		const arrived = new Promise<void>((resolveEntered) => {
			entered = resolveEntered;
		});
		const gate = new Promise<void>((resolveGate) => {
			release = resolveGate;
		});
		let absentBeforeIntent = false;
		checkpoint = async (stage, operationId) => {
			if (operationId !== key) return;
			if (stage === "before_intent")
				absentBeforeIntent = store.loadOperation(key, { actor: { kind: "unknown" }, admin: true }) === null;
			if (stage === "after_intent") {
				entered();
				await gate;
			}
		};
		const writing = repair(plan.fingerprint, key);
		await Promise.race([
			arrived,
			writing.then(async (response) => {
				throw new Error(`Repair returned early: ${response.status} ${await response.clone().text()}`);
			}),
		]);
		expect(absentBeforeIntent).toBe(true);
		const pending = store.listPending().find((operation) => operation.operationId === key);
		expect(pending?.files).toHaveLength(2);
		expect(pending?.files.find((file) => file.path === target)?.before).toBeNull();
		expect(pending?.files.find((file) => file.path === target)?.after?.type).toBe("file");
		expect(pending?.files.find((file) => file.path === source)?.before?.type).toBe("symlink");
		expect(pending?.files.find((file) => file.path === source)?.after).toBeNull();
		expect(pending?.recordUpdates[0]?.recordKey).toBe(recordKey);
		expect((await lstat(source)).isSymbolicLink()).toBe(true);
		expect(await Bun.file(target).exists()).toBe(false);
		expect(await Bun.file(sharedSource).text()).toBe(original);
		expect(await Array.fromAsync(new Bun.Glob("**/*backlog-doctor*").scan({ cwd: projectRoot }))).toEqual([]);
		release?.();
		const response = await writing;
		expect(response.status, await response.clone().text()).toBe(200);
		const result = (await response.json()) as DuplicateRepairResult;
		expect(result.remainingGroups).toEqual([]);
		expect((await lstat(target)).isFile()).toBe(true);
		expect(await Bun.file(source).exists()).toBe(false);
		expect(await Bun.file(sharedSource).text()).toBe(original);
		expect(store.findRecordByPath("1", target)?.recordKey).toBe(recordKey);
		const replay = await repair(plan.fingerprint, key);
		expect(replay.status).toBe(200);
		expect(await replay.json()).toEqual(result);
		expect(
			store
				.listHistory({ scope: { kind: "project", projectId: "1" } })
				.items.filter((event) => event.operationId === key),
		).toHaveLength(1);
	});

	test("rejects a stale preview before intent without leaving staged or backup files", async () => {
		const plan = await preview();
		const content = `${await Bun.file(sharedSource).text()}\nExternal change\n`;
		await Bun.write(sharedSource, content);
		const key = crypto.randomUUID();
		const response = await repair(plan.fingerprint, key);
		expect(response.status).toBe(409);
		expect((await response.json()).code).toBe("REVISION_CONFLICT");
		expect(await Bun.file(sharedSource).text()).toBe(content);
		expect(new MutationStore(data).loadOperation(key, { actor: { kind: "unknown" }, admin: true })).toBeNull();
		expect(await Array.fromAsync(new Bun.Glob("**/*backlog-doctor*").scan({ cwd: projectRoot }))).toEqual([]);
	});
});
