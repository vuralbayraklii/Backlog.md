import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import type { OperationState } from "../server/mutation-types.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "real crash acceptance password";
const CHILD = `
const [centralPath, dataDir, portText, base, readyPath, markerPath, targetStage, targetIndex, targetOperationId] = Bun.argv.slice(2);
const { CentralServer } = await import(centralPath);
const server = new CentralServer(dataDir, targetStage === "none" ? undefined : {
  mutationCheckpoint: async (stage, operationId, fileIndex) => {
    if (targetOperationId && operationId !== targetOperationId) return;
    if (stage !== targetStage || (stage === "after_file" && String(fileIndex) !== targetIndex)) return;
    await Bun.write(markerPath, JSON.stringify({ stage, operationId, fileIndex }));
    await new Promise(() => {});
  },
});
await server.start(Number(portText), false, { publicUrl: base, allowHttpLoopback: true });
await Bun.write(readyPath, "ready");
process.once("SIGTERM", async () => { await server.stop(); process.exit(0); });
await new Promise(() => {});
`;

type CrashStage = {
	stage: string;
	fileIndex?: number;
	physical: "before" | "mixed" | "after";
	state: OperationState | null;
	events: number;
};
const scenarios: CrashStage[] = [
	{ stage: "before_intent", physical: "before", state: null, events: 0 },
	{ stage: "after_intent", physical: "before", state: "not_applied", events: 0 },
	{ stage: "after_file", fileIndex: 0, physical: "mixed", state: "recovery_required", events: 0 },
	{ stage: "after_file", fileIndex: 1, physical: "after", state: "completed", events: 1 },
	{ stage: "before_finalize", physical: "after", state: "completed", events: 1 },
	{ stage: "after_finalize", physical: "after", state: "completed", events: 1 },
];

describe("real process interruption of a central two-file archive", () => {
	let testDir: string;
	let dataDir: string;
	let sourcePath: string;
	let archivePath: string;
	let base: string;
	let port: number;
	let cookie: string;
	let csrf: string;
	let adminId: string;
	let childPath: string;

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-real-crash-");
		dataDir = join(testDir, "data");
		childPath = join(testDir, "child-server.ts");
		await Bun.write(childPath, CHILD);
		for (const [name, title] of [
			["Alpha", "Archive me"],
			["Beta", "Healthy project"],
		] as const) {
			const root = join(testDir, name);
			const core = new Core(root);
			await initializeFilesystemTestProject(core, name);
			const path = await core.fs.saveTask({
				id: "TASK-1",
				title,
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-10-22",
				rawContent: `${name} body`,
			});
			await new ProjectStore(dataDir).register(name, root);
			if (name === "Alpha") {
				sourcePath = path;
				archivePath = join(core.fs.archiveTasksDir, basename(path));
			}
		}
		const auth = new AuthStore(dataDir);
		const admin = await auth.initializeAdmin("admin", PASSWORD);
		adminId = admin.id;
		const login = await auth.login("admin", PASSWORD);
		const changed = await auth.changePassword(login.token, PASSWORD, `${PASSWORD} changed`);
		cookie = `backlog_session=${changed.token}`;
		csrf = changed.session.csrfToken;
		const chosen = await findNextAvailablePort(40000);
		if (!chosen) throw new Error("No test port available.");
		port = chosen;
		base = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	async function marker(path: string): Promise<string> {
		const until = Date.now() + 5000;
		while (Date.now() < until) {
			if (await Bun.file(path).exists()) return Bun.file(path).text();
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error(`Child server did not reach marker ${basename(path)}.`);
	}

	function spawnServer(stage: string, fileIndex?: number, operationId?: string) {
		const readyPath = join(testDir, `ready-${randomUUID()}`);
		const checkpointPath = join(testDir, `checkpoint-${randomUUID()}`);
		const child = Bun.spawn(
			[
				process.execPath,
				childPath,
				join(import.meta.dir, "../server/central.ts"),
				dataDir,
				String(port),
				base,
				readyPath,
				checkpointPath,
				stage,
				String(fileIndex ?? ""),
				operationId ?? "",
			],
			{ cwd: testDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		return { child, readyPath, checkpointPath };
	}

	async function request(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set("Cookie", cookie);
		headers.set("Origin", base);
		headers.set("X-CSRF-Token", csrf);
		return fetch(`${base}${path}`, { ...init, headers });
	}

	async function recoveryCli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const child = Bun.spawn(
			[process.execPath, join(import.meta.dir, "../cli.ts"), "server", "--data-dir", dataDir, "recovery", ...args],
			{ cwd: testDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, exitCode };
	}

	function operationEvidence(operationId: string): { files: Array<{ path: string }>; events: number } {
		const database = new Database(join(dataDir, "server.sqlite"), { readonly: true });
		try {
			return {
				files: database
					.query<{ path: string }, [string]>("SELECT path FROM operation_files WHERE operation_id=? ORDER BY ordinal")
					.all(operationId),
				events:
					database
						.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM history_events WHERE operation_id=?")
						.get(operationId)?.count ?? 0,
			};
		} finally {
			database.close();
		}
	}

	it("recovers an assigned read-only human acceptance after SIGKILL without a second event", async () => {
		const auth = new AuthStore(dataDir);
		const reviewer = await auth.createUser({ username: "reviewer", password: PASSWORD });
		auth.setMember("1", reviewer.id, { tasksWrite: false });
		const login = await auth.login("reviewer", PASSWORD);
		const reader = await auth.changePassword(login.token, PASSWORD, `${PASSWORD} reviewer`);
		const operationId = randomUUID();
		const original = spawnServer("before_finalize", undefined, operationId);
		let replacement: ReturnType<typeof spawnServer> | null = null;
		try {
			await marker(original.readyPath);
			for (const [verb, body] of [
				[
					"request",
					{
						kind: "request",
						type: "acceptance",
						reviewer: { userId: reviewer.id, name: "reviewer" },
						reason: "Accept this work",
					},
				],
				["verify", { kind: "verification", result: "passed", notes: "Verified", evidence: ["test report"] }],
			] as const) {
				const opened = (await (await request("/api/projects/1/tasks/TASK-1")).json()) as { revision: string };
				const result = await request(`/api/projects/1/tasks/TASK-1/reviews/${verb}`, {
					method: "POST",
					headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), "If-Match": opened.revision },
					body: JSON.stringify(body),
				});
				expect(result.status, await result.clone().text()).toBe(200);
			}
			cookie = `backlog_session=${reader.token}`;
			csrf = reader.session.csrfToken;
			const opened = (await (await request("/api/projects/1/tasks/TASK-1")).json()) as { revision: string };
			const init = {
				method: "POST",
				headers: { "Content-Type": "application/json", "Idempotency-Key": operationId, "If-Match": opened.revision },
				body: JSON.stringify({ kind: "response", requestId: 1, outcome: "approved", notes: "Human accepted" }),
			};
			const pending = request("/api/projects/1/tasks/TASK-1/reviews/respond", init).catch(() => null);
			expect(JSON.parse(await marker(original.checkpointPath)).operationId).toBe(operationId);
			original.child.kill("SIGKILL");
			await original.child.exited;
			await pending;
			replacement = spawnServer("none");
			await marker(replacement.readyPath);
			const replay = await request("/api/projects/1/tasks/TASK-1/reviews/respond", init);
			expect(replay.status, await replay.clone().text()).toBe(200);
			expect(operationEvidence(operationId).events).toBe(1);
			const view = (await (await request("/api/projects/1/tasks/TASK-1/reviews")).json()) as {
				trustedEntryIds: number[];
			};
			expect(view.trustedEntryIds).toContain(3);
			const summary = (await (await request("/api/projects/1/reviews")).json()) as { requests: unknown[] };
			expect(summary.requests).toHaveLength(0);
			expect(
				new MutationStore(dataDir).listHistory({ scope: { kind: "project", projectId: "1" }, source: "external" })
					.items,
			).toHaveLength(0);
		} finally {
			original.child.kill("SIGKILL");
			await original.child.exited;
			if (replacement) {
				replacement.child.kill("SIGTERM");
				await replacement.child.exited;
			}
		}
	}, 15000);

	for (const scenario of scenarios) {
		it(
			`recovers ${scenario.stage}${scenario.fileIndex === undefined ? "" : `(${scenario.fileIndex})`} after SIGKILL`,
			async () => {
				const original = spawnServer(scenario.stage, scenario.fileIndex);
				let replacement: ReturnType<typeof spawnServer> | null = null;
				try {
					await marker(original.readyPath);
					const openedResponse = await request("/api/projects/1/tasks/TASK-1");
					expect(openedResponse.status).toBe(200);
					const opened = (await openedResponse.json()) as { revision: string };
					const operationId = randomUUID();
					const pendingResponse = request("/api/projects/1/tasks/TASK-1/archive", {
						method: "POST",
						headers: { "Idempotency-Key": operationId, "If-Match": opened.revision },
					}).catch(() => null);
					const checkpoint = JSON.parse(await marker(original.checkpointPath)) as {
						stage: string;
						operationId: string;
						fileIndex?: number;
					};
					expect(checkpoint).toMatchObject({ stage: scenario.stage, operationId });
					if (scenario.fileIndex !== undefined) expect(checkpoint.fileIndex).toBe(scenario.fileIndex);
					const killedAt = Date.now();
					original.child.kill("SIGKILL");
					await original.child.exited;
					await pendingResponse;
					const sourceExists = await Bun.file(sourcePath).exists();
					const archiveExists = await Bun.file(archivePath).exists();
					expect([sourceExists, archiveExists]).toEqual(
						scenario.physical === "before"
							? [true, false]
							: scenario.physical === "mixed"
								? [true, true]
								: [false, true],
					);
					replacement = spawnServer("none");
					await marker(replacement.readyPath);
					const store = new MutationStore(dataDir);
					const view = store.loadOperation(operationId, { actor: { kind: "user", userId: adminId } });
					expect(view?.state ?? null).toBe(scenario.state);
					const evidence = operationEvidence(operationId);
					expect(evidence.events).toBe(scenario.events);
					if (scenario.state !== null) {
						expect(evidence.files.map((file) => file.path)).toEqual([archivePath, sourcePath]);
					}
					const project = (await (await request("/api/projects/1")).json()) as { writeState: string };
					expect(project.writeState).toBe(scenario.physical === "mixed" ? "recovery_required" : "ready");
					const healthy = await request("/api/projects/2/tasks/TASK-1");
					expect(healthy.status).toBe(200);
					if (scenario.physical === "mixed") {
						const other = (await healthy.json()) as { revision: string };
						const healthyWrite = await request("/api/projects/2/tasks/TASK-1/archive", {
							method: "POST",
							headers: { "Idempotency-Key": randomUUID(), "If-Match": other.revision },
						});
						expect(healthyWrite.status).toBe(200);
						expect(
							store
								.listHistory({ scope: { kind: "project", projectId: "2" } })
								.items.filter((event) => event.action !== "initial_inventory"),
						).toHaveLength(1);
						const ambiguous = await recoveryCli("view", operationId, "--json");
						expect(ambiguous.exitCode).toBe(0);
						const ambiguousFingerprint = JSON.parse(ambiguous.stdout).report.fingerprint as string;
						const refused = await recoveryCli(
							"resolve",
							operationId,
							"--accept-observed",
							"--expected-fingerprint",
							ambiguousFingerprint,
						);
						expect(refused.exitCode).toBe(1);
						await unlink(archivePath);
						const reviewed = await recoveryCli("view", operationId, "--json");
						expect(reviewed.exitCode).toBe(0);
						const fingerprint = JSON.parse(reviewed.stdout).report.fingerprint as string;
						const accepted = await recoveryCli(
							"resolve",
							operationId,
							"--accept-observed",
							"--expected-fingerprint",
							fingerprint,
							"--json",
						);
						expect(accepted.exitCode, accepted.stderr).toBe(0);
						const resolutionId = JSON.parse(accepted.stdout).operation.operationId as string;
						expect(store.loadOperation(operationId, { actor: { kind: "user", userId: adminId } })).toMatchObject({
							state: "recovery_required",
							resolvedBy: resolutionId,
						});
						expect(((await (await request("/api/projects/1")).json()) as { writeState: string }).writeState).toBe(
							"ready",
						);
						const oldReplay = await request("/api/projects/1/tasks/TASK-1/archive", {
							method: "POST",
							headers: { "Idempotency-Key": operationId, "If-Match": opened.revision },
						});
						expect(oldReplay.status).toBe(409);
						expect(await oldReplay.json()).toMatchObject({ code: "OPERATION_RESOLVED", resolvedBy: resolutionId });
						const refreshed = await request("/api/projects/1/tasks/TASK-1");
						expect(refreshed.status).toBe(200);
						const freshTask = (await refreshed.json()) as { revision: string };
						let freshWrite = await request("/api/projects/1/tasks/TASK-1/archive", {
							method: "POST",
							headers: { "Idempotency-Key": randomUUID(), "If-Match": freshTask.revision },
						});
						if (freshWrite.status === 409) {
							expect((await freshWrite.clone().json()).code).toBe("WRITE_LOCKED");
							const lockWait = Math.max(0, killedAt + 12_000 - Date.now());
							if (lockWait) await new Promise((resolve) => setTimeout(resolve, lockWait));
							freshWrite = await request("/api/projects/1/tasks/TASK-1/archive", {
								method: "POST",
								headers: { "Idempotency-Key": randomUUID(), "If-Match": freshTask.revision },
							});
						}
						if (freshWrite.status !== 200) {
							replacement.child.kill("SIGKILL");
							await replacement.child.exited;
							throw new Error(
								`Live write returned ${freshWrite.status}: ${await freshWrite.clone().text()}\n${await new Response(replacement.child.stderr).text()}`,
							);
						}
						expect(freshWrite.status, await freshWrite.clone().text()).toBe(200);
						const alphaHistory = store.listHistory({ scope: { kind: "project", projectId: "1" } }).items;
						expect(alphaHistory.filter((event) => event.action === "accept_observed")).toHaveLength(1);
						expect(alphaHistory.filter((event) => event.operationId === operationId)).toHaveLength(0);
					} else if (scenario.state === "completed") {
						const replay = await request("/api/projects/1/tasks/TASK-1/archive", {
							method: "POST",
							headers: { "Idempotency-Key": operationId, "If-Match": opened.revision },
						});
						expect(replay.status).toBe(200);
						expect(operationEvidence(operationId).events).toBe(1);
						expect(
							store
								.listHistory({ scope: { kind: "project", projectId: "1" } })
								.items.filter((event) => event.source === "external"),
						).toHaveLength(0);
					}
				} finally {
					original.child.kill("SIGKILL");
					await original.child.exited;
					if (replacement) {
						replacement.child.kill("SIGTERM");
						await replacement.child.exited;
					}
				}
			},
			scenario.physical === "mixed" ? 20_000 : 10_000,
		);
	}
});
