import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { ARCHIVED_TASK_DIRECTORIES, DEFAULT_DIRECTORIES } from "../constants/index.ts";
import type { FileSystem } from "../file-system/operations.ts";
import { type FileEntry, fileEntriesEqual } from "../file-system/prepared-change.ts";
import { parseDecision, parseDocument, parseMilestone, parseTask } from "../markdown/parser.ts";
import { decisionIdKey } from "../utils/decision-id.ts";
import { documentIdKey } from "../utils/document-id.ts";
import { isValidTaskId, taskIdsEqual } from "../utils/task-id.ts";
import {
	draftIdsMatchLoosely,
	extractDraftIdFromFilename,
	extractTaskIdFromFilename,
	normalizeTaskIdentity,
} from "../utils/task-path.ts";
import { containsPath } from "./folder-areas.ts";
import type { RecordKind } from "./mutation-types.ts";
import type { ObservedFileIdentity, ObservedPathSnapshot } from "./observation-types.ts";
import { assertProjectBoundary, readProjectFile } from "./project-paths.ts";

export interface ScannedRecord {
	path: string;
	entry: Exclude<FileEntry, null>;
	recordBytes: Uint8Array;
	identity: ObservedFileIdentity | null;
	kind: RecordKind;
	visibleId: string;
	lifecycle: "active" | "draft" | "archived";
}

export type ObservationProblem = { path: string; state: "invalid" | "unreadable" | "unstable"; error: string };
export interface ObservedInventory {
	entries: ScannedRecord[];
	/** A missing path is only trusted when every relevant directory was read successfully. */
	missing: string[];
	problems: ObservationProblem[];
	fingerprint: string;
}

const SETTLE_MS = 90;
const MAX_ATTEMPTS = 4;

function statIdentity(stats: NonNullable<ReturnType<typeof lstatSync>>): ObservedFileIdentity | null {
	const big = stats as NonNullable<ReturnType<typeof lstatSync>> & {
		dev: bigint;
		ino: bigint;
		birthtimeNs?: bigint;
	};
	if (typeof big.dev !== "bigint" || typeof big.ino !== "bigint" || !big.birthtimeNs || big.birthtimeNs <= 0n)
		return null;
	return { dev: String(big.dev), ino: String(big.ino), birthtimeNs: String(big.birthtimeNs) };
}

function sameStats(
	left: NonNullable<ReturnType<typeof lstatSync>>,
	right: NonNullable<ReturnType<typeof lstatSync>>,
): boolean {
	const a = left as NonNullable<ReturnType<typeof lstatSync>> & {
		dev: bigint;
		ino: bigint;
		size: bigint;
		mtimeNs: bigint;
		ctimeNs: bigint;
	};
	const b = right as typeof a;
	return (
		a.dev === b.dev &&
		a.ino === b.ino &&
		a.size === b.size &&
		a.mtimeNs === b.mtimeNs &&
		a.ctimeNs === b.ctimeNs &&
		left.mode === right.mode
	);
}

function readCandidate(
	root: string,
	path: string,
): { entry: Exclude<FileEntry, null>; bytes: Uint8Array; identity: ObservedFileIdentity | null } {
	const before = lstatSync(path, { bigint: true });
	if (!before.isFile() && !before.isSymbolicLink()) throw new Error("Not a regular file or file symlink.");
	const entry: Exclude<FileEntry, null> = before.isSymbolicLink()
		? { type: "symlink", target: readlinkSync(path) }
		: { type: "file", bytes: new Uint8Array() };
	const bytes = readProjectFile(root, path);
	const after = lstatSync(path, { bigint: true });
	if (!sameStats(before, after)) throw new ObservationUnstableError("File changed while it was read.");
	if (entry.type === "symlink" && readlinkSync(path) !== entry.target)
		throw new ObservationUnstableError("Symlink changed while it was read.");
	if (entry.type === "file") entry.bytes = bytes;
	return { entry, bytes, identity: statIdentity(before) };
}

class ObservationUnstableError extends Error {}

function candidateIdentity(
	kind: RecordKind,
	lifecycle: ScannedRecord["lifecycle"],
	path: string,
	content: string,
	filesystem: FileSystem,
): string {
	const file = basename(path);
	if (kind === "config") {
		Bun.YAML.parse(content);
		const config = filesystem.parseConfig(content);
		if (!config.projectName.trim()) throw new Error("Configuration has no project name.");
		return "config";
	}
	if (kind === "task") {
		const task = normalizeTaskIdentity(parseTask(content));
		if (!isValidTaskId(task.id) || !task.title.trim()) throw new Error("Task has no valid ID or title.");
		if (lifecycle === "draft") {
			if (!extractDraftIdFromFilename(file) || !draftIdsMatchLoosely(task.id, file))
				throw new Error("Draft ID does not match its filename.");
		} else {
			const fileId = extractTaskIdFromFilename(file) ?? basename(file, ".md");
			if (!taskIdsEqual(fileId, task.id)) {
				// Older task files use a hyphen between the numeric ID and title.
				const legacyId = !file.includes(" - ") ? file.match(/^([a-zA-Z]+-\d+(?:\.\d+)*)-/)?.[1] : null;
				if (!legacyId || !taskIdsEqual(legacyId, task.id)) throw new Error("Task ID does not match its filename.");
			}
		}
		return task.id;
	}
	if (kind === "document") {
		const document = parseDocument(content);
		const fileId = basename(file, ".md").split(" - ")[0] ?? "";
		if (!documentIdKey(document.id) || documentIdKey(fileId) !== documentIdKey(document.id) || !document.title.trim())
			throw new Error("Document has no valid matching ID or title.");
		return document.id;
	}
	if (kind === "decision") {
		const decision = parseDecision(content);
		const fileId = basename(file, ".md").split(" - ")[0] ?? "";
		if (!decisionIdKey(decision.id) || decisionIdKey(fileId) !== decisionIdKey(decision.id) || !decision.title.trim())
			throw new Error("Decision has no valid matching ID or title.");
		return decision.id;
	}
	const milestone = parseMilestone(content);
	const fileId = basename(file, ".md").split(" - ")[0] ?? "";
	if (
		!/^m-[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(milestone.id) ||
		fileId.toLowerCase() !== milestone.id.toLowerCase() ||
		!milestone.title.trim()
	)
		throw new Error("Milestone has no valid matching ID or title.");
	return milestone.id;
}

function listFiles(root: string, directory: string, recursive: boolean, foreignDirectory?: string): string[] {
	const found: string[] = [];
	const pending = [directory];
	const visited = new Set<string>();
	let ownRoot: string;
	try {
		ownRoot = realpathSync(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	let foreignRoot: string | null = null;
	if (foreignDirectory) {
		try {
			foreignRoot = realpathSync(foreignDirectory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	if (foreignRoot && containsPath(ownRoot, foreignRoot)) foreignRoot = null;
	for (let index = 0; index < pending.length; index++) {
		const current = pending[index];
		if (!current) continue;
		let actual: string;
		try {
			actual = realpathSync(current);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		if (!containsPath(root, actual)) throw new Error("Collection directory escapes the project root.");
		if (visited.has(actual)) continue;
		visited.add(actual);
		for (const item of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (item.name.startsWith(".")) continue;
			const path = join(current, item.name);
			const linkTarget = item.isSymbolicLink() ? realpathSync(path) : null;
			if (linkTarget && !containsPath(root, linkTarget))
				throw new Error("Collection symlink escapes the project root.");
			if (linkTarget && foreignRoot && containsPath(foreignRoot, linkTarget)) continue;
			const target = item.isSymbolicLink() ? statSync(path) : item;
			if (target.isDirectory()) {
				if (recursive && (!linkTarget || !containsPath(ownRoot, linkTarget))) pending.push(path);
			} else if (target.isFile() && item.name.endsWith(".md")) found.push(path);
		}
	}
	return found;
}

function scanOnce(root: string, filesystem: FileSystem, previousPaths: readonly string[]): ObservedInventory {
	const entries: ScannedRecord[] = [];
	const problems: ObservationProblem[] = [];
	try {
		assertProjectBoundary(root, [filesystem.backlogDir, filesystem.configFilePath]);
	} catch (error) {
		return {
			entries,
			missing: [],
			problems: [{ path: root, state: "unreadable", error: String(error) }],
			fingerprint: "",
		};
	}
	let taskPrefix: string;
	try {
		taskPrefix = (
			filesystem.parseConfig(readProjectFile(root, filesystem.configFilePath).toString("utf8")).prefixes?.task ?? "task"
		).toLowerCase();
	} catch (error) {
		return {
			entries,
			missing: [],
			fingerprint: "",
			problems: [{ path: filesystem.configFilePath, state: "invalid", error: String(error) }],
		};
	}
	const collections: Array<{
		directory: string;
		kind: RecordKind;
		lifecycle: ScannedRecord["lifecycle"];
		recursive: boolean;
		foreignDirectory?: string;
	}> = [
		{ directory: filesystem.tasksDir, kind: "task", lifecycle: "active", recursive: false },
		{
			directory: join(filesystem.backlogDir, DEFAULT_DIRECTORIES.DRAFTS),
			kind: "task",
			lifecycle: "draft",
			recursive: false,
		},
		...ARCHIVED_TASK_DIRECTORIES.map((name) => ({
			directory: join(filesystem.backlogDir, name),
			kind: "task" as const,
			lifecycle: "archived" as const,
			recursive: false,
		})),
		{
			directory: join(filesystem.backlogDir, DEFAULT_DIRECTORIES.ARCHIVE_DRAFTS),
			kind: "task",
			lifecycle: "archived",
			recursive: false,
		},
		{
			directory: filesystem.docsDir,
			kind: "document",
			lifecycle: "active",
			recursive: true,
			foreignDirectory: filesystem.archiveDocsDir,
		},
		{
			directory: filesystem.archiveDocsDir,
			kind: "document",
			lifecycle: "archived",
			recursive: true,
			foreignDirectory: filesystem.docsDir,
		},
		{ directory: filesystem.decisionsDir, kind: "decision", lifecycle: "active", recursive: false },
		{ directory: filesystem.archiveDecisionsDir, kind: "decision", lifecycle: "archived", recursive: false },
		{ directory: filesystem.milestonesDir, kind: "milestone", lifecycle: "active", recursive: false },
		{ directory: filesystem.archiveMilestonesDir, kind: "milestone", lifecycle: "archived", recursive: false },
	];
	const candidates: Array<{ path: string; kind: RecordKind; lifecycle: ScannedRecord["lifecycle"] }> = [
		{ path: filesystem.configFilePath, kind: "config", lifecycle: "active" },
	];
	for (const collection of collections) {
		try {
			for (const path of listFiles(root, collection.directory, collection.recursive, collection.foreignDirectory)) {
				const file = basename(path);
				if (collection.kind === "document" && file.toLowerCase() === "readme.md") continue;
				const prefix =
					collection.kind === "task"
						? collection.lifecycle === "draft" || collection.directory.endsWith(DEFAULT_DIRECTORIES.ARCHIVE_DRAFTS)
							? "draft"
							: taskPrefix
						: collection.kind === "decision"
							? "decision"
							: collection.kind === "milestone"
								? "m"
								: null;
				if (prefix && !file.toLowerCase().startsWith(`${prefix}-`)) continue;
				candidates.push({ path, kind: collection.kind, lifecycle: collection.lifecycle });
			}
		} catch (error) {
			problems.push({ path: collection.directory, state: "unreadable", error: String(error) });
		}
	}
	for (const candidate of candidates) {
		try {
			const { entry, bytes, identity } = readCandidate(root, candidate.path);
			const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			const visibleId = candidateIdentity(candidate.kind, candidate.lifecycle, candidate.path, content, filesystem);
			entries.push({ ...candidate, entry, recordBytes: bytes, identity, visibleId });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			problems.push({
				path: candidate.path,
				state:
					error instanceof ObservationUnstableError || code === "ENOENT" ? "unstable" : code ? "unreadable" : "invalid",
				error: String(error),
			});
		}
	}
	entries.sort((a, b) => a.path.localeCompare(b.path));
	const present = new Set(entries.map((entry) => entry.path));
	const missing = problems.length === 0 ? previousPaths.filter((path) => !present.has(path)).sort() : [];
	const hash = createHash("sha256");
	for (const item of entries) {
		hash
			.update(item.path)
			.update("\0")
			.update(item.kind)
			.update("\0")
			.update(item.visibleId)
			.update("\0")
			.update(item.lifecycle)
			.update("\0");
		if (item.entry.type === "symlink") hash.update(item.entry.target);
		hash.update("\0").update(item.recordBytes).update("\0");
	}
	return { entries, missing, problems, fingerprint: hash.digest("hex") };
}

/** A changed result needs two matching guarded reads; unchanged trusted bytes can return immediately. */
export async function scanObservedProjectFiles(
	root: string,
	filesystem: FileSystem,
	previousPaths: readonly string[] = [],
	previousEntries?: readonly ObservedPathSnapshot[],
): Promise<ObservedInventory> {
	let prior = scanOnce(root, filesystem, previousPaths);
	if (
		prior.problems.length === 0 &&
		previousEntries &&
		prior.entries.length === previousEntries.length &&
		prior.entries.every((entry, index) => {
			const before = previousEntries[index];
			return (
				before?.path === entry.path &&
				before.kind === entry.kind &&
				before.visibleId === entry.visibleId &&
				before.lifecycle === entry.lifecycle &&
				fileEntriesEqual(before.entry, entry.entry) &&
				Buffer.from(before.recordBytes).equals(Buffer.from(entry.recordBytes))
			);
		})
	)
		return prior;
	for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
		const current = scanOnce(root, filesystem, previousPaths);
		if (
			current.problems.length === 0 &&
			prior.problems.length === 0 &&
			current.fingerprint === prior.fingerprint &&
			current.entries.every((entry, index) => {
				const before = prior.entries[index];
				return (
					before &&
					fileEntriesEqual(before.entry, entry.entry) &&
					JSON.stringify(before.identity) === JSON.stringify(entry.identity)
				);
			})
		)
			return current;
		prior = current;
	}
	return prior.problems.length
		? prior
		: {
				entries: prior.entries,
				missing: [],
				problems: [{ path: root, state: "unstable", error: "Project files did not settle between guarded reads." }],
				fingerprint: prior.fingerprint,
			};
}
