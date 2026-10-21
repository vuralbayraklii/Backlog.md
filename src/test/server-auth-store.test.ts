import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AuthStore, AuthStoreError } from "../server/auth-store.ts";
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS } from "../server/auth-types.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, safeCleanup } from "./test-utils.ts";

const PASSWORD = "  initial password with spaces  ";
const REPLACEMENT = "  replacement password with spaces  ";

describe("central account store", () => {
	let testDir: string;
	let dataDir: string;
	let store: AuthStore;
	let now: number;

	beforeEach(async () => {
		testDir = await createTestDirOutsideRepository("backlog-auth-store-");
		dataDir = join(testDir, "data");
		now = Date.parse("2026-10-21T12:00:00.000Z");
		store = new AuthStore(dataDir, { now: () => now });
	});
	afterEach(async () => {
		await safeCleanup(testDir);
	});

	function seedProject(): void {
		const db = new Database(store.databasePath);
		db.query("INSERT INTO projects(name,root_path,created_at) VALUES(?,?,?)").run(
			"Example",
			join(testDir, "project"),
			new Date(now).toISOString(),
		);
		db.close();
	}

	it("keeps account reads absent and upgrades A-01 only on a successful mutation", async () => {
		expect(store.hasAdmin()).toBe(false);
		expect(store.listUsers()).toEqual([]);
		expect(store.loadSession("absent")).toBeNull();
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
		await mkdir(dataDir);
		const db = new Database(store.databasePath);
		db.exec(
			"CREATE TABLE projects(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,root_path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL) STRICT; INSERT INTO projects VALUES(7,'Keep','/tmp/keep','2026-10-21')",
		);
		db.close();
		const before = await Bun.file(store.databasePath).arrayBuffer();
		expect(store.listUsers()).toEqual([]);
		expect(store.hasAdmin()).toBe(false);
		expect(store.listMembers("7")).toEqual([]);
		expect(new ProjectStore(dataDir).list()[0]?.id).toBe("7");
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
		await store.initializeAdmin("root-admin", PASSWORD);
		expect(new ProjectStore(dataDir).list()).toEqual([
			{ id: "7", name: "Keep", rootPath: "/tmp/keep", createdAt: "2026-10-21" },
		]);
		const migrated = new Database(store.databasePath, { readonly: true });
		expect(migrated.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
		migrated.close();
	});

	it("rejects account mutations before initialization without leaving an unusable empty database", async () => {
		await expect(store.createUser({ username: "normal", password: PASSWORD })).rejects.toThrow("first admin");
		expect(() => store.editUser("missing", { active: false })).toThrow("not found");
		await expect(store.resetPassword("missing", PASSWORD)).rejects.toThrow("not found");
		await expect(store.login("missing", PASSWORD)).rejects.toMatchObject({ status: 401 });
		expect(() => store.setMember("1", "missing")).toThrow("not found");
		expect(() => store.removeMember("1", "missing")).toThrow("not found");
		expect(await Bun.file(store.databasePath).exists()).toBe(false);
		await store.initializeAdmin("admin", PASSWORD);
		expect(store.hasAdmin()).toBe(true);
	});

	it.each(["damaged", "", "unknown-schema"])("rejects %s without repairing evidence", async (content) => {
		await mkdir(dataDir);
		if (content === "unknown-schema") {
			const db = new Database(store.databasePath);
			db.exec("CREATE TABLE unrelated(value TEXT)");
			db.close();
		} else await Bun.write(store.databasePath, content);
		const before = await Bun.file(store.databasePath).arrayBuffer();
		expect(() => store.listUsers()).toThrow();
		await expect(store.initializeAdmin("admin", PASSWORD)).rejects.toThrow();
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
	});

	it("rejects lookalike columns missing identity constraints or strict tables", async () => {
		await mkdir(dataDir);
		const db = new Database(store.databasePath);
		db.exec("CREATE TABLE projects(id INTEGER,name TEXT,root_path TEXT,created_at TEXT)");
		db.close();
		const before = await Bun.file(store.databasePath).arrayBuffer();
		expect(() => new ProjectStore(dataDir).list()).toThrow("Unrecognized");
		await expect(store.initializeAdmin("admin", PASSWORD)).rejects.toThrow("Unrecognized");
		expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
	});

	it("keeps SQL literals significant when recognizing the account schema", async () => {
		await store.initializeAdmin("admin", PASSWORD);
		const db = new Database(store.databasePath);
		const schema = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_schema WHERE name='users'").get()?.sql ?? "";
		db.exec(`DROP TABLE users; ${schema.replace("'admin'", "' admin '")}`);
		db.close();
		expect(() => store.listUsers()).toThrow("Unrecognized");
	});

	it("initializes only once, normalizes immutable usernames and stores Argon2id without exposing it", async () => {
		const admin = await store.initializeAdmin("  ADMIN.Root  ", PASSWORD, "Yönetici 🦊");
		expect(admin).toMatchObject({
			username: "admin.root",
			displayName: "Yönetici 🦊",
			role: "admin",
			active: true,
			mustChangePassword: true,
		});
		expect(store.hasAdmin()).toBe(true);
		await expect(store.initializeAdmin("another-admin", PASSWORD)).rejects.toThrow("already configured");
		await expect(store.createUser({ username: "ADMIN.ROOT", password: PASSWORD })).rejects.toThrow("already in use");
		const db = new Database(store.databasePath, { readonly: true });
		const stored = db.query<{ password_hash: string }, []>("SELECT password_hash FROM users").get();
		expect(stored?.password_hash).toStartWith("$argon2id$v=19$m=19456,t=2,");
		expect(await Bun.password.verify(PASSWORD, stored?.password_hash ?? "")).toBe(true);
		db.close();
		expect(JSON.stringify(store.listUsers())).not.toContain("passwordHash");
	});

	it("validates usernames and password lengths while preserving every password space", async () => {
		for (const value of ["ab", "a b", "İsim", "a".repeat(65)])
			await expect(store.initializeAdmin(value, PASSWORD)).rejects.toThrow("Username");
		for (const value of ["a".repeat(14), "a".repeat(129)])
			await expect(store.initializeAdmin("admin", value)).rejects.toThrow("15–128");
		await store.initializeAdmin("admin", " ".repeat(15));
		expect((await store.login("admin", " ".repeat(15))).session.user.username).toBe("admin");
		await expect(store.login("admin", "")).rejects.toThrow("Invalid username or password");
	});

	it("rotates the current session and revokes every old browser when changing a password", async () => {
		const admin = await store.initializeAdmin("admin", PASSWORD);
		const first = await store.login("admin", PASSWORD);
		const other = await store.login("admin", PASSWORD);
		const rotated = await store.changePassword(first.token, PASSWORD, REPLACEMENT);
		expect(rotated.token).not.toBe(first.token);
		expect(rotated.session.user.mustChangePassword).toBe(false);
		expect(store.loadSession(first.token)).toBeNull();
		expect(store.loadSession(other.token)).toBeNull();
		expect(store.loadSession(rotated.token)?.user.id).toBe(admin.id);
		const raw = await Bun.file(store.databasePath).text();
		expect(raw).not.toContain(rotated.token);
		expect(new AuthStore(dataDir, { now: () => now }).loadSession(rotated.token)).toEqual(rotated.session);
		store.logout(rotated.token);
		expect(store.loadSession(rotated.token)).toBeNull();
	});

	it.each(["initial", "after reset", "voluntary"])(
		"rejects the current password during %s changes without altering accounts or sessions",
		async (stage) => {
			const admin = await store.initializeAdmin("admin", PASSWORD);
			let currentPassword = PASSWORD;
			if (stage !== "initial") {
				const initial = await store.login("admin", PASSWORD);
				await store.changePassword(initial.token, PASSWORD, REPLACEMENT);
				currentPassword = REPLACEMENT;
				if (stage === "after reset") {
					await store.resetPassword(admin.id, PASSWORD);
					currentPassword = PASSWORD;
				}
			}
			const first = await store.login("admin", currentPassword);
			const other = await store.login("admin", currentPassword);
			expect(first.session.user.mustChangePassword).toBe(stage !== "voluntary");
			const before = await Bun.file(store.databasePath).arrayBuffer();
			await expect(store.changePassword(first.token, currentPassword, currentPassword)).rejects.toMatchObject({
				name: "AuthStoreError",
				status: 400,
				message: "New password must be different from the current password.",
			});
			expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
			expect(store.loadSession(first.token)).toEqual(first.session);
			expect(store.loadSession(other.token)).toEqual(other.session);
			const rotated = await store.changePassword(first.token, currentPassword, `${currentPassword} new`);
			expect(rotated.session.user.mustChangePassword).toBe(false);
			expect(store.loadSession(first.token)).toBeNull();
			expect(store.loadSession(other.token)).toBeNull();
			expect(store.loadSession(rotated.token)).toEqual(rotated.session);
		},
	);

	it("validates new password length without mutating state and preserves significant whitespace", async () => {
		await store.initializeAdmin("admin", PASSWORD);
		const first = await store.login("admin", PASSWORD);
		const before = await Bun.file(store.databasePath).arrayBuffer();
		for (const invalid of ["a".repeat(14), "a".repeat(129)]) {
			await expect(store.changePassword(first.token, PASSWORD, invalid)).rejects.toMatchObject({
				status: 400,
				message: "Password must contain 15–128 characters.",
			});
			expect(await Bun.file(store.databasePath).arrayBuffer()).toEqual(before);
			expect(store.loadSession(first.token)).toEqual(first.session);
		}
		const trimmed = PASSWORD.trim();
		const rotated = await store.changePassword(first.token, PASSWORD, trimmed);
		expect(rotated.session.user.mustChangePassword).toBe(false);
		expect(store.loadSession(first.token)).toBeNull();
		await expect(store.login("admin", PASSWORD)).rejects.toMatchObject({ status: 401 });
		expect((await store.login("admin", trimmed)).session.user.username).toBe("admin");
	});

	it("allows an admin reset to the existing password while requiring replacement and revoking sessions", async () => {
		const admin = await store.initializeAdmin("admin", PASSWORD);
		const first = await store.login("admin", PASSWORD);
		const changed = await store.changePassword(first.token, PASSWORD, REPLACEMENT);
		const other = await store.login("admin", REPLACEMENT);
		expect((await store.resetPassword(admin.id, REPLACEMENT)).mustChangePassword).toBe(true);
		expect(store.loadSession(changed.token)).toBeNull();
		expect(store.loadSession(other.token)).toBeNull();
		expect((await store.login("admin", REPLACEMENT)).session.user.mustChangePassword).toBe(true);
	});

	it("allows only one concurrent password replacement and retains the winning session", async () => {
		await store.initializeAdmin("admin", PASSWORD);
		const first = await store.login("admin", PASSWORD);
		const other = await store.login("admin", PASSWORD);
		const results = await Promise.allSettled([
			store.changePassword(first.token, PASSWORD, REPLACEMENT),
			store.changePassword(other.token, PASSWORD, `${REPLACEMENT} other`),
		]);
		const succeeded = results.filter((result) => result.status === "fulfilled");
		const rejected = results.filter((result) => result.status === "rejected");
		expect(succeeded).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]?.reason).toMatchObject({ status: 401 });
		expect(store.loadSession(first.token)).toBeNull();
		expect(store.loadSession(other.token)).toBeNull();
		const winner = succeeded[0]?.value;
		expect(winner).toBeDefined();
		if (winner) expect(store.loadSession(winner.token)).toEqual(winner.session);
	});

	it("expires idle sessions without extending on reads and never extends beyond twelve hours", async () => {
		await store.initializeAdmin("admin", PASSWORD);
		const idle = await store.login("admin", PASSWORD);
		now += 119 * 60 * 1000;
		expect(store.loadSession(idle.token)?.lastActivityAt).toBe(idle.session.lastActivityAt);
		now += 60 * 1000;
		expect(store.loadSession(idle.token)).toBeNull();
		const active = await store.login("admin", PASSWORD);
		for (let hour = 1; hour <= 11; hour++) {
			now += 60 * 60 * 1000;
			expect(store.activity(active.token)).not.toBeNull();
		}
		now += 60 * 60 * 1000;
		expect(store.activity(active.token)).toBeNull();
	});

	it("protects the final active admin and invalidates sessions after deactivation or reset", async () => {
		const first = await store.initializeAdmin("admin", PASSWORD);
		expect(() => store.editUser(first.id, { active: false })).toThrow("last active admin");
		expect(() => store.editUser(first.id, { role: "user" })).toThrow("last active admin");
		const second = await store.createUser({ username: "second", password: PASSWORD, role: "admin" });
		const firstSession = await store.login("admin", PASSWORD);
		store.editUser(first.id, { active: false });
		expect(store.loadSession(firstSession.token)).toBeNull();
		expect(() => store.editUser(second.id, { active: false })).toThrow("last active admin");
		const secondSession = await store.login("second", PASSWORD);
		await store.resetPassword(second.id, REPLACEMENT);
		expect(store.loadSession(secondSession.token)).toBeNull();
		expect((await store.login("second", REPLACEMENT)).session.user.mustChangePassword).toBe(true);
		await expect(store.login("admin", PASSWORD)).rejects.toThrow("Invalid username or password");
	});

	it("persists failed limits across stores and atomically reserves concurrent attempts", async () => {
		await store.initializeAdmin("admin", PASSWORD);
		const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => store.login(" UNKNOWN ", PASSWORD)));
		expect(
			attempts.filter((result) => result.status === "rejected" && (result.reason as AuthStoreError).status === 401),
		).toHaveLength(5);
		expect(
			attempts.filter((result) => result.status === "rejected" && (result.reason as AuthStoreError).status === 429),
		).toHaveLength(1);
		const restarted = new AuthStore(dataDir, { now: () => now });
		try {
			await restarted.login("unknown", PASSWORD);
			throw new Error("Expected rate limit");
		} catch (error) {
			expect(error).toBeInstanceOf(AuthStoreError);
			expect((error as AuthStoreError).retryAfter).toBe(900);
		}
		now += 15 * 60 * 1000;
		await expect(restarted.login("unknown", PASSWORD)).rejects.toMatchObject({ status: 401 });
	});

	it("counts all accepted login attempts toward the service-wide limit", async () => {
		await store.initializeAdmin("admin", PASSWORD);
		const db = new Database(store.databasePath);
		for (let index = 0; index < 60; index++)
			db.query("INSERT INTO login_attempts(username,attempted_at,failed) VALUES(?,?,0)").run(`user-${index}`, now);
		db.close();
		await expect(store.login("admin", PASSWORD)).rejects.toMatchObject({ status: 429, retryAfter: 60 });
		now += 60 * 1000;
		expect((await store.login("admin", PASSWORD)).session.user.username).toBe("admin");
	});

	it("uses membership defaults and reloads both user role and permissions immediately", async () => {
		const admin = await store.initializeAdmin("admin", PASSWORD);
		const user = await store.createUser({ username: "normal", password: PASSWORD });
		seedProject();
		expect(store.permissions(admin, "1")).toEqual(ADMIN_PERMISSIONS);
		expect(store.permissions(admin, "2")).toBeNull();
		expect(store.permissions(user, "1")).toBeNull();
		expect(store.setMember("1", user.id).permissions).toEqual(DEFAULT_PERMISSIONS);
		expect(store.setMember("1", user.id, { archive: true, tasksWrite: false }).permissions).toEqual({
			...DEFAULT_PERMISSIONS,
			archive: true,
			tasksWrite: false,
		});
		expect(store.listMembers("1")).toHaveLength(1);
		expect(store.permissions(user, "1")?.archive).toBe(true);
		store.removeMember("1", user.id);
		expect(store.permissions(user, "1")).toBeNull();
		store.editUser(user.id, { role: "admin" });
		expect(store.permissions(user, "1")).toEqual(ADMIN_PERMISSIONS);
		store.editUser(user.id, { active: false });
		expect(store.permissions(user, "1")).toBeNull();
		expect(() => store.setMember("1", user.id, { tasksWrite: "true" } as never)).toThrow("boolean");
	});
});
