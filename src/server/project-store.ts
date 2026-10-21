import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FileSystem } from "../file-system/operations.ts";
import { normalizeProjectBacklogDirectory } from "../utils/backlog-directory.ts";

export interface ServerProject {
	id: string;
	name: string;
	rootPath: string;
	createdAt: string;
}

const PROJECT_COLUMNS = "CAST(id AS TEXT) AS id, name, root_path AS rootPath, created_at AS createdAt";

function rootsOverlap(left: string, right: string): boolean {
	return [relative(left, right), relative(right, left)].some(
		(path) => path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`)),
	);
}

/** Persistent workspace bindings. Task content remains in each project's Markdown files. */
export class ProjectStore {
	readonly databasePath: string;

	constructor(dataDirectory: string) {
		if (!dataDirectory.trim()) throw new Error("--data-dir must name a directory.");
		this.databasePath = join(resolve(dataDirectory), "server.sqlite");
	}

	list(): ServerProject[] {
		if (!this.databaseExists()) return [];
		const database = this.openDatabase(true);
		try {
			return database.query<ServerProject, []>(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY id`).all();
		} finally {
			database.close();
		}
	}

	load(projectId: string): ServerProject | null {
		if (!/^[1-9]\d*$/.test(projectId)) throw new Error("Project ID must be a positive integer.");
		return this.list().find((project) => project.id === projectId) ?? null;
	}

	async register(name: string, projectRoot: string): Promise<ServerProject> {
		const trimmedName = name.trim();
		if (!trimmedName) throw new Error("Project name is required.");
		if (!projectRoot.trim()) throw new Error("Project root is required.");
		const rootPath = await realpath(resolve(projectRoot));
		if (!(await stat(rootPath)).isDirectory()) throw new Error(`Project root "${rootPath}" is not a directory.`);
		const filesystem = new FileSystem(rootPath);
		const config = await filesystem.loadConfig();
		if (!config?.projectName.trim()) {
			throw new Error(`No readable Backlog configuration at "${rootPath}". Initialize it with backlog init first.`);
		}
		if (config.backlogDirectory !== undefined && !normalizeProjectBacklogDirectory(config.backlogDirectory)) {
			throw new Error(`Invalid backlog_directory in "${filesystem.configFilePath}".`);
		}
		if (!(await stat(filesystem.backlogDir)).isDirectory()) {
			throw new Error(`Backlog path "${filesystem.backlogDir}" is not a directory.`);
		}

		const existingDatabase = this.databaseExists();
		await mkdir(dirname(this.databasePath), { recursive: true });
		const database = this.openDatabase(false);
		try {
			return database
				.transaction(() => {
					// Existing files must already contain our schema; do not repair an empty or damaged database.
					if (!existingDatabase) {
						database.exec(`CREATE TABLE IF NOT EXISTS projects (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						name TEXT NOT NULL,
						root_path TEXT NOT NULL UNIQUE,
						created_at TEXT NOT NULL
					) STRICT`);
					}
					const projects = database.query<ServerProject, []>(`SELECT ${PROJECT_COLUMNS} FROM projects`).all();
					for (const project of projects) {
						if (project.rootPath === rootPath) {
							throw new Error(
								`Directory "${rootPath}" is already registered as project ${project.id} (${project.name}).`,
							);
						}
						if (rootsOverlap(project.rootPath, rootPath)) {
							throw new Error(`Directory "${rootPath}" overlaps project ${project.id} at "${project.rootPath}".`);
						}
					}
					const project = database
						.query<ServerProject, [string, string, string]>(
							`INSERT INTO projects (name, root_path, created_at) VALUES (?, ?, ?) RETURNING ${PROJECT_COLUMNS}`,
						)
						.get(trimmedName, rootPath, new Date().toISOString());
					if (!project) throw new Error("Project registration returned no record.");
					return project;
				})
				.immediate();
		} finally {
			database.close();
		}
	}

	private databaseExists(): boolean {
		try {
			statSync(this.databasePath);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}

	private openDatabase(readonly: boolean): Database {
		const database = new Database(this.databasePath, { readonly, create: !readonly, strict: true });
		try {
			database.exec("PRAGMA busy_timeout = 5000");
			return database;
		} catch (error) {
			database.close();
			throw error;
		}
	}
}
