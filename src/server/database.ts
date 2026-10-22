import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PROJECT_SCHEMA = `CREATE TABLE projects (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	root_path TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL
) STRICT`;

const AUTH_SCHEMA = `
CREATE TABLE users (
	id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
	role TEXT NOT NULL CHECK(role IN ('admin','user')), active INTEGER NOT NULL CHECK(active IN (0,1)),
	password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL CHECK(must_change_password IN (0,1))
) STRICT;
CREATE TABLE sessions (
	token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf_token TEXT NOT NULL,
	created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL
) STRICT;
CREATE TABLE project_members (
	project_id INTEGER NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id),
	tasks_write INTEGER NOT NULL CHECK(tasks_write IN (0,1)), docs_write INTEGER NOT NULL CHECK(docs_write IN (0,1)),
	decisions_write INTEGER NOT NULL CHECK(decisions_write IN (0,1)),
	decisions_manage INTEGER NOT NULL CHECK(decisions_manage IN (0,1)),
	archive INTEGER NOT NULL CHECK(archive IN (0,1)), permanent_delete INTEGER NOT NULL CHECK(permanent_delete IN (0,1)),
	PRIMARY KEY(project_id,user_id)
) STRICT;
CREATE TABLE login_attempts (
	id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, attempted_at INTEGER NOT NULL,
	failed INTEGER NOT NULL CHECK(failed IN (0,1))
) STRICT;
CREATE INDEX login_attempts_time ON login_attempts(attempted_at);
CREATE INDEX sessions_user ON sessions(user_id);
PRAGMA user_version = 2;
`;

const TRACKING_COLUMN = "tracking INTEGER NOT NULL DEFAULT 1 CHECK(tracking IN(0,1))";
const REGISTRATION_SCHEMA = `
ALTER TABLE projects ADD COLUMN ${TRACKING_COLUMN};
CREATE TABLE folder_areas (
	id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
	root_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
) STRICT;
PRAGMA user_version = 3;
`;

function normalizedSql(sql: string): string {
	return sql
		.replace(/'(?:''|[^'])*'|[^']+/g, (part) => (part.startsWith("'") ? part : part.replace(/\s+/g, "").toLowerCase()))
		.replace(/;$/, "");
}

function declarations(schema: string): Record<string, string> {
	return Object.fromEntries(
		schema.matchAll(/CREATE (?:TABLE|INDEX) (\w+)[\s\S]*?;/g).map((match) => [match[1], normalizedSql(match[0])]),
	);
}

const SCHEMA_V2 = declarations(`${PROJECT_SCHEMA};${AUTH_SCHEMA}`);
const SCHEMA_V3: Record<string, string> = {
	...SCHEMA_V2,
	...declarations(REGISTRATION_SCHEMA),
	projects: normalizedSql(PROJECT_SCHEMA.replace("\n) STRICT", `, ${TRACKING_COLUMN}) STRICT`)),
};

function schemaVersion(database: Database, allowEmpty = false): number {
	const version = database.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
	const objects = database
		.query<{ name: string; sql: string }, []>(
			"SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.all();
	if (allowEmpty && version === 0 && objects.length === 0) return -1;
	const schema = version === 3 ? SCHEMA_V3 : SCHEMA_V2;
	const expected = version === 0 ? ["projects"] : version === 2 || version === 3 ? Object.keys(schema).sort() : [];
	if (
		!expected.length ||
		expected.length !== objects.length ||
		expected.some((name, index) => name !== objects[index]?.name)
	) {
		throw new Error("Unrecognized server database schema (no such table or unsupported schema version).");
	}
	for (const { name, sql } of objects) {
		// Exact known declarations also protect PK/UNIQUE/FK/CHECK/STRICT semantics and reject added triggers/views.
		if (normalizedSql(sql) !== schema[name]) throw new Error(`Unrecognized server database schema for ${name}.`);
	}
	return version ?? 0;
}

/** One connection policy for both stores. Only mutations create or upgrade server.sqlite. */
export class ServerDatabase {
	readonly databasePath: string;

	constructor(dataDirectory: string) {
		if (!dataDirectory.trim()) throw new Error("--data-dir must name a directory.");
		this.databasePath = join(resolve(dataDirectory), "server.sqlite");
	}

	read<T>(missing: T, action: (database: Database, version: number) => T): T {
		if (!existsSync(this.databasePath)) return missing;
		const database = this.open(true);
		try {
			return action(database, schemaVersion(database));
		} finally {
			database.close();
		}
	}

	write<T>(action: (database: Database) => T): T {
		mkdirSync(dirname(this.databasePath), { recursive: true });
		const existed = existsSync(this.databasePath);
		const database = this.open(false);
		try {
			return database
				.transaction(() => {
					const version = schemaVersion(database, !existed);
					if (version === -1) database.exec(PROJECT_SCHEMA);
					if (version < 2) database.exec(AUTH_SCHEMA);
					if (version !== 3) database.exec(REGISTRATION_SCHEMA);
					return action(database);
				})
				.immediate();
		} finally {
			database.close();
		}
	}

	private open(readonly: boolean): Database {
		const database = new Database(this.databasePath, { readonly, create: !readonly, strict: true });
		try {
			database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON");
			return database;
		} catch (error) {
			database.close();
			throw error;
		}
	}
}
