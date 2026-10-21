import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { ProjectStore } from "../server/project-store.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("server project CLI", () => {
	const cli = getTestCliPath();
	let testDir: string;
	let projectRoot: string;
	let dataDir: string;

	async function run(args: string[], cwd = testDir, env = process.env) {
		const child = Bun.spawn([process.execPath, cli, ...args], {
			cwd,
			env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, exitCode };
	}

	function args(...values: string[]) {
		return ["server", "--data-dir", dataDir, "project", ...values];
	}

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-server-cli-");
		projectRoot = join(testDir, "project");
		dataDir = join(testDir, "data");
		await initializeFilesystemTestProject(new Core(projectRoot), "Source name");
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("registers, views, and lists the same project in separate processes with versioned JSON", async () => {
		const registered = await run(args("register", "./project", "--name", "Display name", "--json"));
		expect(registered.stderr).toBe("");
		expect(registered.exitCode).toBe(0);
		const record = JSON.parse(registered.stdout);
		expect(record).toMatchObject({
			schemaVersion: 1,
			kind: "server-project",
			project: { id: "1", name: "Display name" },
		});
		const viewed = await run(args("view", record.project.id, "--json"));
		expect(viewed.exitCode).toBe(0);
		expect(JSON.parse(viewed.stdout)).toEqual(record);
		const listed = await run(args("list", "--json"));
		expect(listed.exitCode).toBe(0);
		expect(JSON.parse(listed.stdout)).toEqual({
			schemaVersion: 1,
			kind: "server-project-list",
			projects: [record.project],
		});
		const text = await run(args("view", record.project.id));
		expect(text.stdout).toContain("1 - Display name");
		expect(text.stdout).toContain(`Root: ${record.project.rootPath}`);
		expect(text.stdout).toContain(`Registered: ${record.project.createdAt}`);
	});

	it("returns an empty list and unknown-ID errors without creating server state", async () => {
		const listed = await run(args("list", "--json"));
		expect(listed.exitCode).toBe(0);
		expect(JSON.parse(listed.stdout).projects).toEqual([]);
		const text = await run(args("list"));
		expect(text.stdout).toContain("No server projects registered.");
		const viewed = await run(args("view", "1", "--json"));
		expect(viewed.exitCode).toBe(1);
		expect(viewed.stdout).toBe("");
		expect(viewed.stderr).toContain('Server project "1" was not found');
		expect(await Bun.file(join(dataDir, "server.sqlite")).exists()).toBe(false);
	});

	it("requires explicit data directory, display name, and a valid numeric ID", async () => {
		for (const command of [
			["server", "project", "list"],
			args("register", projectRoot),
			args("register", projectRoot, "--name", " "),
			["server", "--data-dir", " ", "project", "list"],
			args("view", "invalid"),
		]) {
			const result = await run(command);
			expect(result.exitCode).toBe(1);
			expect(result.stdout).toBe("");
		}
		expect(await Bun.file(join(dataDir, "server.sqlite")).exists()).toBe(false);
	});

	it("does not migrate a legacy cwd project or the project being registered", async () => {
		const cwd = join(testDir, "legacy-cwd");
		const legacyDir = join(cwd, ".backlog");
		await mkdir(legacyDir, { recursive: true });
		const legacyConfig = 'project_name: "Legacy"\nstatuses: ["To Do", "Done"]\nmilestones: ["Keep as config"]\n';
		const legacyPath = join(legacyDir, "config.yml");
		await Bun.write(legacyPath, legacyConfig);
		const sourceConfigPath = join(projectRoot, "backlog", "config.yml");
		const sourceConfig = 'project_name: "Source legacy"\nstatuses: ["To Do", "Done"]\nmilestones: ["Do not migrate"]\n';
		await Bun.write(sourceConfigPath, sourceConfig);
		for (const command of [args("list"), args("register", projectRoot, "--name", "Registered"), args("view", "1")]) {
			const result = await run(command, cwd);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
		}
		expect(await Bun.file(legacyPath).text()).toBe(legacyConfig);
		expect(await Bun.file(sourceConfigPath).text()).toBe(sourceConfig);
		expect(await Bun.file(join(legacyDir, "milestones", "m-0 - Keep-as-config.md")).exists()).toBe(false);
	});

	it("uses explicit relative paths from cwd while ignoring BACKLOG_CWD", async () => {
		const result = await run(
			["server", "--data-dir", "./relative-data", "project", "register", "./project", "--name", "Relative", "--json"],
			testDir,
			{ ...process.env, BACKLOG_CWD: join(testDir, "does-not-exist") },
		);
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout).project.rootPath).toBe(projectRoot);
		expect(new ProjectStore(join(testDir, "relative-data")).list()).toHaveLength(1);
	});

	it("returns metadata even when the recorded source directory is temporarily unavailable", async () => {
		expect((await run(args("register", projectRoot, "--name", "Offline"))).exitCode).toBe(0);
		await rename(projectRoot, join(testDir, "moved"));
		const viewed = await run(args("view", "1", "--json"));
		expect(viewed.exitCode).toBe(0);
		expect(JSON.parse(viewed.stdout).project.rootPath).toBe(projectRoot);
	});

	it("does not recreate or overwrite a damaged database", async () => {
		await mkdir(dataDir);
		const databasePath = join(dataDir, "server.sqlite");
		await Bun.write(databasePath, "damaged database, keep evidence");
		for (const command of [
			args("list", "--json"),
			args("view", "1"),
			args("register", projectRoot, "--name", "Example"),
		]) {
			const result = await run(command);
			expect(result.exitCode).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain("not a database");
		}
		expect(await Bun.file(databasePath).text()).toBe("damaged database, keep evidence");
	});

	it("creates a single record for racing registrations through real paths and aliases", async () => {
		const alias = join(testDir, "alias");
		await symlink(projectRoot, alias, "dir");
		const results = await Promise.all([
			run(args("register", projectRoot, "--name", "First", "--json")),
			run(args("register", alias, "--name", "Second", "--json")),
		]);
		expect(results.map((result) => result.exitCode).sort()).toEqual([0, 1]);
		expect(new ProjectStore(dataDir).list()).toHaveLength(1);
		const duplicate = await run(args("register", alias, "--name", "Renamed"));
		expect(duplicate.exitCode).toBe(1);
		expect(duplicate.stderr).toContain("already registered as project 1");
	});

	it("serializes overlapping registrations in separate processes without partial records", async () => {
		await run(args("register", projectRoot, "--name", "Initial"));
		const parent = join(testDir, "parent");
		const child = join(parent, "child");
		await initializeFilesystemTestProject(new Core(parent), "Parent");
		await initializeFilesystemTestProject(new Core(child), "Child");
		const results = await Promise.all([
			run(args("register", parent, "--name", "Parent", "--json")),
			run(args("register", child, "--name", "Child", "--json")),
		]);
		expect(results.map((result) => result.exitCode).sort()).toEqual([0, 1]);
		expect(results.find((result) => result.exitCode === 1)?.stderr).toContain("overlaps project");
		expect(new ProjectStore(dataDir).list()).toHaveLength(2);
	});

	it("documents paths, persistent IDs, writes, and JSON on the shipped help surface", async () => {
		for (const command of ["register", "list", "view"]) {
			const help = await run(["server", "project", command, "--help"]);
			expect(help.exitCode).toBe(0);
			expect(help.stdout).toContain("--data-dir");
			expect(help.stdout).toContain("schemaVersion 1 JSON");
			expect(help.stdout).toContain("server.sqlite");
		}
		const rootHelp = await run(["--help"]);
		expect(rootHelp.stdout).toContain("server");
		const serverHelp = await run(["server", "--help"]);
		expect(serverHelp.stdout).toContain("BACKLOG_CWD is not used");
		expect(await Bun.file(join(dataDir, "server.sqlite")).exists()).toBe(false);
	});
});
