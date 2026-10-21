import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { DEFAULT_PERMISSIONS } from "../server/auth-types.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "  initial password with spaces  ";
const RESET_PASSWORD = "  reset password with spaces  ";

describe("server account and membership CLI", () => {
	let testDir: string;
	let dataDir: string;
	let store: AuthStore;
	const cli = getTestCliPath();

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-user-cli-");
		dataDir = join(testDir, "server-data");
		store = new AuthStore(dataDir);
	});
	afterEach(async () => {
		await safeCleanup(testDir);
	});

	async function run(command: string[], input?: string) {
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
	function args(...command: string[]) {
		return ["server", "--data-dir", dataDir, ...command];
	}

	it("creates initial admin and users with stdin passwords, versioned JSON and immutable usernames", async () => {
		const initialized = await run(
			args("user", "init-admin", " Root.Admin ", "--display-name", "Yönetici", "--password-stdin", "--json"),
			`${PASSWORD}\n`,
		);
		expect(initialized.exitCode).toBe(0);
		expect(initialized.stderr).toBe("");
		const admin = JSON.parse(initialized.stdout).user;
		expect(JSON.parse(initialized.stdout)).toMatchObject({
			schemaVersion: 1,
			kind: "server-user",
			user: { username: "root.admin", displayName: "Yönetici", role: "admin", mustChangePassword: true },
		});
		expect(initialized.stdout).not.toContain(PASSWORD);
		expect(initialized.stdout).not.toContain("passwordHash");
		expect((await store.login("root.admin", PASSWORD)).session.user.id).toBe(admin.id);
		const reinitialized = await run(args("user", "init-admin", "new-admin", "--password-stdin"), `${PASSWORD}\n`);
		expect(reinitialized.exitCode).toBe(1);
		expect(reinitialized.stderr).toContain("already configured");
		const created = await run(
			args("user", "create", "normal.user", "--display-name", "Normal Kullanıcı", "--password-stdin", "--json"),
			`${PASSWORD}\r\n`,
		);
		expect(created.exitCode).toBe(0);
		const user = JSON.parse(created.stdout).user;
		expect(user.role).toBe("user");
		const viewed = await run(args("user", "view", user.id, "--json"));
		expect(JSON.parse(viewed.stdout).user).toEqual(user);
		const listed = await run(args("user", "list", "--json"));
		expect(JSON.parse(listed.stdout)).toMatchObject({
			schemaVersion: 1,
			kind: "server-user-list",
			users: expect.arrayContaining([admin, user]),
		});
		const renamed = await run(args("user", "edit", user.id, "--display-name", "Yeni Ad", "--json"));
		expect(JSON.parse(renamed.stdout).user).toMatchObject({ username: "normal.user", displayName: "Yeni Ad" });
		expect((await run(args("user", "edit", user.id, "--username", "changed"))).exitCode).toBe(1);
	});

	it("supports password recovery and deactivation while revoking existing browser sessions", async () => {
		await store.initializeAdmin("admin", PASSWORD);
		const user = await store.createUser({ username: "normal", password: PASSWORD });
		const oldSession = await store.login("normal", PASSWORD);
		const reset = await run(args("user", "reset-password", user.id, "--password-stdin", "--json"), RESET_PASSWORD);
		expect(reset.exitCode).toBe(0);
		expect(JSON.parse(reset.stdout).user.mustChangePassword).toBe(true);
		expect(store.loadSession(oldSession.token)).toBeNull();
		const current = await store.login("normal", RESET_PASSWORD);
		const deactivated = await run(args("user", "edit", user.id, "--active", "false", "--json"));
		expect(JSON.parse(deactivated.stdout).user.active).toBe(false);
		expect(store.loadSession(current.token)).toBeNull();
		expect((await run(args("user", "edit", user.id, "--active", "maybe"))).exitCode).toBe(1);
	});

	it("preserves one active admin when independent CLI processes race to remove their roles", async () => {
		const first = await store.initializeAdmin("admin", PASSWORD);
		const second = await store.createUser({ username: "second", password: PASSWORD, role: "admin" });
		const results = await Promise.all([
			run(args("user", "edit", first.id, "--role", "user", "--json")),
			run(args("user", "edit", second.id, "--active", "false", "--json")),
		]);
		expect(results.map(({ exitCode }) => exitCode).sort()).toEqual([0, 1]);
		expect(results.find(({ exitCode }) => exitCode === 1)?.stderr).toContain("last active admin");
		expect(store.listUsers().filter((user) => user.active && user.role === "admin")).toHaveLength(1);
	});

	it("sets independent permission flags and removes membership using canonical project commands", async () => {
		await store.initializeAdmin("admin", PASSWORD);
		const user = await store.createUser({ username: "normal", password: PASSWORD });
		const root = join(testDir, "example");
		await initializeFilesystemTestProject(new Core(root), "Example");
		expect((await run(args("project", "register", root, "--name", "Example"))).exitCode).toBe(0);
		const added = await run(args("project", "member", "set", "1", user.id, "--json"));
		expect(added.exitCode).toBe(0);
		expect(JSON.parse(added.stdout)).toMatchObject({
			schemaVersion: 1,
			kind: "server-project-member",
			member: { projectId: "1", userId: user.id, permissions: DEFAULT_PERMISSIONS },
		});
		const updated = await run(
			args(
				"project",
				"member",
				"set",
				"1",
				user.id,
				"--tasks-write",
				"false",
				"--decisions-manage",
				"true",
				"--archive",
				"true",
				"--delete",
				"true",
				"--json",
			),
		);
		expect(JSON.parse(updated.stdout).member.permissions).toEqual({
			...DEFAULT_PERMISSIONS,
			tasksWrite: false,
			decisionsManage: true,
			archive: true,
			delete: true,
		});
		const listed = await run(args("project", "member", "list", "1", "--json"));
		expect(JSON.parse(listed.stdout)).toMatchObject({
			schemaVersion: 1,
			kind: "server-project-member-list",
			members: [JSON.parse(updated.stdout).member],
		});
		const removed = await run(args("project", "member", "remove", "1", user.id, "--json"));
		expect(JSON.parse(removed.stdout)).toEqual({
			schemaVersion: 1,
			kind: "server-project-member-remove",
			projectId: "1",
			userId: user.id,
		});
		expect(store.permissions(user, "1")).toBeNull();
	});

	it("never creates data from read commands or accepts a password as a visible argument", async () => {
		expect((await run(args("user", "list", "--json"))).exitCode).toBe(0);
		expect((await run(args("user", "view", "missing", "--json"))).exitCode).toBe(1);
		const noTerminal = await run(args("user", "init-admin", "admin"));
		expect(noTerminal.exitCode).toBe(1);
		expect(noTerminal.stderr).toContain("--password-stdin");
		expect((await run(args("user", "init-admin", "admin", "--password", PASSWORD))).exitCode).toBe(1);
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
	});

	it("documents account/member JSON and requires the public origin for server startup", async () => {
		for (const command of [
			["user", "init-admin"],
			["user", "create"],
			["user", "reset-password"],
			["project", "member", "set"],
		]) {
			const help = await run(["server", ...command, "--help"]);
			expect(help.exitCode).toBe(0);
			expect(help.stdout).toContain("schemaVersion 1 JSON");
			expect(help.stdout).toContain("server.sqlite");
		}
		const start = await run(args("start"));
		expect(start.exitCode).toBe(1);
		expect(start.stderr).toContain("--public-url");
		const help = await run(["server", "start", "--help"]);
		expect(help.stdout).toContain("--allow-http-loopback");
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
	});
});
