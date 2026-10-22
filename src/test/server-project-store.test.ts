import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { FileSystem } from "../file-system/operations.ts";
import { ProjectContextRegistry } from "../server/project-context.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("server project store", () => {
	let testDir: string;
	let projectRoot: string;
	let dataDir: string;
	let store: ProjectStore;

	async function seed(root: string, directory?: string): Promise<Core> {
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Source project", directory);
		return core;
	}

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-project-store-");
		projectRoot = join(testDir, "project");
		dataDir = join(testDir, "data");
		store = new ProjectStore(dataDir);
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("leaves missing data directories absent while reading empty metadata", async () => {
		expect(store.list()).toEqual([]);
		expect(store.load("1")).toBeNull();
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
		expect(await new Bun.Glob("data").scan({ cwd: testDir, onlyFiles: false }).next()).toMatchObject({ done: true });
	});

	it("persists IDs, labels, canonical roots, and UTC creation dates across store instances", async () => {
		await seed(projectRoot);
		const record = await store.register("  Example's project  ", join(projectRoot, "."));
		expect(record).toEqual({
			id: "1",
			name: "Example's project",
			rootPath: await realpath(projectRoot),
			createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
			tracking: true,
		});
		const restored = new ProjectStore(dataDir);
		expect(restored.load(record.id)).toEqual(record);
		const otherRoot = join(testDir, "project-other");
		await seed(otherRoot);
		const other = await restored.register(record.name, otherRoot);
		expect(other.id).toBe("2");
		expect(restored.list()).toEqual([record, other]);
	});

	it.each(["backlog", ".backlog", "planning/records"])(
		"registers the %s layout without changing any source file",
		async (directory) => {
			const core = await seed(projectRoot, directory);
			await core.fs.saveTask({
				id: "TASK-1",
				title: "Source task",
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-10-21",
				rawContent: "Source task body",
			});
			const snapshot = async () => {
				const paths = await Array.fromAsync(
					new Bun.Glob("**/*").scan({ cwd: projectRoot, onlyFiles: true, dot: true }),
				);
				return await Promise.all(
					paths.sort().map(async (path) => [path, await Bun.file(join(projectRoot, path)).text()]),
				);
			};
			const before = await snapshot();
			await store.register("Display name", projectRoot);
			expect(await snapshot()).toEqual(before);
			expect((await core.fs.loadConfig())?.projectName).toBe("Source project");
		},
	);

	it("rejects exact duplicates and symlink aliases without changing the existing record", async () => {
		await seed(projectRoot);
		const record = await store.register("Original", projectRoot);
		await expect(store.register("Replacement", projectRoot)).rejects.toThrow("already registered as project 1");
		const alias = join(testDir, "alias");
		await symlink(projectRoot, alias, "dir");
		await expect(store.register("Alias", alias)).rejects.toThrow("already registered as project 1");
		expect(store.list()).toEqual([record]);
	});

	it.each([false, true])("rejects overlapping roots with child registered first: %s", async (childFirst) => {
		const childRoot = join(projectRoot, "child");
		await seed(projectRoot);
		await seed(childRoot);
		const first = childFirst ? childRoot : projectRoot;
		const second = childFirst ? projectRoot : childRoot;
		const record = await store.register("First", first);
		await expect(store.register("Second", second)).rejects.toThrow("overlaps project 1");
		expect(store.list()).toEqual([record]);
	});

	it("requires a readable initialized project at the exact path before creating server data", async () => {
		await seed(projectRoot);
		const child = join(projectRoot, "uninitialized-child");
		await mkdir(child);
		await expect(store.register("Child", child)).rejects.toThrow("No readable Backlog configuration");
		const configPath = new FileSystem(projectRoot).configFilePath;
		await Bun.write(configPath, 'project_name: "Invalid"\ndefault_assignee: true\n');
		await expect(store.register("Invalid", projectRoot)).rejects.toThrow("default_assignee");
		await expect(store.register("Missing", join(testDir, "missing"))).rejects.toThrow();
		expect(store.list()).toEqual([]);
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
	});

	it("rejects missing configured Backlog directories instead of creating them", async () => {
		await mkdir(projectRoot);
		await Bun.write(join(projectRoot, "backlog.config.yml"), 'project_name: "Missing"\nbacklog_directory: records\n');
		await expect(store.register("Missing", projectRoot)).rejects.toThrow();
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
		expect(await Bun.file(join(projectRoot, "records", "config.yml")).exists()).toBe(false);
	});

	it("rejects an invalid root-config directory pointer instead of guessing another Backlog folder", async () => {
		await seed(projectRoot);
		await Bun.write(
			join(projectRoot, "backlog.config.yml"),
			'project_name: "Invalid pointer"\nbacklog_directory: ../outside\n',
		);
		await expect(store.register("Invalid", projectRoot)).rejects.toThrow("Invalid backlog_directory");
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
	});

	it.each(["not a SQLite database", ""])("does not rebuild damaged or truncated databases: %j", async (content) => {
		await seed(projectRoot);
		await mkdir(dataDir);
		await Bun.write(store.databasePath, content);
		expect(() => store.list()).toThrow();
		await expect(store.register("Example", projectRoot)).rejects.toThrow();
		expect(await Bun.file(store.databasePath).text()).toBe(content);
	});

	it("does not add the project schema to an unrelated existing SQLite database", async () => {
		await seed(projectRoot);
		await mkdir(dataDir);
		const database = new Database(store.databasePath);
		database.exec("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('keep me')");
		database.close();
		const before = await Bun.file(store.databasePath).arrayBuffer();
		await expect(store.register("Example", projectRoot)).rejects.toThrow("no such table");
		expect(() => store.list()).toThrow("no such table");
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
	});

	it("reports a database path that cannot be opened", async () => {
		await seed(projectRoot);
		await mkdir(store.databasePath, { recursive: true });
		expect(() => store.list()).toThrow();
		await expect(store.register("Example", projectRoot)).rejects.toThrow();
	});

	it("bounds write-lock waiting and leaves the registered data unchanged", async () => {
		await seed(projectRoot);
		const record = await store.register("Existing", projectRoot);
		const otherRoot = join(testDir, "other");
		await seed(otherRoot);
		const blocker = new Database(store.databasePath);
		blocker.exec("BEGIN IMMEDIATE");
		try {
			const started = Date.now();
			await expect(store.register("Blocked", otherRoot)).rejects.toThrow("locked");
			const elapsed = Date.now() - started;
			expect(elapsed).toBeGreaterThanOrEqual(4500);
			expect(elapsed).toBeLessThan(8500);
		} finally {
			blocker.exec("ROLLBACK");
			blocker.close();
		}
		expect(store.list()).toEqual([record]);
	});

	it("opens two persisted project bindings with colliding TASK-1 IDs in independent contexts", async () => {
		const otherRoot = join(testDir, "other");
		for (const [root, title] of [
			[projectRoot, "Alpha work"],
			[otherRoot, "Beta work"],
		] as const) {
			const core = await seed(root);
			await core.fs.saveTask({
				id: "TASK-1",
				title,
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-10-21",
				rawContent: title,
			});
			await store.register(title, root);
		}
		const restored = new ProjectStore(dataDir);
		const registry = new ProjectContextRegistry();
		try {
			const contexts = await Promise.all(restored.list().map((project) => registry.open(project.id, project.rootPath)));
			const [alpha, beta] = contexts;
			if (!alpha || !beta) throw new Error("Fixture contexts missing.");
			expect((await alpha.core.getTask("TASK-1"))?.title).toBe("Alpha work");
			expect((await beta.core.getTask("TASK-1"))?.title).toBe("Beta work");
			await alpha.core.updateTaskFromInput("TASK-1", { title: "Alpha revised" }, false);
			expect((await beta.core.getTask("TASK-1"))?.title).toBe("Beta work");
		} finally {
			await registry.dispose();
		}
	});
});
