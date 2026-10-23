import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { OperationView, SafeHttpResult } from "./mutation-types.ts";
import { requestHash } from "./mutations.ts";

export interface ServerConnectionOptions {
	serverUrl?: string;
	serverProject?: string;
	agentKeyFile?: string;
	allowHttpLoopback?: boolean;
}

export class ServerClientError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
		readonly operationId?: string,
	) {
		super(message);
		this.name = "ServerClientError";
	}
}

/** A connection is explicit so a failed remote command can never become a local write. */
export function hasServerConnection(argv: string[]): boolean {
	return argv.some((arg) => /^(--server-url|--server-project|--agent-key-file)(=|$)/.test(arg));
}

export class ServerClient {
	readonly projectId: string;
	readonly origin: string;
	private constructor(
		origin: string,
		projectId: string,
		private readonly secret: string,
	) {
		this.origin = origin;
		this.projectId = projectId;
	}

	static async connect(options: ServerConnectionOptions): Promise<ServerClient> {
		if (!options.serverUrl || !options.serverProject || !options.agentKeyFile) {
			throw new Error("Server mode requires --server-url, --server-project and --agent-key-file.");
		}
		const url = new URL(options.serverUrl);
		if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
			throw new Error("--server-url must be an origin without credentials, a path, query or fragment.");
		}
		const hostname = url.hostname.replace(/^\[|\]$/g, "");
		const loopback =
			hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && hostname.startsWith("127."));
		if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && options.allowHttpLoopback)) {
			throw new Error("Server connections require HTTPS; local HTTP requires --allow-http-loopback.");
		}
		if (!/^[1-9]\d*$/.test(options.serverProject)) throw new Error("--server-project must be a registered project ID.");
		let secret: string;
		try {
			const bytes = await readFile(options.agentKeyFile);
			if (bytes.length > 4096) throw new Error();
			secret = bytes.toString("utf8").trim();
		} catch {
			throw new Error("Cannot read the agent key file.");
		}
		if (!secret || /\s/.test(secret)) throw new Error("The agent key file must contain one access key.");
		return new ServerClient(url.origin, options.serverProject, secret);
	}

	projectPath(path = ""): string {
		return `/api/projects/${encodeURIComponent(this.projectId)}${path ? `/${path.replace(/^\//, "")}` : ""}`;
	}

	private async send(path: string, init: RequestInit = {}): Promise<Response> {
		if (!path.startsWith("/api/") || path.startsWith("//") || path.includes("\\"))
			throw new Error("Invalid server API path.");
		const url = new URL(path, this.origin);
		if (url.origin !== this.origin) throw new Error("Invalid server API origin.");
		const headers = new Headers(init.headers);
		headers.set("Authorization", `Bearer ${this.secret}`);
		if (init.body !== undefined) headers.set("Content-Type", "application/json");
		return fetch(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(30000) });
	}

	private async result<T>(response: Response): Promise<T> {
		const body: unknown = await response.json();
		if (!response.ok) {
			const error = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
			throw new ServerClientError(
				typeof error.error === "string" ? error.error : `Server request failed (${response.status}).`,
				response.status,
				typeof error.code === "string" ? error.code : undefined,
				typeof error.operationId === "string" ? error.operationId : undefined,
			);
		}
		return body as T;
	}

	async read<T>(
		path: string,
		query?: Record<string, string | number | boolean | readonly string[] | undefined>,
	): Promise<T> {
		const url = new URL(this.projectPath(path), this.origin);
		for (const [key, value] of Object.entries(query ?? {}))
			if (value !== undefined)
				for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
		return this.result<T>(await this.send(url.pathname + url.search));
	}

	async operation(operationId: string): Promise<OperationView> {
		return this.result<OperationView>(await this.send(`/api/operations/${encodeURIComponent(operationId)}`));
	}

	async write<T>(
		path: string,
		method: "POST" | "PUT" | "DELETE",
		body?: unknown,
		options: { revision?: string; operationId?: string } = {},
	): Promise<T> {
		const operationId = options.operationId ?? randomUUID();
		const headers = new Headers({ "Idempotency-Key": operationId });
		if (options.revision) headers.set("If-Match", options.revision);
		if (body !== undefined) headers.set("Content-Type", "application/json");
		const init: RequestInit = { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) };
		const expectedHash = await requestHash(new Request(new URL(this.projectPath(path), this.origin), init));
		try {
			const response = await this.send(this.projectPath(path), init);
			return await this.result<T>(response);
		} catch (error) {
			if (error instanceof ServerClientError) throw error;
			try {
				const operation = await this.operation(operationId);
				if (operation.state === "completed" && operation.result && operation.requestHash === expectedHash) {
					return await this.result<T>(storedResponse(operation.result));
				}
			} catch {
				// A failed lookup cannot establish whether the write committed. Preserve its ID.
			}
			throw new ServerClientError(
				`The result is uncertain. Inspect operation ${operationId} before retrying with the same --operation-id.`,
				0,
				"OPERATION_RESULT_UNKNOWN",
				operationId,
			);
		}
	}
}

function storedResponse(result: SafeHttpResult): Response {
	return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers });
}
