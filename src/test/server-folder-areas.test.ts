import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync, symlinkSync } from "node:fs";
import { mkdir, realpath, rename, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AuthStore, AuthStoreError } from "../server/auth-store.ts";
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS } from "../server/auth-types.ts";
import { ServerDatabase } from "../server/database.ts";
import { assertRegistrationAccess, containsPath, pathsOverlap } from "../server/folder-areas.ts";
import { createTestDirOutsideRepository, safeCleanup } from "./test-utils.ts";

const PASSWORD = "folder areas password";
const PROJECT_SCHEMA =
	"CREATE TABLE projects(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,root_path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL) STRICT";

describe("personal folder areas and additive server migration", () => {
	let testDir: string;
	let dataDir: string;
	let store: AuthStore;
	let database: ServerDatabase;
	let areaRoot: string;
	let projectRoot: string;
	let otherRoot: string;

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-folder-areas-");
		dataDir = join(testDir, "data");
		store = new AuthStore(dataDir, { now: () => Date.parse("2026-10-22T06:00:00.000Z") });
		database = new ServerDatabase(dataDir);
		areaRoot = join(testDir, "alice");
		projectRoot = join(areaRoot, "project");
		otherRoot = join(testDir, "bob");
		await mkdir(projectRoot, { recursive: true });
		await mkdir(otherRoot);
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	async function accounts() {
		const admin = await store.initializeAdmin("admin", PASSWORD);
		const alice = await store.createUser({ username: "alice", password: PASSWORD });
		const bob = await store.createUser({ username: "bob", password: PASSWORD });
		return { admin, alice, bob };
	}

	it("keeps absent and project-only reads unchanged, including missing mutations", async () => {
		expect(store.listFolderAreas()).toEqual([]);
		expect(store.listFolderAreas("missing")).toEqual([]);
		expect(() => store.removeFolderArea("missing")).toThrow("not found");
		await expect(store.upsertFolderArea("missing", areaRoot)).rejects.toMatchObject({ status: 404 });
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
		await mkdir(dataDir);
		const old = new Database(store.databasePath);
		old.exec(PROJECT_SCHEMA);
		old.close();
		const before = await Bun.file(store.databasePath).arrayBuffer();
		expect(store.listFolderAreas()).toEqual([]);
		expect(store.listFolderAreas("missing")).toEqual([]);
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
	});

	it("rolls back A-01 schema changes and preserves project identities and the allocator on success", async () => {
		await mkdir(dataDir);
		const old = new Database(store.databasePath);
		old.exec(
			`${PROJECT_SCHEMA}; INSERT INTO projects VALUES(7,'Keep','/tmp/keep','2026-10-21'); INSERT INTO projects VALUES(42,'Removed','/tmp/removed','2026-10-21'); DELETE FROM projects WHERE id=42`,
		);
		old.close();
		const before = await Bun.file(store.databasePath).arrayBuffer();
		expect(() =>
			database.write(() => {
				throw new Error("cancel write");
			}),
		).toThrow("cancel write");
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
		database.write((db) => {
			expect(db.query("SELECT * FROM projects").all()).toEqual([
				{ id: 7, name: "Keep", root_path: "/tmp/keep", created_at: "2026-10-21", tracking: 1 },
			]);
			const inserted = db
				.query("INSERT INTO projects(name,root_path,created_at) VALUES('Next','/tmp/next','2026-10-22')")
				.run();
			expect(inserted.lastInsertRowid).toBe(43);
			expect(() => db.query("UPDATE projects SET tracking=2 WHERE id=7").run()).toThrow("CHECK");
		});
		expect(database.read(-1, (_db, version) => version)).toBe(4);
	});

	it("reads A-02 accounts and sessions without migration, then atomically preserves them through an upgrade", async () => {
		const { admin, alice } = await accounts();
		const login = await store.login("alice", PASSWORD);
		database.write((db) =>
			db.query("INSERT INTO projects(id,name,root_path,created_at) VALUES(7,'Keep',?,'2026-10-21')").run(projectRoot),
		);
		const member = store.setMember("7", alice.id, { archive: true });
		const old = new Database(store.databasePath);
		old.exec(
			"DROP TABLE history_events; DROP TABLE operation_files; DROP TABLE operations; DROP TABLE records; DROP TABLE folder_areas; ALTER TABLE projects DROP COLUMN tracking; PRAGMA user_version=2",
		);
		old.close();
		const before = await Bun.file(store.databasePath).arrayBuffer();
		expect(store.hasAdmin()).toBe(true);
		expect(store.loadUser(alice.id)).toEqual(alice);
		expect(store.loadSession(login.token)).toEqual(login.session);
		expect(store.listMembers("7")).toEqual([member]);
		expect(store.permissions(alice, "7")).toEqual(member.permissions);
		expect(store.permissions(admin, "7")).toEqual(ADMIN_PERMISSIONS);
		expect(store.listFolderAreas()).toEqual([]);
		database.read(null, (db) => {
			expect(() => assertRegistrationAccess(db, admin.id, projectRoot)).not.toThrow();
			try {
				assertRegistrationAccess(db, alice.id, projectRoot);
				throw new Error("Expected registration access denial.");
			} catch (error) {
				expect(error).toMatchObject({ status: 403, message: "Project registration is not permitted for this folder." });
			}
			return null;
		});
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
		await expect(
			store.upsertFolderArea(alice.id, areaRoot, () => {
				throw new AuthStoreError("Authentication required.", 401);
			}),
		).rejects.toMatchObject({ status: 401 });
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
		const area = await store.upsertFolderArea(alice.id, areaRoot);
		expect(store.listFolderAreas(alice.id)).toEqual([area]);
		expect(store.loadUser(alice.id)).toEqual(alice);
		expect(store.loadSession(login.token)).toEqual(login.session);
		expect(store.listMembers("7")).toEqual([member]);
		expect(store.permissions(alice, "7")).toEqual(member.permissions);
		expect(database.read(-1, (_db, version) => version)).toBe(4);
	});

	it.each(["tracking constraint", "area uniqueness", "unknown version", "added view"])(
		"rejects %s lookalikes without rewriting the database",
		async (change) => {
			await accounts();
			const raw = new Database(store.databasePath);
			if (change === "tracking constraint")
				raw.exec(
					"DROP TABLE projects; CREATE TABLE projects(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,root_path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,tracking INTEGER NOT NULL DEFAULT 1) STRICT",
				);
			if (change === "area uniqueness")
				raw.exec(
					"DROP TABLE folder_areas; CREATE TABLE folder_areas(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),root_path TEXT NOT NULL,created_at TEXT NOT NULL) STRICT",
				);
			if (change === "unknown version") raw.exec("PRAGMA user_version=5");
			if (change === "added view") raw.exec("CREATE VIEW unexpected AS SELECT id FROM users");
			raw.close();
			const before = await Bun.file(store.databasePath).arrayBuffer();
			expect(() => store.listFolderAreas()).toThrow("Unrecognized");
			expect(() => database.write(() => null)).toThrow("Unrecognized");
			expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
		},
	);

	it("upserts one canonical area through aliases and allows nested areas for the same owner", async () => {
		const { alice, bob } = await accounts();
		const alias = join(testDir, "alias");
		await symlink(areaRoot, alias);
		const area = await store.upsertFolderArea(alice.id, alias);
		expect(area.rootPath).toBe(await realpath(areaRoot));
		expect(await store.upsertFolderArea(alice.id, areaRoot)).toEqual(area);
		const nested = await store.upsertFolderArea(alice.id, projectRoot);
		const other = await store.upsertFolderArea(bob.id, otherRoot);
		expect(store.listFolderAreas(alice.id)).toEqual([area, nested]);
		expect(store.listFolderAreas()).toEqual([area, nested, other]);
	});

	it("rejects equal, descendant and ancestor areas for other owners without disclosing their paths", async () => {
		const { alice, bob } = await accounts();
		await store.upsertFolderArea(alice.id, areaRoot);
		for (const path of [areaRoot, projectRoot, testDir]) {
			await expect(store.upsertFolderArea(bob.id, path)).rejects.toMatchObject({
				status: 409,
				message: "Folder area overlaps another user's area.",
			});
		}
		expect(store.listFolderAreas(bob.id)).toEqual([]);
	});

	it("serializes simultaneous overlapping grants", async () => {
		const { alice, bob } = await accounts();
		const results = await Promise.allSettled([
			store.upsertFolderArea(alice.id, areaRoot),
			store.upsertFolderArea(bob.id, projectRoot),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected").map((result) => result.reason)).toMatchObject([
			{ status: 409 },
		]);
		expect(store.listFolderAreas()).toHaveLength(1);
	});

	it("rechecks the current target account after waiting for filesystem work", async () => {
		const { alice } = await accounts();
		const pending = store.upsertFolderArea(alice.id, areaRoot);
		store.editUser(alice.id, { active: false });
		await expect(pending).rejects.toMatchObject({ message: "User is inactive." });
		expect(store.listFolderAreas(alice.id)).toEqual([]);
	});

	it("rejects missing, non-directory and changed alias paths without writing an area", async () => {
		const { alice } = await accounts();
		const file = join(testDir, "plain-file");
		await Bun.write(file, "content");
		const before = await Bun.file(store.databasePath).arrayBuffer();
		for (const path of ["", file, join(testDir, "missing")])
			await expect(store.upsertFolderArea(alice.id, path)).rejects.toMatchObject({ status: 400 });
		const alias = join(testDir, "alias");
		await symlink(areaRoot, alias);
		await expect(
			store.upsertFolderArea(alice.id, alias, () => {
				rmSync(alias);
				symlinkSync(otherRoot, alias);
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(store.listFolderAreas(alice.id)).toEqual([]);
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
	});

	it("uses current accounts and grants from the caller's connection, including uncommitted changes", async () => {
		const { admin, alice } = await accounts();
		const area = await store.upsertFolderArea(alice.id, areaRoot);
		database.write((db) => {
			expect(() => assertRegistrationAccess(db, admin.id, otherRoot)).not.toThrow();
			expect(() => assertRegistrationAccess(db, alice.id, areaRoot)).not.toThrow();
			expect(() => assertRegistrationAccess(db, alice.id, projectRoot)).not.toThrow();
			expect(() => assertRegistrationAccess(db, alice.id, otherRoot)).toThrow("not permitted");
			expect(() => assertRegistrationAccess(db, "missing", projectRoot)).toThrow("Authentication required");
			db.query("DELETE FROM folder_areas WHERE id=?").run(area.id);
			expect(() => assertRegistrationAccess(db, alice.id, projectRoot)).toThrow("not permitted");
			db.query("UPDATE users SET role='admin' WHERE id=?").run(alice.id);
			expect(() => assertRegistrationAccess(db, alice.id, otherRoot)).not.toThrow();
			db.query("UPDATE users SET role='user' WHERE id=?").run(alice.id);
			expect(() => assertRegistrationAccess(db, alice.id, otherRoot)).toThrow("not permitted");
			db.query("UPDATE users SET active=0 WHERE id=?").run(alice.id);
			expect(() => assertRegistrationAccess(db, alice.id, projectRoot)).toThrow("Authentication required");
		});
	});

	it("keeps an area fixed when its input alias or canonical directory changes", async () => {
		const { alice } = await accounts();
		const alias = join(testDir, "alias");
		await symlink(areaRoot, alias);
		const area = await store.upsertFolderArea(alice.id, alias);
		await unlink(alias);
		await symlink(otherRoot, alias);
		database.read(null, (db) => {
			expect(() => assertRegistrationAccess(db, alice.id, otherRoot)).toThrow("not permitted");
			expect(() => assertRegistrationAccess(db, alice.id, projectRoot)).not.toThrow();
			return null;
		});
		await rename(areaRoot, join(testDir, "original-area"));
		await symlink(otherRoot, areaRoot);
		database.read(null, (db) => {
			expect(() => assertRegistrationAccess(db, alice.id, areaRoot)).toThrow("not permitted");
			return null;
		});
		expect(store.listFolderAreas(alice.id)).toEqual([area]);
	});

	it("revokes only future registration when an area is removed, preserving standard memberships", async () => {
		const { alice } = await accounts();
		const area = await store.upsertFolderArea(alice.id, areaRoot);
		database.write((db) =>
			db.query("INSERT INTO projects(name,root_path,created_at) VALUES('Existing',?,'2026-10-22')").run(projectRoot),
		);
		const member = store.setMember("1", alice.id);
		expect(member.permissions).toEqual(DEFAULT_PERMISSIONS);
		store.removeFolderArea(area.id);
		expect(store.listFolderAreas(alice.id)).toEqual([]);
		expect(store.listMembers("1")).toEqual([member]);
		expect(store.permissions(alice, "1")).toEqual(DEFAULT_PERMISSIONS);
		expect(() => database.write((db) => assertRegistrationAccess(db, alice.id, projectRoot))).toThrow("not permitted");
		expect(() => store.removeFolderArea(area.id)).toThrow("not found");
	});

	it("preserves the area and memberships when the transactional deletion guard refuses", async () => {
		const { alice } = await accounts();
		const area = await store.upsertFolderArea(alice.id, areaRoot);
		database.write((db) =>
			db.query("INSERT INTO projects(name,root_path,created_at) VALUES('Existing',?,'2026-10-22')").run(projectRoot),
		);
		const member = store.setMember("1", alice.id);
		const before = await Bun.file(store.databasePath).arrayBuffer();
		let guarded = false;
		expect(() =>
			store.removeFolderArea(area.id, () => {
				guarded = true;
				throw new AuthStoreError("Permission denied.", 403);
			}),
		).toThrow("Permission denied.");
		expect(guarded).toBe(true);
		expect(store.listFolderAreas(alice.id)).toEqual([area]);
		expect(store.listMembers("1")).toEqual([member]);
		expect(store.permissions(alice, "1")).toEqual(DEFAULT_PERMISSIONS);
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
	});

	it("uses path components for inclusive containment and symmetric overlaps", () => {
		expect(containsPath(areaRoot, areaRoot)).toBe(true);
		expect(containsPath(areaRoot, projectRoot)).toBe(true);
		expect(containsPath(areaRoot, `${areaRoot}-other`)).toBe(false);
		expect(containsPath(projectRoot, areaRoot)).toBe(false);
		expect(pathsOverlap(areaRoot, projectRoot)).toBe(true);
		expect(pathsOverlap(projectRoot, areaRoot)).toBe(true);
		expect(pathsOverlap(areaRoot, otherRoot)).toBe(false);
	});
});
