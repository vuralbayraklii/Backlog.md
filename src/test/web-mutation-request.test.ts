import { afterEach, describe, expect, it } from "bun:test";
import type { AuthSession } from "../server/auth-types";
import {
	checkPendingMutation,
	listPendingMutations,
	retryPendingMutation,
	sessionFetch,
	setRequestSession,
	UncertainMutationError,
} from "../web/lib/request";

const originalFetch = globalThis.fetch;
const account = (id: string): AuthSession => ({
	user: { id, username: id, displayName: id, role: "user", active: true, mustChangePassword: false },
	csrfToken: `csrf-${id}`,
	createdAt: "2026-01-01T00:00:00Z",
	expiresAt: "2026-01-01T12:00:00Z",
	lastActivityAt: "2026-01-01T00:00:00Z",
	idleExpiresAt: "2026-01-01T02:00:00Z",
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	setRequestSession(account("cleanup"));
	setRequestSession(null);
});

describe("central mutation requests", () => {
	it("queries one lost response and returns the stored result without replaying the write", async () => {
		setRequestSession(account("alice"));
		let mutationCount = 0;
		let lookupCount = 0;
		let operationId = "";
		globalThis.fetch = (async (input, options) => {
			const path = String(input);
			if (path.endsWith("/tasks/TASK-1")) {
				mutationCount++;
				const headers = new Headers(options?.headers);
				expect(headers.get("X-CSRF-Token")).toBe("csrf-alice");
				expect(headers.get("If-Match")).toBe("rev-1");
				operationId = headers.get("Idempotency-Key") ?? "";
				throw new TypeError("connection closed after commit");
			}
			lookupCount++;
			expect(path).toBe(`/api/operations/${operationId}`);
			return Response.json({
				operationId,
				state: "completed",
				result: {
					status: 200,
					body: { id: "TASK-1", title: "Saved" },
					headers: { "content-type": "application/json" },
				},
			});
		}) as typeof fetch;

		const response = await sessionFetch("/api/projects/1/tasks/TASK-1", {
			method: "PUT",
			headers: { "If-Match": "rev-1" },
			body: JSON.stringify({ title: "Saved" }),
		});
		expect(await response.json()).toEqual({ id: "TASK-1", title: "Saved" });
		expect(operationId).toMatch(/^[0-9a-f-]{36}$/i);
		expect(mutationCount).toBe(1);
		expect(lookupCount).toBe(1);
		expect(listPendingMutations()).toEqual([]);
	});

	it("keeps the same key for an explicit retry while blocking a second submit", async () => {
		setRequestSession(account("alice"));
		const sentKeys: string[] = [];
		globalThis.fetch = (async (input, options) => {
			const path = String(input);
			if (path.startsWith("/api/operations/")) return Response.json({ state: "pending" });
			sentKeys.push(new Headers(options?.headers).get("Idempotency-Key") ?? "");
			if (sentKeys.length === 1) throw new TypeError("connection lost");
			return Response.json({ id: "TASK-2" });
		}) as typeof fetch;

		await expect(sessionFetch("/api/projects/982/tasks", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
			UncertainMutationError,
		);
		const pending = listPendingMutations()[0];
		expect(pending?.state).toBe("pending");
		if (!pending) throw new Error("Expected a pending operation");
		setRequestSession(null);
		setRequestSession(account("alice"));
		expect(listPendingMutations()[0]?.operationId).toBe(pending.operationId);
		await expect(sessionFetch("/api/projects/982/tasks", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
			UncertainMutationError,
		);
		expect(sentKeys).toHaveLength(1);
		const response = await retryPendingMutation(pending.operationId);
		expect(await response.json()).toEqual({ id: "TASK-2" });
		expect(sentKeys).toEqual([pending.operationId, pending.operationId]);
		expect(listPendingMutations()).toEqual([]);
	});

	it("does not carry an unresolved operation into another account", async () => {
		setRequestSession(account("alice"));
		globalThis.fetch = (async (input) => {
			if (String(input).startsWith("/api/operations/")) return Response.json({ state: "pending" });
			throw new TypeError("connection lost");
		}) as typeof fetch;
		await expect(sessionFetch("/api/projects/983/tasks", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
			UncertainMutationError,
		);
		const operationId = listPendingMutations()[0]?.operationId;
		expect(operationId).toBeTruthy();
		if (!operationId) throw new Error("Expected a pending operation");
		setRequestSession(account("bob"));
		expect(listPendingMutations()).toEqual([]);
		expect(await checkPendingMutation(operationId)).toBeNull();
		await expect(retryPendingMutation(operationId)).rejects.toThrow("no longer available");
	});

	it("ignores an operation lookup that finishes after the account changes", async () => {
		setRequestSession(account("alice"));
		let releaseLookup: ((response: Response) => void) | undefined;
		let lookups = 0;
		globalThis.fetch = (async (input) => {
			if (String(input).startsWith("/api/operations/")) {
				if (++lookups === 1) return Response.json({ state: "pending" });
				return new Promise<Response>((resolve) => {
					releaseLookup = resolve;
				});
			}
			throw new TypeError("connection lost");
		}) as typeof fetch;
		await expect(sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
			UncertainMutationError,
		);
		const operationId = listPendingMutations()[0]?.operationId;
		if (!operationId) throw new Error("Expected a pending operation");
		const lookup = checkPendingMutation(operationId);
		await Promise.resolve();
		setRequestSession(account("bob"));
		releaseLookup?.(
			Response.json({
				state: "completed",
				result: { status: 200, body: { private: "alice" }, headers: { "content-type": "application/json" } },
			}),
		);
		expect(await lookup).toBeNull();
		expect(listPendingMutations()).toEqual([]);
	});

	it("does not deliver a write response to a different account", async () => {
		setRequestSession(account("alice"));
		let releaseWrite: ((response: Response) => void) | undefined;
		globalThis.fetch = ((_input) =>
			new Promise<Response>((resolve) => {
				releaseWrite = resolve;
			})) as typeof fetch;
		const write = sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" });
		setRequestSession(account("bob"));
		releaseWrite?.(Response.json({ private: "alice" }));
		await expect(write).rejects.toThrow("account changed");
		expect(listPendingMutations()).toEqual([]);
	});

	it("keeps a late success for the same account to inspect after re-login", async () => {
		setRequestSession(account("alice"));
		let releaseWrite: ((response: Response) => void) | undefined;
		globalThis.fetch = ((_input) =>
			new Promise<Response>((resolve) => {
				releaseWrite = resolve;
			})) as typeof fetch;
		const write = sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" });
		setRequestSession(null);
		releaseWrite?.(Response.json({ id: "TASK-1" }));
		await expect(write).rejects.toBeInstanceOf(UncertainMutationError);
		setRequestSession(account("alice"));
		expect(listPendingMutations()).toHaveLength(1);
	});

	it("keeps the UUID when a write returns 401 after the session expires", async () => {
		setRequestSession(account("alice"));
		const keys: string[] = [];
		globalThis.fetch = (async (_input, options) => {
			keys.push(new Headers(options?.headers).get("Idempotency-Key") ?? "");
			return keys.length === 1
				? Response.json({ error: "Session expired" }, { status: 401 })
				: Response.json({ id: "TASK-1" });
		}) as typeof fetch;
		await expect(sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
			UncertainMutationError,
		);
		setRequestSession(account("alice"));
		const pending = listPendingMutations()[0];
		if (!pending) throw new Error("Expected a pending operation");
		await retryPendingMutation(pending.operationId);
		expect(keys).toEqual([pending.operationId, pending.operationId]);
	});

	it("queries the operation before treating an authorization response as final", async () => {
		setRequestSession(account("alice"));
		let writes = 0;
		let lookups = 0;
		globalThis.fetch = (async (input) => {
			if (String(input).startsWith("/api/operations/")) {
				lookups++;
				return Response.json({
					state: "completed",
					result: { status: 200, body: { id: "TASK-1" }, headers: { "content-type": "application/json" } },
				});
			}
			writes++;
			return Response.json({ error: "Access changed" }, { status: 403 });
		}) as typeof fetch;
		const response = await sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" });
		expect(await response.json()).toEqual({ id: "TASK-1" });
		expect([writes, lookups]).toEqual([1, 1]);
	});

	it("retains the UUID when a 404 hides the operation lookup", async () => {
		setRequestSession(account("alice"));
		let lookups = 0;
		globalThis.fetch = (async (input) => {
			if (String(input).startsWith("/api/operations/")) lookups++;
			return Response.json({ error: "Not Found" }, { status: 404 });
		}) as typeof fetch;
		await expect(sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
			UncertainMutationError,
		);
		expect(listPendingMutations()[0]?.state).toBe("unknown");
		expect(lookups).toBe(1);
	});

	it("keeps a recovery key only when the blocked operation is the same write", async () => {
		setRequestSession(account("alice"));
		globalThis.fetch = (async (_input, options) => {
			const operationId = new Headers(options?.headers).get("Idempotency-Key");
			return Response.json({ error: "Recovery required", code: "RECOVERY_REQUIRED", operationId }, { status: 503 });
		}) as typeof fetch;
		const response = await sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" });
		expect(response.status).toBe(503);
		expect(listPendingMutations()[0]?.state).toBe("recovery_required");
		setRequestSession(account("cleanup"));
		setRequestSession(account("alice"));
		globalThis.fetch = (async (_input) =>
			Response.json(
				{ error: "Recovery required", code: "RECOVERY_REQUIRED", operationId: "older-operation" },
				{ status: 503 },
			)) as typeof fetch;
		await sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" });
		expect(listPendingMutations()).toEqual([]);
	});

	it("releases a recovery incident resolved by a separate operation", async () => {
		setRequestSession(account("alice"));
		let lookups = 0;
		globalThis.fetch = (async (input) => {
			if (String(input).startsWith("/api/operations/"))
				return Response.json(
					++lookups === 1 ? { state: "recovery_required" } : { state: "recovery_required", resolvedBy: "repair-op" },
				);
			throw new TypeError("response lost");
		}) as typeof fetch;
		await expect(sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
			UncertainMutationError,
		);
		const operationId = listPendingMutations()[0]?.operationId;
		if (!operationId) throw new Error("Expected a pending operation");
		expect((await checkPendingMutation(operationId))?.resolvedBy).toBe("repair-op");
		expect(listPendingMutations()).toEqual([]);
	});

	it("treats a same-key resolved replay as a definite 409 without duplicating the write", async () => {
		setRequestSession(account("alice"));
		let writes = 0;
		globalThis.fetch = (async (input) => {
			if (String(input).startsWith("/api/operations/")) return Response.json({ state: "pending" });
			writes++;
			if (writes === 1) throw new TypeError("response lost");
			return Response.json(
				{ error: "Review current data", code: "OPERATION_RESOLVED", resolvedBy: "repair-op" },
				{ status: 409 },
			);
		}) as typeof fetch;
		await expect(sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
			UncertainMutationError,
		);
		const operationId = listPendingMutations()[0]?.operationId;
		if (!operationId) throw new Error("Expected a pending operation");
		const response = await retryPendingMutation(operationId);
		expect(response.status).toBe(409);
		expect((await response.json()).code).toBe("OPERATION_RESOLVED");
		expect(writes).toBe(2);
		expect(listPendingMutations()).toEqual([]);
	});

	it("returns not-applied as a definite result and releases the old key", async () => {
		setRequestSession(account("alice"));
		globalThis.fetch = (async (input) => {
			if (String(input).startsWith("/api/operations/"))
				return Response.json({ state: "not_applied", error: { message: "Not applied" } });
			throw new TypeError("connection lost");
		}) as typeof fetch;
		const response = await sessionFetch("/api/projects/1/tasks/TASK-4", { method: "PUT", body: "{}" });
		expect(response.status).toBe(409);
		expect((await response.json()).code).toBe("OPERATION_NOT_APPLIED");
		expect(listPendingMutations()).toEqual([]);
	});

	it("keeps password and preview POSTs outside idempotent replay", async () => {
		setRequestSession(account("admin"));
		const seen: Array<{ path: string; key: string | null }> = [];
		globalThis.fetch = (async (input, options) => {
			seen.push({ path: String(input), key: new Headers(options?.headers).get("Idempotency-Key") });
			return Response.json({});
		}) as typeof fetch;
		await sessionFetch("/api/admin/users", { method: "POST", body: JSON.stringify({ password: "secret" }) });
		await sessionFetch("/api/admin/users/1/reset-password", {
			method: "POST",
			body: JSON.stringify({ password: "secret" }),
		});
		await sessionFetch("/api/projects/preview", { method: "POST", body: "{}" });
		await sessionFetch("/api/projects", { method: "POST", body: "{}" });
		expect(seen.slice(0, 3).map((item) => item.key)).toEqual([null, null, null]);
		expect(seen[3]?.key).toMatch(/^[0-9a-f-]{36}$/i);
	});
});
