import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import {
	applyPreparedChanges,
	PreparedChangeConflictError,
	type PreparedFileChange,
	type PreparedPathGuard,
	prepareFileMove,
	snapshotFileEntry,
} from "../file-system/prepared-change.ts";

describe("prepared file changes", () => {
	let root: string;
	let guard: PreparedPathGuard;
	const record = { kind: "task", visibleId: "TASK-1", lifecycle: "active" } as const;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "backlog-prepared-change-"));
		guard = (path) => {
			if (!path.startsWith(`${root}${sep}`)) throw new Error("Path escaped the project");
		};
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("installs a prepared replacement through a synced temporary file", async () => {
		const path = join(root, "tasks", "task-1.md");
		await mkdir(dirname(path));
		await writeFile(path, "before");
		const change: PreparedFileChange = {
			path,
			before: await snapshotFileEntry(path),
			after: { type: "file", bytes: Buffer.from("after") },
			record,
		};

		await applyPreparedChanges([change], guard);

		expect(await readFile(path, "utf8")).toBe("after");
		expect(await readdir(dirname(path))).toEqual(["task-1.md"]);
	});

	it("keeps the existing regular file mode on replacement", async () => {
		const path = join(root, "tasks", "task-1.md");
		await mkdir(dirname(path));
		await writeFile(path, "before");
		await chmod(path, 0o644);
		await applyPreparedChanges(
			[{ path, before: await snapshotFileEntry(path), after: { type: "file", bytes: Buffer.from("after") }, record }],
			guard,
		);
		expect((await lstat(path)).mode & 0o777).toBe(0o644);
	});

	it("creates nested parent directories and a normal new file", async () => {
		const path = join(root, "docs", "nested", "deeper", "doc-1.md");
		await applyPreparedChanges(
			[{ path, before: null, after: { type: "file", bytes: Buffer.from("new") }, record, noReplace: true }],
			guard,
		);
		expect(await readFile(path, "utf8")).toBe("new");
		expect((await lstat(path)).mode & 0o777).toBe(0o666 & ~process.umask());
	});

	it("keeps the original file when a prepared source becomes stale", async () => {
		const source = join(root, "tasks", "task-1.md");
		const target = join(root, "archive", "task-1.md");
		await mkdir(dirname(source));
		await writeFile(source, "before");
		const changes = await prepareFileMove(source, target, { ...record, lifecycle: "archived" }, guard);
		await writeFile(source, "newer edit");

		await expect(applyPreparedChanges(changes, guard)).rejects.toBeInstanceOf(PreparedChangeConflictError);
		expect(await readFile(source, "utf8")).toBe("newer edit");
		expect(await snapshotFileEntry(target)).toBeNull();
	});

	it("does not replace an occupied destination", async () => {
		const source = join(root, "tasks", "task-1.md");
		const target = join(root, "archive", "task-1.md");
		await mkdir(dirname(source));
		await writeFile(source, "source");
		const changes = await prepareFileMove(source, target, { ...record, lifecycle: "archived" }, guard);
		await mkdir(dirname(target));
		await writeFile(target, "someone else's file");

		await expect(applyPreparedChanges(changes, guard)).rejects.toBeInstanceOf(PreparedChangeConflictError);
		expect(await readFile(source, "utf8")).toBe("source");
		expect(await readFile(target, "utf8")).toBe("someone else's file");
	});

	it("preserves a read-only regular file mode when moving", async () => {
		const source = join(root, "tasks", "task-1.md");
		const target = join(root, "archive", "task-1.md");
		await mkdir(dirname(source));
		await writeFile(source, "record");
		await chmod(source, 0o444);
		await applyPreparedChanges(
			await prepareFileMove(source, target, { ...record, lifecycle: "archived" }, guard),
			guard,
		);
		expect((await lstat(target)).mode & 0o777).toBe(0o444);
	});

	it("moves a relative symbolic link without changing its target", async () => {
		const content = join(root, "content.md");
		const source = join(root, "tasks", "task-1.md");
		const target = join(root, "archive", "tasks", "task-1.md");
		await writeFile(content, "unchanged");
		await mkdir(dirname(source));
		await symlink("../content.md", source);
		const changes = await prepareFileMove(source, target, { ...record, lifecycle: "archived" }, guard);

		await applyPreparedChanges(changes, guard);

		expect(await snapshotFileEntry(source)).toBeNull();
		expect(await readlink(target)).toBe("../../content.md");
		expect(await readFile(target, "utf8")).toBe("unchanged");
		expect(await readFile(content, "utf8")).toBe("unchanged");
	});

	it("runs interruption checkpoints after each durable path effect", async () => {
		const source = join(root, "tasks", "task-1.md");
		const target = join(root, "archive", "task-1.md");
		await mkdir(dirname(source));
		await writeFile(source, "record");
		const changes = await prepareFileMove(source, target, { ...record, lifecycle: "archived" }, guard);
		const observations: Array<{ index: number; source: boolean; target: boolean }> = [];
		await applyPreparedChanges(changes, guard, async (index) => {
			observations.push({
				index,
				source: (await snapshotFileEntry(source)) !== null,
				target: (await snapshotFileEntry(target)) !== null,
			});
		});
		expect(observations).toEqual([
			{ index: 0, source: true, target: true },
			{ index: 1, source: false, target: true },
		]);
	});
});
