import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { AuthStoreError } from "./auth-store.ts";
import { DEFAULT_PERMISSIONS } from "./auth-types.ts";
import { ServerDatabase } from "./database.ts";
import { assertRegistrationAccess, pathsOverlap } from "./folder-areas.ts";
import type { ManagementAuditHook } from "./mutations.ts";
import { canonicalProjectRoot, inspectProject } from "./project-paths.ts";
import type { ProjectPreview } from "./registration-types.ts";

export interface ServerProject {
	id: string;
	name: string;
	rootPath: string;
	createdAt: string;
	tracking: boolean;
}

type ProjectRow = Omit<ServerProject, "tracking"> & { tracking: number };
const PROJECT_COLUMNS = "CAST(id AS TEXT) AS id, name, root_path AS rootPath, created_at AS createdAt";

function listProjects(database: Database, version = 3): ServerProject[] {
	return database
		.query<ProjectRow, []>(
			`SELECT ${PROJECT_COLUMNS}, ${version >= 3 ? "tracking" : "1 AS tracking"} FROM projects ORDER BY id`,
		)
		.all()
		.map((project) => ({ ...project, tracking: Boolean(project.tracking) }));
}

function projectName(name: string): string {
	if (typeof name !== "string" || !name.trim()) throw new AuthStoreError("Project name is required.");
	return name.trim();
}

function assertNoCollision(projects: ServerProject[], rootPath: string, actorId?: string): void {
	for (const project of projects) {
		if (!pathsOverlap(project.rootPath, rootPath)) continue;
		if (actorId) throw new AuthStoreError("Project root is already registered or overlaps an existing project.", 409);
		throw new AuthStoreError(
			project.rootPath === rootPath
				? `Directory "${rootPath}" is already registered as project ${project.id} (${project.name}).`
				: `Directory "${rootPath}" overlaps project ${project.id} at "${project.rootPath}".`,
			409,
		);
	}
}

function assertPrepared(preview: ProjectPreview): void {
	if (!preview.canRegister) {
		throw new AuthStoreError(
			preview.issues.find((issue) => issue.severity === "error")?.message ?? "Project is not prepared.",
		);
	}
}

/** Persistent workspace bindings. Task content remains in each project's Markdown files. */
export class ProjectStore {
	readonly databasePath: string;
	private readonly database: ServerDatabase;

	constructor(dataDirectory: string) {
		this.database = new ServerDatabase(dataDirectory);
		this.databasePath = this.database.databasePath;
	}

	list(): ServerProject[] {
		return this.database.read([], listProjects);
	}

	load(projectId: string): ServerProject | null {
		if (!/^[1-9]\d*$/.test(projectId)) throw new AuthStoreError("Project ID must be a positive integer.");
		return this.list().find((project) => project.id === projectId) ?? null;
	}

	async preview(name: string, projectRoot: string, actorId?: string): Promise<ProjectPreview> {
		const trimmedName = projectName(name);
		let rootPath: string;
		try {
			rootPath = canonicalProjectRoot(projectRoot);
		} catch (error) {
			// A forbidden missing/file path must not reveal different filesystem metadata
			// from an existing forbidden directory. Account failure still takes priority.
			if (actorId && typeof projectRoot === "string") this.assertActorAccess(actorId, resolve(projectRoot));
			throw error;
		}
		// Permission comes before config discovery or any record read. Reads never upgrade SQLite.
		if (actorId) this.assertActorAccess(actorId, rootPath);
		try {
			assertNoCollision(this.list(), rootPath, actorId);
		} catch (error) {
			if (!(error instanceof AuthStoreError)) throw error;
			// Folder grants authorize new registration, not inspection of an existing
			// private binding. Detect collisions before reading any of its source files.
			return {
				name: trimmedName,
				rootPath: actorId ? resolve(projectRoot) : rootPath,
				backlogPath: null,
				configPath: null,
				config: null,
				counts: { tasks: 0, drafts: 0, documents: 0, decisions: 0, archived: 0 },
				issues: [{ severity: "error", message: error.message }],
				canRegister: false,
			};
		}
		return inspectProject(trimmedName, rootPath);
	}

	private assertActorAccess(actorId: string, rootPath: string): void {
		const authorized = this.database.read(false, (database, version) => {
			if (version < 2) throw new AuthStoreError("Authentication required.", 401);
			assertRegistrationAccess(database, actorId, rootPath);
			return true;
		});
		if (!authorized) throw new AuthStoreError("Authentication required.", 401);
	}

	async register(
		name: string,
		projectRoot: string,
		actorId?: string,
		beforeCommit?: () => void,
		audit?: ManagementAuditHook,
	): Promise<ServerProject> {
		const trimmedName = projectName(name);
		// Refuse unsafe/unprepared input before creating metadata. Actor preview also
		// ensures no project content is read before authorization.
		const preview = await this.preview(trimmedName, projectRoot, actorId);
		const rootPath = preview.canRegister ? preview.rootPath : canonicalProjectRoot(projectRoot);
		assertNoCollision(this.list(), rootPath, actorId);
		assertPrepared(preview);
		return this.database.write((database) => {
			beforeCommit?.();
			if (actorId) assertRegistrationAccess(database, actorId, rootPath);
			const currentRoot = canonicalProjectRoot(projectRoot);
			if (actorId) assertRegistrationAccess(database, actorId, currentRoot);
			if (currentRoot !== rootPath) throw new AuthStoreError("Project root changed since preview. Preview it again.");
			assertNoCollision(listProjects(database), currentRoot, actorId);
			// Synchronous inspection shares the transaction with current access checks,
			// insertion, and the creator's standard membership.
			assertPrepared(inspectProject(trimmedName, currentRoot));
			const row = database
				.query<ProjectRow, [string, string, string]>(
					`INSERT INTO projects (name, root_path, created_at) VALUES (?, ?, ?) RETURNING ${PROJECT_COLUMNS}, tracking`,
				)
				.get(trimmedName, currentRoot, new Date().toISOString());
			if (!row) throw new Error("Project registration returned no record.");
			if (actorId) {
				const permissions = DEFAULT_PERMISSIONS;
				database
					.query(
						"INSERT INTO project_members(project_id,user_id,tasks_write,docs_write,decisions_write,decisions_manage,archive,permanent_delete) VALUES(?,?,?,?,?,?,?,?)",
					)
					.run(
						row.id,
						actorId,
						Number(permissions.tasksWrite),
						Number(permissions.docsWrite),
						Number(permissions.decisionsWrite),
						Number(permissions.decisionsManage),
						Number(permissions.archive),
						Number(permissions.delete),
					);
			}
			const project = { ...row, tracking: Boolean(row.tracking) };
			audit?.(
				database,
				[
					{ kind: "project", recordKey: `project:${project.id}`, visibleId: project.id, before: null, after: project },
					...(actorId
						? [
								{
									kind: "membership" as const,
									recordKey: `membership:${project.id}:${actorId}`,
									visibleId: actorId,
									before: null,
									after: { projectId: project.id, userId: actorId, permissions: DEFAULT_PERMISSIONS },
								},
							]
						: []),
				],
				project,
			);
			return project;
		});
	}

	async setTracking(
		projectId: string,
		tracking: boolean,
		beforeCommit?: () => void,
		audit?: ManagementAuditHook,
	): Promise<ServerProject> {
		if (typeof tracking !== "boolean") throw new AuthStoreError("Tracking must be a boolean.");
		const project = this.load(projectId);
		if (!project) throw new AuthStoreError("Project not found.", 404);
		if (tracking) assertPrepared(inspectProject(project.name, project.rootPath));
		return this.database.write((database) => {
			beforeCommit?.();
			const current = listProjects(database).find((entry) => entry.id === projectId);
			if (!current) throw new AuthStoreError("Project not found.", 404);
			if (tracking) assertPrepared(inspectProject(current.name, current.rootPath));
			database.query("UPDATE projects SET tracking=? WHERE id=?").run(Number(tracking), projectId);
			const project = { ...current, tracking };
			audit?.(
				database,
				{ kind: "project", recordKey: `project:${projectId}`, visibleId: projectId, before: current, after: project },
				project,
			);
			return project;
		});
	}
}
