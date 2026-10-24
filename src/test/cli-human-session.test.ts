import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { CentralServer } from "../server/central.ts";
import { ServerClient } from "../server/client.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { MutationStore } from "../server/mutation-store.ts";
import { ProjectStore } from "../server/project-store.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const initial = "  human initial password  ";
const changed = "  human changed password  ";

describe("human CLI sessions", () => {
	let root: string;
	let auth: AuthStore;
	let server: CentralServer;
	let base: string;
	let file: string;
	let adminId: string;
	const cli = getTestCliPath();
	const options = () => ({ serverUrl: base, serverProject: "1", sessionFile: file, allowHttpLoopback: true });

	beforeEach(async () => {
		root = await createTestDirOutsideRepository("human-cli-");
		file = join(root, "session.json");
		const core = new Core(join(root, "project"));
		await initializeFilesystemTestProject(core, "Human CLI");
		await core.fs.saveTask({
			id: "TASK-1",
			title: "Original",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-23",
		});
		await new ProjectStore(join(root, "data")).register("Human CLI", join(root, "project"));
		auth = new AuthStore(join(root, "data"));
		adminId = (await auth.initializeAdmin("admin", initial)).id;
		const port = await findNextAvailablePort(42000);
		if (!port) throw new Error("No port available");
		base = `http://127.0.0.1:${port}`;
		server = new CentralServer(join(root, "data"));
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
	});
	afterEach(async () => {
		await server?.stop();
		await safeCleanup(root);
	});

	async function run(args: string[], input = "") {
		const child = Bun.spawn(
			[process.execPath, cli, "--server-url", base, "--allow-http-loopback", "--session-file", file, ...args],
			{ cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
		);
		child.stdin.write(input);
		child.stdin.end();
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, code };
	}

	it("logs in, changes the required password, edits as the human and logs out through the real CLI", async () => {
		const login = await run(["auth", "login", "--username", "admin", "--password-stdin", "--json"], `${initial}\n`);
		expect(login.code, login.stderr).toBe(0);
		expect(JSON.parse(login.stdout).user.mustChangePassword).toBe(true);
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect(await readFile(file, "utf8")).not.toContain(initial);
		const blocked = await run(["--server-project", "1", "task", "view", "TASK-1", "--json"]);
		expect(blocked.code).not.toBe(0);
		const password = await run(
			["auth", "password", "--passwords-stdin", "--json"],
			JSON.stringify({ currentPassword: initial, newPassword: changed }),
		);
		expect(password.code, password.stderr).toBe(0);
		const client = await ServerClient.connect(options());
		const task = await client.read<{ revision: string }>("tasks/TASK-1");
		const edited = await run([
			"--server-project",
			"1",
			"--if-match",
			task.revision,
			"task",
			"edit",
			"TASK-1",
			"--title",
			"Human edited",
		]);
		expect(edited.code, edited.stderr).toBe(0);
		const event = new MutationStore(join(root, "data")).listHistory({ scope: { kind: "project", projectId: "1" } })
			.items[0];
		expect(event).toMatchObject({ actor: { kind: "user", userId: adminId }, source: "server-cli" });
		const session = JSON.parse(await readFile(file, "utf8"));
		const logout = await run(["auth", "logout", "--json"]);
		expect(logout.code, logout.stderr).toBe(0);
		expect(auth.loadSession(session.token)).toBeNull();
		expect(await Bun.file(file).exists()).toBe(false);
		for (const output of [login.stdout, password.stdout, logout.stdout]) {
			expect(output).not.toContain(session.token);
			expect(output).not.toContain(initial);
			expect(output).not.toContain(changed);
		}
	});

	it("enforces origin binding, file permissions, symlink rejection and exclusive credential selection", async () => {
		await ServerClient.auth(options(), "login", { username: "admin", password: initial });
		await expect(ServerClient.connect({ ...options(), agentKeyFile: "other" })).rejects.toThrow("either");
		await expect(ServerClient.connect({ ...options(), serverUrl: "http://127.0.0.1:1" })).rejects.toThrow(
			"different server",
		);
		await chmod(file, 0o644);
		await expect(ServerClient.connect(options())).rejects.toThrow("0600");
		await chmod(file, 0o600);
		await symlink(file, join(root, "linked-session"));
		await expect(ServerClient.connect({ ...options(), sessionFile: join(root, "linked-session") })).rejects.toThrow();
		await expect(
			ServerClient.auth({ ...options(), sessionFile: join(root, "project", "session") }, "login", {
				username: "admin",
				password: initial,
			}),
		).rejects.toThrow("outside");
	});

	it("preserves read-only access and immediately applies session revocation", async () => {
		const user = await auth.createUser({ username: "reader", password: initial });
		const login = await auth.login("reader", initial);
		await auth.changePassword(login.token, initial, changed);
		auth.setMember("1", user.id, { tasksWrite: false, docsWrite: false });
		await ServerClient.auth(options(), "login", { username: "reader", password: changed });
		const client = await ServerClient.connect(options());
		const task = await client.read<{ title: string; revision: string }>("tasks/TASK-1");
		expect(task.title).toBe("Original");
		await expect(
			client.write("tasks/TASK-1", "PUT", { title: "Forbidden" }, { revision: task.revision }),
		).rejects.toMatchObject({ status: 403 });
		auth.editUser(user.id, { active: false });
		await expect(client.read("tasks/TASK-1")).rejects.toMatchObject({ status: 401 });
	});

	it("rejects a forged CSRF token without changing the task", async () => {
		await ServerClient.auth(options(), "login", { username: "admin", password: initial });
		await ServerClient.auth(options(), "password", { currentPassword: initial, newPassword: changed });
		const raw = JSON.parse(await readFile(file, "utf8"));
		await writeFile(file, JSON.stringify({ ...raw, csrfToken: "wrong" }));
		await expect(ServerClient.connect(options())).rejects.toMatchObject({ status: 403 });
		await writeFile(file, JSON.stringify(raw));
		const client = await ServerClient.connect(options());
		expect((await client.read<{ title: string }>("tasks/TASK-1")).title).toBe("Original");
	});

	it("does not echo malformed password or session input in CLI errors", async () => {
		const secret = "never echo this credential";
		const result = await run(["auth", "password", "--passwords-stdin"], secret);
		expect(result.code).not.toBe(0);
		expect(result.stderr + result.stdout).not.toContain(secret);
		await writeFile(file, secret, { mode: 0o600 });
		await expect(ServerClient.connect(options())).rejects.toThrow("Invalid session file");
	});

	it("does not migrate a local project when a server-only command lacks connection options", async () => {
		const cwd = join(root, "legacy");
		const directory = join(cwd, ".backlog");
		await mkdir(directory, { recursive: true });
		const path = join(directory, "config.yml");
		const config = 'project_name: "Keep local"\nstatuses: ["To Do", "Done"]\nmilestones: ["Keep as config"]\n';
		await writeFile(path, config);
		for (const args of [
			["auth", "login", "--username", "admin", "--password-stdin"],
			["reviews", "list"],
			["history", "list"],
			["operation", "view", "missing"],
		]) {
			const child = Bun.spawn([process.execPath, cli, ...args], {
				cwd,
				env: { ...process.env, BACKLOG_CWD: cwd },
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});
			child.stdin.write(`${initial}\n`);
			child.stdin.end();
			const [code] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(code).not.toBe(0);
			expect(await readFile(path, "utf8")).toBe(config);
		}
		expect(await Bun.file(join(directory, "milestones", "m-0 - Keep-as-config.md")).exists()).toBe(false);
	});
});
