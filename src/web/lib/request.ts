import type { AuthSession } from "../../server/auth-types";

let session: AuthSession | null = null;
const listeners = new Set<() => void>();

export function setRequestSession(value: AuthSession | null): void {
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
	const response = await fetch(input, { ...options, headers, credentials: "same-origin" });
	if (response.status === 401 && session?.csrfToken === requestSession?.csrfToken) {
		session = null;
		for (const listener of listeners) listener();
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
}

export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
	const response = await sessionFetch(url, {
		...options,
		headers: { "Content-Type": "application/json", ...options.headers },
	});
	const data = await response.json().catch(() => null);
	if (!response.ok) throw new HttpError(data?.error ?? `Request failed (${response.status})`, response.status, data);
	return data as T;
}
