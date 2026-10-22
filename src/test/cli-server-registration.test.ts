import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { ProjectStore } from "../server/project-store.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("server registration CLI", () => {
	const cli = getTestCliPath();
	let root: string;
	let data: string;
	let path: string;
	async function run(...values: string[]) {
		const child = Bun.spawn([process.execPath, cli, "server", "--data-dir", data, ...values], {
			cwd: root,
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
	beforeEach(async () => {
		root = await createTestDirOutsideRepository("backlog-server-registration-cli-");
		data = join(root, "data");
		path = join(root, "project");
		await initializeFilesystemTestProject(new Core(path), "Source name");
	});
	afterEach(async () => {
		await safeCleanup(root);
	});

	it("previews in another working directory without creating server data or changing sources", async () => {
		const configPath = join(path, "backlog", "config.yml");
		const before = await Bun.file(configPath).text();
		const response = await run("project", "preview", "./project", "--name", "Displayed", "--json");
		expect(response.exitCode).toBe(0);
		expect(response.stderr).toBe("");
		expect(JSON.parse(response.stdout)).toMatchObject({
			schemaVersion: 1,
			kind: "server-project-preview",
			preview: {
				name: "Displayed",
				rootPath: path,
				canRegister: true,
				counts: { tasks: 0, documents: 0, decisions: 0 },
			},
		});
		expect(existsSync(data)).toBe(false);
		expect(await Bun.file(configPath).text()).toBe(before);
		const text = await run("project", "preview", path, "--name", "Displayed");
		expect(text.exitCode).toBe(0);
		expect(text.stdout).toContain("Can register: true");
		expect(text.stdout).toContain("Source name");
	});

	it("reports an unprepared directory without creating Backlog files", async () => {
		const unprepared = join(root, "unprepared");
		await mkdir(unprepared);
		const preview = await run("project", "preview", unprepared, "--name", "Empty", "--json");
		expect(preview.exitCode).toBe(0);
		expect(JSON.parse(preview.stdout).preview.canRegister).toBe(false);
		expect((await run("project", "register", unprepared, "--name", "Empty")).exitCode).toBe(1);
		expect(existsSync(join(unprepared, "backlog"))).toBe(false);
		expect(existsSync(data)).toBe(false);
	});

	it("retains project metadata and membership across tracking commands and rejects invalid reactivation", async () => {
		const auth = new AuthStore(data);
		await auth.initializeAdmin("admin", "initial cli registration password");
		const member = await auth.createUser({ username: "member", password: "initial cli registration password" });
		expect((await run("project", "register", path, "--name", "Tracked", "--json")).exitCode).toBe(0);
		auth.setMember("1", member.id);
		const before = new ProjectStore(data).load("1");
		const members = auth.listMembers("1");
		const stopped = await run("project", "tracking", "1", "--enabled", "false", "--json");
		expect(stopped.exitCode).toBe(0);
		expect(JSON.parse(stopped.stdout).project).toEqual({ ...before, tracking: false });
		expect(JSON.parse((await run("project", "view", "1", "--json")).stdout).project.tracking).toBe(false);
		expect(JSON.parse((await run("project", "list", "--json")).stdout).projects).toHaveLength(1);
		await rename(path, `${path}-moved`);
		expect((await run("project", "tracking", "1", "--enabled", "true")).exitCode).toBe(1);
		expect(new ProjectStore(data).load("1")?.tracking).toBe(false);
		await rename(`${path}-moved`, path);
		const resumed = await run("project", "tracking", "1", "--enabled", "true", "--json");
		expect(resumed.exitCode).toBe(0);
		expect(JSON.parse(resumed.stdout).project).toEqual(before);
		expect(auth.listMembers("1")).toEqual(members);
		expect((await run("project", "tracking", "1", "--enabled", "yes")).exitCode).toBe(1);
	});

	it("manages personal areas through versioned JSON and preserves existing project membership", async () => {
		const empty = await run("folder-area", "list", "--json");
		expect(empty.exitCode).toBe(0);
		expect(JSON.parse(empty.stdout)).toEqual({ schemaVersion: 1, kind: "server-folder-area-list", areas: [] });
		expect(existsSync(data)).toBe(false);
		const auth = new AuthStore(data);
		await auth.initializeAdmin("admin", "initial cli registration password");
		const member = await auth.createUser({ username: "member", password: "initial cli registration password" });
		const other = await auth.createUser({ username: "other", password: "initial cli registration password" });
		const created = await run("folder-area", "set", member.id, path, "--json");
		expect(created.exitCode).toBe(0);
		const record = JSON.parse(created.stdout);
		expect(record).toMatchObject({
			schemaVersion: 1,
			kind: "server-folder-area",
			area: { userId: member.id, rootPath: path },
		});
		expect((await run("folder-area", "set", other.id, root)).exitCode).toBe(1);
		expect(JSON.parse((await run("folder-area", "list", "--user", member.id, "--json")).stdout).areas).toEqual([
			record.area,
		]);
		expect(JSON.parse((await run("folder-area", "list", "--user", other.id, "--json")).stdout).areas).toEqual([]);
		await new ProjectStore(data).register("Member project", path, member.id);
		const members = auth.listMembers("1");
		const removed = await run("folder-area", "remove", record.area.id, "--json");
		expect(removed.exitCode).toBe(0);
		expect(JSON.parse(removed.stdout)).toEqual({
			schemaVersion: 1,
			kind: "server-folder-area-remove",
			id: record.area.id,
		});
		expect(auth.listMembers("1")).toEqual(members);
	});

	it("documents new capabilities on shipped help with source preservation and JSON schemas", async () => {
		for (const command of [
			["project", "preview"],
			["project", "tracking"],
			["folder-area", "list"],
			["folder-area", "set"],
			["folder-area", "remove"],
		]) {
			const response = await run(...command, "--help");
			expect(response.exitCode).toBe(0);
			expect(response.stdout).toContain("--data-dir");
			expect(response.stdout).toContain("schemaVersion 1 JSON");
		}
	});
});
