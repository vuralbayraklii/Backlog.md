import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { snapshotFileEntry } from "../file-system/prepared-change.ts";
import { type MutationIntent, MutationStore } from "../server/mutation-store.ts";
import { recordRevision } from "../server/mutations.ts";
import { ProjectStore } from "../server/project-store.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "  CLI audit password with spaces  ";

describe("central history and reviewed recovery CLI", () => {
	let testDir: string;
	let dataDir: string;
	const cli = getTestCliPath();

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-history-recovery-cli-");
		dataDir = join(testDir, "data");
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	function args(...command: string[]): string[] {
		return ["server", "--data-dir", dataDir, ...command];
	}

	async function run(command: string[], input?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const child = Bun.spawn([process.execPath, cli, ...command], {
			cwd: testDir,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		if (input !== undefined) child.stdin.write(input);
		child.stdin.end();
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, exitCode };
	}

	it("audits CLI password and project writes with unknown actor and no stored secret inputs", async () => {
		const initialized = await run(args("user", "init-admin", "admin", "--password-stdin", "--json"), `${PASSWORD}\n`);
		expect(initialized.exitCode).toBe(0);
		const admin = JSON.parse(initialized.stdout).user as { id: string };
		const reset = await run(args("user", "reset-password", admin.id, "--password-stdin", "--json"), `${PASSWORD}\n`);
		expect(reset.exitCode).toBe(0);
		const projectRoot = join(testDir, "project");
		await initializeFilesystemTestProject(new Core(projectRoot), "CLI project");
		const registered = await run(args("project", "register", projectRoot, "--name", "CLI project", "--json"));
		expect(registered.exitCode).toBe(0);
		const adminHistory = await run(args("history", "list", "--scope", "admin", "--json"));
		expect(adminHistory.exitCode).toBe(0);
		const adminPage = JSON.parse(adminHistory.stdout);
		expect(adminPage).toMatchObject({ schemaVersion: 1, kind: "server-history-page" });
		expect(adminPage.items.map((event: { action: string }) => event.action)).toEqual([
			"user.reset_password",
			"user.init_admin",
		]);
		for (const event of adminPage.items) {
			expect(event.actor).toEqual({ kind: "unknown" });
			expect(event.source).toBe("server-cli");
		}
		const registration = await run(args("history", "list", "--scope", "registration", "--json"));
		expect(JSON.parse(registration.stdout).items).toMatchObject([
			{ action: "project.register", actor: { kind: "unknown" }, source: "server-cli" },
		]);
		const firstId = adminPage.items[0].operationId as string;
		const readableHistory = await run(args("history", "list", "--scope", "admin"));
		expect(readableHistory.stdout).toContain("Europe/Istanbul");
		const operation = await run(args("operation", "view", firstId, "--json"));
		expect(operation.exitCode).toBe(0);
		expect(JSON.parse(operation.stdout).operation).toMatchObject({ operationId: firstId, state: "completed" });
		const readableOperation = await run(args("operation", "view", firstId));
		expect(readableOperation.stdout).toContain("Europe/Istanbul");
		const raw = new Database(join(dataDir, "server.sqlite"), { readonly: true });
		try {
			const rows = raw
				.query<{ request_hash: string; planned_result_json: string; planned_event_json: string | null }, []>(
					"SELECT request_hash,planned_result_json,planned_event_json FROM operations ORDER BY created_at",
				)
				.all();
			expect(rows).toHaveLength(3);
			for (const row of rows) {
				expect(row.request_hash).toMatch(/^[0-9a-f]{64}$/);
				expect(row.planned_result_json).not.toContain(PASSWORD);
				expect(row.planned_result_json).not.toContain("password_hash");
				expect(row.planned_event_json ?? "").not.toContain(PASSWORD);
				expect(row.planned_event_json ?? "").not.toContain("password_hash");
			}
		} finally {
			raw.close();
		}
	});

	it("lists, fingerprints, and resolves a valid unexpected file state as a separate event", async () => {
		const projectRoot = join(testDir, "project");
		const core = new Core(projectRoot);
		await initializeFilesystemTestProject(core, "Recovery CLI project");
		const path = await core.fs.saveTask({
			id: "TASK-1",
			title: "Original",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
			rawContent: "Body",
		});
		const project = await new ProjectStore(dataDir).register("Recovery CLI project", projectRoot);
		const store = new MutationStore(dataDir);
		const recordKey = randomUUID();
		const before = await snapshotFileEntry(path);
		if (before?.type !== "file") throw new Error("Fixture requires a task file.");
		const original = Buffer.from(before.bytes).toString("utf8");
		const planned = original.replace("Original", "Planned");
		const observed = original.replace("Original", "Observed");
		const plannedBytes = new TextEncoder().encode(planned);
		const beforeRevision = recordRevision(recordKey, path, "active", before.bytes);
		const afterRevision = recordRevision(recordKey, path, "active", plannedBytes);
		store.upsertRecord({
			recordKey,
			projectId: project.id,
			kind: "task",
			visibleId: "TASK-1",
			path,
			lifecycle: "active",
			revision: beforeRevision,
		});
		const operationId = randomUUID();
		const scope = { kind: "project" as const, projectId: project.id };
		const actor = { kind: "user" as const, userId: "alice" };
		const intent: MutationIntent = {
			operationId,
			scope,
			actor,
			source: "browser",
			requestHash: createHash("sha256").update(operationId).digest("hex"),
			action: "task.edit",
			files: [
				{
					path,
					before,
					after: { type: "file", bytes: plannedBytes },
					record: { recordKey, kind: "task", visibleId: "TASK-1", lifecycle: "active", recordPath: path },
				},
			],
			recordUpdates: [
				{
					recordKey,
					projectId: project.id,
					kind: "task",
					visibleId: "TASK-1",
					path,
					lifecycle: "active",
					revision: afterRevision,
				},
			],
			plannedResult: { status: 200, body: { id: "TASK-1" } },
			plannedEvent: {
				eventId: operationId,
				operationId,
				scope,
				actor,
				source: "browser",
				action: "task.edit",
				occurredAt: new Date().toISOString(),
				changes: [
					{
						recordKey,
						kind: "task",
						visibleId: "TASK-1",
						beforeRevision,
						afterRevision,
						before: original,
						after: planned,
					},
				],
			},
		};
		store.begin(intent);
		await Bun.write(path, observed);
		store.requireRecovery(operationId);
		const listed = await run(args("recovery", "list", "--json"));
		expect(listed.exitCode).toBe(0);
		expect(JSON.parse(listed.stdout)).toMatchObject({
			schemaVersion: 1,
			kind: "server-recovery-list",
			items: [{ operationId }],
		});
		const viewed = await run(args("recovery", "view", operationId, "--json"));
		expect(viewed.exitCode).toBe(0);
		const report = JSON.parse(viewed.stdout).report as { fingerprint: string; classification: string };
		expect(report.classification).toBe("mixed");
		expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(viewed.stdout).not.toContain("Observed");
		const readableRecovery = await run(args("recovery", "view", operationId));
		expect(readableRecovery.stdout).toContain("Europe/Istanbul");
		const missingFlag = await run(
			args("recovery", "resolve", operationId, "--expected-fingerprint", report.fingerprint),
		);
		expect(missingFlag.exitCode).toBe(1);
		const stale = await run(
			args("recovery", "resolve", operationId, "--accept-observed", "--expected-fingerprint", "0".repeat(64)),
		);
		expect(stale.exitCode).toBe(1);
		const resolved = await run(
			args(
				"recovery",
				"resolve",
				operationId,
				"--accept-observed",
				"--expected-fingerprint",
				report.fingerprint,
				"--json",
			),
		);
		expect(resolved.exitCode).toBe(0);
		const recovery = JSON.parse(resolved.stdout);
		expect(recovery).toMatchObject({
			schemaVersion: 1,
			kind: "server-recovery-resolution",
			operation: { state: "completed", source: "recovery", actor: { kind: "unknown" } },
		});
		expect((await run(args("recovery", "list", "--json"))).stdout).toContain('"items": []');
		expect(JSON.parse((await run(args("operation", "view", operationId, "--json"))).stdout).operation).toMatchObject({
			state: "recovery_required",
			resolvedBy: recovery.operation.operationId,
		});
		const history = JSON.parse((await run(args("history", "list", "--project", project.id, "--json"))).stdout);
		expect(history.items.map((event: { action: string }) => event.action)).toEqual(["accept_observed"]);
		expect(await Bun.file(path).text()).toBe(observed);
	});
});
