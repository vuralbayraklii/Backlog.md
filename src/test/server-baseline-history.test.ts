import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { BacklogServer } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import { CentralMutations } from "../server/mutations.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("first inventory history", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-baseline-history-");
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("preserves a Done task's day-only source date without inventing a completion time", async () => {
		const projectRoot = join(testDir, "project");
		const dataDir = join(testDir, "data");
		const core = new Core(projectRoot);
		await initializeFilesystemTestProject(core, "Date-only project");
		await core.fs.saveTask({
			id: "TASK-1",
			title: "Older completed task",
			status: "Done",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2020-01-01",
		});
		const project = await new ProjectStore(dataDir).register("Date-only project", projectRoot);
		const handler = new BacklogServer(projectRoot, { centralMode: true, projectName: project.name });
		try {
			const central = new CentralMutations(dataDir, () => project);
			await central.ensureBaseline(project, () => handler.listCentralRecordSnapshots());
			await central.ensureBaseline(project, async () => {
				throw new Error("A second inventory must not run.");
			});
			const events = new MutationStore(dataDir).listHistory({
				scope: { kind: "project", projectId: project.id },
			}).items;
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ action: "initial_inventory", source: "baseline", actor: { kind: "unknown" } });
			expect(events[0]?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
			const task = events[0]?.changes.find((change) => change.kind === "task" && change.visibleId === "TASK-1");
			expect(typeof task?.after).toBe("string");
			expect(task?.after).toContain("2020-01-01");
			expect(task?.after).not.toContain("2020-01-01T");
			expect(task?.after).not.toMatch(/completed[_-]?date|completedAt/i);
		} finally {
			await handler.stop();
		}
	});
});
