import type { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AgentGrant, AgentKey, CreatedAgentKey } from "./agent-types.ts";
import { ADMIN_PERMISSIONS, PERMISSION_NAMES, type ProjectPermissions } from "./auth-types.ts";
import { ServerDatabase } from "./database.ts";
import type { MutationActor } from "./mutation-types.ts";
import { type ManagementAuditHook, managementRevision } from "./mutations.ts";

const KEY_COLUMNS =
	"id,user_id AS userId,name,secret_hash AS secretHash,created_at AS createdAt,revoked_at AS revokedAt";
const GRANT_COLUMNS =
	"CAST(g.project_id AS TEXT) AS projectId,g.tasks_write AS tasksWrite,g.docs_write AS docsWrite,g.decisions_write AS decisionsWrite,g.decisions_manage AS decisionsManage,g.archive,g.permanent_delete AS 'delete'";

interface KeyRow extends Omit<AgentKey, "grants" | "revision"> {
	secretHash: string;
}

interface GrantRow extends Omit<AgentGrant, "permissions"> {
	tasksWrite: number;
	docsWrite: number;
	decisionsWrite: number;
	decisionsManage: number;
	archive: number;
	delete: number;
}

interface AccessRow extends GrantRow {
	userId: string;
	role: "admin" | "user";
	memberTasksWrite: number | null;
	memberDocsWrite: number | null;
	memberDecisionsWrite: number | null;
	memberDecisionsManage: number | null;
	memberArchive: number | null;
	memberDelete: number | null;
}

export class AgentStoreError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "AgentStoreError";
	}
}

function grantPermissions(row: GrantRow): ProjectPermissions {
	return Object.fromEntries(PERMISSION_NAMES.map((name) => [name, Boolean(row[name])])) as ProjectPermissions;
}

function withoutRevision(key: AgentKey): Omit<AgentKey, "revision"> {
	return {
		id: key.id,
		userId: key.userId,
		name: key.name,
		grants: key.grants,
		createdAt: key.createdAt,
		revokedAt: key.revokedAt,
	};
}

function validGrants(grants: readonly AgentGrant[]): AgentGrant[] {
	if (!Array.isArray(grants) || grants.length === 0)
		throw new AgentStoreError("At least one project grant is required.");
	const seen = new Set<string>();
	for (const grant of grants) {
		if (!/^[1-9]\d*$/.test(grant?.projectId) || seen.has(grant.projectId))
			throw new AgentStoreError("Project grants must have unique project IDs.");
		seen.add(grant.projectId);
		if (
			!grant.permissions ||
			Object.keys(grant.permissions).length !== PERMISSION_NAMES.length ||
			PERMISSION_NAMES.some((permission) => typeof grant.permissions[permission] !== "boolean")
		) {
			throw new AgentStoreError("Project grants must name each boolean permission.");
		}
	}
	return [...grants].sort((a, b) => Number(a.projectId) - Number(b.projectId));
}

function loadKey(database: Database, id: string): AgentKey | null {
	const row = database.query<KeyRow, [string]>(`SELECT ${KEY_COLUMNS} FROM agent_keys WHERE id=?`).get(id);
	if (!row) return null;
	const grants = database
		.query<GrantRow, [string]>(
			`SELECT ${GRANT_COLUMNS} FROM agent_key_grants g WHERE agent_key_id=? ORDER BY project_id`,
		)
		.all(id)
		.map((grant) => ({ projectId: grant.projectId, permissions: grantPermissions(grant) }));
	const safe = {
		id: row.id,
		userId: row.userId,
		name: row.name,
		grants,
		createdAt: row.createdAt,
		revokedAt: row.revokedAt,
	};
	return { ...safe, revision: managementRevision(safe) };
}

/** User-owned bearer keys. The plaintext bearer value is returned only at creation. */
export class AgentStore {
	private readonly database: ServerDatabase;

	constructor(dataDirectory: string) {
		this.database = new ServerDatabase(dataDirectory);
	}

	create(
		input: { userId: string; name: string; grants: readonly AgentGrant[] },
		audit?: ManagementAuditHook,
	): CreatedAgentKey {
		const name = typeof input.name === "string" ? input.name.trim() : "";
		if (!name || name.length > 100) throw new AgentStoreError("Agent key name must contain 1–100 characters.");
		const grants = validGrants(input.grants);
		const id = randomUUID();
		const secret = `bk_${id}_${randomBytes(32).toString("base64url")}`;
		const secretHash = createHash("sha256").update(secret).digest("hex");
		return this.database.write((database) => {
			const user = database
				.query<{ active: number; must_change_password: number }, [string]>(
					"SELECT active,must_change_password FROM users WHERE id=?",
				)
				.get(input.userId);
			if (!user?.active || user.must_change_password) throw new AgentStoreError("Active account required.", 403);
			for (const grant of grants) {
				if (!database.query("SELECT 1 FROM projects WHERE id=? AND tracking=1").get(grant.projectId)) {
					throw new AgentStoreError("A granted project is unavailable.", 404);
				}
			}
			const createdAt = new Date().toISOString();
			database
				.query("INSERT INTO agent_keys(id,user_id,name,secret_hash,created_at,revoked_at) VALUES(?,?,?,?,?,NULL)")
				.run(id, input.userId, name, secretHash, createdAt);
			const insertGrant = database.query(
				"INSERT INTO agent_key_grants(agent_key_id,project_id,tasks_write,docs_write,decisions_write,decisions_manage,archive,permanent_delete) VALUES(?,?,?,?,?,?,?,?)",
			);
			for (const grant of grants) {
				insertGrant.run(
					id,
					Number(grant.projectId),
					...PERMISSION_NAMES.map((permission) => Number(grant.permissions[permission])),
				);
			}
			const key = loadKey(database, id);
			if (!key) throw new Error("Created agent key could not be loaded.");
			audit?.(
				database,
				{ kind: "agent-key", recordKey: `agent-key:${id}`, visibleId: id, before: null, after: withoutRevision(key) },
				{ key },
			);
			return { key, secret };
		});
	}

	list(userId?: string): AgentKey[] {
		return this.database.read([], (database, version) =>
			version < 5
				? []
				: database
						.query<{ id: string }, [string | null, string | null]>(
							"SELECT id FROM agent_keys WHERE (? IS NULL OR user_id=?) ORDER BY created_at DESC,id",
						)
						.all(userId ?? null, userId ?? null)
						.flatMap(({ id }) => {
							const key = loadKey(database, id);
							return key ? [key] : [];
						}),
		);
	}

	load(id: string): AgentKey | null {
		return this.database.read(null, (database, version) => (version < 5 ? null : loadKey(database, id)));
	}

	revoke(id: string, ownerUserId: string, audit?: ManagementAuditHook): AgentKey {
		return this.database.write((database) => {
			const before = loadKey(database, id);
			if (!before || before.userId !== ownerUserId) throw new AgentStoreError("Agent key not found.", 404);
			if (!before.revokedAt) {
				database
					.query("UPDATE agent_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL")
					.run(new Date().toISOString(), id);
			}
			const key = loadKey(database, id);
			if (!key) throw new Error("Revoked agent key could not be loaded.");
			audit?.(
				database,
				{
					kind: "agent-key",
					recordKey: `agent-key:${id}`,
					visibleId: id,
					before: withoutRevision(before),
					after: withoutRevision(key),
				},
				{ key },
			);
			return key;
		});
	}

	authenticate(secret: string): Extract<MutationActor, { kind: "agent" }> | null {
		if (typeof secret !== "string") return null;
		const match = /^bk_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/.exec(secret);
		if (!match) return null;
		return this.database.read(null, (database, version) => {
			if (version < 5) return null;
			const row = database
				.query<{ userId: string; secretHash: string }, [string]>(
					"SELECT k.user_id AS userId,k.secret_hash AS secretHash FROM agent_keys k JOIN users u ON u.id=k.user_id WHERE k.id=? AND k.revoked_at IS NULL AND u.active=1 AND u.must_change_password=0",
				)
				.get(match[1] ?? "");
			if (!row) return null;
			const supplied = createHash("sha256").update(secret).digest();
			const stored = Buffer.from(row.secretHash, "hex");
			if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) return null;
			return { kind: "agent", agentKeyId: match[1] ?? "", userId: row.userId };
		});
	}

	permissions(agentKeyId: string, projectId: string): ProjectPermissions | null {
		if (!/^[1-9]\d*$/.test(projectId)) return null;
		return this.database.read(null, (database, version) => {
			if (version < 5) return null;
			const row = database
				.query<AccessRow, [string, string]>(
					`SELECT ${GRANT_COLUMNS},k.user_id AS userId,u.role,
					 m.tasks_write AS memberTasksWrite,m.docs_write AS memberDocsWrite,
					 m.decisions_write AS memberDecisionsWrite,m.decisions_manage AS memberDecisionsManage,
					 m.archive AS memberArchive,m.permanent_delete AS memberDelete
					 FROM agent_key_grants g JOIN agent_keys k ON k.id=g.agent_key_id
					 JOIN users u ON u.id=k.user_id JOIN projects p ON p.id=g.project_id
					 LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=u.id
					 WHERE g.agent_key_id=? AND CAST(g.project_id AS TEXT)=? AND k.revoked_at IS NULL
					 AND u.active=1 AND u.must_change_password=0 AND p.tracking=1`,
				)
				.get(agentKeyId, projectId);
			if (!row || (row.role !== "admin" && row.memberTasksWrite === null)) return null;
			const grant = grantPermissions(row);
			const current =
				row.role === "admin"
					? ADMIN_PERMISSIONS
					: {
							tasksWrite: Boolean(row.memberTasksWrite),
							docsWrite: Boolean(row.memberDocsWrite),
							decisionsWrite: Boolean(row.memberDecisionsWrite),
							decisionsManage: Boolean(row.memberDecisionsManage),
							archive: Boolean(row.memberArchive),
							delete: Boolean(row.memberDelete),
						};
			return Object.fromEntries(
				PERMISSION_NAMES.map((permission) => [permission, grant[permission] && current[permission]]),
			) as ProjectPermissions;
		});
	}
}
