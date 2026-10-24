import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { findBacklogRoot } from "../utils/find-backlog-root.ts";
import type { AuthSession } from "./auth-types.ts";
import type { OperationView, SafeHttpResult } from "./mutation-types.ts";
import { requestHash } from "./mutations.ts";

export interface ServerConnectionOptions {
	serverUrl?: string;
	serverProject?: string;
	agentKeyFile?: string;
	sessionFile?: string;
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
	return argv.some((arg) => /^(--server-url|--server-project|--agent-key-file|--session-file)(=|$)/.test(arg));
}

interface ClientSession {
	origin: string;
	token: string;
	csrfToken: string;
	userId: string;
}

function serverOrigin(options: ServerConnectionOptions): string {
	if (!options.serverUrl) throw new Error("--server-url is required.");
	const url = new URL(options.serverUrl);
	if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
		throw new Error("--server-url must be an origin without credentials, a path, query or fragment.");
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const loopback =
		hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && hostname.startsWith("127."));
	if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && options.allowHttpLoopback))
		throw new Error("Server connections require HTTPS; local HTTP requires --allow-http-loopback.");
	return url.origin;
}

async function sessionPath(path: string): Promise<string> {
	const absolute = resolve(path);
	const parent = await realpath(dirname(absolute));
	if (await findBacklogRoot(parent)) throw new Error("The session file must be outside a Backlog project.");
	return join(parent, basename(absolute));
}

async function loadSessionFile(path: string, origin: string): Promise<ClientSession> {
	const file = await open(await sessionPath(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const stat = await file.stat();
		if (
			!stat.isFile() ||
			stat.size > 16384 ||
			(stat.mode & 0o077) !== 0 ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error("The session file must be an owner-readable regular file (0600).");
		let session: ClientSession;
		try {
			session = JSON.parse(await file.readFile("utf8")) as ClientSession;
		} catch {
			throw new Error("Invalid session file.");
		}
		if (session.origin !== origin) throw new Error("The session file belongs to a different server origin.");
		if (
			typeof session.token !== "string" ||
			!/^[A-Za-z0-9_-]+$/.test(session.token) ||
			typeof session.csrfToken !== "string" ||
			!session.csrfToken ||
			typeof session.userId !== "string"
		)
			throw new Error("Invalid session file.");
		return session;
	} finally {
		await file.close();
	}
}

async function upsertSessionFile(path: string, session: ClientSession): Promise<void> {
	const target = await sessionPath(path);
	try {
		await lstat(target);
		await loadSessionFile(target, session.origin);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const temporary = `${target}.${randomUUID()}.tmp`;
	const file = await open(temporary, "wx", 0o600);
	try {
		await file.writeFile(JSON.stringify(session));
		await file.sync();
	} finally {
		await file.close();
	}
	try {
		await rename(temporary, target);
	} finally {
		await unlink(temporary).catch(() => {});
	}
}

export class ServerClient {
	readonly projectId: string;
	readonly origin: string;
	private constructor(
		origin: string,
		projectId: string,
		private readonly credential: string | ClientSession | null,
	) {
		this.origin = origin;
		this.projectId = projectId;
	}

	static async connect(options: ServerConnectionOptions): Promise<ServerClient> {
		if (!options.serverUrl || !options.serverProject || (!options.agentKeyFile && !options.sessionFile)) {
			throw new Error(
				"Server mode requires --server-url, --server-project and one of --agent-key-file or --session-file.",
			);
		}
		if (options.agentKeyFile && options.sessionFile)
			throw new Error("Choose either --agent-key-file or --session-file.");
		const origin = serverOrigin(options);
		if (!/^[1-9]\d*$/.test(options.serverProject)) throw new Error("--server-project must be a registered project ID.");
		if (options.sessionFile) {
			const client = new ServerClient(
				origin,
				options.serverProject,
				await loadSessionFile(options.sessionFile, origin),
			);
			await client.result<AuthSession>(await client.send("/api/auth/activity", { method: "POST" }));
			return client;
		}
		let secret: string;
		try {
			const bytes = await readFile(options.agentKeyFile as string);
			if (bytes.length > 4096) throw new Error();
			secret = bytes.toString("utf8").trim();
		} catch {
			throw new Error("Cannot read the agent key file.");
		}
		if (!secret || /\s/.test(secret)) throw new Error("The agent key file must contain one access key.");
		return new ServerClient(origin, options.serverProject, secret);
	}

	static async auth(
		options: ServerConnectionOptions,
		action: "login" | "password" | "logout",
		body?: unknown,
	): Promise<AuthSession | null> {
		if (!options.sessionFile || options.agentKeyFile)
			throw new Error("Human login requires --session-file and cannot use --agent-key-file.");
		const origin = serverOrigin(options);
		await sessionPath(options.sessionFile);
		const credential = action === "login" ? null : await loadSessionFile(options.sessionFile, origin);
		const client = new ServerClient(origin, "", credential);
		const response = await client.send(`/api/auth/${action}`, {
			method: "POST",
			...(body !== undefined && { body: JSON.stringify(body) }),
		});
		const value = await client.result<AuthSession>(response);
		if (action === "logout") {
			await unlink(await sessionPath(options.sessionFile));
			return null;
		}
		const token = /(?:^|;\s*)backlog_session=([A-Za-z0-9_-]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
		if (!token || !value.csrfToken || !value.user?.id) throw new Error("Server did not return a valid session.");
		await upsertSessionFile(options.sessionFile, { origin, token, csrfToken: value.csrfToken, userId: value.user.id });
		return value;
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
		headers.set("Origin", this.origin);
		headers.set("X-Backlog-Client", "cli");
		if (typeof this.credential === "string") headers.set("Authorization", `Bearer ${this.credential}`);
		else if (this.credential) {
			headers.set("Cookie", `backlog_session=${this.credential.token}`);
			if (!["GET", "HEAD", "OPTIONS"].includes(init.method ?? "GET"))
				headers.set("X-CSRF-Token", this.credential.csrfToken);
		}
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
