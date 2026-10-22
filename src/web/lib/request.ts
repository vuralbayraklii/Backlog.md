import type { AuthSession } from "../../server/auth-types";
import type { OperationState, OperationView, SafeHttpResult } from "../../server/mutation-types";

let session: AuthSession | null = null;
const listeners = new Set<() => void>();
const pendingListeners = new Set<() => void>();

export interface PendingMutation {
	operationId: string;
	path: string;
	state: "sending" | "unknown" | OperationState;
}

interface PendingRequest extends PendingMutation {
	ownerId: string | null;
	options: RequestInit;
}

const pendingRequests = new Map<string, PendingRequest>();

const notifyPending = () => {
	for (const listener of pendingListeners) listener();
};

export function onPendingMutationsChanged(listener: () => void): () => void {
	pendingListeners.add(listener);
	return () => pendingListeners.delete(listener);
}

export function listPendingMutations(): PendingMutation[] {
	return [...pendingRequests.values()]
		.filter(({ state, ownerId }) => state !== "sending" && session?.user.id === ownerId)
		.map(({ operationId, path, state }) => ({ operationId, path, state }));
}

function isCentralMutation(path: string, method: string): boolean {
	if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
	if (path.startsWith("/api/auth/") || path === "/api/projects/preview") return false;
	if (path === "/api/admin/users" && method === "POST") return false;
	if (/^\/api\/admin\/users\/[^/]+\/reset-password$/.test(path)) return false;
	return path === "/api/projects" || path.startsWith("/api/admin/") || /^\/api\/projects\/[1-9]\d*\//.test(path);
}

function resourceKey(path: string, method: string): string {
	return `${method} ${path}`;
}

function forgetPending(operationId: string) {
	for (const [key, pending] of pendingRequests) {
		if (pending.operationId === operationId) pendingRequests.delete(key);
	}
	notifyPending();
}

function resultResponse(result: SafeHttpResult): Response {
	const headers = new Headers(result.headers);
	const body =
		result.body === undefined || result.body === null
			? null
			: headers.get("content-type")?.includes("application/json")
				? JSON.stringify(result.body)
				: String(result.body);
	return new Response(body, { status: result.status, headers });
}

async function readOperation(pending: PendingRequest): Promise<OperationView | null> {
	if (session?.user.id !== pending.ownerId) return null;
	try {
		const response = await sessionFetch(`/api/operations/${encodeURIComponent(pending.operationId)}`);
		if (!response.ok) return null;
		return (await response.json()) as OperationView;
	} catch {
		return null;
	}
}

export async function checkPendingMutation(operationId: string): Promise<OperationView | null> {
	const pending = [...pendingRequests.values()].find((item) => item.operationId === operationId);
	if (!pending || session?.user.id !== pending.ownerId) return null;
	const view = await readOperation(pending);
	if (session?.user.id !== pending.ownerId || ![...pendingRequests.values()].includes(pending)) return null;
	if (!view) return null;
	if (view.state === "completed" || view.state === "not_applied" || view.resolvedBy) forgetPending(operationId);
	else {
		pending.state = view.state;
		notifyPending();
	}
	return view;
}

/** A retry is an explicit user action and uses exactly the original request and key. */
export async function retryPendingMutation(operationId: string): Promise<Response> {
	const pending = [...pendingRequests.values()].find((item) => item.operationId === operationId);
	if (!pending || session?.user.id !== pending.ownerId) throw new Error("This operation is no longer available.");
	const headers = new Headers(pending.options.headers);
	headers.set("Idempotency-Key", operationId);
	const response = await sessionFetch(pending.path, { ...pending.options, headers, signal: undefined });
	if (session?.user.id !== pending.ownerId) throw new Error("This operation is no longer available.");
	return response;
}

export class UncertainMutationError extends Error {
	constructor(public operationId: string) {
		super("The request result is uncertain. Check the operation before trying again.");
		this.name = "UncertainMutationError";
	}
}

async function inspectPending(pending: PendingRequest): Promise<Response | null> {
	const operation = await readOperation(pending);
	if (session?.user.id !== pending.ownerId) return null;
	if (operation?.state === "completed" && operation.result) {
		forgetPending(pending.operationId);
		return resultResponse(operation.result);
	}
	if (operation?.state === "not_applied") {
		forgetPending(pending.operationId);
		return Response.json(
			{
				error:
					operation.error?.message ?? "Operation was not applied. Review the current record before submitting again.",
				code: "OPERATION_NOT_APPLIED",
				operationId: pending.operationId,
			},
			{ status: 409 },
		);
	}
	if (operation) {
		pending.state = operation.state;
		notifyPending();
	}
	return null;
}

export function setRequestSession(value: AuthSession | null): void {
	if (value && [...pendingRequests.values()].some((pending) => pending.ownerId !== value.user.id)) {
		pendingRequests.clear();
		notifyPending();
	}
	session = value;
}

export function onSessionExpired(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Every browser request uses the same cookie and in-memory CSRF policy. Never retry a mutation. */
export async function sessionFetch(input: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
	const requestSession = session;
	const headers = new Headers(options.headers);
	const method = (options.method ?? "GET").toUpperCase();
	if (!["GET", "HEAD", "OPTIONS"].includes(method) && session) headers.set("X-CSRF-Token", session.csrfToken);
	const path = new URL(
		typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
		"http://localhost",
	).pathname;
	const centralMutation = isCentralMutation(path, method);
	let pending: PendingRequest | undefined;
	if (centralMutation) {
		const key = resourceKey(path, method);
		pending = pendingRequests.get(key);
		const suppliedId = headers.get("Idempotency-Key");
		if (pending && suppliedId !== pending.operationId) throw new UncertainMutationError(pending.operationId);
		const operationId = suppliedId ?? crypto.randomUUID();
		headers.set("Idempotency-Key", operationId);
		if (!pending) {
			pending = {
				operationId,
				path,
				options: { ...options, method, headers: new Headers(options.headers), signal: undefined },
				ownerId: requestSession?.user.id ?? null,
				state: "sending",
			};
			pendingRequests.set(key, pending);
		}
	}
	let response: Response;
	try {
		response = await fetch(input, { ...options, headers, credentials: "same-origin" });
	} catch (error) {
		if (!pending) throw error;
		if (session?.user.id !== pending.ownerId) {
			forgetPending(pending.operationId);
			throw error;
		}
		pending.state = "unknown";
		pendingRequests.set(resourceKey(path, method), pending);
		notifyPending();
		const resolved = await inspectPending(pending);
		if (session?.user.id !== pending.ownerId) {
			forgetPending(pending.operationId);
			throw error;
		}
		if (resolved) return resolved;
		throw new UncertainMutationError(pending.operationId);
	}
	if (response.status === 401 && session?.csrfToken === requestSession?.csrfToken) {
		session = null;
		for (const listener of listeners) listener();
	}
	if (pending) {
		if (session?.user.id !== pending.ownerId) {
			if (session?.user.id) {
				forgetPending(pending.operationId);
				throw new Error("The account changed before this operation returned.");
			}
			pending.state = "unknown";
			notifyPending();
			throw new UncertainMutationError(pending.operationId);
		}
		if (response.status === 409 || response.status === 503) {
			const data = await response
				.clone()
				.json()
				.catch(() => null);
			if (data?.code === "OPERATION_IN_PROGRESS") {
				pending.state = "pending";
				notifyPending();
				return response;
			}
			if (data?.code === "RECOVERY_REQUIRED") {
				if (typeof window !== "undefined") window.dispatchEvent(new window.Event("backlog-project-write-state"));
				if (data.operationId && data.operationId !== pending.operationId) forgetPending(pending.operationId);
				else {
					pending.state = "recovery_required";
					notifyPending();
				}
				return response;
			}
		}
		if ([403, 404].includes(response.status) || response.status >= 500) {
			pending.state = "unknown";
			notifyPending();
			const resolved = await inspectPending(pending);
			if (session?.user.id !== pending.ownerId) {
				forgetPending(pending.operationId);
				throw new Error("The account changed before this operation returned.");
			}
			if (resolved) return resolved;
			throw new UncertainMutationError(pending.operationId);
		}
		// A definite HTTP response is handled by its caller; only a lost response keeps the key.
		forgetPending(pending.operationId);
	}
	return response;
}

export class HttpError extends Error {
	constructor(
		message: string,
		public status: number,
		public data: Record<string, unknown> | null,
	) {
		super(message);
		this.name = "HttpError";
	}
	get code(): string | undefined {
		return typeof this.data?.code === "string" ? this.data.code : undefined;
	}
}

export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
	const headers = new Headers(options.headers);
	if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
	const response = await sessionFetch(url, {
		...options,
		headers,
	});
	const data = await response.json().catch(() => null);
	if (!response.ok) throw new HttpError(data?.error ?? `Request failed (${response.status})`, response.status, data);
	return data as T;
}
