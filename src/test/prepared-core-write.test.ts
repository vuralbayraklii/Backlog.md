import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Core } from "../core/backlog.ts";
import { type PreparedPathGuard, recordFileSnapshot } from "../file-system/prepared-change.ts";

describe("Core prepared writes", () => {
	let root: string;
	let core: Core;
	let guard: PreparedPathGuard;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "backlog-prepared-core-"));
		core = new Core(root, { serverMode: true });
		await core.filesystem.ensureBacklogStructure();
		await core.filesystem.saveConfig({
			projectName: "Prepared",
			statuses: ["To Do", "Done"],
			labels: [],
			milestones: [],
			dateFormat: "YYYY-MM-DD",
			remoteOperations: false,
		});
		guard = (path) => {
			if (!path.startsWith(`${root}${sep}`)) throw new Error("Path escaped the project");
		};
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("prepares task creation without writing until apply", async () => {
		const prepared = await core.prepareWrite(guard, undefined, () => core.createTaskFromInput({ title: "First" }));
		expect(prepared.result.task.title).toBe("First");
		expect(prepared.files).toHaveLength(1);
		expect(await core.filesystem.listTasks()).toEqual([]);

		await prepared.apply();
		await prepared.publish();
		expect((await core.filesystem.listTasks()).map((task) => task.title)).toEqual(["First"]);
	});

	it("keeps task search and listeners on the old snapshot until finalize", async () => {
		const { task } = await core.createTaskFromInput({ title: "First" });
		const store = await core.getContentStore();
		await store.ensureInitialized();
		const opened = await core.getTask(task.id);
		expect(recordFileSnapshot(opened)?.bytes.length).toBeGreaterThan(0);
		let notifications = 0;
		const unsubscribe = store.subscribe((event) => {
			if (event.type === "tasks") notifications += 1;
		});
		try {
			const prepared = await core.prepareWrite(guard, undefined, () =>
				core.updateTaskFromInput(task.id, { title: "Second" }),
			);
			expect(prepared.files).toHaveLength(1);
			expect(store.getTasks()[0]?.title).toBe("First");
			expect(notifications).toBe(0);
			await prepared.apply();
			expect(store.getTasks()[0]?.title).toBe("First");
			expect(notifications).toBe(0);
			await prepared.publish();
			expect(store.getTasks()[0]?.title).toBe("Second");
			expect(notifications).toBeGreaterThan(0);
		} finally {
			unsubscribe();
		}
	});

	it("prepares content records and binds parsed reads to their exact bytes", async () => {
		const document = await core.prepareWrite(guard, undefined, () =>
			core.createDocumentFromInput({ title: "Guide", content: "# Guide" }),
		);
		expect(await core.filesystem.listDocuments()).toEqual([]);
		await document.apply();
		await document.publish();
		const openedDocument = await core.getDocument(document.result.id);
		expect(recordFileSnapshot(openedDocument)?.bytes.length).toBeGreaterThan(0);

		const decision = await core.prepareWrite(guard, undefined, () => core.createDecisionWithTitle("Choose"));
		expect(await core.filesystem.listDecisions()).toEqual([]);
		await decision.apply();
		await decision.publish();
		const openedDecision = await core.getDecision(decision.result.id);
		expect(recordFileSnapshot(openedDecision)?.bytes.length).toBeGreaterThan(0);
	});

	it("prepares deleted task and dependent cleanup in one file set", async () => {
		const first = (await core.createTaskFromInput({ title: "First" })).task;
		const second = (await core.createTaskFromInput({ title: "Second", dependencies: [first.id] })).task;
		expect(await core.archiveTask(first.id)).toBe(true);
		const prepared = await core.prepareWrite(guard, undefined, () => core.deleteTask(first.id));
		expect(prepared.result).toMatchObject({ success: true, cleanedTaskIds: [second.id] });
		expect(prepared.files).toHaveLength(2);
		expect((await core.filesystem.loadTask(second.id))?.dependencies).toEqual([first.id]);
		await prepared.apply();
		await prepared.publish();
		expect((await core.filesystem.loadTask(second.id))?.dependencies).toEqual([]);
		expect(await core.filesystem.listArchivedTasks()).toEqual([]);
	});

	it("holds the task lock through apply and publication", async () => {
		const task = (await core.createTaskFromInput({ title: "First" })).task;
		const prepared = await core.prepareWrite(guard, undefined, () =>
			core.updateTaskFromInput(task.id, { title: "Second" }),
		);
		const otherCore = new Core(root, { serverMode: true });
		await expect(otherCore.updateTaskFromInput(task.id, { title: "Intruder" })).rejects.toThrow();
		expect((await core.filesystem.loadTask(task.id))?.title).toBe("First");
		await prepared.apply();
		await expect(otherCore.updateTaskFromInput(task.id, { title: "Intruder" })).rejects.toThrow();
		await prepared.publish();
		expect((await core.filesystem.loadTask(task.id))?.title).toBe("Second");
		await otherCore.updateTaskFromInput(task.id, { title: "Third" });
		expect((await core.filesystem.loadTask(task.id))?.title).toBe("Third");
	});

	it("holds the allocator lock through creation publication", async () => {
		const prepared = await core.prepareWrite(guard, undefined, () => core.createTaskFromInput({ title: "First" }));
		const otherCore = new Core(root, { serverMode: true });
		await expect(
			otherCore.filesystem.withCreateLock(async () => "unexpected", { timeoutMs: 50, retryDelayMs: 10 }),
		).rejects.toThrow();
		await prepared.apply();
		await prepared.publish();
		expect(await otherCore.filesystem.withCreateLock(async () => "available", { timeoutMs: 50 })).toBe("available");
	});
});
