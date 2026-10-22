import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ARCHIVED_TASK_DIRECTORIES, DEFAULT_FILES } from "../constants/index.ts";
import { FileSystem } from "../file-system/operations.ts";
import { parseDecision, parseDocument, parseTask } from "../markdown/parser.ts";
import type { Task } from "../types/index.ts";
import { normalizeProjectBacklogDirectory } from "../utils/backlog-directory.ts";
import { decisionIdKey } from "../utils/decision-id.ts";
import { documentIdKey } from "../utils/document-id.ts";
import { detectContentIdentityIssues, detectDuplicateTaskIds } from "../utils/duplicate-detection.ts";
import { buildGlobPattern } from "../utils/prefix-config.ts";
import { isValidTaskId } from "../utils/task-id.ts";
import {
	draftIdsMatchLoosely,
	extractDraftIdFromFilename,
	findDuplicateDraftFilenameGroups,
	normalizeTaskIdentity,
} from "../utils/task-path.ts";
import { AuthStoreError } from "./auth-store.ts";
import { containsPath } from "./folder-areas.ts";
import type { ProjectPreview } from "./registration-types.ts";

function failure(message: string): never {
	throw new AuthStoreError(message);
}

/** Resolve only filesystem metadata before any config discovery or project content read. */
export function canonicalProjectRoot(projectRoot: string): string {
	if (typeof projectRoot !== "string" || !projectRoot.trim()) failure("Project root is required.");
	try {
		const root = realpathSync(resolve(projectRoot));
		if (!statSync(root).isDirectory()) failure("Project root is not a directory.");
		return root;
	} catch (error) {
		if (error instanceof AuthStoreError) throw error;
		return failure("Project root is not a readable directory.");
	}
}

/** Bind bytes to an already opened Linux file, so a changed symlink cannot fill a cache. */
export function readProjectFile(rootPath: string, path: string): Buffer {
	if (canonicalProjectRoot(rootPath) !== resolve(rootPath) || !containsPath(rootPath, resolve(path))) {
		failure("Project file escapes the project root.");
	}
	const descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
	try {
		const assertOpenedFile = () => {
			const actualPath = realpathSync(`/proc/self/fd/${descriptor}`);
			if (!containsPath(rootPath, actualPath) || !fstatSync(descriptor).isFile()) {
				failure("Project file escapes the project root or is not a regular file.");
			}
		};
		assertOpenedFile();
		const bytes = readFileSync(descriptor);
		assertOpenedFile();
		return bytes;
	} finally {
		closeSync(descriptor);
	}
}

function present(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function checkPath(root: string, path: string): string | null {
	if (!containsPath(root, resolve(path))) failure("Backlog path escapes the project root.");
	// A missing child still needs its existing parents checked: an external directory link
	// must never become an accepted future config, attachment, or record location.
	let ancestor = path;
	while (!present(ancestor)) {
		const parent = dirname(ancestor);
		if (parent === ancestor) failure("Backlog path is unavailable.");
		ancestor = parent;
	}
	let target: string;
	try {
		target = realpathSync(ancestor);
	} catch {
		return failure("Backlog path contains an unreadable symbolic link.");
	}
	if (!containsPath(root, target)) failure("Backlog path escapes the project root.");
	return ancestor === path ? target : null;
}

function checkTree(root: string, path: string, visited = new Set<string>()): void {
	const target = checkPath(root, path);
	if (!target) return;
	const stat = statSync(target);
	if (stat.isFile()) return;
	if (!stat.isDirectory()) failure("Backlog paths must contain only files and directories.");
	if (visited.has(target)) return;
	visited.add(target);
	for (const name of readdirSync(path).sort()) checkTree(root, join(path, name), visited);
}

/** No FileSystem constructor may inspect an unchecked config candidate, including unused candidates. */
function checkedFilesystem(root: string): FileSystem {
	if (canonicalProjectRoot(root) !== resolve(root)) failure("Project root changed its real location.");
	checkPath(root, join(root, DEFAULT_FILES.ROOT_CONFIG));
	for (const directory of ["backlog", ".backlog"]) {
		const path = join(root, directory);
		checkPath(root, path);
		for (const file of [DEFAULT_FILES.CONFIG, DEFAULT_FILES.CONFIG_YAML]) checkPath(root, join(path, file));
	}
	return new FileSystem(root, (path) => readProjectFile(root, path));
}

function readPreparedProject(root: string): { filesystem: FileSystem; config: NonNullable<ProjectPreview["config"]> } {
	const filesystem = checkedFilesystem(root);
	const configPath = filesystem.configFilePath;
	if (!checkPath(root, configPath) || !statSync(configPath).isFile()) {
		failure("No readable Backlog configuration. Initialize it with backlog init first.");
	}
	const content = readProjectFile(root, configPath).toString("utf8");
	// The regular reader validates individual supported values. Also reject malformed YAML
	// rather than silently accepting a broken unrelated block as a prepared project.
	Bun.YAML.parse(content);
	const config = filesystem.parseConfig(content);
	if (!config.projectName.trim()) failure("No readable Backlog configuration. Initialize it with backlog init first.");
	if (config.backlogDirectory !== undefined && !normalizeProjectBacklogDirectory(config.backlogDirectory)) {
		failure("Invalid backlog_directory in Backlog configuration.");
	}
	if (!checkPath(root, filesystem.backlogDir) || !statSync(filesystem.backlogDir).isDirectory()) {
		failure("Backlog path is not a readable directory.");
	}
	return { filesystem, config };
}

/** Synchronous guard for central API/cache/WS delivery and pinned previous handler layouts. */
export function assertProjectBoundary(rootPath: string, pinnedPaths: readonly string[] = []): void {
	const { filesystem } = readPreparedProject(rootPath);
	const visited = new Set<string>();
	checkTree(rootPath, filesystem.backlogDir, visited);
	for (const path of pinnedPaths) checkTree(rootPath, path, visited);
}

/** Read existing records without initializing Core, creating directories, or publishing caches. */
export function inspectProject(name: string, rootPath: string): ProjectPreview {
	const preview: ProjectPreview = {
		name,
		rootPath,
		backlogPath: null,
		configPath: null,
		config: null,
		counts: { tasks: 0, drafts: 0, documents: 0, decisions: 0, archived: 0 },
		issues: [],
		canRegister: false,
	};
	try {
		const { filesystem, config } = readPreparedProject(rootPath);
		preview.backlogPath = filesystem.backlogDir;
		preview.configPath = filesystem.configFilePath;
		preview.config = config;
		checkTree(rootPath, filesystem.backlogDir);
		const tasks: Task[] = [];
		const documents: { id: string; path: string }[] = [];
		const decisions: { id: string; path: string }[] = [];
		const warning = (message: string, path: string) => preview.issues.push({ severity: "warning", message, path });
		const files = (directory: string, pattern: string): string[] => {
			const path = join(filesystem.backlogDir, directory);
			return present(path) ? [...new Bun.Glob(pattern).scanSync({ cwd: path, followSymlinks: true })].sort() : [];
		};
		const collections = [
			{ directory: "tasks", kind: "tasks", pattern: buildGlobPattern(config.prefixes?.task ?? "task") },
			{ directory: "drafts", kind: "drafts", pattern: buildGlobPattern("draft") },
			{ directory: "docs", kind: "documents", pattern: "**/*.md" },
			{ directory: "decisions", kind: "decisions", pattern: "decision-*.md" },
			...ARCHIVED_TASK_DIRECTORIES.map((directory) => ({
				directory,
				kind: "tasks" as const,
				pattern: buildGlobPattern(config.prefixes?.task ?? "task"),
				archived: true,
			})),
			{ directory: "archive/drafts", kind: "drafts", pattern: buildGlobPattern("draft"), archived: true },
			{ directory: "archive/docs", kind: "documents", pattern: "**/*.md", archived: true },
			{ directory: "archive/decisions", kind: "decisions", pattern: "decision-*.md", archived: true },
		] as const;
		for (const collection of collections) {
			const entries = files(collection.directory, collection.pattern).filter(
				(file) => collection.kind !== "documents" || basename(file).toLowerCase() !== "readme.md",
			);
			const archived = "archived" in collection && collection.archived;
			preview.counts[archived ? "archived" : collection.kind] += entries.length;
			if (collection.kind === "drafts") {
				for (const group of findDuplicateDraftFilenameGroups(entries)) {
					for (const file of group) warning("Duplicate draft identity.", join(collection.directory, file));
				}
			}
			for (const file of entries) {
				const path = join(collection.directory, file);
				try {
					const content = readProjectFile(rootPath, join(filesystem.backlogDir, path)).toString("utf8");
					if (collection.kind === "tasks" || collection.kind === "drafts") {
						const task = normalizeTaskIdentity(parseTask(content));
						if (!isValidTaskId(task.id)) warning("Task has a missing or invalid identity.", path);
						if (!task.title.trim()) warning("Task has no title.", path);
						if (!config.statuses.includes(task.status)) warning(`Unknown task status: ${task.status}.`, path);
						if (collection.kind === "drafts") {
							if (!draftIdsMatchLoosely(task.id, file)) {
								warning(
									`Draft identity does not match filename ${extractDraftIdFromFilename(file) ?? "(missing id)"}.`,
									path,
								);
							}
						} else if (isValidTaskId(task.id)) tasks.push({ ...task, filePath: path });
					} else {
						const record = collection.kind === "documents" ? parseDocument(content) : parseDecision(content);
						if (!record.title.trim()) warning("Record has no title.", path);
						(collection.kind === "documents" ? documents : decisions).push({ id: record.id, path });
					}
				} catch (error) {
					warning(`Record could not be parsed: ${error instanceof Error ? error.message : String(error)}`, path);
				}
			}
		}
		for (const group of detectDuplicateTaskIds(tasks)) {
			for (const task of group.tasks) warning(`Duplicate task identity: ${group.id}.`, task.filePath ?? "tasks");
		}
		for (const [entries, key] of [
			[documents, documentIdKey],
			[decisions, decisionIdKey],
		] as const) {
			const findings = detectContentIdentityIssues(entries, key);
			for (const path of findings.missingIds) warning("Record has no addressable identity.", path);
			for (const group of findings.duplicates) {
				for (const path of group.paths) warning(`Duplicate record identity: ${group.id}.`, path);
			}
		}
		preview.canRegister = true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Paths carried by parser errors are local to the authorized project; emit relative
		// diagnostics so previews never expose another binding's identity or location.
		preview.issues.push({ severity: "error", message: message.replaceAll(rootPath, ".") });
	}
	return preview;
}
