import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cp, mkdir, rename, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { Core } from "../core/backlog.ts";
import { BacklogServer, type ProjectReadContext } from "../server/index.ts";
import type { ObservedPathSnapshot } from "../server/observation-types.ts";
import { assertProjectBoundary, readProjectFile } from "../server/project-paths.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const authorized = { check: () => null };
const SOURCE = "---\nid: TASK-1\ntitle: Safe source\nstatus: To Do\n---\nSafe content.\n";
const SECRET = "---\nid: TASK-1\ntitle: PRIVATE_EXTERNAL_SENTINEL\nstatus: To Do\n---\nPRIVATE_EXTERNAL_SENTINEL\n";

async function waitFor(predicate: () => boolean): Promise<void> {
	const until = Date.now() + 4000;
	while (!predicate()) {
		if (Date.now() > until) throw new Error("Expected asynchronous condition was not observed.");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

describe("registered project boundaries", () => {
	let testDir: string;
	let root: string;
	let core: Core;
	let store: ProjectStore;
	const handlers: BacklogServer[] = [];

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("server-boundary-");
		root = join(testDir, "project");
		core = new Core(root);
		await initializeFilesystemTestProject(core, "Safe source");
		await Bun.write(join(core.fs.tasksDir, "task-1 - Safe.md"), SOURCE);
		store = new ProjectStore(join(testDir, "central"));
	});
	afterEach(async () => {
		await Promise.all(handlers.splice(0).map((handler) => handler.stop()));
		await safeCleanup(testDir);
	});

	function handler(): BacklogServer {
		const server = new BacklogServer(root, { centralMode: true });
		handlers.push(server);
		return server;
	}
	function read(server: BacklogServer, path = "/api/tasks"): Promise<Response> {
		const context: ProjectReadContext = {
			recordKeyFor: (kind, visibleId, recordPath) => `${kind}:${visibleId}:${recordPath}`,
		};
		return server.dispatchApi(new Request(`http://localhost${path}`), path, authorized, context);
	}

	it.each(["root-config", "folder-config", "unused-config", "backlog-dir", "record", "nested-doc-dir", "asset"])(
		"rejects escaping %s links without reading foreign contents",
		async (kind) => {
			const outside = join(testDir, "outside");
			await mkdir(outside);
			await Bun.write(join(outside, "config.yml"), 'project_name: "PRIVATE_EXTERNAL_SENTINEL"\n');
			await Bun.write(join(outside, "task.md"), SECRET);
			await Bun.write(join(outside, "asset.txt"), "PRIVATE_EXTERNAL_SENTINEL");
			let link: string;
			let target: string;
			if (kind === "root-config") {
				link = join(root, "backlog.config.yml");
				target = join(outside, "config.yml");
			} else if (kind === "folder-config") {
				link = core.fs.configFilePath;
				target = join(outside, "config.yml");
				await rename(link, `${link}.safe`);
			} else if (kind === "unused-config") {
				link = join(core.fs.backlogDir, "config.yaml");
				target = join(outside, "config.yml");
			} else if (kind === "backlog-dir") {
				link = core.fs.backlogDir;
				target = outside;
				await rename(link, `${link}.safe`);
			} else if (kind === "record") {
				link = join(core.fs.tasksDir, "task-2 - External.md");
				target = join(outside, "task.md");
			} else if (kind === "nested-doc-dir") {
				link = join(core.fs.docsDir, "external");
				target = outside;
			} else {
				link = join(core.fs.backlogDir, "assets", "leak.txt");
				target = join(outside, "asset.txt");
				await mkdir(join(core.fs.backlogDir, "assets"));
			}
			await symlink(target, link);
			const preview = await store.preview("Attempt", root);
			expect(preview.canRegister).toBe(false);
			expect(JSON.stringify(preview)).not.toContain("PRIVATE_EXTERNAL_SENTINEL");
			await expect(store.register("Attempt", root)).rejects.toMatchObject({ status: 400 });
			expect(() => assertProjectBoundary(root)).toThrow();
			expect(await Bun.file(store.databasePath).exists()).toBe(false);
			expect(await Bun.file(join(outside, "task.md")).text()).toBe(SECRET);
		},
	);

	it("rejects a custom Backlog pointer whose real target leaves the registered root", async () => {
		const outside = join(testDir, "outside");
		await mkdir(outside);
		await symlink(outside, join(root, "custom"));
		await Bun.write(join(root, "backlog.config.yml"), 'project_name: "Custom"\nbacklog_directory: custom\n');
		expect((await store.preview("Custom", root)).canRegister).toBe(false);
		await expect(store.register("Custom", root)).rejects.toMatchObject({ status: 400 });
	});

	it("allows in-root directory/config/record/asset links and reads their opened bytes", async () => {
		const local = join(root, "local");
		await mkdir(local);
		await Bun.write(join(local, "task.md"), SOURCE);
		await rename(core.fs.tasksDir, join(local, "tasks"));
		await symlink(join(local, "tasks"), core.fs.tasksDir);
		await rename(core.fs.configFilePath, join(local, "config.yml"));
		await symlink(join(local, "config.yml"), core.fs.configFilePath);
		await symlink(join(local, "task.md"), join(core.fs.tasksDir, "task-2 - Alias.md"));
		await mkdir(join(local, "assets"));
		await Bun.write(join(local, "assets", "asset.txt"), "Safe asset");
		await symlink(join(local, "assets"), join(core.fs.backlogDir, "assets"));
		await symlink(join(local, "assets", "asset.txt"), join(core.fs.backlogDir, "assets", "linked.txt"));
		expect((await store.preview("Local links", root)).canRegister).toBe(true);
		expect(readProjectFile(root, join(core.fs.backlogDir, "assets", "linked.txt")).toString()).toBe("Safe asset");
		await store.register("Local links", root);
		expect((await read(handler(), "/assets/linked.txt")).status).toBe(200);
	});

	it("denies a root directory replaced by an external alias instead of silently moving the binding", async () => {
		await store.register("Pinned", root);
		const original = `${root}.original`;
		await rename(root, original);
		const outside = join(testDir, "outside");
		await mkdir(outside);
		await symlink(outside, root);
		expect(() => assertProjectBoundary(root)).toThrow("real location");
		await store.setTracking("1", false);
		await expect(store.setTracking("1", true)).rejects.toMatchObject({ status: 400 });
		expect(store.load("1")?.tracking).toBe(false);
	});

	it("blocks cached responses and WebSocket sends when a record link changes after startup", async () => {
		const server = handler();
		expect((await read(server)).status).toBe(200);
		const sent: string[] = [];
		let closed = false;
		const socket = {
			send: (message: string) => sent.push(message),
			close: () => {
				closed = true;
			},
		} as unknown as ServerWebSocket<unknown>;
		server.acceptSocket(socket, () => true);
		sent.length = 0;
		const external = join(testDir, "private.md");
		await Bun.write(external, SECRET);
		const task = join(core.fs.tasksDir, "task-1 - Safe.md");
		await rename(task, `${task}.safe`);
		await symlink(external, task);
		const response = await read(server);
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("PRIVATE_EXTERNAL_SENTINEL");
		(server as unknown as { broadcastConfigUpdated(): void }).broadcastConfigUpdated();
		expect(closed).toBe(true);
		expect(sent).toEqual([]);
	});

	it.each(["task", "config"])(
		"a transient external %s link cannot fill central caches before observation",
		async (kind) => {
			const server = handler();
			expect((await read(server)).status).toBe(200);
			const contentStore = await (server as unknown as { core: Core }).core.getContentStore();
			const beforeVersion = contentStore.publicationVersion();
			const localPath = kind === "task" ? join(core.fs.tasksDir, "task-1 - Safe.md") : core.fs.configFilePath;
			const external = join(testDir, kind === "task" ? "private.md" : "private.yml");
			await Bun.write(
				external,
				kind === "task" ? SECRET : 'project_name: "PRIVATE_EXTERNAL_SENTINEL"\nstatuses: ["To Do"]\n',
			);
			await rename(localPath, `${localPath}.safe`);
			await symlink(external, localPath);
			const unsafe = await server.scanObservedFiles();
			expect(unsafe.problems.length).toBeGreaterThan(0);
			expect(JSON.stringify(unsafe)).not.toContain("PRIVATE_EXTERNAL_SENTINEL");
			expect(contentStore.publicationVersion()).toBe(beforeVersion);
			await unlink(localPath);
			await rename(`${localPath}.safe`, localPath);
			const response = await read(server);
			expect(response.status).toBe(200);
			expect(await response.text()).toContain("Safe source");
		},
	);

	it("keeps an ordinary removed record from poisoning the handler", async () => {
		const server = handler();
		expect((await read(server)).status).toBe(200);
		const task = join(core.fs.tasksDir, "task-1 - Safe.md");
		await unlink(task);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect((await read(server)).status).toBe(200);
		await Bun.write(task, SOURCE);
		expect((await read(server)).status).toBe(200);
	});

	it("publishes a new bound revision after observed Markdown bytes are committed", async () => {
		const server = handler();
		const opened = (await (await read(server)).json()) as Array<{ title: string; revision: string }>;
		const original = opened[0];
		if (!original) throw new Error("Seed task was not listed");
		const contentStore = await (server as unknown as { core: Core }).core.getContentStore();
		const beforeVersion = contentStore.publicationVersion();
		const task = join(core.fs.tasksDir, "task-1 - Safe.md");
		await Bun.write(task, SOURCE.replace("\n---\nSafe content.", "\n# preserved comment\n---\nSafe content."));
		const scanned = await server.scanObservedFiles();
		expect(scanned.problems).toEqual([]);
		await server.publishObservedFiles(
			scanned.entries.map((entry) => ({ ...entry, recordKey: `test:${entry.path}` })) satisfies ObservedPathSnapshot[],
		);
		expect(contentStore.publicationVersion()).toBeGreaterThan(beforeVersion);
		const changed = (await (await read(server)).json()) as Array<{ title: string; revision: string }>;
		expect(changed[0]?.title).toBe(original.title);
		expect(changed[0]?.revision).not.toBe(original.revision);
	});

	it("guards a previous handler layout after root config switches to a new Backlog tree", async () => {
		const server = handler();
		expect((await read(server)).status).toBe(200);
		const next = join(root, "planning", "records");
		await cp(core.fs.backlogDir, next, { recursive: true });
		await Bun.write(
			join(root, "backlog.config.yml"),
			'project_name: "Moved"\nbacklog_directory: planning/records\nstatuses: ["To Do"]\n',
		);
		const filesystem = (server as unknown as { core: Core }).core.filesystem;
		filesystem.invalidateConfigCache();
		expect(filesystem.backlogDir).toBe(next);
		expect((await read(server)).status).toBe(200);
		const outside = join(testDir, "outside");
		await mkdir(outside);
		await rename(core.fs.tasksDir, `${core.fs.tasksDir}.safe`);
		await symlink(outside, core.fs.tasksDir);
		// The currently selected tree is safe; the old watcher/handler tree is not.
		expect(() => assertProjectBoundary(root)).not.toThrow();
		expect((await read(server)).status).toBe(503);
	});

	it("rechecks an asynchronous response before releasing the bytes", async () => {
		const server = handler();
		const internals = server as unknown as { handleListTasks(req: Request): Promise<Response> };
		let release: (() => void) | undefined;
		let started = false;
		internals.handleListTasks = async () => {
			started = true;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return Response.json({ title: "Should not be delivered" });
		};
		const pending = read(server);
		await waitFor(() => started);
		const outside = join(testDir, "private.txt");
		await Bun.write(outside, "PRIVATE_EXTERNAL_SENTINEL");
		await mkdir(join(core.fs.backlogDir, "assets"));
		await symlink(outside, join(core.fs.backlogDir, "assets", "changed.txt"));
		release?.();
		const response = await pending;
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("Should not be delivered");
	});
});
