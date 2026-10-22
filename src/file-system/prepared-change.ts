import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readlink, realpath, rename, stat, symlink, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type FileEntry = null | { type: "file"; bytes: Uint8Array } | { type: "symlink"; target: string };

/** Internal read evidence, carried through object spreads but excluded from JSON responses. */
export const RECORD_FILE_SNAPSHOT = Symbol("backlog.recordFileSnapshot");
export interface RecordFileSnapshot {
	recordPath: string;
	bytes: Uint8Array;
}

export function attachRecordFileSnapshot<T extends object>(record: T, recordPath: string, bytes: Uint8Array): T {
	Object.defineProperty(record, RECORD_FILE_SNAPSHOT, {
		value: { recordPath, bytes } satisfies RecordFileSnapshot,
		enumerable: true,
		configurable: true,
	});
	return record;
}

export function recordFileSnapshot(record: unknown): RecordFileSnapshot | undefined {
	if (typeof record !== "object" || record === null) return undefined;
	return (record as { [RECORD_FILE_SNAPSHOT]?: RecordFileSnapshot })[RECORD_FILE_SNAPSHOT];
}

export interface PreparedRecordIdentity {
	recordKey?: string;
	kind: "task" | "document" | "decision" | "milestone" | "config";
	visibleId: string;
	lifecycle: "active" | "draft" | "archived" | "deleted";
	/** The record's own path when the physical write follows a file symlink. */
	recordPath?: string;
	/** The former record path when promotion or demotion changes its visible ID. */
	transitionFromPath?: string;
}

export interface PreparedFileChange {
	path: string;
	before: FileEntry;
	after: FileEntry;
	record: PreparedRecordIdentity;
	noReplace?: boolean;
	/** Preserve source permissions when this effect moves an existing regular file. */
	preserveModeFrom?: string;
}

export type PreparedPathGuard = (path: string) => void | Promise<void>;
export type PreparedAfterFile = (index: number) => void | Promise<void>;
export type PreparedRecordKeyResolver = (record: {
	kind: PreparedRecordIdentity["kind"];
	visibleId: string;
	recordPath: string;
	transitionFromPath?: string;
}) => string | undefined | Promise<string | undefined>;

export class PreparedChangeConflictError extends Error {
	constructor(readonly path: string) {
		super(`File changed before the prepared write could be applied: ${path}`);
		this.name = "PreparedChangeConflictError";
	}
}

/** Capture the pathname itself. A symbolic link remains a link, rather than becoming its target's bytes. */
export async function snapshotFileEntry(path: string): Promise<FileEntry> {
	let stats: Awaited<ReturnType<typeof lstat>>;
	try {
		stats = await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	if (stats.isSymbolicLink()) return { type: "symlink", target: await readlink(path) };
	if (!stats.isFile()) throw new Error(`Expected a regular file or symbolic link at ${path}`);
	// Refuse a link swapped in after lstat. A non-cooperating writer can still race a later apply;
	// the supported guarantee is between writers that take the shared project lock.
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if (!(await handle.stat()).isFile()) throw new Error(`Expected a regular file at ${path}`);
		return { type: "file", bytes: await handle.readFile() };
	} finally {
		await handle.close();
	}
}

export function fileEntriesEqual(left: FileEntry, right: FileEntry): boolean {
	if (left === null || right === null) return left === right;
	if (left.type !== right.type) return false;
	if (left.type === "symlink" && right.type === "symlink") return left.target === right.target;
	if (left.type === "file" && right.type === "file") return Buffer.from(left.bytes).equals(Buffer.from(right.bytes));
	return false;
}

/** A move is two ordered pathname effects; the destination is installed before the source is removed. */
export async function prepareFileMove(
	sourcePath: string,
	targetPath: string,
	record: PreparedRecordIdentity,
	guard: PreparedPathGuard,
): Promise<PreparedFileChange[]> {
	await guard(sourcePath);
	await guard(targetPath);
	const source = await snapshotFileEntry(sourcePath);
	const target = await snapshotFileEntry(targetPath);
	if (!source) throw new Error(`File to move does not exist: ${sourcePath}`);
	if (target) throw new PreparedChangeConflictError(targetPath);
	const moved: FileEntry =
		source.type === "symlink" && !isAbsolute(source.target)
			? {
					type: "symlink",
					target: relative(
						await realpath(dirname(targetPath)).catch(() => dirname(targetPath)),
						resolve(await realpath(dirname(sourcePath)), source.target),
					),
				}
			: source;
	return [
		{
			path: targetPath,
			before: null,
			after: moved,
			record,
			noReplace: true,
			...(source.type === "file" && { preserveModeFrom: sourcePath }),
		},
		{ path: sourcePath, before: source, after: null, record },
	];
}

/** FileSystem's instance-scoped staging state; it never holds an actor or request identity. */
export class PreparedFileCapture {
	private readonly effects = new Map<string, PreparedFileChange>();
	private readonly lockReleases: Array<{ key: string; release: () => Promise<void> }> = [];
	private readonly heldLocks = new Set<string>();

	constructor(
		private readonly guard: PreparedPathGuard,
		private readonly resolveRecordKey?: PreparedRecordKeyResolver,
	) {}

	private async assertPath(path: string): Promise<void> {
		if (!isAbsolute(path)) throw new Error(`Prepared path must be absolute: ${path}`);
		await this.guard(path);
	}

	async entry(path: string): Promise<FileEntry> {
		await this.assertPath(path);
		const staged = this.effects.get(path);
		return staged ? staged.after : await snapshotFileEntry(path);
	}

	async bytes(path: string, fallback: () => Promise<Buffer>): Promise<Buffer> {
		await this.assertPath(path);
		let entry = this.effects.get(path)?.after;
		if (entry === undefined) {
			// A symlink's bytes may be staged at its referent while its own entry stays unchanged.
			const resolvedPath = await realpath(path).catch(() => path);
			entry = this.effects.get(resolvedPath)?.after;
		}
		if (entry === undefined) return await fallback();
		if (entry === null) {
			const error = new Error(`File does not exist: ${path}`) as NodeJS.ErrnoException;
			error.code = "ENOENT";
			throw error;
		}
		if (entry.type === "file") return Buffer.from(entry.bytes);
		const targetPath = resolve(dirname(path), entry.target);
		await this.assertPath(targetPath);
		return await this.bytes(targetPath, () => fallback());
	}

	private async stage(
		path: string,
		after: FileEntry,
		record: PreparedRecordIdentity,
		noReplace = false,
		preserveModeFrom?: string,
	): Promise<void> {
		await this.assertPath(path);
		const existing = this.effects.get(path);
		const before = existing ? existing.before : await snapshotFileEntry(path);
		const recordKey =
			record.recordKey ??
			(await this.resolveRecordKey?.({
				kind: record.kind,
				visibleId: record.visibleId,
				recordPath: record.recordPath ?? path,
				...(record.transitionFromPath && { transitionFromPath: record.transitionFromPath }),
			}));
		this.effects.set(path, {
			path,
			before,
			after,
			record: { ...record, ...(recordKey && { recordKey }) },
			...(noReplace && { noReplace: true }),
			...(preserveModeFrom && { preserveModeFrom }),
		});
	}

	async write(
		targetPath: string,
		bytes: Uint8Array,
		loadedFromPath: string | undefined,
		record: PreparedRecordIdentity,
	): Promise<string | undefined> {
		await this.assertPath(targetPath);
		if (!loadedFromPath) {
			if ((await this.entry(targetPath)) !== null) throw new PreparedChangeConflictError(targetPath);
			await this.stage(targetPath, { type: "file", bytes }, record, true);
			return undefined;
		}
		await this.assertPath(loadedFromPath);
		const source = await this.entry(loadedFromPath);
		if (!source) throw new PreparedChangeConflictError(loadedFromPath);
		const identity = {
			...record,
			recordPath: targetPath,
			...(loadedFromPath !== targetPath && { transitionFromPath: loadedFromPath }),
		};
		if (source.type === "symlink") {
			const referent = await realpath(loadedFromPath);
			await this.assertPath(referent);
			await this.stage(referent, { type: "file", bytes }, identity);
			if (loadedFromPath !== targetPath) {
				if ((await this.entry(targetPath)) !== null) throw new PreparedChangeConflictError(targetPath);
				const moved = await prepareFileMove(loadedFromPath, targetPath, identity, this.guard);
				for (const change of moved)
					await this.stage(change.path, change.after, identity, change.noReplace, change.preserveModeFrom);
			}
			return loadedFromPath !== targetPath ? loadedFromPath : undefined;
		}
		if (loadedFromPath !== targetPath) {
			if ((await this.entry(targetPath)) !== null) throw new PreparedChangeConflictError(targetPath);
			await this.stage(targetPath, { type: "file", bytes }, identity, true, loadedFromPath);
			await this.stage(loadedFromPath, null, identity);
			return loadedFromPath;
		}
		await this.stage(targetPath, { type: "file", bytes }, identity);
		return undefined;
	}

	async move(sourcePath: string, targetPath: string, record: PreparedRecordIdentity): Promise<void> {
		const identity = { ...record, recordPath: targetPath, transitionFromPath: sourcePath };
		const changes = await prepareFileMove(sourcePath, targetPath, identity, this.guard);
		for (const change of changes)
			await this.stage(change.path, change.after, identity, change.noReplace, change.preserveModeFrom);
	}

	async linkIdentity(newPath: string, formerPath: string): Promise<void> {
		const change = this.effects.get(newPath);
		if (!change) throw new Error(`Prepared record was not found at ${newPath}`);
		const { recordKey: _provisionalKey, ...record } = change.record;
		await this.stage(
			newPath,
			change.after,
			{ ...record, transitionFromPath: formerPath },
			change.noReplace,
			change.preserveModeFrom,
		);
	}

	async remove(path: string, record: PreparedRecordIdentity): Promise<void> {
		if ((await this.entry(path)) === null) throw new PreparedChangeConflictError(path);
		await this.stage(path, null, record);
	}

	changes(): PreparedFileChange[] {
		return [...this.effects.values()];
	}

	async apply(afterFile?: PreparedAfterFile): Promise<void> {
		await applyPreparedChanges(this.changes(), this.guard, afterFile);
	}

	holdsLock(key: string): boolean {
		return this.heldLocks.has(key);
	}

	markLockHeld(key: string): void {
		this.heldLocks.add(key);
	}

	forgetLock(key: string): void {
		this.heldLocks.delete(key);
	}

	deferLockRelease(key: string, release: () => Promise<void>): void {
		this.lockReleases.push({ key, release });
	}

	async releaseLocks(): Promise<void> {
		let firstError: unknown;
		for (const { key, release } of this.lockReleases.splice(0)) {
			try {
				await release();
			} catch (error) {
				firstError ??= error;
			} finally {
				this.heldLocks.delete(key);
			}
		}
		if (firstError) throw firstError;
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function ensureDirectoryDurable(directory: string): Promise<void> {
	const missing: string[] = [];
	let current = directory;
	while (true) {
		try {
			if (!(await stat(current)).isDirectory()) throw new Error(`Expected a directory at ${current}`);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			missing.push(current);
			const parent = dirname(current);
			if (parent === current) throw error;
			current = parent;
		}
	}
	for (const path of missing.reverse()) {
		await mkdir(path);
		await syncDirectory(dirname(path));
	}
}

async function installFile(
	path: string,
	bytes: Uint8Array,
	noReplace: boolean,
	preserveModeFrom?: string,
): Promise<void> {
	const directory = dirname(path);
	const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
	const previous = preserveModeFrom ? await lstat(preserveModeFrom) : noReplace ? null : await lstat(path);
	const previousMode = previous?.isFile() ? previous.mode & 0o777 : null;
	const handle = await open(temporary, "wx", previousMode ?? 0o666);
	let handleOpen = true;
	let temporaryExists = true;
	try {
		await handle.writeFile(bytes);
		if (previousMode !== null) await handle.chmod(previousMode);
		await handle.sync();
		await handle.close();
		handleOpen = false;
		if (noReplace) {
			await link(temporary, path);
			await syncDirectory(directory);
			await unlink(temporary);
			temporaryExists = false;
		} else {
			await rename(temporary, path);
			temporaryExists = false;
		}
		await syncDirectory(directory);
	} finally {
		if (handleOpen) await handle.close().catch(() => {});
		if (temporaryExists) await unlink(temporary).catch(() => {});
	}
}

async function applyOne(change: PreparedFileChange): Promise<void> {
	const { path, after } = change;
	if (fileEntriesEqual(change.before, after)) return;
	if (after === null) {
		await unlink(path);
		await syncDirectory(dirname(path));
		return;
	}
	await ensureDirectoryDurable(dirname(path));
	if (after.type === "file") {
		await installFile(path, after.bytes, change.noReplace ?? change.before === null, change.preserveModeFrom);
		return;
	}
	if (change.noReplace ?? change.before === null) {
		await symlink(after.target, path);
		await syncDirectory(dirname(path));
		return;
	}
	const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
	try {
		await symlink(after.target, temporary);
		await rename(temporary, path);
		await syncDirectory(dirname(path));
	} finally {
		await unlink(temporary).catch(() => {});
	}
}

/** Apply only an already durable plan. Any mismatch leaves the plan for recovery inspection. */
export async function applyPreparedChanges(
	changes: readonly PreparedFileChange[],
	guard: PreparedPathGuard,
	afterFile?: PreparedAfterFile,
): Promise<void> {
	const seen = new Set<string>();
	for (const change of changes) {
		if (!isAbsolute(change.path)) throw new Error(`Prepared path must be absolute: ${change.path}`);
		if (seen.has(change.path)) throw new Error(`Prepared path appears twice: ${change.path}`);
		seen.add(change.path);
		await guard(change.path);
		if (!fileEntriesEqual(await snapshotFileEntry(change.path), change.before)) {
			throw new PreparedChangeConflictError(change.path);
		}
	}
	let appliedIndex = 0;
	for (const change of changes) {
		await guard(change.path);
		if (!fileEntriesEqual(await snapshotFileEntry(change.path), change.before)) {
			throw new PreparedChangeConflictError(change.path);
		}
		if (fileEntriesEqual(change.before, change.after)) continue;
		await applyOne(change);
		await afterFile?.(appliedIndex++);
	}
}
