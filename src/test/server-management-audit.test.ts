import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { MutationStore } from "../server/mutation-store.ts";
import { MutationError, managementAudit, managementRevision } from "../server/mutations.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("atomic management audit", () => {
	let root: string;
	let data: string;
	let auth: AuthStore;
	let store: MutationStore;
	let adminId: string;
	beforeEach(async () => {
		root = await createTestDirOutsideRepository("backlog-management-audit-");
		data = join(root, "server");
		auth = new AuthStore(data);
		adminId = (await auth.initializeAdmin("admin", "management initial password")).id;
		store = new MutationStore(data);
	});
	afterEach(async () => safeCleanup(root));
	function audit(
		action: string,
		options: { expectedRevision?: string; requireRevision?: boolean; forceEvent?: boolean } = {},
	) {
		const operationId = randomUUID();
		return {
			operationId,
			hook: managementAudit(store, {
				operationId,
				scope: { kind: "admin" },
				actor: { kind: "user", userId: adminId },
				source: "browser",
				requestHash: createHash("sha256").update(operationId).digest("hex"),
				action,
				...options,
			}),
		};
	}
	test("a stale revision rolls back the account and creates no audit", () => {
		const before = auth.loadUser(adminId);
		expect(before).not.toBeNull();
		const failed = audit("user.edit", { requireRevision: true, expectedRevision: '"stale"' });
		expect(() => auth.editUser(adminId, { displayName: "Wrong" }, failed.hook)).toThrow(MutationError);
		expect(auth.loadUser(adminId)).toEqual(before);
		expect(store.loadOperation(failed.operationId, { actor: { kind: "user", userId: adminId } })).toBeNull();
		expect(store.listHistory({ scope: { kind: "admin" } }).items).toHaveLength(0);
	});
	test("a successful edit and safe replay result commit together; a no-op has no extra event", () => {
		const before = auth.loadUser(adminId);
		const edited = audit("user.edit", { requireRevision: true, expectedRevision: managementRevision(before) });
		const user = auth.editUser(adminId, { displayName: "Updated" }, edited.hook);
		const operation = store.loadOperation(edited.operationId, { actor: { kind: "user", userId: adminId } });
		expect(operation?.state).toBe("completed");
		expect(operation?.result?.body).toMatchObject({
			...user,
			recordKey: `user:${adminId}`,
			revision: managementRevision(user),
		});
		const noOp = audit("user.edit", { requireRevision: true, expectedRevision: managementRevision(user) });
		auth.editUser(adminId, { displayName: "Updated" }, noOp.hook);
		expect(store.loadOperation(noOp.operationId, { actor: { kind: "user", userId: adminId } })?.state).toBe(
			"completed",
		);
		expect(store.listHistory({ scope: { kind: "admin" } }).items).toHaveLength(1);
	});
	test("a password reset records its action even when public values match, without a password request hash", async () => {
		const reset = audit("user.reset_password", { forceEvent: true });
		await auth.resetPassword(adminId, "new private reset password", reset.hook);
		const event = store.listHistory({ scope: { kind: "admin" } }).items[0];
		expect(event?.action).toBe("user.reset_password");
		const database = new Database(store.databasePath, { readonly: true });
		try {
			const row = database
				.query<{ request_hash: string; planned_result_json: string; planned_event_json: string }, [string]>(
					"SELECT request_hash,planned_result_json,planned_event_json FROM operations WHERE operation_id=?",
				)
				.get(reset.operationId);
			expect(row?.request_hash).toBe(createHash("sha256").update(reset.operationId).digest("hex"));
			expect(JSON.stringify(row)).not.toContain("new private reset password");
			expect(JSON.stringify(row)).not.toContain("passwordHash");
		} finally {
			database.close();
		}
	});
	test("project registration and creator membership share one event and transaction", async () => {
		const projectRoot = join(root, "project");
		await initializeFilesystemTestProject(new Core(projectRoot), "Prepared");
		const operationId = randomUUID();
		const hook = managementAudit(store, {
			operationId,
			scope: { kind: "registration" },
			actor: { kind: "user", userId: adminId },
			source: "browser",
			requestHash: createHash("sha256").update(operationId).digest("hex"),
			action: "project.register",
			status: 201,
		});
		const project = await new ProjectStore(data).register("Prepared", projectRoot, adminId, undefined, hook);
		const events = store.listHistory({ scope: { kind: "registration" } }).items;
		expect(events).toHaveLength(1);
		expect(events[0]?.changes.map((change) => change.kind)).toEqual(["project", "membership"]);
		expect(auth.listMembers(project.id)).toHaveLength(1);
		expect(store.loadOperation(operationId, { actor: { kind: "user", userId: adminId } })?.result?.status).toBe(201);
	});
});
