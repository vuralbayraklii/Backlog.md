import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import type { ContentStoreEvent } from "../core/content-store.ts";
import { FileSystem } from "../file-system/operations.ts";
import { serializeTask } from "../markdown/serializer.ts";
import { type ProjectContext, ProjectContextRegistry } from "../server/project-context.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup, sleep, waitUntil } from "./test-utils.ts";

describe("ProjectContextRegistry", () => {
	let testDir: string;
	let registry: ProjectContextRegistry;
	let alphaRoot: string;
	let betaRoot: string;

	async function seed(projectRoot: string, marker: string, backlogDirectory?: string): Promise<void> {
		const core = new Core(projectRoot);
		await initializeFilesystemTestProject(core, marker, backlogDirectory);
		const config = await core.fs.loadConfig();
		if (!config) throw new Error("Fixture configuration missing.");
		await core.fs.saveConfig({ ...config, projects: ["Shared portfolio"] });
		await core.fs.saveTask({
			id: "TASK-1",
			title: `${marker} task`,
			status: "To Do",
			project: "Shared portfolio",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-20",
			rawContent: `${marker} task content`,
		});
		await core.fs.saveDocument({
			id: "doc-1",
			title: `${marker} document`,
			type: "guide",
			createdDate: "2026-10-20",
			rawContent: `${marker} document content`,
		});
		await core.fs.saveDecision({
			id: "decision-1",
			title: `${marker} decision`,
			date: "2026-10-20",
			status: "proposed",
			context: marker,
			decision: marker,
			consequences: marker,
			rawContent: `## Context\n${marker}\n\n## Decision\n${marker}\n\n## Consequences\n${marker}`,
		});
	}

	async function openBoth(): Promise<[ProjectContext, ProjectContext]> {
		return await Promise.all([registry.open("alpha", alphaRoot), registry.open("beta", betaRoot)]);
	}

	function searchedTaskTitle(context: ProjectContext, query: string): string | undefined {
		const result = context.searchService.search({ query, types: ["task"] })[0];
		return result?.type === "task" ? result.task.title : undefined;
	}

	async function changeTaskOnDisk(context: ProjectContext, title: string): Promise<void> {
		const task = await context.core.fs.loadTask("TASK-1");
		if (!task?.filePath) throw new Error("Fixture task missing.");
		await Bun.write(task.filePath, serializeTask({ ...task, title }));
	}

	beforeEach(async () => {
		testDir = createUniqueTestDir("project-context");
		alphaRoot = join(testDir, "alpha");
		betaRoot = join(testDir, "beta");
		registry = new ProjectContextRegistry();
		await Promise.all([seed(alphaRoot, "Violetnebula"), seed(betaRoot, "Copperharbor", "records")]);
	});

	afterEach(async () => {
		await registry.dispose();
		await safeCleanup(testDir);
	});

	it("resolves concurrent projects by workspace ID and shares initialization only within that ID", async () => {
		const cwd = process.cwd();
		const [alpha, beta, alphaAgain] = await Promise.all([
			registry.open("alpha", alphaRoot),
			registry.open("beta", betaRoot),
			registry.open("alpha", join(alphaRoot, ".")),
		]);

		expect(alphaAgain).toBe(alpha);
		expect(await registry.get("alpha")).toBe(alpha);
		expect(await registry.get("beta")).toBe(beta);
		expect(alpha.projectId).toBe("alpha");
		expect(beta.projectRoot).toBe(betaRoot);
		expect(alpha.core).not.toBe(beta.core);
		expect(alpha.contentStore).not.toBe(beta.contentStore);
		expect(alpha.searchService).not.toBe(beta.searchService);
		expect((await alpha.core.getTask("TASK-1"))?.project).toBe("Shared portfolio");
		expect((await beta.core.getTask("TASK-1"))?.project).toBe("Shared portfolio");
		await expect(registry.get("Shared portfolio")).rejects.toThrow("is not open");
		await expect(registry.get("missing")).rejects.toThrow("is not open");
		await expect(registry.open("alpha", betaRoot)).rejects.toThrow("different root");
		expect(await registry.get("alpha")).toBe(alpha);
		expect(process.cwd()).toBe(cwd);
	});

	it("reads and updates the same TASK-1 in each project without changing the other file", async () => {
		const [alpha, beta] = await openBoth();
		const [alphaTask, betaTask] = await Promise.all([alpha.core.getTask("TASK-1"), beta.core.getTask("TASK-1")]);
		expect(alphaTask?.title).toBe("Violetnebula task");
		expect(betaTask?.title).toBe("Copperharbor task");
		if (!alphaTask?.filePath || !betaTask?.filePath) throw new Error("Fixture tasks missing.");
		const betaBefore = await Bun.file(betaTask.filePath).text();

		await alpha.core.updateTaskFromInput("TASK-1", { title: "Violetnebula updated" }, false);
		expect(await Bun.file(betaTask.filePath).text()).toBe(betaBefore);
		const alphaAfter = await Bun.file(alphaTask.filePath).text();
		await beta.core.updateTaskFromInput("TASK-1", { title: "Copperharbor updated" }, false);
		expect(await Bun.file(alphaTask.filePath).text()).toBe(alphaAfter);

		await Promise.all([
			alpha.core.updateTaskFromInput("TASK-1", { status: "In Progress" }, false),
			beta.core.updateTaskFromInput("TASK-1", { status: "Done" }, false),
		]);
		expect((await alpha.core.getTask("TASK-1"))?.status).toBe("In Progress");
		expect((await beta.core.getTask("TASK-1"))?.status).toBe("Done");
		expect(searchedTaskTitle(alpha, "Violetnebula")).toBe("Violetnebula updated");
		expect(searchedTaskTitle(beta, "Copperharbor")).toBe("Copperharbor updated");
	});

	it("keeps colliding document and decision IDs, configuration, and search in their own contexts", async () => {
		const [alpha, beta] = await openBoth();
		for (const [context, marker, otherMarker] of [
			[alpha, "Violetnebula", "Copperharbor"],
			[beta, "Copperharbor", "Violetnebula"],
		] as const) {
			expect((await context.core.getDocument("doc-1"))?.title).toBe(`${marker} document`);
			expect((await context.core.getDecision("decision-1"))?.title).toBe(`${marker} decision`);
			expect((await context.core.fs.loadConfig())?.projectName).toBe(marker);
			expect(
				context.searchService
					.search({ query: marker })
					.map((result) => result.type)
					.sort(),
			).toEqual(["decision", "document", "task"]);
			expect(context.searchService.search({ query: otherMarker })).toEqual([]);
		}

		const betaDocument = await beta.core.getDocument("doc-1");
		const betaDecision = await beta.core.getDecision("decision-1");
		const betaConfig = await Bun.file(beta.core.fs.configFilePath).text();
		await alpha.core.updateDocumentFromInput({ id: "doc-1", content: "Violetnebula revised document" }, false);
		await alpha.core.updateDecisionStatus("decision-1", "accepted", false);
		const config = await alpha.core.fs.loadConfig();
		if (!config) throw new Error("Fixture configuration missing.");
		await alpha.core.fs.saveConfig({ ...config, projectName: "Violetnebula revised" });

		expect((await alpha.core.getDocument("doc-1"))?.rawContent).toBe("Violetnebula revised document");
		expect((await alpha.core.getDecision("decision-1"))?.status).toBe("accepted");
		expect(await beta.core.getDocument("doc-1")).toEqual(betaDocument);
		expect(await beta.core.getDecision("decision-1")).toEqual(betaDecision);
		expect(await Bun.file(beta.core.fs.configFilePath).text()).toBe(betaConfig);
		expect((await beta.core.fs.loadConfig())?.projectName).toBe("Copperharbor");
		expect(beta.searchService.search({ query: "Violetnebula" })).toEqual([]);
	});

	it("delivers external task changes and search updates only to the owning project", async () => {
		const [alpha, beta] = await openBoth();
		const alphaEvents: ContentStoreEvent[] = [];
		const betaEvents: ContentStoreEvent[] = [];
		alpha.contentStore.subscribe((event) => {
			if (event.type !== "ready") alphaEvents.push(event);
		});
		beta.contentStore.subscribe((event) => {
			if (event.type !== "ready") betaEvents.push(event);
		});

		await changeTaskOnDisk(alpha, "Violetnebula external");
		await waitUntil(
			() => searchedTaskTitle(alpha, "Violetnebula") === "Violetnebula external",
			"alpha watcher and search update",
			5000,
		);
		expect(alphaEvents.some((event) => event.type === "tasks")).toBe(true);
		expect(betaEvents).toHaveLength(0);
		expect(beta.contentStore.getTasks()[0]?.title).toBe("Copperharbor task");

		await changeTaskOnDisk(beta, "Copperharbor external");
		await waitUntil(
			() => searchedTaskTitle(beta, "Copperharbor") === "Copperharbor external",
			"beta watcher and search update",
			5000,
		);
		expect(betaEvents.some((event) => event.type === "tasks")).toBe(true);
		expect(alphaEvents.every((event) => event.snapshot.tasks[0]?.title.startsWith("Violetnebula"))).toBe(true);
		expect(betaEvents.every((event) => event.snapshot.tasks[0]?.title.startsWith("Copperharbor"))).toBe(true);
		expect(alpha.searchService.search({ query: "Copperharbor" })).toEqual([]);
	});

	it("isolates external document, decision, and config notifications across different backlog layouts", async () => {
		const [alpha, beta] = await openBoth();
		const alphaEvents: ContentStoreEvent[] = [];
		const betaEvents: ContentStoreEvent[] = [];
		alpha.contentStore.subscribe((event) => {
			if (event.type !== "ready") alphaEvents.push(event);
		});
		beta.contentStore.subscribe((event) => {
			if (event.type !== "ready") betaEvents.push(event);
		});
		const external = new FileSystem(alphaRoot);
		const document = await external.loadDocument("doc-1");
		const decision = await external.loadDecision("decision-1");
		const config = await external.loadConfig();
		if (!document || !decision || !config) throw new Error("Fixture content missing.");
		await Promise.all([
			external.saveDocument({ ...document, rawContent: "Violetnebula external document" }),
			external.saveDecision({ ...decision, status: "accepted" }),
			external.saveConfig({ ...config, projectName: "Violetnebula external config" }),
		]);
		await waitUntil(
			() => ["documents", "decisions", "config"].every((type) => alphaEvents.some((event) => event.type === type)),
			"alpha content and config notifications",
			5000,
		);
		expect(alpha.contentStore.getDocuments()[0]?.rawContent).toBe("Violetnebula external document");
		expect(alpha.contentStore.getDecisions()[0]?.status).toBe("accepted");
		expect((await alpha.core.fs.loadConfig())?.projectName).toBe("Violetnebula external config");
		expect(betaEvents).toHaveLength(0);
		expect(beta.contentStore.getDocuments()[0]?.rawContent).toBe("Copperharbor document content");
		expect(beta.contentStore.getDecisions()[0]?.status).toBe("proposed");
		expect((await beta.core.fs.loadConfig())?.projectName).toBe("Copperharbor");
		expect(beta.searchService.search({ query: "Violetnebula" })).toEqual([]);
	});

	it("closes and reopens one context while the other watcher and search remain live", async () => {
		const [alpha, beta] = await openBoth();
		const alphaEvents: ContentStoreEvent[] = [];
		alpha.contentStore.subscribe((event) => alphaEvents.push(event));
		await registry.close("alpha");
		const eventsAfterClose = alphaEvents.length;
		await expect(registry.get("alpha")).rejects.toThrow("is not open");
		expect(() => alpha.contentStore.subscribe(() => {})).toThrow("disposed");
		expect(() => alpha.searchService.search()).toThrow("not initialized");

		await changeTaskOnDisk(alpha, "Violetnebula after close");
		await changeTaskOnDisk(beta, "Copperharbor still live");
		await waitUntil(
			() => searchedTaskTitle(beta, "Copperharbor") === "Copperharbor still live",
			"beta watcher after alpha closes",
			5000,
		);
		expect(alphaEvents).toHaveLength(eventsAfterClose);
		expect(await registry.get("beta")).toBe(beta);
		expect((await beta.core.getTask("TASK-1"))?.title).toBe("Copperharbor still live");
		expect(beta.searchService.search({ query: "Violetnebula" })).toEqual([]);
		const reopened = await registry.open("alpha", alphaRoot);
		expect(reopened.core).not.toBe(alpha.core);
		expect((await reopened.core.getTask("TASK-1"))?.title).toBe("Violetnebula after close");
		expect(await registry.get("beta")).toBe(beta);
	});

	it("drains a closing initialization without removing a replacement with the same ID", async () => {
		const replacementRoot = join(testDir, "replacement");
		await seed(replacementRoot, "Goldenmeadow");
		const beta = await registry.open("beta", betaRoot);
		const outcome = registry.open("alpha", alphaRoot).catch((error: unknown) => error);
		const closing = registry.close("alpha");
		const replacement = await registry.open("alpha", replacementRoot);
		await closing;
		expect(await outcome).toMatchObject({ message: expect.stringContaining("closed during initialization") });
		expect(await registry.get("alpha")).toBe(replacement);
		expect((await replacement.core.getTask("TASK-1"))?.title).toBe("Goldenmeadow task");
		expect(await registry.get("beta")).toBe(beta);
	});

	it("releases a failed initialization so it can be retried without disturbing another project", async () => {
		const beta = await registry.open("beta", betaRoot);
		const configPath = new FileSystem(alphaRoot).configFilePath;
		const validConfig = await Bun.file(configPath).text();
		await Bun.write(configPath, 'project_name: "Broken"\ndefault_assignee: true\nfilesystem_only: true\n');
		await expect(registry.open("alpha", alphaRoot)).rejects.toThrow("default_assignee");
		await expect(registry.get("alpha")).rejects.toThrow("is not open");
		await Bun.write(configPath, validConfig);
		const alpha = await registry.open("alpha", alphaRoot);
		expect((await alpha.core.getTask("TASK-1"))?.title).toBe("Violetnebula task");
		expect(await registry.get("beta")).toBe(beta);
		await changeTaskOnDisk(beta, "Copperharbor after failed initialization");
		await waitUntil(
			() => searchedTaskTitle(beta, "Copperharbor") === "Copperharbor after failed initialization",
			"beta watcher after another initialization fails",
			5000,
		);
	});

	it("rejects empty bindings and prevents new contexts during registry shutdown", async () => {
		await expect(registry.open(" ", alphaRoot)).rejects.toThrow("Project ID is required");
		await expect(registry.open("alpha", " ")).rejects.toThrow("Project root is required");
		const outcome = registry.open("alpha", alphaRoot).catch((error: unknown) => error);
		await registry.dispose();
		expect(await outcome).toMatchObject({ message: expect.stringContaining("closed during initialization") });
		await expect(registry.open("beta", betaRoot)).rejects.toThrow("disposed");
		await registry.close("missing");
		await registry.dispose();
	});

	it("waits for an already closing project before completing registry shutdown", async () => {
		const beta = await registry.open("beta", betaRoot);
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const getContentStore = Core.prototype.getContentStore;
		const delayed = spyOn(Core.prototype, "getContentStore").mockImplementationOnce(async function (this: Core) {
			await held;
			return await getContentStore.call(this);
		});
		const outcome = registry.open("alpha", alphaRoot).catch((error: unknown) => error);
		const closing = registry.close("alpha");
		let finished = false;
		const shutdown = registry.dispose().then(() => {
			finished = true;
		});
		try {
			await sleep(25);
			expect(finished).toBe(false);
		} finally {
			release();
			delayed.mockRestore();
			await Promise.all([closing, shutdown]);
		}
		expect(await outcome).toMatchObject({ message: expect.stringContaining("closed during initialization") });
		expect(() => beta.contentStore.subscribe(() => {})).toThrow("disposed");
	});
});
