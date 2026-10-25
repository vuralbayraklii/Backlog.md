import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Core } from "../core/backlog.ts";
import { BacklogServer } from "../server/index.ts";
import { CentralMutations, type CentralProject, type ObservationHooks } from "../server/mutations.ts";
import type { ObservedPathSnapshot } from "../server/observation-types.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const CONTENT = "---\nid: TASK-1\ntitle: One\nstatus: To Do\ncreated_date: 2026-10-23\n---\nBody.\n";

describe("central external file observation", () => {
	let temporary: string;
	let projectRoot: string;
	let taskPath: string;
	let handler: BacklogServer;
	let mutations: CentralMutations;
	let project: CentralProject;
	let published: number;
	let hooks: ObservationHooks;

	beforeEach(async () => {
		temporary = createUniqueTestDir("server-observation");
		projectRoot = join(temporary, "project");
		const core = new Core(projectRoot);
		await initializeFilesystemTestProject(core, "Observed Project");
		taskPath = await core.fs.saveTask({
			id: "TASK-1",
			title: "One",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-23",
		});
		handler = new BacklogServer(projectRoot, { centralMode: true });
		await new ProjectStore(join(temporary, "data")).register("Observed Project", projectRoot);
		project = { id: "1", rootPath: projectRoot, tracking: true };
		mutations = new CentralMutations(join(temporary, "data"), () => project);
		await mutations.recoverPending();
		await mutations.ensureBaseline(project, () => handler.listCentralRecordSnapshots());
		published = 0;
		hooks = {
			publish: async () => {
				published++;
			},
		};
	});

	afterEach(async () => {
		await mutations.stopObservation();
		await handler.stop();
		await safeCleanup(temporary);
	});

	const scan = () => (paths: readonly string[], entries?: readonly ObservedPathSnapshot[]) =>
		handler.scanObservedFiles(paths, entries);

	it("resolves 1000 identities from one validated checkpoint and rejects mismatched content", async () => {
		await Promise.all(
			Array.from({ length: 999 }, (_, index) => {
				const id = `TASK-${index + 2}`;
				return writeFile(join(projectRoot, "backlog", "tasks", `${id}.md`), CONTENT.replace("TASK-1", id));
			}),
		);
		await mutations.reconcileObserved(project, scan());
		const records = mutations.observations.load(project.id).entries.filter((entry) => entry.kind === "task");
		expect(records).toHaveLength(1000);
		const load = spyOn(mutations.observations, "load");
		try {
			const started = performance.now();
			const resolve = mutations.recordKeysFor(project.id);
			for (const record of records) {
				expect(
					resolve(record.kind, record.visibleId, record.path, {
						lifecycle: "active",
						bytes: record.recordBytes,
					}),
				).toBe(record.recordKey);
			}
			console.log(`1000 record identities: ${(performance.now() - started).toFixed(1)} ms`);
			expect(load).toHaveBeenCalledTimes(1);
			const record = records[0];
			if (!record) throw new Error("Missing fixture");
			expect(
				resolve(record.kind, record.visibleId, record.path, {
					lifecycle: "active",
					bytes: Buffer.from("Changed"),
				}),
			).toBeUndefined();
			expect(
				resolve(record.kind, record.visibleId, record.path, { lifecycle: "archived", bytes: record.recordBytes }),
			).toBeUndefined();
		} finally {
			load.mockRestore();
		}
	});

	it("distinguishes unreadable and invalid paths from a complete absence", async () => {
		const first = await handler.scanObservedFiles();
		expect(first.problems).toEqual([]);
		expect(first.entries.some((entry) => entry.path === taskPath)).toBe(true);
		await unlink(taskPath);
		const damaged = join(projectRoot, "backlog", "tasks", "task-2 - Damaged.md");
		await writeFile(damaged, "---\nid: TASK-2\ntitle: [broken\n---\n");
		const invalid = await handler.scanObservedFiles(first.entries.map((entry) => entry.path));
		expect(invalid.problems.some((problem) => problem.path === damaged && problem.state === "invalid")).toBe(true);
		expect(invalid.missing).toEqual([]);
		await unlink(damaged);
		const missing = await handler.scanObservedFiles(first.entries.map((entry) => entry.path));
		expect(missing.problems).toEqual([]);
		expect(missing.missing).toContain(taskPath);
	});

	it("accepts existing short Markdown filenames for every record kind", async () => {
		const shortTask = join(projectRoot, "backlog", "tasks", "task-1.md");
		await rename(taskPath, shortTask);
		await writeFile(
			join(projectRoot, "backlog", "docs", "doc-1.md"),
			"---\nid: doc-1\ntitle: Short document\n---\nText\n",
		);
		await writeFile(
			join(projectRoot, "backlog", "decisions", "decision-1.md"),
			"---\nid: decision-1\ntitle: Short decision\nstatus: proposed\n---\n## Context\nText\n",
		);
		await writeFile(
			join(projectRoot, "backlog", "milestones", "m-1.md"),
			"---\nid: m-1\ntitle: Short milestone\n---\n",
		);
		const inventory = await handler.scanObservedFiles();
		expect(inventory.problems).toEqual([]);
		expect(inventory.entries.filter((entry) => entry.kind !== "config")).toHaveLength(4);
	});

	it.each([
		["tasks", "task-1-old-title.md", "TASK-1"],
		["completed", "task-001-old-title.md", "TASK-1"],
		["archive/tasks", "task-1.02-old-title.md", "TASK-1.2"],
		["tasks", "task-1-old-title.md", "TASK-1-OLD-TITLE"],
	])("observes existing task filename %s/%s as %s", async (directory, filename, id) => {
		await unlink(taskPath);
		const parent = join(projectRoot, "backlog", directory);
		await mkdir(parent, { recursive: true });
		const path = join(parent, filename);
		await writeFile(path, CONTENT.replace("TASK-1", id));
		const state = await mutations.ensureObserved(project, scan(), hooks);
		expect(state.state).toBe("ready");
		expect(mutations.observations.load(project.id).entries).toContainEqual(
			expect.objectContaining({ path, visibleId: id }),
		);
	});

	it.each([
		"task-2-old-title.md",
		"task-10-old-title.md",
		"task-1.2-old-title.md",
		"task-1x-old-title.md",
		"task-1-other - Title.md",
	])("rejects filename %s when frontmatter claims TASK-1", async (filename) => {
		await unlink(taskPath);
		const path = join(projectRoot, "backlog", "tasks", filename);
		await writeFile(path, CONTENT);
		const inventory = await handler.scanObservedFiles();
		expect(inventory.problems).toContainEqual({
			path,
			state: "invalid",
			error: "Error: Task ID does not match its filename.",
		});
		expect(inventory.entries.some((entry) => entry.path === path)).toBe(false);
	});

	it("does not duplicate documents through links into their own or archive folders", async () => {
		const docs = join(projectRoot, "backlog", "docs");
		const archive = join(projectRoot, "backlog", "archive", "docs");
		await mkdir(join(docs, "nested"), { recursive: true });
		await mkdir(archive, { recursive: true });
		await writeFile(join(docs, "nested", "doc-1.md"), "---\nid: doc-1\ntitle: Primary\n---\n");
		await writeFile(join(archive, "doc-2.md"), "---\nid: doc-2\ntitle: Archived\n---\n");
		await symlink(join(docs, "nested"), join(docs, "shortcut"));
		await symlink(archive, join(docs, "archived-shortcut"));
		const inventory = await handler.scanObservedFiles();
		expect(inventory.problems).toEqual([]);
		const documents = inventory.entries.filter((entry) => entry.kind === "document");
		expect(documents).toHaveLength(2);
		expect(documents.map((entry) => entry.path)).toContain(join(docs, "nested", "doc-1.md"));
		expect(documents.map((entry) => entry.path)).not.toContain(join(docs, "shortcut", "doc-1.md"));
	});

	it("uses the first A-05 scan as a baseline without backfilling A-04 external events", async () => {
		const priorKey = mutations.store.findRecordByPath(project.id, taskPath)?.recordKey;
		expect(priorKey).toBeTruthy();
		await unlink(taskPath);
		await mutations.ensureObserved(project, scan(), hooks);
		expect(mutations.store.loadRecord(project.id, priorKey as string)?.lifecycle).toBe("deleted");
		expect(mutations.observations.load(project.id).entries.some((entry) => entry.path === taskPath)).toBe(false);
		const events = mutations.store.listHistory({ scope: { kind: "project", projectId: project.id } }).items;
		expect(events.filter((event) => event.source === "external")).toHaveLength(0);
	});

	it("keeps a key only for a unique physical move and allocates a new one after observed deletion", async () => {
		const initial = await mutations.ensureObserved(project, scan(), hooks);
		expect(initial.state).toBe("ready");
		const before = mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath);
		expect(before?.recordKey).toBeTruthy();
		expect(
			mutations.store
				.listHistory({ scope: { kind: "project", projectId: project.id } })
				.items.filter((event) => event.source === "external"),
		).toHaveLength(0);

		const movedPath = join(projectRoot, "backlog", "tasks", "task-1 - Moved.md");
		await rename(taskPath, movedPath);
		await mutations.reconcileObserved(project, scan(), hooks);
		const moved = mutations.observations.load(project.id).entries.find((entry) => entry.path === movedPath);
		expect(moved?.recordKey).toBe(before?.recordKey);
		const moveEvents = mutations.store
			.listHistory({ scope: { kind: "project", projectId: project.id } })
			.items.filter((event) => event.source === "external");
		expect(moveEvents).toHaveLength(1);
		expect(moveEvents[0]?.occurredAt).toBeNull();
		expect(moveEvents[0]?.detectedAt).toBeTruthy();
		expect(moveEvents[0]?.changes).toHaveLength(1);

		await unlink(movedPath);
		await mutations.reconcileObserved(project, scan(), hooks);
		await writeFile(movedPath, CONTENT);
		await mutations.reconcileObserved(project, scan(), hooks);
		const recreated = mutations.observations.load(project.id).entries.find((entry) => entry.path === movedPath);
		expect(recreated?.recordKey).not.toBe(before?.recordKey);
		expect(published).toBe(4);
	});

	it("treats a byte-identical copy and remove as an uncertain new path", async () => {
		await mutations.ensureObserved(project, scan(), hooks);
		const before = mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath);
		const copiedPath = join(projectRoot, "backlog", "tasks", "task-1 - Copied.md");
		await copyFile(taskPath, copiedPath);
		await unlink(taskPath);
		await mutations.reconcileObserved(project, scan(), hooks);
		const after = mutations.observations.load(project.id).entries.find((entry) => entry.path === copiedPath);
		expect(after?.recordKey).not.toBe(before?.recordKey);
		const event = mutations.store
			.listHistory({ scope: { kind: "project", projectId: project.id } })
			.items.find((item) => item.source === "external");
		expect(event?.changes).toHaveLength(2);
	});

	it("preserves a key when an editor atomically replaces the same pathname", async () => {
		await mutations.ensureObserved(project, scan(), hooks);
		const before = mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath);
		const staged = `${taskPath}.new`;
		await writeFile(staged, CONTENT.replace("title: One", "title: Atomic edit"));
		await rename(staged, taskPath);
		await mutations.reconcileObserved(project, scan(), hooks);
		const after = mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath);
		expect(after?.recordKey).toBe(before?.recordKey);
		expect(after?.identity?.ino).not.toBe(before?.identity?.ino);
		const events = mutations.store
			.listHistory({ scope: { kind: "project", projectId: project.id } })
			.items.filter((event) => event.source === "external");
		expect(events).toHaveLength(1);
	});

	it("batches document, decision, milestone, and config changes before an archive move", async () => {
		await mutations.ensureObserved(project, scan(), hooks);
		const taskKey = mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath)?.recordKey;
		const backlog = join(projectRoot, "backlog");
		await writeFile(join(backlog, "docs", "doc-1.md"), "---\nid: doc-1\ntitle: Added document\n---\n");
		await writeFile(
			join(backlog, "decisions", "decision-1.md"),
			"---\nid: decision-1\ntitle: Added decision\nstatus: proposed\n---\n",
		);
		await writeFile(join(backlog, "milestones", "m-1.md"), "---\nid: m-1\ntitle: Added milestone\n---\n");
		const configPath = join(backlog, "config.yml");
		await writeFile(configPath, (await readFile(configPath, "utf8")).replace("Observed Project", "Renamed Project"));
		await mutations.reconcileObserved(project, scan(), hooks);
		let events = mutations.store
			.listHistory({ scope: { kind: "project", projectId: project.id } })
			.items.filter((event) => event.source === "external");
		expect(events).toHaveLength(1);
		expect(new Set(events[0]?.changes.map((change) => change.kind))).toEqual(
			new Set(["document", "decision", "milestone", "config"]),
		);

		const archivedPath = join(backlog, "archive", "tasks", basename(taskPath));
		await mkdir(join(backlog, "archive", "tasks"), { recursive: true });
		await rename(taskPath, archivedPath);
		await mutations.reconcileObserved(project, scan(), hooks);
		const archived = mutations.observations.load(project.id).entries.find((entry) => entry.path === archivedPath);
		expect(archived?.recordKey).toBe(taskKey);
		expect(archived?.lifecycle).toBe("archived");
		events = mutations.store
			.listHistory({ scope: { kind: "project", projectId: project.id } })
			.items.filter((event) => event.source === "external");
		expect(events).toHaveLength(2);
	});

	it("finds one offline move after restart without inventing its occurrence time", async () => {
		await mutations.ensureObserved(project, scan(), hooks);
		const oldKey = mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath)?.recordKey;
		await mutations.stopObservation();
		await handler.stop();
		const movedPath = join(projectRoot, "backlog", "tasks", "task-1 - Offline.md");
		await rename(taskPath, movedPath);
		handler = new BacklogServer(projectRoot, { centralMode: true });
		mutations = new CentralMutations(join(temporary, "data"), () => project);
		await mutations.recoverPending();
		await mutations.ensureObserved(project, scan(), hooks);
		const current = mutations.observations.load(project.id).entries.find((entry) => entry.path === movedPath);
		expect(current?.recordKey).toBe(oldKey);
		const events = mutations.store
			.listHistory({ scope: { kind: "project", projectId: project.id } })
			.items.filter((event) => event.source === "external");
		expect(events).toHaveLength(1);
		expect(events[0]?.occurredAt).toBeNull();
		expect(events[0]?.detectedAt).toBeTruthy();
	});

	it("reconciles a watcher signal while no browser is open", async () => {
		await mutations.ensureObserved(project, scan(), hooks);
		mutations.setObservationTracking(project, scan(), hooks);
		await writeFile(taskPath, CONTENT.replace("title: One", "title: Changed outside"));
		const deadline = Date.now() + 4_000;
		while (Date.now() < deadline) {
			const events = mutations.store
				.listHistory({ scope: { kind: "project", projectId: project.id } })
				.items.filter((event) => event.source === "external");
			if (events.length === 1) break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		const events = mutations.store
			.listHistory({ scope: { kind: "project", projectId: project.id } })
			.items.filter((event) => event.source === "external");
		expect(events).toHaveLength(1);
		expect(published).toBe(2);
	});

	it("keeps the 30-second full scan active when a watcher cannot bind", async () => {
		await mutations.ensureObserved(project, scan(), hooks);
		const realInterval = globalThis.setInterval;
		let tick: (() => void) | undefined;
		globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
			if (delay === 30_000) tick = () => callback(...args);
			return realInterval(callback, delay, ...args);
		}) as typeof setInterval;
		try {
			mutations.setObservationTracking(project, scan(), {
				...hooks,
				watchDirectory: join(projectRoot, "missing-watch-directory"),
			});
			expect(tick).toBeDefined();
			await writeFile(taskPath, CONTENT.replace("title: One", "title: Periodic edit"));
			tick?.();
			const deadline = Date.now() + 3_000;
			while (Date.now() < deadline) {
				if (
					mutations.store
						.listHistory({ scope: { kind: "project", projectId: project.id } })
						.items.some((event) => event.source === "external")
				)
					break;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			expect(
				mutations.store
					.listHistory({ scope: { kind: "project", projectId: project.id } })
					.items.filter((event) => event.source === "external"),
			).toHaveLength(1);
		} finally {
			globalThis.setInterval = realInterval;
		}
	});

	it("degrades without a false deletion and reopens after a full safe scan", async () => {
		await mutations.ensureObserved(project, scan(), hooks);
		const priorKey = mutations.observations
			.load(project.id)
			.entries.find((entry) => entry.path === taskPath)?.recordKey;
		await writeFile(taskPath, "---\nid: TASK-1\ntitle: [unfinished\n---\n");
		const degraded = await mutations.reconcileObserved(project, scan(), hooks);
		expect(degraded.state).toBe("degraded");
		expect(mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath)?.recordKey).toBe(
			priorKey,
		);
		await writeFile(taskPath, CONTENT);
		const recovered = await mutations.reconcileObserved(project, scan(), hooks);
		expect(recovered.state).toBe("ready");
		expect(mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath)?.recordKey).toBe(
			priorKey,
		);
	});

	it("refuses an escaping symlink without reading or recording its referent", async () => {
		await mutations.ensureObserved(project, scan(), hooks);
		const outside = join(temporary, `outside-${randomUUID()}.md`);
		await writeFile(outside, "PRIVATE_EXTERNAL_SENTINEL");
		await unlink(taskPath);
		await symlink(outside, taskPath);
		const observed = await handler.scanObservedFiles([taskPath]);
		expect(observed.problems.length).toBeGreaterThan(0);
		expect(JSON.stringify(observed)).not.toContain("PRIVATE_EXTERNAL_SENTINEL");
		expect(observed.missing).toEqual([]);
		const status = await mutations.reconcileObserved(project, scan(), hooks);
		expect(status.state).toBe("degraded");
		expect(status.error).not.toContain(temporary);
		expect(
			basename(mutations.observations.load(project.id).entries.find((entry) => entry.path === taskPath)?.path ?? ""),
		).toBe(basename(taskPath));
	});
});
