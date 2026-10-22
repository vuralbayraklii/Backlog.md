import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { lstatSync, readdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import { mkdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore, AuthStoreError } from "../server/auth-store.ts";
import { DEFAULT_PERMISSIONS } from "../server/auth-types.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "a prepared project password";

function snapshot(root: string): unknown {
	const entries: [string, string][] = [];
	const visit = (path: string, prefix: string) => {
		for (const name of readdirSync(path).sort()) {
			const absolute = join(path, name);
			const relative = join(prefix, name);
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink()) entries.push([relative, `link:${readlinkSync(absolute)}`]);
			else if (stat.isDirectory()) visit(absolute, relative);
			else entries.push([relative, new Bun.CryptoHasher("sha256").update(readFileSync(absolute)).digest("hex")]);
		}
	};
	visit(root, "");
	return entries;
}

async function prepared(root: string, directory?: string): Promise<Core> {
	const core = new Core(root);
	await initializeFilesystemTestProject(core, "Existing source", directory);
	await Bun.write(
		join(core.fs.tasksDir, "task-1 - Existing.md"),
		"---\nid: TASK-1\ntitle: Existing\nstatus: To Do\n---\nKeep source bytes.\n",
	);
	return core;
}

describe("read-only central project registration", () => {
	let testDir: string;
	let root: string;
	let data: string;
	let store: ProjectStore;
	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("server-registration-");
		root = join(testDir, "area", "project");
		data = join(testDir, "central");
		store = new ProjectStore(data);
	});
	afterEach(async () => safeCleanup(testDir));

	it.each(["backlog", ".backlog", "planning/records"])(
		"previews and tracks %s without changing source hashes",
		async (directory) => {
			const core = await prepared(root, directory);
			await Bun.write(
				join(core.fs.docsDir, "nested", "doc-1.md"),
				"---\nid: doc-1\ntitle: Notes\n---\nSource notes.\n",
			);
			await Bun.write(
				join(core.fs.decisionsDir, "decision-1.md"),
				"---\nid: decision-1\ntitle: Choice\nstatus: proposed\n---\nSource decision.\n",
			);
			await Bun.write(
				join(core.fs.backlogDir, "drafts", "draft-1 - Planned.md"),
				"---\nid: DRAFT-1\ntitle: Planned\nstatus: To Do\n---\nSource draft.\n",
			);
			await Bun.write(
				join(core.fs.archiveTasksDir, "task-2 - Archived.md"),
				"---\nid: TASK-2\ntitle: Archived\nstatus: Done\n---\nSource archive.\n",
			);
			const before = snapshot(root);
			const preview = await store.preview("  Display  ", root);
			expect(preview).toMatchObject({
				name: "Display",
				rootPath: root,
				backlogPath: core.fs.backlogDir,
				counts: { tasks: 1, drafts: 1, documents: 1, decisions: 1, archived: 1 },
				canRegister: true,
				issues: [],
			});
			expect(await Bun.file(store.databasePath).exists()).toBe(false);
			expect(snapshot(root)).toEqual(before);
			const project = await store.register("Display", root);
			expect(snapshot(root)).toEqual(before);
			expect(await store.setTracking(project.id, false)).toEqual({ ...project, tracking: false });
			expect(snapshot(root)).toEqual(before);
			expect(await store.setTracking(project.id, true)).toEqual(project);
			expect(snapshot(root)).toEqual(before);
		},
	);

	it("reports each malformed, missing, drifted and colliding record without rewriting or hiding it", async () => {
		const core = await prepared(root);
		await Bun.write(
			join(core.fs.tasksDir, "task-01 - Duplicate.md"),
			"---\nid: TASK-01\ntitle: Duplicate\nstatus: To Do\n---\n",
		);
		await Bun.write(
			join(core.fs.tasksDir, "task-2 - Broken.md"),
			"---\nid: TASK-2\ndependencies: [{nested: true}]\n---\n",
		);
		await Bun.write(join(core.fs.tasksDir, "task-3 - Missing.md"), "---\ntitle: Missing ID\nstatus: To Do\n---\n");
		await Bun.write(
			join(core.fs.backlogDir, "drafts", "draft-1 - Drift.md"),
			"---\nid: DRAFT-9\ntitle: Drift\nstatus: To Do\n---\n",
		);
		await Bun.write(join(core.fs.docsDir, "doc-1.md"), "---\nid: doc-1\ntitle: Notes\n---\n");
		await Bun.write(join(core.fs.docsDir, "nested", "doc-01.md"), "---\nid: DOC-01\ntitle: Duplicate\n---\n");
		await Bun.write(join(core.fs.docsDir, "missing.md"), "---\ntitle: Missing\n---\n");
		await Bun.write(join(core.fs.decisionsDir, "decision-1.md"), "---\ninvalid: [\n---\n");
		const before = snapshot(root);
		const preview = await store.preview("Existing", root);
		expect(preview.canRegister).toBe(true);
		expect(preview.counts).toMatchObject({ tasks: 4, drafts: 1, documents: 3, decisions: 1 });
		for (const pattern of [
			"Duplicate task identity",
			"could not be parsed",
			"missing or invalid identity",
			"does not match filename",
			"Duplicate record identity",
			"no addressable identity",
		]) {
			expect(preview.issues.some((issue) => issue.severity === "warning" && issue.message.includes(pattern))).toBe(
				true,
			);
		}
		expect(preview.issues.every((issue) => issue.path && !issue.path.startsWith("/"))).toBe(true);
		await store.register("Existing", root);
		expect(snapshot(root)).toEqual(before);
	});

	it.each(["missing", "invalid-value", "invalid-yaml", "invalid-pointer"])(
		"blocks %s config without initializing source or central data",
		async (kind) => {
			await mkdir(root, { recursive: true });
			if (kind !== "missing") {
				await mkdir(join(root, "backlog"));
				await Bun.write(
					join(root, "backlog.config.yml"),
					kind === "invalid-value"
						? 'project_name: "Invalid"\ndefault_assignee: true\n'
						: kind === "invalid-yaml"
							? 'project_name: "Invalid"\nunknown: [\n'
							: 'project_name: "Invalid"\nbacklog_directory: ../outside\n',
				);
			}
			const before = snapshot(root);
			expect((await store.preview("Unprepared", root)).canRegister).toBe(false);
			await expect(store.register("Unprepared", root)).rejects.toMatchObject({ status: 400 });
			expect(snapshot(root)).toEqual(before);
			expect(await Bun.file(store.databasePath).exists()).toBe(false);
		},
	);

	it("checks current folder access before reading config and rechecks revoked grants at commit", async () => {
		const core = await prepared(root);
		const auth = new AuthStore(data);
		await auth.initializeAdmin("admin", PASSWORD);
		const user = await auth.createUser({ username: "creator", password: PASSWORD });
		// A forbidden external config must yield a permission error, rather than a content diagnostic.
		const foreign = join(testDir, "private-config.yml");
		await Bun.write(foreign, 'project_name: "Secret foreign project"\n');
		await rename(core.fs.configFilePath, `${core.fs.configFilePath}.keep`);
		await symlink(foreign, core.fs.configFilePath);
		await expect(store.preview("Denied", root, user.id)).rejects.toMatchObject({ status: 403 });
		unlinkSync(core.fs.configFilePath);
		renameSync(`${core.fs.configFilePath}.keep`, core.fs.configFilePath);
		const area = await auth.upsertFolderArea(user.id, join(testDir, "area"));
		expect((await store.preview("Allowed", root, user.id)).canRegister).toBe(true);
		// register yields after its own fresh preview; revocation before the transaction wins.
		const pending = store.register("Stale grant", root, user.id);
		auth.removeFolderArea(area.id);
		await expect(pending).rejects.toMatchObject({ status: 403 });
		expect(store.list()).toEqual([]);
	});

	it("rechecks inactive accounts and changed real roots after its preliminary preview", async () => {
		await prepared(root);
		const replacement = join(testDir, "other");
		await prepared(replacement);
		const alias = join(testDir, "alias");
		await symlink(root, alias);
		const auth = new AuthStore(data);
		await auth.initializeAdmin("admin", PASSWORD);
		const user = await auth.createUser({ username: "creator", password: PASSWORD });
		await auth.upsertFolderArea(user.id, join(testDir, "area"));
		const changed = store.register("Moved alias", alias, user.id);
		unlinkSync(alias);
		symlinkSync(replacement, alias);
		await expect(changed).rejects.toMatchObject({ status: 403 });
		expect(store.list()).toEqual([]);
		const inactive = store.register("Inactive", root, user.id);
		auth.editUser(user.id, { active: false });
		await expect(inactive).rejects.toMatchObject({ status: 401 });
		expect(store.list()).toEqual([]);
	});

	it("creates default membership with the project, retains it while untracked and revalidates activation", async () => {
		const core = await prepared(root);
		const auth = new AuthStore(data);
		await auth.initializeAdmin("admin", PASSWORD);
		const user = await auth.createUser({ username: "creator", password: PASSWORD });
		await auth.upsertFolderArea(user.id, join(testDir, "area"));
		const before = snapshot(root);
		const project = await store.register("Owned", root, user.id);
		expect(auth.listMembers(project.id)).toEqual([
			{ projectId: project.id, userId: user.id, permissions: DEFAULT_PERMISSIONS },
		]);
		await store.setTracking(project.id, false);
		expect(auth.permissions(user, project.id)).toBeNull();
		expect(auth.listMembers(project.id)).toHaveLength(1);
		await expect(store.register("Conflicting", root, user.id)).rejects.toMatchObject({ status: 409 });
		expect(snapshot(root)).toEqual(before);
		await Bun.write(core.fs.configFilePath, 'project_name: "Broken"\ndefault_assignee: true\n');
		await expect(store.setTracking(project.id, true)).rejects.toMatchObject({ status: 400 });
		expect(store.load(project.id)?.tracking).toBe(false);
		await core.fs.saveConfig({
			projectName: "Existing source",
			statuses: ["To Do", "In Progress", "Done"],
			labels: [],
			dateFormat: "yyyy-mm-dd",
		});
		const repaired = snapshot(root);
		expect(await store.setTracking(project.id, true)).toEqual(project);
		expect(auth.permissions(user, project.id)).toEqual(DEFAULT_PERMISSIONS);
		expect(snapshot(root)).toEqual(repaired);
	});

	it("does not reveal another binding in actor collisions or preview diagnostics", async () => {
		await prepared(root);
		const auth = new AuthStore(data);
		await auth.initializeAdmin("admin", PASSWORD);
		const user = await auth.createUser({ username: "creator", password: PASSWORD });
		await auth.upsertFolderArea(user.id, join(testDir, "area"));
		await store.register("Foreign secret label", root);
		const preview = await store.preview("Attempt", root, user.id);
		expect(preview.canRegister).toBe(false);
		expect(preview.config).toBeNull();
		expect(preview.configPath).toBeNull();
		expect(preview.backlogPath).toBeNull();
		expect(preview.counts).toEqual({ tasks: 0, drafts: 0, documents: 0, decisions: 0, archived: 0 });
		expect(JSON.stringify(preview.issues)).not.toContain("Foreign secret label");
		expect(JSON.stringify(preview.issues)).not.toContain(root);
		await expect(store.register("Attempt", root, user.id)).rejects.toMatchObject({ status: 409 });
		const alias = join(testDir, "area", "known-alias");
		await symlink(root, alias);
		const blockedAlias = await store.preview("Alias attempt", `${alias}/.`, user.id);
		expect(blockedAlias.canRegister).toBe(false);
		expect(blockedAlias.rootPath).toBe(alias);
		expect(JSON.stringify(blockedAlias)).not.toContain(root);
		expect(JSON.stringify(blockedAlias)).not.toContain("Foreign secret label");
		expect((await store.preview("Trusted alias", alias)).rootPath).toBe(root);
		await expect(store.register("Alias attempt", alias, user.id)).rejects.toMatchObject({ status: 409 });
	});

	it("rolls back session guards and serializes concurrent same-root registrations", async () => {
		await prepared(root);
		const auth = new AuthStore(data);
		const admin = await auth.initializeAdmin("admin", PASSWORD);
		const before = snapshot(root);
		await expect(
			store.register("Expired session", root, admin.id, () => {
				throw new AuthStoreError("Session expired", 401);
			}),
		).rejects.toMatchObject({ status: 401 });
		expect(store.list()).toEqual([]);
		const results = await Promise.allSettled([
			store.register("First", root, admin.id),
			new ProjectStore(data).register("Second", root, admin.id),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
		expect(store.list()).toHaveLength(1);
		const database = new Database(store.databasePath, { readonly: true });
		try {
			expect(database.query("SELECT COUNT(*) AS count FROM project_members").get()).toEqual({ count: 1 });
		} finally {
			database.close();
		}
		expect(snapshot(root)).toEqual(before);
	});

	it("allows only one registration and one membership across competing server processes", async () => {
		await prepared(root);
		const auth = new AuthStore(data);
		const admin = await auth.initializeAdmin("admin", PASSWORD);
		const before = snapshot(root);
		const module = new URL("../server/project-store.ts", import.meta.url).pathname;
		const script = `import { ProjectStore } from ${JSON.stringify(module)};
try { await new ProjectStore(${JSON.stringify(data)}).register("Concurrent", ${JSON.stringify(root)}, ${JSON.stringify(admin.id)}); }
catch (error) { process.exit(error.status === 409 ? 3 : 7); }`;
		const children = Array.from({ length: 2 }, () =>
			Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" }),
		);
		const results = await Promise.all(
			children.map(async (child) => ({
				status: await child.exited,
				stdout: await new Response(child.stdout).text(),
				stderr: await new Response(child.stderr).text(),
			})),
		);
		expect(results.map((result) => result.status).sort()).toEqual([0, 3]);
		expect(results.every((result) => !result.stdout && !result.stderr)).toBe(true);
		expect(store.list()).toHaveLength(1);
		expect(auth.listMembers(store.list()[0]?.id ?? "1")).toHaveLength(1);
		expect(snapshot(root)).toEqual(before);
	});
});
