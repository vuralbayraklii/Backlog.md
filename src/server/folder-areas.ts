import type { Database } from "bun:sqlite";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { AuthStoreError } from "./auth-store.ts";

export function containsPath(root: string, path: string): boolean {
	const fromRoot = relative(root, path);
	return fromRoot === "" || (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

export function pathsOverlap(left: string, right: string): boolean {
	return containsPath(left, right) || containsPath(right, left);
}

/** The caller keeps this fresh account/grant check inside its own write transaction. */
export function assertRegistrationAccess(database: Database, userId: string, rootPath: string): void {
	const user = database
		.query<{ role: string; active: number }, [string]>("SELECT role,active FROM users WHERE id=?")
		.get(userId);
	if (!user?.active) throw new AuthStoreError("Authentication required.", 401);
	if (user.role === "admin") return;
	// A-02 databases are readable before their first successful A-03 write, but
	// cannot contain a personal grant yet.
	if ((database.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0) < 3)
		throw new AuthStoreError("Project registration is not permitted for this folder.", 403);
	const areas = database
		.query<{ rootPath: string }, [string]>("SELECT root_path AS rootPath FROM folder_areas WHERE user_id=?")
		.all(userId);
	for (const area of areas) {
		if (!containsPath(area.rootPath, rootPath)) continue;
		try {
			// Canonical grants never follow a directory replaced by a symlink to another area.
			if (
				realpathSync(area.rootPath) === area.rootPath &&
				realpathSync(rootPath) === rootPath &&
				statSync(rootPath).isDirectory()
			)
				return;
		} catch {
			// A missing or changed grant cannot authorize a new project.
		}
	}
	throw new AuthStoreError("Project registration is not permitted for this folder.", 403);
}
