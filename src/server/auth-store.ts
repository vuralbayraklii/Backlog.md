import type { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	ADMIN_PERMISSIONS,
	type AuthSession,
	DEFAULT_PERMISSIONS,
	PERMISSION_NAMES,
	type ProjectMember,
	type ProjectPermissions,
	type ServerUser,
} from "./auth-types.ts";
import { ServerDatabase } from "./database.ts";

const ABSOLUTE_LIFETIME = 12 * 60 * 60 * 1000;
const IDLE_LIFETIME = 2 * 60 * 60 * 1000;
const FAILURE_WINDOW = 15 * 60 * 1000;
const GLOBAL_WINDOW = 60 * 1000;
const DUMMY_HASH =
	"$argon2id$v=19$m=19456,t=2,p=1$08eNdAnnQPCO5GMrAuEp8clK9kKBkUroERLRqS5EGeE$2ZbsbUgmF9n89JASiaH3J+A2b9vYikK9+I95FLSqC8A";
const USER_COLUMNS =
	"id, username, display_name AS displayName, role, active, password_hash AS passwordHash, must_change_password AS mustChangePassword";
const MEMBER_COLUMNS =
	"CAST(project_id AS TEXT) AS projectId, user_id AS userId, tasks_write AS tasksWrite, docs_write AS docsWrite, decisions_write AS decisionsWrite, decisions_manage AS decisionsManage, archive, permanent_delete AS 'delete'";

interface UserRow extends Omit<ServerUser, "active" | "mustChangePassword"> {
	active: number;
	mustChangePassword: number;
	passwordHash: string;
}
interface SessionRow {
	userId: string;
	csrfToken: string;
	createdAt: number;
	expiresAt: number;
	lastActivityAt: number;
}
interface MemberRow extends Omit<ProjectMember, "permissions"> {
	tasksWrite: number;
	docsWrite: number;
	decisionsWrite: number;
	decisionsManage: number;
	archive: number;
	delete: number;
}

export class AuthStoreError extends Error {
	constructor(
		message: string,
		readonly status = 400,
		readonly retryAfter?: number,
	) {
		super(message);
		this.name = "AuthStoreError";
	}
}

function username(value: string): string {
	if (typeof value !== "string") throw new AuthStoreError("Username must be text.");
	const normalized = value.trim().toLowerCase();
	if (!/^[a-z0-9._-]{3,64}$/.test(normalized)) {
		throw new AuthStoreError("Username must contain 3–64 letters a-z, digits, periods, underscores or hyphens.");
	}
	return normalized;
}

function validatePassword(value: string): void {
	if (typeof value !== "string" || Array.from(value).length < 15 || Array.from(value).length > 128) {
		throw new AuthStoreError("Password must contain 15–128 characters.");
	}
}

function displayName(value: string): string {
	if (typeof value !== "string" || !value.trim()) throw new AuthStoreError("Display name is required.");
	return value.trim();
}

function validateRole(value: string): asserts value is ServerUser["role"] {
	if (value !== "admin" && value !== "user") throw new AuthStoreError("Role must be admin or user.");
}

function publicUser(row: UserRow): ServerUser {
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		role: row.role,
		active: Boolean(row.active),
		mustChangePassword: Boolean(row.mustChangePassword),
	};
}

function publicMember(row: MemberRow): ProjectMember {
	return {
		projectId: row.projectId,
		userId: row.userId,
		permissions: Object.fromEntries(PERMISSION_NAMES.map((key) => [key, Boolean(row[key])])) as ProjectPermissions,
	};
}

function tokenHash(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(value: string): Promise<string> {
	validatePassword(value);
	return Bun.password.hash(value, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
}

/** Persistent central accounts and access. Markdown remains in the registered project. */
export class AuthStore {
	readonly databasePath: string;
	private readonly database: ServerDatabase;
	private readonly now: () => number;

	constructor(dataDirectory: string, options: { now?: () => number } = {}) {
		this.database = new ServerDatabase(dataDirectory);
		this.databasePath = this.database.databasePath;
		this.now = options.now ?? Date.now;
	}

	hasAdmin(): boolean {
		return this.database.read(
			false,
			(database, version) =>
				version === 2 && Boolean(database.query("SELECT 1 FROM users WHERE role='admin' AND active=1 LIMIT 1").get()),
		);
	}

	async initializeAdmin(loginName: string, password: string, name?: string): Promise<ServerUser> {
		const normalized = username(loginName);
		const label = displayName(name ?? normalized);
		const passwordHash = await hashPassword(password);
		return this.database.write((database) => {
			if (database.query("SELECT 1 FROM users LIMIT 1").get())
				throw new AuthStoreError("The initial admin is already configured. Use user reset-password for recovery.");
			return this.insertUser(database, normalized, label, "admin", passwordHash);
		});
	}

	async createUser(input: {
		username: string;
		password: string;
		displayName?: string;
		role?: ServerUser["role"];
	}): Promise<ServerUser> {
		if (!this.hasAdmin()) throw new AuthStoreError("Initialize the first admin with server user init-admin first.");
		const normalized = username(input.username);
		const label = displayName(input.displayName === undefined ? normalized : input.displayName);
		const role = input.role === undefined ? "user" : input.role;
		validateRole(role);
		const passwordHash = await hashPassword(input.password);
		return this.database.write((database) => {
			if (!database.query("SELECT 1 FROM users WHERE role='admin' AND active=1 LIMIT 1").get())
				throw new AuthStoreError("Initialize the first admin with server user init-admin first.");
			return this.insertUser(database, normalized, label, role, passwordHash);
		});
	}

	listUsers(): ServerUser[] {
		return this.database.read([], (database, version) =>
			version === 2
				? database.query<UserRow, []>(`SELECT ${USER_COLUMNS} FROM users ORDER BY username`).all().map(publicUser)
				: [],
		);
	}

	loadUser(id: string): ServerUser | null {
		return this.database.read(null, (database, version) => {
			const row = version === 2 ? this.userRow(database, id) : null;
			return row ? publicUser(row) : null;
		});
	}

	editUser(id: string, patch: { displayName?: string; role?: ServerUser["role"]; active?: boolean }): ServerUser {
		if (!this.loadUser(id)) throw new AuthStoreError("User not found.", 404);
		if (patch.role !== undefined) validateRole(patch.role);
		if (patch.active !== undefined && typeof patch.active !== "boolean")
			throw new AuthStoreError("Active must be true or false.");
		const label = patch.displayName === undefined ? undefined : displayName(patch.displayName);
		return this.database.write((database) => {
			const row = this.requireUser(database, id);
			const role = patch.role ?? row.role;
			const active = patch.active ?? Boolean(row.active);
			if (row.role === "admin" && row.active && (role !== "admin" || !active)) {
				const admins =
					database
						.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1")
						.get()?.count ?? 0;
				if (admins <= 1) throw new AuthStoreError("The last active admin cannot be deactivated or demoted.");
			}
			database
				.query("UPDATE users SET display_name=?,role=?,active=? WHERE id=?")
				.run(label ?? row.displayName, role, Number(active), id);
			if (!active) database.query("DELETE FROM sessions WHERE user_id=?").run(id);
			return publicUser(this.requireUser(database, id));
		});
	}

	async resetPassword(id: string, password: string): Promise<ServerUser> {
		if (!this.loadUser(id)) throw new AuthStoreError("User not found.", 404);
		const passwordHash = await hashPassword(password);
		return this.database.write((database) => {
			this.requireUser(database, id);
			database.query("UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?").run(passwordHash, id);
			database.query("DELETE FROM sessions WHERE user_id=?").run(id);
			return publicUser(this.requireUser(database, id));
		});
	}

	async login(loginName: string, password: string): Promise<{ token: string; session: AuthSession }> {
		if (!this.hasAdmin()) throw new AuthStoreError("Invalid username or password.", 401);
		const normalized = typeof loginName === "string" ? loginName.trim().toLowerCase() : "";
		const attempt = this.database.write((database) => {
			const now = this.now();
			database.query("DELETE FROM login_attempts WHERE attempted_at <= ?").run(now - FAILURE_WINDOW);
			const failures = database
				.query<{ attemptedAt: number }, [string, number]>(
					"SELECT attempted_at AS attemptedAt FROM login_attempts WHERE username=? AND failed=1 AND attempted_at>? ORDER BY attempted_at",
				)
				.all(normalized, now - FAILURE_WINDOW);
			const global = database
				.query<{ attemptedAt: number }, [number]>(
					"SELECT attempted_at AS attemptedAt FROM login_attempts WHERE attempted_at>? ORDER BY attempted_at",
				)
				.all(now - GLOBAL_WINDOW);
			if (failures.length >= 5 || global.length >= 60) {
				const until = Math.max(
					failures.length >= 5 ? (failures[0]?.attemptedAt ?? now) + FAILURE_WINDOW : now,
					global.length >= 60 ? (global[0]?.attemptedAt ?? now) + GLOBAL_WINDOW : now,
				);
				throw new AuthStoreError(
					"Too many login attempts. Try again later.",
					429,
					Math.max(1, Math.ceil((until - now) / 1000)),
				);
			}
			// Pending verifications count as failures so simultaneous attempts cannot bypass either limit.
			const inserted = database
				.query("INSERT INTO login_attempts(username,attempted_at,failed) VALUES (?,?,1)")
				.run(normalized, now);
			const row = database
				.query<UserRow, [string]>(`SELECT ${USER_COLUMNS} FROM users WHERE username=?`)
				.get(normalized);
			return { id: Number(inserted.lastInsertRowid), row };
		});
		const boundedPassword = typeof password === "string" && Array.from(password).length <= 128 ? password : "";
		const valid = await Bun.password.verify(boundedPassword, attempt.row?.passwordHash ?? DUMMY_HASH);
		if (!valid || !attempt.row?.active) throw new AuthStoreError("Invalid username or password.", 401);
		return this.database.write((database) => {
			const current = this.userRow(database, attempt.row?.id ?? "");
			if (!current?.active || current.passwordHash !== attempt.row?.passwordHash)
				throw new AuthStoreError("Invalid username or password.", 401);
			database.query("UPDATE login_attempts SET failed=0 WHERE id=?").run(attempt.id);
			return this.createSession(database, current);
		});
	}

	loadSession(token: string): AuthSession | null {
		return this.database.read(null, (database, version) => (version === 2 ? this.session(database, token) : null));
	}

	logout(token: string): void {
		if (!this.loadSession(token)) return;
		this.database.write((database) => {
			database.query("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
		});
	}

	async changePassword(
		token: string,
		currentPassword: string,
		newPassword: string,
	): Promise<{ token: string; session: AuthSession }> {
		const session = this.loadSession(token);
		if (!session) throw new AuthStoreError("Authentication required.", 401);
		const originalHash = this.database.read<string | null>(
			null,
			(database) => this.userRow(database, session.user.id)?.passwordHash ?? null,
		);
		if (!originalHash || !(await Bun.password.verify(currentPassword, originalHash)))
			throw new AuthStoreError("Current password is incorrect.", 400);
		validatePassword(newPassword);
		if (await Bun.password.verify(newPassword, originalHash))
			throw new AuthStoreError("New password must be different from the current password.", 400);
		const passwordHash = await hashPassword(newPassword);
		return this.database.write((database) => {
			const currentSession = this.session(database, token);
			const currentUser = currentSession ? this.userRow(database, currentSession.user.id) : null;
			if (!currentUser || currentUser.passwordHash !== originalHash)
				throw new AuthStoreError("Authentication required.", 401);
			database
				.query("UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?")
				.run(passwordHash, currentUser.id);
			database.query("DELETE FROM sessions WHERE user_id=?").run(currentUser.id);
			return this.createSession(database, this.requireUser(database, currentUser.id));
		});
	}

	activity(token: string): AuthSession | null {
		if (!this.loadSession(token)) return null;
		return this.database.write((database) => {
			if (!this.session(database, token)) return null;
			database.query("UPDATE sessions SET last_activity_at=? WHERE token_hash=?").run(this.now(), tokenHash(token));
			return this.session(database, token);
		});
	}

	permissions(user: ServerUser, projectId: string): ProjectPermissions | null {
		return this.database.read(null, (database, version) => {
			if (version !== 2 || !database.query("SELECT 1 FROM projects WHERE CAST(id AS TEXT)=?").get(projectId))
				return null;
			const current = this.userRow(database, user.id);
			if (!current?.active) return null;
			if (current.role === "admin") return { ...ADMIN_PERMISSIONS };
			const row = database
				.query<MemberRow, [string, string]>(
					`SELECT ${MEMBER_COLUMNS} FROM project_members WHERE CAST(project_id AS TEXT)=? AND user_id=?`,
				)
				.get(projectId, user.id);
			return row ? publicMember(row).permissions : null;
		});
	}

	listMembers(projectId: string): ProjectMember[] {
		const rows = this.database.read<MemberRow[] | null>(null, (database, version) => {
			this.requireProject(database, projectId);
			return version === 2
				? database
						.query<MemberRow, [string]>(
							`SELECT ${MEMBER_COLUMNS} FROM project_members WHERE CAST(project_id AS TEXT)=? ORDER BY user_id`,
						)
						.all(projectId)
				: [];
		});
		if (rows === null) throw new AuthStoreError("Project not found.", 404);
		return rows.map(publicMember);
	}

	setMember(projectId: string, userId: string, patch: Partial<ProjectPermissions> = {}): ProjectMember {
		if (!this.loadUser(userId)) throw new AuthStoreError("User not found.", 404);
		for (const [key, value] of Object.entries(patch)) {
			if (!PERMISSION_NAMES.includes(key as keyof ProjectPermissions) || typeof value !== "boolean")
				throw new AuthStoreError("Permissions must use known names and boolean values.");
		}
		return this.database.write((database) => {
			this.requireProject(database, projectId);
			this.requireUser(database, userId);
			const row = database
				.query<MemberRow, [string, string]>(
					`SELECT ${MEMBER_COLUMNS} FROM project_members WHERE CAST(project_id AS TEXT)=? AND user_id=?`,
				)
				.get(projectId, userId);
			const permissions = { ...(row ? publicMember(row).permissions : DEFAULT_PERMISSIONS), ...patch };
			database
				.query(
					"INSERT INTO project_members(project_id,user_id,tasks_write,docs_write,decisions_write,decisions_manage,archive,permanent_delete) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET tasks_write=excluded.tasks_write,docs_write=excluded.docs_write,decisions_write=excluded.decisions_write,decisions_manage=excluded.decisions_manage,archive=excluded.archive,permanent_delete=excluded.permanent_delete",
				)
				.run(Number(projectId), userId, ...PERMISSION_NAMES.map((key) => Number(permissions[key])));
			return { projectId, userId, permissions };
		});
	}

	removeMember(projectId: string, userId: string): void {
		if (!this.loadUser(userId)) throw new AuthStoreError("User not found.", 404);
		this.database.write((database) => {
			this.requireProject(database, projectId);
			this.requireUser(database, userId);
			database
				.query("DELETE FROM project_members WHERE CAST(project_id AS TEXT)=? AND user_id=?")
				.run(projectId, userId);
		});
	}

	private userRow(database: Database, id: string): UserRow | null {
		return database.query<UserRow, [string]>(`SELECT ${USER_COLUMNS} FROM users WHERE id=?`).get(id);
	}

	private requireUser(database: Database, id: string): UserRow {
		const row = this.userRow(database, id);
		if (!row) throw new AuthStoreError("User not found.", 404);
		return row;
	}

	private requireProject(database: Database, id: string): void {
		if (!/^[1-9]\d*$/.test(id) || !database.query("SELECT 1 FROM projects WHERE id=?").get(Number(id)))
			throw new AuthStoreError("Project not found.", 404);
	}

	private insertUser(
		database: Database,
		loginName: string,
		label: string,
		role: ServerUser["role"],
		passwordHash: string,
	): ServerUser {
		if (database.query("SELECT 1 FROM users WHERE username=?").get(loginName))
			throw new AuthStoreError("Username is already in use.");
		const id = randomUUID();
		database
			.query(
				"INSERT INTO users(id,username,display_name,role,active,password_hash,must_change_password) VALUES(?,?,?,?,1,?,1)",
			)
			.run(id, loginName, label, role, passwordHash);
		return publicUser(this.requireUser(database, id));
	}

	private createSession(database: Database, user: UserRow): { token: string; session: AuthSession } {
		const token = randomBytes(32).toString("base64url");
		const now = this.now();
		database
			.query(
				"INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_activity_at) VALUES(?,?,?,?,?,?)",
			)
			.run(tokenHash(token), user.id, randomBytes(32).toString("base64url"), now, now + ABSOLUTE_LIFETIME, now);
		const session = this.session(database, token);
		if (!session) throw new Error("Session creation returned no record.");
		return { token, session };
	}

	private session(database: Database, token: string): AuthSession | null {
		if (!token || typeof token !== "string") return null;
		const row = database
			.query<SessionRow, [string]>(
				"SELECT user_id AS userId,csrf_token AS csrfToken,created_at AS createdAt,expires_at AS expiresAt,last_activity_at AS lastActivityAt FROM sessions WHERE token_hash=?",
			)
			.get(tokenHash(token));
		const now = this.now();
		if (!row || row.expiresAt <= now || row.lastActivityAt + IDLE_LIFETIME <= now) return null;
		const user = this.userRow(database, row.userId);
		if (!user?.active) return null;
		return {
			user: publicUser(user),
			csrfToken: row.csrfToken,
			createdAt: new Date(row.createdAt).toISOString(),
			expiresAt: new Date(row.expiresAt).toISOString(),
			lastActivityAt: new Date(row.lastActivityAt).toISOString(),
			idleExpiresAt: new Date(Math.min(row.expiresAt, row.lastActivityAt + IDLE_LIFETIME)).toISOString(),
		};
	}
}
