import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { FileSystem } from "../file-system/operations.ts";
import { AuthStore } from "../server/auth-store.ts";
import { readProjectFile } from "../server/project-paths.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const PASSWORD = "registration review password";

describe("independent project-registration security regressions", () => {
	let root: string;
	let auth: AuthStore;
	let projects: ProjectStore;

	beforeEach(async () => {
		root = await createTestDirOutsideRepository("backlog-registration-review-");
		const data = join(root, "data");
		auth = new AuthStore(data);
		projects = new ProjectStore(data);
	});

	afterEach(async () => {
		await safeCleanup(root);
	});

	it("does not reveal whether an ungranted path exists or is a directory", async () => {
		await auth.initializeAdmin("admin", PASSWORD);
		const user = await auth.createUser({ username: "normal", password: PASSWORD });
		const foreign = join(root, "PRIVATE_OWNER");
		await mkdir(foreign);
		const file = join(foreign, "PRIVATE_FILE");
		await Bun.write(file, "PRIVATE_CONTENT");
		const statuses: number[] = [];
		for (const operation of ["preview", "register"] as const) {
			for (const path of [foreign, join(foreign, "PRIVATE_MISSING"), file]) {
				try {
					await projects[operation]("Attempt", path, user.id);
					throw new Error("Expected authorization denial.");
				} catch (error) {
					const denied = error as { status: number; message: string };
					statuses.push(denied.status);
					expect(denied.message).not.toContain("PRIVATE");
				}
			}
		}
		expect(statuses).toEqual([403, 403, 403, 403, 403, 403]);
		expect(projects.list()).toEqual([]);
	});

	it("uses the injected opened-file reader during initial root-config discovery", async () => {
		const project = join(root, "project");
		await mkdir(join(project, "backlog"), { recursive: true });
		await mkdir(join(project, "PRIVATE_LAYOUT_SENTINEL"));
		const outsideConfig = join(root, "outside.yml");
		await Bun.write(outsideConfig, "project_name: PRIVATE_NAME\nbacklog_directory: PRIVATE_LAYOUT_SENTINEL\n");
		const config = join(project, "backlog.config.yml");
		await symlink(outsideConfig, config);
		const reads: string[] = [];
		expect(
			() =>
				new FileSystem(project, (path) => {
					reads.push(path);
					return readProjectFile(project, path);
				}),
		).toThrow("escapes the project root");
		expect(reads).toContain(config);
	});

	it.each(["grant", "account"])(
		"rechecks revoked %s between inspection and the registration transaction",
		async (revoked) => {
			await auth.initializeAdmin("admin", PASSWORD);
			const user = await auth.createUser({ username: "normal", password: PASSWORD });
			const area = join(root, "area");
			const project = join(area, "ready");
			const core = new Core(project);
			await initializeFilesystemTestProject(core, "Ready");
			const grant = await auth.upsertFolderArea(user.id, area);
			const pending = projects.register("Ready", project, user.id);
			if (revoked === "grant") auth.removeFolderArea(grant.id);
			else auth.editUser(user.id, { active: false });
			await expect(pending).rejects.toMatchObject({ status: revoked === "grant" ? 403 : 401 });
			expect(projects.list()).toEqual([]);
		},
	);
});
