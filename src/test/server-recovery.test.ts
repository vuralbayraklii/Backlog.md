import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { type PreparedFileChange, snapshotFileEntry } from "../file-system/prepared-change.ts";
import { ServerDatabase } from "../server/database.ts";
import { type MutationIntent, MutationStore, type StoredRecord } from "../server/mutation-store.ts";
import { recordRevision } from "../server/mutations.ts";
import { listRecovery, resolveRecovery, viewRecovery } from "../server/recovery.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("reviewed central recovery", () => {
	let testDir: string;
	let dataDir: string;
	let projectRoot: string;
	let store: MutationStore;
	let operationId: string;
	let paths: string[];
	let beforeTexts: string[];
	let afterTexts: string[];

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-recovery-");
		dataDir = join(testDir, "data");
		projectRoot = join(testDir, "project");
		const core = new Core(projectRoot);
		await initializeFilesystemTestProject(core, "Recovery project");
		const database = new ServerDatabase(dataDir);
		database.write((db) =>
			db
				.query("INSERT INTO projects(id,name,root_path,created_at) VALUES(7,'Recovery project',?,?)")
				.run(projectRoot, new Date().toISOString()),
		);
		store = new MutationStore(dataDir);
		operationId = randomUUID();
		paths = [];
		beforeTexts = [];
		afterTexts = [];
		const files: PreparedFileChange[] = [];
		const recordUpdates: StoredRecord[] = [];
		const changes: NonNullable<MutationIntent["plannedEvent"]>["changes"] = [];
		for (const index of [1, 2]) {
			const id = `TASK-${index}`;
			const path = await core.fs.saveTask({
				id,
				title: `Original ${index}`,
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-10-22",
				rawContent: `Body ${index}`,
			});
			const before = await snapshotFileEntry(path);
			if (before?.type !== "file") throw new Error("Fixture needs task files.");
			const prior = Buffer.from(before.bytes).toString("utf8");
			const after = prior.replace(`Original ${index}`, `Revised ${index}`);
			if (after === prior) throw new Error("Fixture title could not be changed.");
			const recordKey = randomUUID();
			const beforeRevision = recordRevision(recordKey, path, "active", before.bytes);
			const afterBytes = new TextEncoder().encode(after);
			const afterRevision = recordRevision(recordKey, path, "active", afterBytes);
			store.upsertRecord({
				recordKey,
				projectId: "7",
				kind: "task",
				visibleId: id,
				path,
				lifecycle: "active",
				revision: beforeRevision,
			});
			files.push({
				path,
				before,
				after: { type: "file", bytes: afterBytes },
				record: { recordKey, kind: "task", visibleId: id, lifecycle: "active", recordPath: path },
			});
			recordUpdates.push({
				recordKey,
				projectId: "7",
				kind: "task",
				visibleId: id,
				path,
				lifecycle: "active",
				revision: afterRevision,
			});
			changes.push({ recordKey, kind: "task", visibleId: id, beforeRevision, afterRevision, before: prior, after });
			paths.push(path);
			beforeTexts.push(prior);
			afterTexts.push(after);
		}
		const scope = { kind: "project" as const, projectId: "7" };
		const actor = { kind: "user" as const, userId: "alice" };
		const intent: MutationIntent = {
			operationId,
			scope,
			actor,
			source: "browser",
			requestHash: createHash("sha256").update(operationId).digest("hex"),
			action: "tasks.bulk_edit",
			files,
			recordUpdates,
			plannedResult: { status: 200, body: { success: true } },
			plannedEvent: {
				eventId: operationId,
				operationId,
				scope,
				actor,
				source: "browser",
				action: "tasks.bulk_edit",
				occurredAt: new Date().toISOString(),
				changes,
			},
		};
		store.begin(intent);
		await Bun.write(paths[0] ?? "", afterTexts[0] ?? "");
		store.requireRecovery(operationId);
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("reports a mixed state without raw bytes and requires the exact reviewed fingerprint", async () => {
		const reports = await listRecovery(dataDir);
		expect(reports).toHaveLength(1);
		const report = reports[0];
		if (!report?.fingerprint) throw new Error("Fixture recovery fingerprint missing.");
		expect(report.classification).toBe("mixed");
		expect(report.files).toHaveLength(2);
		expect(JSON.stringify(report)).not.toContain("Body 1");
		expect(JSON.stringify(report)).not.toContain("Revised 1");
		await expect(resolveRecovery(dataDir, operationId, "0".repeat(64))).rejects.toThrow("fingerprint changed");
		expect(store.listRecoveryRequired("7")).toHaveLength(1);
		const accepted = await resolveRecovery(dataDir, operationId, report.fingerprint);
		expect(accepted.operation.state).toBe("completed");
		expect(accepted.operation.scope).toEqual({ kind: "project", projectId: "7" });
		expect(store.listRecoveryRequired("7")).toEqual([]);
		expect(store.loadOperation(operationId, { actor: { kind: "user", userId: "alice" } })?.state).toBe(
			"recovery_required",
		);
		const history = store.listHistory({ scope: { kind: "project", projectId: "7" } }).items;
		expect(history.map((event) => event.action)).toEqual(["accept_observed"]);
		expect(history[0]?.changes.map((change) => change.visibleId)).toEqual(["TASK-1"]);
		expect(await Bun.file(paths[0] ?? "").text()).toBe(afterTexts[0] ?? "");
		expect(await Bun.file(paths[1] ?? "").text()).toBe(beforeTexts[1] ?? "");
	});

	it("rejects an observation that changed after review or contains invalid Markdown", async () => {
		const report = await viewRecovery(dataDir, operationId);
		if (!report.fingerprint) throw new Error("Fixture recovery fingerprint missing.");
		await Bun.write(paths[1] ?? "", afterTexts[1] ?? "");
		await expect(resolveRecovery(dataDir, operationId, report.fingerprint)).rejects.toThrow("fingerprint changed");
		await Bun.write(paths[1] ?? "", "---\nid: BAD-ID\ntitle: Broken\n---\n");
		const invalid = await viewRecovery(dataDir, operationId);
		if (!invalid.fingerprint) throw new Error("Invalid Markdown remains readable for the physical report.");
		await expect(resolveRecovery(dataDir, operationId, invalid.fingerprint)).rejects.toThrow(
			"unreadable, invalid, or ambiguous",
		);
		expect(store.listRecoveryRequired("7")).toHaveLength(1);
		expect(store.listHistory({ scope: { kind: "project", projectId: "7" } }).items).toEqual([]);
	});

	it("withholds a fingerprint when an affected path escapes through a symbolic link", async () => {
		const outside = join(testDir, "outside.md");
		await Bun.write(outside, afterTexts[0] ?? "");
		await unlink(paths[0] ?? "");
		await symlink(outside, paths[0] ?? "");
		const report = await viewRecovery(dataDir, operationId);
		expect(report).toMatchObject({ classification: "unknown", fingerprint: null });
		await expect(resolveRecovery(dataDir, operationId, "0".repeat(64))).rejects.toThrow("fingerprint changed");
		expect(store.listRecoveryRequired("7")).toHaveLength(1);
	});
});
