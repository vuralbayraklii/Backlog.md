import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Server, ServerWebSocket } from "bun";
import { launchBrowser } from "../utils/browser-launch.ts";
import { getVersion } from "../utils/version.ts";
import { AgentStore, AgentStoreError } from "./agent-store.ts";
import type { AgentGrant } from "./agent-types.ts";
import { AuthStore, AuthStoreError } from "./auth-store.ts";
import type { AuthSession, ProjectAuthorization, ProjectPermissions } from "./auth-types.ts";
import { BacklogServer, spaIndexHtml } from "./index.ts";
import { MutationStoreError } from "./mutation-store.ts";
import type { MutationActor, MutationScope, OperationView, RecordKind } from "./mutation-types.ts";
import {
	CentralMutations,
	type ManagementMutationContext,
	MutationAbortResponse,
	type MutationCheckpoint,
	MutationError,
	managementAudit,
	versionedManagement,
} from "./mutations.ts";
import type { ObservationState, ObservedPathSnapshot } from "./observation-types.ts";
import { assertProjectBoundary } from "./project-paths.ts";
import { ProjectStore, type ServerProject } from "./project-store.ts";

const HOST = "127.0.0.1";
const COOKIE = "backlog_session";
const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff" };
const PROJECT_PAGES = new Set([
	"board",
	"tasks",
	"milestones",
	"drafts",
	"documentation",
	"decisions",
	"statistics",
	"settings",
	"archive",
	"members",
]);
interface SocketData {
	projectId: string;
	token: string;
}
export interface CentralServerOptions {
	publicUrl: string;
	allowHttpLoopback?: boolean;
}

function errorResponse(error: string, status: number): Response {
	return Response.json({ error }, { status, headers: NO_STORE });
}

function noStore(response: Response): Response {
	for (const [key, value] of Object.entries(NO_STORE)) response.headers.set(key, value);
	return response;
}

function configuredOrigin(options?: CentralServerOptions): string {
	if (!options?.publicUrl) throw new Error("--public-url is required for the central server.");
	let url: URL;
	try {
		url = new URL(options.publicUrl);
	} catch {
		throw new Error("--public-url must be an absolute HTTPS origin.");
	}
	if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
		throw new Error("--public-url must contain only the scheme, host, and optional port.");
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const loopback =
		hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && hostname.startsWith("127."));
	if (url.protocol !== "https:" && !(url.protocol === "http:" && options.allowHttpLoopback && loopback)) {
		throw new Error(
			"--public-url requires HTTPS; HTTP development requires --allow-http-loopback and a loopback origin.",
		);
	}
	return url.origin;
}

function cookieToken(req: Request): string {
	const values = (req.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
	return values.find((value) => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
}

function equalToken(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
	if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
		throw new AuthStoreError("Content-Type must be application/json.", 415);
	}
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		throw new AuthStoreError("Invalid JSON body.", 400);
	}
	if (!body || typeof body !== "object" || Array.isArray(body))
		throw new AuthStoreError("Expected a JSON object.", 400);
	return body as Record<string, unknown>;
}
function stringField(body: Record<string, unknown>, key: string): string {
	if (typeof body[key] !== "string") throw new AuthStoreError(`${key} is required.`, 400);
	return body[key];
}
function fields(body: Record<string, unknown>, allowed: string[]): void {
	if (Object.keys(body).some((key) => !allowed.includes(key))) throw new AuthStoreError("Unknown request field.", 400);
}

export class CentralServer {
	private readonly store: ProjectStore;
	private readonly auth: AuthStore;
	private readonly agents: AgentStore;
	private readonly mutations: CentralMutations;
	private readonly handlers = new Map<string, BacklogServer>();
	private readonly publishedHandlers = new WeakSet<BacklogServer>();
	private readonly retiring = new Set<Promise<void>>();
	private readonly sockets = new Set<ServerWebSocket<SocketData>>();
	private server: Server<SocketData> | null = null;
	private closing: Promise<void> | null = null;
	private sweep: ReturnType<typeof setInterval> | null = null;
	private observationSweep: ReturnType<typeof setInterval> | null = null;
	private readonly observedProjects = new Set<string>();
	private origin = "";

	constructor(dataDirectory: string, options?: { mutationCheckpoint?: MutationCheckpoint }) {
		this.store = new ProjectStore(dataDirectory);
		this.auth = new AuthStore(dataDirectory);
		this.agents = new AgentStore(dataDirectory);
		this.mutations = new CentralMutations(dataDirectory, (id) => this.project(id), options?.mutationCheckpoint);
	}

	getPort(): number | null {
		return this.server?.port ?? null;
	}

	async start(port = 6420, openBrowser = false, options?: CentralServerOptions): Promise<void> {
		if (this.closing) await this.closing;
		if (this.server) return;
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535.");
		this.origin = configuredOrigin(options);
		this.store.list();
		if (!this.auth.hasAdmin())
			throw new Error(
				"Initialize the first admin with: backlog server --data-dir <directory> user init-admin <username>",
			);
		await this.mutations.recoverPending();
		await this.syncObservedProjects();
		try {
			this.server = Bun.serve<SocketData>({
				port,
				hostname: HOST,
				development: process.env.NODE_ENV === "development",
				routes: { "/__backlog_entry": spaIndexHtml },
				fetch: async (req, server) => {
					try {
						const response = await this.handleRequest(req, server);
						return response ? noStore(response) : response;
					} catch (error) {
						if (error instanceof MutationAbortResponse) return noStore(error.response);
						if (error instanceof MutationError) return noStore(error.response());
						if (error instanceof MutationStoreError)
							return Response.json(
								{ error: error.message, code: error.code },
								{ status: error.status, headers: NO_STORE },
							);
						if (error instanceof AgentStoreError) return errorResponse(error.message, error.status);
						if (error instanceof AuthStoreError) {
							const response = errorResponse(error.message, error.status);
							if (error.retryAfter !== undefined) response.headers.set("Retry-After", String(error.retryAfter));
							return response;
						}
						return errorResponse("Request failed.", 500);
					}
				},
				websocket: {
					open: (ws) => {
						this.sockets.add(ws);
						if (this.socketAllowed(ws))
							this.handlers.get(ws.data.projectId)?.acceptSocket(ws, () => this.socketAllowed(ws));
					},
					message: (ws) => {
						if (this.socketAllowed(ws)) ws.send("pong");
					},
					close: (ws) => {
						this.sockets.delete(ws);
						this.handlers.get(ws.data.projectId)?.removeSocket(ws);
					},
				},
			});
		} catch (error) {
			await this.stop();
			if ((error as { code?: string }).code === "EADDRINUSE")
				throw new Error(`Port ${port} is already in use. Use --port to choose another port.`);
			throw error;
		}
		this.sweep = setInterval(() => {
			for (const ws of this.sockets) this.socketAllowed(ws);
		}, 1000);
		this.sweep.unref();
		this.observationSweep = setInterval(() => void this.syncObservedProjects().catch(() => {}), 30000);
		this.observationSweep.unref();
		const url = `${this.origin}/projects`;
		console.log(`Backlog.md server running at ${url}`);
		if (openBrowser) {
			try {
				await launchBrowser(url);
			} catch {
				console.warn("Could not open a browser automatically.");
			}
		}
	}

	async stop(): Promise<void> {
		if (this.closing) return this.closing;
		this.closing = (async () => {
			try {
				if (this.sweep) clearInterval(this.sweep);
				if (this.observationSweep) clearInterval(this.observationSweep);
				this.observationSweep = null;
				this.sweep = null;
				for (const ws of this.sockets) ws.close(1001, "Server stopping");
				this.sockets.clear();
				const server = this.server;
				this.server = null;
				if (server) await server.stop(true);
				await this.mutations.stopObservation();
				this.observedProjects.clear();
				await Promise.all([...this.handlers.values()].map((handler) => handler.stop()));
				this.handlers.clear();
				await Promise.all(this.retiring);
			} finally {
				this.closing = null;
			}
		})();
		return this.closing;
	}

	private socketAllowed(ws: ServerWebSocket<SocketData>): boolean {
		try {
			if (!this.authorization(ws.data.token, ws.data.projectId).check("read")) return true;
		} catch {
			/* Fail closed if the database becomes unreadable. */
		}
		ws.close(1008, "Access expired");
		return false;
	}

	private authorization(token: string, projectId: string): ProjectAuthorization {
		return {
			check: (permission) => {
				if (this.closing) return errorResponse("Server is stopping.", 503);
				const session = this.auth.loadSession(token);
				if (!session) return errorResponse("Authentication required.", 401);
				if (session.user.mustChangePassword) return errorResponse("Password change required.", 403);
				const project = this.project(projectId);
				if (!project?.tracking) {
					void this.retireProject(projectId);
					return errorResponse("Not Found", 404);
				}
				const permissions = this.auth.permissions(session.user, projectId);
				if (!permissions) return errorResponse("Not Found", 404);
				try {
					assertProjectBoundary(project.rootPath);
				} catch {
					void this.retireProject(projectId);
					return errorResponse("Project is unavailable.", 503);
				}
				if (
					permission === "admin" ? session.user.role !== "admin" : permission !== "read" && !permissions[permission]
				) {
					return errorResponse("Permission denied.", 403);
				}
				return null;
			},
		};
	}

	private requireCurrentSession(token: string, admin = false): AuthSession {
		if (this.closing) throw new AuthStoreError("Server is stopping.", 503);
		const session = this.auth.loadSession(token);
		if (!session) throw new AuthStoreError("Authentication required.", 401);
		if (session.user.mustChangePassword) throw new AuthStoreError("Password change required.", 403);
		if (admin && session.user.role !== "admin") throw new AuthStoreError("Permission denied.", 403);
		return session;
	}

	private operationDenied(operation: OperationView, token: string): Response | null {
		if (operation.scope.kind === "project") return this.authorization(token, operation.scope.projectId).check("read");
		if (operation.scope.kind === "registration") {
			const body = operation.result?.body;
			if (body && typeof body === "object" && "id" in body && typeof body.id === "string")
				return this.authorization(token, body.id).check("read");
		}
		try {
			this.requireCurrentSession(token, operation.scope.kind === "admin");
			return null;
		} catch (error) {
			return error instanceof AuthStoreError
				? errorResponse(error.message, error.status)
				: errorResponse("Request failed.", 500);
		}
	}

	private async retireProject(projectId: string): Promise<void> {
		for (const ws of this.sockets) {
			if (ws.data.projectId === projectId) ws.close(1008, "Project unavailable");
		}
		const handler = this.handlers.get(projectId);
		this.handlers.delete(projectId);
		if (!handler) return;
		const stopping = handler.stop();
		this.retiring.add(stopping);
		try {
			await stopping;
		} finally {
			this.retiring.delete(stopping);
		}
	}

	private project(projectId: string): ServerProject | null {
		return /^[1-9]\d*$/.test(projectId) ? this.store.load(projectId) : null;
	}

	private async observeProject(project: ServerProject): Promise<void> {
		if (this.closing || !this.project(project.id)?.tracking) return;
		const scan = (previousPaths: readonly string[], previousEntries?: readonly ObservedPathSnapshot[]) =>
			this.handler(project).scanObservedFiles(previousPaths, previousEntries);
		const hooks = {
			watchDirectory: this.handler(project).observationWatchDirectory(),
			needsPublication: () => !this.publishedHandlers.has(this.handler(project)),
			publish: async (entries: readonly ObservedPathSnapshot[]) => {
				const handler = this.handler(project);
				await handler.publishObservedFiles(entries);
				this.publishedHandlers.add(handler);
			},
			onState: (state: ObservationState) =>
				this.handlers.get(project.id)?.broadcastObservationUpdated(project.id, state.state),
			onPublicationFailure: () => this.retireProject(project.id),
		};
		this.mutations.setObservationTracking(project, scan, hooks);
		this.observedProjects.add(project.id);
		await this.mutations.reconcileObserved(project, scan, hooks);
	}

	private async syncObservedProjects(): Promise<void> {
		if (this.closing) return;
		const projects = this.store.list().filter((project) => project.tracking);
		const active = new Set(projects.map((project) => project.id));
		for (const id of this.observedProjects) {
			if (!active.has(id)) {
				await this.mutations.stopObservationTracking(id);
				this.observedProjects.delete(id);
				await this.retireProject(id);
			}
		}
		for (const project of projects) {
			if (this.observedProjects.has(project.id)) continue;
			try {
				await this.mutations.ensureBaseline(project, () => this.handler(project).listCentralRecordSnapshots());
				await this.observeProject(project);
			} catch {
				// One unavailable binding must not prevent observing the other projects.
			}
		}
	}

	private agentAuthorization(secret: string, projectId: string): ProjectAuthorization {
		return {
			check: (permission) => {
				if (this.closing) return errorResponse("Server is stopping.", 503);
				const actor = this.agents.authenticate(secret);
				if (!actor) return errorResponse("Authentication required.", 401);
				const project = this.project(projectId);
				const permissions = this.agents.permissions(actor.agentKeyId, projectId);
				if (!project?.tracking || !permissions) return errorResponse("Not Found", 404);
				try {
					assertProjectBoundary(project.rootPath);
				} catch {
					return errorResponse("Project is unavailable.", 503);
				}
				if (permission === "admin" || (permission !== "read" && !permissions[permission]))
					return errorResponse("Permission denied.", 403);
				return null;
			},
		};
	}

	private async agentRequest(req: Request, server: Server<SocketData>): Promise<Response | undefined> {
		const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.get("authorization") ?? "");
		const secret = match?.[1] ?? "";
		const actor = this.agents.authenticate(secret);
		if (!actor) return errorResponse("Authentication required.", 401);
		const path = new URL(req.url).pathname;
		if (path === "/api/projects" && req.method === "GET") {
			return Response.json(
				this.store
					.list()
					.filter((project) => project.tracking && this.agents.permissions(actor.agentKeyId, project.id))
					.map(({ id, name }) => ({ id, name, observation: this.mutations.observationState(id) })),
			);
		}
		const operation = path.match(/^\/api\/operations\/([^/]+)$/);
		if (operation && req.method === "GET") {
			const view = this.mutations.operation(operation[1] ?? "", actor);
			if (view?.scope.kind !== "project") return errorResponse("Not Found", 404);
			return this.agentAuthorization(secret, view.scope.projectId).check("read") ?? Response.json(view);
		}
		const api = path.match(/^\/api\/projects\/([1-9]\d*)(?:\/(.+))?$/);
		if (!api) return errorResponse("Permission denied.", 403);
		return this.projectRequest(
			req,
			server,
			api[1] ?? "",
			api[2],
			this.agentAuthorization(secret, api[1] ?? ""),
			actor,
			() => this.agents.permissions(actor.agentKeyId, api[1] ?? ""),
		);
	}

	private handler(project: ServerProject): BacklogServer {
		let handler = this.handlers.get(project.id);
		if (!handler) {
			handler = new BacklogServer(project.rootPath, { centralMode: true, projectName: project.name });
			this.handlers.set(project.id, handler);
		}
		return handler;
	}
	private async html(): Promise<Response> {
		const entry = await fetch(`http://${HOST}:${this.server?.port}/__backlog_entry`);
		return new Response(entry.body, { status: entry.status, headers: entry.headers });
	}
	private sessionResponse(result: { token: string; session: AuthSession }): Response {
		const secure = this.origin.startsWith("https:") ? "; Secure" : "";
		return Response.json(result.session, {
			headers: {
				...NO_STORE,
				"Set-Cookie": `${COOKIE}=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`,
			},
		});
	}
	private checkMutation(req: Request, session: AuthSession): Response | null {
		if (req.headers.get("origin") !== this.origin) return errorResponse("Invalid Origin.", 403);
		if (!equalToken(req.headers.get("x-csrf-token") ?? "", session.csrfToken))
			return errorResponse("Invalid CSRF token.", 403);
		return null;
	}

	private async authRequest(req: Request, path: string, token: string): Promise<Response> {
		if (path === "/api/auth/login" && req.method === "POST") {
			if (req.headers.get("origin") !== this.origin) return errorResponse("Invalid Origin.", 403);
			const body = await jsonBody(req);
			fields(body, ["username", "password"]);
			return this.sessionResponse(await this.auth.login(stringField(body, "username"), stringField(body, "password")));
		}
		const session = this.auth.loadSession(token);
		if (!session) return errorResponse("Authentication required.", 401);
		if (path === "/api/auth/session" && req.method === "GET") return Response.json(session);
		if (req.method !== "POST") return errorResponse("Not Found", 404);
		const denied = this.checkMutation(req, session);
		if (denied) return denied;
		if (path === "/api/auth/logout") {
			this.auth.logout(token);
			return Response.json(
				{ success: true },
				{
					headers: {
						"Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${this.origin.startsWith("https:") ? "; Secure" : ""}`,
					},
				},
			);
		}
		if (path === "/api/auth/password") {
			const body = await jsonBody(req);
			fields(body, ["currentPassword", "newPassword"]);
			const operationId = randomUUID();
			const audit = managementAudit(this.mutations.store, {
				operationId,
				scope: { kind: "admin" },
				actor: { kind: "user", userId: session.user.id },
				source: "browser",
				requestHash: createHash("sha256").update(`user.change_password\0${operationId}`).digest("hex"),
				action: "user.change_password",
				forceEvent: true,
				resultBody: () => ({ success: true }),
			});
			return this.sessionResponse(
				await this.auth.changePassword(
					token,
					stringField(body, "currentPassword"),
					stringField(body, "newPassword"),
					audit,
				),
			);
		}
		if (session.user.mustChangePassword) return errorResponse("Password change required.", 403);
		if (path === "/api/auth/activity") {
			const updated = this.auth.activity(token);
			return updated ? Response.json(updated) : errorResponse("Authentication required.", 401);
		}
		return errorResponse("Not Found", 404);
	}

	private async adminRequest(
		req: Request,
		path: string,
		token: string,
		mutation?: ManagementMutationContext,
	): Promise<Response> {
		if (path === "/api/admin/agent-keys") {
			if (req.method === "GET") return Response.json(this.agents.list());
			if (req.method === "POST") {
				const body = await jsonBody(req);
				fields(body, ["userId", "name", "grants"]);
				const created = this.agents.create(
					{
						userId: stringField(body, "userId"),
						name: stringField(body, "name"),
						grants: body.grants as AgentGrant[],
					},
					mutation?.audit("agent-key.create", { status: 201, resultBody: (result) => result }),
				);
				return Response.json(created, { status: 201 });
			}
		}
		const revokeKey = path.match(/^\/api\/admin\/agent-keys\/([^/]+)\/revoke$/);
		if (revokeKey && req.method === "POST") {
			const key = this.agents.load(decodeURIComponent(revokeKey[1] ?? ""));
			if (!key) return errorResponse("Not Found", 404);
			const updated = this.agents.revoke(
				key.id,
				key.userId,
				mutation?.audit("agent-key.revoke", { requireRevision: true, resultBody: (result) => result }),
			);
			return Response.json({ key: updated });
		}
		if (path === "/api/admin/history" && req.method === "GET") {
			const url = new URL(req.url);
			const scope: MutationScope =
				url.searchParams.get("scope") === "registration" ? { kind: "registration" } : { kind: "admin" };
			const kind = url.searchParams.get("kind") ?? undefined;
			if (kind && !["user", "membership", "folder-area", "project", "agent-key"].includes(kind))
				return errorResponse("Invalid history kind.", 400);
			return Response.json(
				this.mutations.store.listHistory({
					scope,
					...(url.searchParams.get("recordKey") && { recordKey: url.searchParams.get("recordKey") ?? undefined }),
					...(kind && { kind: kind as "user" | "membership" | "folder-area" | "project" }),
					...(url.searchParams.get("cursor") && { cursor: url.searchParams.get("cursor") ?? undefined }),
					...(url.searchParams.get("limit") && { limit: Number(url.searchParams.get("limit")) }),
				}),
			);
		}
		if (path === "/api/admin/folder-areas") {
			if (req.method === "GET")
				return Response.json(
					this.auth.listFolderAreas().map((area) => versionedManagement(`folder-area:${area.id}`, area)),
				);
			if (req.method === "POST") {
				const body = await jsonBody(req);
				fields(body, ["userId", "path"]);
				const area = await this.auth.upsertFolderArea(
					stringField(body, "userId"),
					stringField(body, "path"),
					() => {
						this.requireCurrentSession(token, true);
					},
					mutation?.audit("folder_area.upsert"),
				);
				return Response.json(versionedManagement(`folder-area:${area.id}`, area));
			}
		}
		const area = path.match(/^\/api\/admin\/folder-areas\/([^/]+)$/);
		if (area && req.method === "DELETE") {
			this.auth.removeFolderArea(
				decodeURIComponent(area[1] ?? ""),
				() => {
					this.requireCurrentSession(token, true);
				},
				mutation?.audit("folder_area.remove", { requireRevision: true }),
			);
			return Response.json({ success: true });
		}
		if (path === "/api/admin/projects" && req.method === "GET")
			return Response.json(this.store.list().map((project) => versionedManagement(`project:${project.id}`, project)));
		const tracking = path.match(/^\/api\/admin\/projects\/([^/]+)\/tracking$/);
		if (tracking && req.method === "PUT") {
			const body = await jsonBody(req);
			fields(body, ["tracking"]);
			if (typeof body.tracking !== "boolean") throw new AuthStoreError("tracking must be a boolean.", 400);
			const project = await this.store.setTracking(
				tracking[1] ?? "",
				body.tracking,
				() => {
					this.requireCurrentSession(token, true);
				},
				mutation?.audit("project.tracking", { requireRevision: true }),
			);
			await this.mutations.stopObservationTracking(project.id);
			this.observedProjects.delete(project.id);
			await this.retireProject(project.id);
			if (project.tracking) await this.observeProject(project);
			return Response.json(versionedManagement(`project:${project.id}`, project));
		}
		if (path === "/api/admin/users") {
			if (req.method === "GET")
				return Response.json(this.auth.listUsers().map((user) => versionedManagement(`user:${user.id}`, user)));
			if (req.method === "POST") {
				const body = await jsonBody(req);
				fields(body, ["username", "password", "displayName", "role"]);
				const created = await this.auth.createUser(
					{
						...body,
						username: stringField(body, "username"),
						password: stringField(body, "password"),
					},
					mutation?.audit("user.create", { forceEvent: true }),
				);
				return Response.json(versionedManagement(`user:${created.id}`, created));
			}
		}
		const user = path.match(/^\/api\/admin\/users\/([^/]+)(\/reset-password)?$/);
		if (user) {
			const id = decodeURIComponent(user[1] ?? "");
			if (user[2] && req.method === "POST") {
				const body = await jsonBody(req);
				fields(body, ["password"]);
				const updated = await this.auth.resetPassword(
					id,
					stringField(body, "password"),
					mutation?.audit("user.reset_password", { forceEvent: true }),
				);
				return Response.json(versionedManagement(`user:${id}`, updated));
			}
			if (!user[2] && req.method === "GET") {
				const record = this.auth.loadUser(id);
				return record ? Response.json(versionedManagement(`user:${id}`, record)) : errorResponse("Not Found", 404);
			}
			if (!user[2] && ["PUT", "PATCH"].includes(req.method)) {
				const body = await jsonBody(req);
				fields(body, ["displayName", "role", "active"]);
				const updated = this.auth.editUser(id, body, mutation?.audit("user.edit", { requireRevision: true }));
				return Response.json(versionedManagement(`user:${id}`, updated));
			}
		}
		const member = path.match(/^\/api\/admin\/projects\/([^/]+)\/members(?:\/([^/]+))?$/);
		if (member) {
			const projectId = member[1] ?? "";
			if (!this.project(projectId)) return errorResponse("Not Found", 404);
			if (!member[2] && req.method === "GET")
				return Response.json(
					this.auth
						.listMembers(projectId)
						.map((entry) => versionedManagement(`membership:${projectId}:${entry.userId}`, entry)),
				);
			const userId = decodeURIComponent(member[2] ?? "");
			if (userId && ["PUT", "PATCH"].includes(req.method)) {
				const body = await jsonBody(req);
				fields(body, ["permissions"]);
				if (
					body.permissions !== undefined &&
					(!body.permissions || typeof body.permissions !== "object" || Array.isArray(body.permissions))
				)
					throw new AuthStoreError("Invalid permissions.", 400);
				const updated = this.auth.setMember(
					projectId,
					userId,
					body.permissions as Partial<ProjectPermissions> | undefined,
					mutation?.audit("membership.set", { requireRevision: true }),
				);
				return Response.json(versionedManagement(`membership:${projectId}:${userId}`, updated));
			}
			if (userId && req.method === "DELETE") {
				this.auth.removeMember(projectId, userId, mutation?.audit("membership.remove", { requireRevision: true }));
				return Response.json({ success: true });
			}
		}
		return errorResponse("Not Found", 404);
	}

	private async handleRequest(req: Request, server: Server<SocketData>): Promise<Response | undefined> {
		if (this.closing) return errorResponse("Server is stopping.", 503);
		const path = new URL(req.url).pathname;
		if (req.headers.has("authorization")) return this.agentRequest(req, server);
		const token = cookieToken(req);
		if (path.startsWith("/api/auth/")) return this.authRequest(req, path, token);
		if (path === "/api/version" && req.method === "GET") return Response.json({ version: await getVersion() });
		if ((path === "/login" || path === "/password") && req.method === "GET") return this.html();
		const session = this.auth.loadSession(token);
		if (!session) {
			if (
				req.method === "GET" &&
				(path === "/projects" || path.startsWith("/projects/") || path === "/admin" || path.startsWith("/admin/"))
			)
				return this.html();
			if (path === "/") return Response.redirect(`${this.origin}/login`, 302);
			return errorResponse("Authentication required.", 401);
		}
		if (session.user.mustChangePassword) {
			if (
				req.method === "GET" &&
				(path === "/" || path === "/projects" || path.startsWith("/projects/") || path.startsWith("/admin/"))
			)
				return this.html();
			return errorResponse("Password change required.", 403);
		}
		if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
			const denied = this.checkMutation(req, session);
			if (denied) return denied;
		}
		const operation = path.match(/^\/api\/operations\/([^/]+)$/);
		if (operation && req.method === "GET") {
			const view = this.mutations.operation(
				operation[1] ?? "",
				{ kind: "user", userId: session.user.id },
				session.user.role === "admin",
			);
			if (!view) return errorResponse("Not Found", 404);
			const denied = this.operationDenied(view, token);
			if (denied) return denied;
			return Response.json(view);
		}
		if (path.startsWith("/api/admin/")) {
			if (session.user.role !== "admin") return errorResponse("Permission denied.", 403);
			if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return this.adminRequest(req, path, token);
			const secretBody =
				(path === "/api/admin/users" && req.method === "POST") ||
				(path.endsWith("/reset-password") && req.method === "POST");
			return this.mutations.runManagement(
				req,
				{ kind: "admin" },
				{ kind: "user", userId: session.user.id },
				secretBody,
				() => {
					try {
						this.requireCurrentSession(token, true);
						return null;
					} catch (error) {
						return error instanceof AuthStoreError
							? errorResponse(error.message, error.status)
							: errorResponse("Request failed.", 500);
					}
				},
				(context) => this.adminRequest(req, path, token, context),
			);
		}
		if (path === "/" && req.method === "GET") return Response.redirect(`${this.origin}/projects`, 302);
		if (path === "/projects" && req.method === "GET") return this.html();
		if ((path === "/admin/users" || path === "/admin") && req.method === "GET")
			return session.user.role === "admin" ? this.html() : errorResponse("Permission denied.", 403);
		if (path === "/api/projects/registration" && req.method === "GET") {
			const areas = this.auth.listFolderAreas(session.user.id);
			return Response.json({
				allowed: session.user.role === "admin" || areas.length > 0,
				areas: areas.map((area) => versionedManagement(`folder-area:${area.id}`, area)),
			});
		}
		if ((path === "/api/projects/preview" || path === "/api/projects") && req.method === "POST") {
			const body = await jsonBody(req.clone());
			fields(body, ["name", "path"]);
			const name = stringField(body, "name");
			const root = stringField(body, "path");
			const actor = this.requireCurrentSession(token);
			if (path === "/api/projects/preview") {
				const preview = await this.store.preview(name, root, actor.user.id);
				this.requireCurrentSession(token);
				return Response.json(preview);
			}
			return this.mutations.runManagement(
				req,
				{ kind: "registration" },
				{ kind: "user", userId: actor.user.id },
				false,
				() => {
					try {
						this.requireCurrentSession(token);
						return null;
					} catch (error) {
						return error instanceof AuthStoreError
							? errorResponse(error.message, error.status)
							: errorResponse("Request failed.", 500);
					}
				},
				async (mutation) => {
					const project = await this.store.register(
						name,
						root,
						actor.user.id,
						() => {
							this.requireCurrentSession(token);
						},
						mutation.audit("project.register", { status: 201 }),
					);
					try {
						await this.mutations.ensureBaseline(project, () => this.handler(project).listCentralRecordSnapshots());
					} catch {
						// Observation reports incomplete source records without inventing a recovery operation.
					}
					await this.observeProject(project);
					return Response.json(versionedManagement(`project:${project.id}`, project), { status: 201 });
				},
				(operation) => this.operationDenied(operation, token),
			);
		}
		if (path === "/api/projects" && req.method === "GET") {
			return Response.json(
				this.store
					.list()
					.filter((project) => project.tracking && this.auth.permissions(session.user, project.id))
					.map(({ id, name }) => ({ id, name, observation: this.mutations.observationState(id) })),
			);
		}
		const api = path.match(/^\/api\/projects\/([^/]+)(?:\/(.+))?$/);
		if (api)
			return this.projectRequest(
				req,
				server,
				api[1] ?? "",
				api[2],
				this.authorization(token, api[1] ?? ""),
				{ kind: "user", userId: session.user.id },
				() => this.auth.permissions(session.user, api[1] ?? ""),
				token,
			);
		const page = path.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
		if (page && req.method === "GET") {
			const denied = this.authorization(token, page[1] ?? "").check("read");
			if (denied) return denied;
			const project = this.project(page[1] ?? "");
			if (!project) return errorResponse("Not Found", 404);
			const remainder = page[2] ?? "";
			if (!remainder) return Response.redirect(`${this.origin}/projects/${project.id}/board`, 302);
			if (!PROJECT_PAGES.has(remainder.split("/")[0] ?? "")) return errorResponse("Not Found", 404);
			if ((remainder === "settings" || remainder === "members") && session.user.role !== "admin")
				return errorResponse("Permission denied.", 403);
			return this.html();
		}
		return errorResponse("Not Found", 404);
	}
	private async projectRequest(
		req: Request,
		server: Server<SocketData>,
		projectId: string,
		tail: string | undefined,
		authorization: ProjectAuthorization,
		actor: MutationActor,
		permissions: () => ProjectPermissions | null,
		token?: string,
	): Promise<Response | undefined> {
		const denied = authorization.check("read");
		if (denied) return denied;
		const project = this.project(projectId);
		if (!project) return errorResponse("Not Found", 404);
		if (!this.mutations.store.hasBaseline(project.id) && this.mutations.writeState(project.id).writeState === "ready") {
			try {
				await this.mutations.ensureBaseline(project, () => this.handler(project).listCentralRecordSnapshots());
			} catch {
				// The observer distinguishes malformed files from interrupted writes.
			}
		}
		await this.observeProject(project);
		if (!tail)
			return req.method === "GET"
				? Response.json({
						id: project.id,
						name: project.name,
						permissions: permissions(),
						...this.mutations.writeState(project.id),
						observation: this.mutations.observationState(project.id),
					})
				: errorResponse("Not Found", 404);
		if (tail === "history" && req.method === "GET") {
			const url = new URL(req.url);
			const kind = url.searchParams.get("kind") ?? undefined;
			if (kind && !(["task", "document", "decision", "milestone", "config"] as string[]).includes(kind))
				return errorResponse("Invalid history kind.", 400);
			return Response.json(
				this.mutations.store.listHistory({
					scope: { kind: "project", projectId: project.id },
					...(url.searchParams.get("recordKey") && { recordKey: url.searchParams.get("recordKey") ?? undefined }),
					...(kind && { kind: kind as RecordKind }),
					...(url.searchParams.get("cursor") && { cursor: url.searchParams.get("cursor") ?? undefined }),
					...(url.searchParams.get("limit") && { limit: Number(url.searchParams.get("limit")) }),
				}),
			);
		}
		this.mutations.writeState(project.id);
		if (this.mutations.consumeResolved(project.id)) await this.retireProject(project.id);
		const handler = this.handler(project);
		if (tail === "ws") {
			if (!token) return errorResponse("Permission denied.", 403);
			if (req.headers.get("origin") !== this.origin) return errorResponse("Invalid Origin.", 403);
			if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return errorResponse("Not Found", 404);
			const latestDenied = authorization.check("read");
			if (latestDenied) return latestDenied;
			return server.upgrade(req, { data: { projectId: project.id, token } })
				? undefined
				: errorResponse("WebSocket upgrade failed", 400);
		}
		const localPath = tail.startsWith("assets/") ? `/${tail}` : `/api/${tail}`;
		const permissionRequest = req.clone();
		const response = ["GET", "HEAD", "OPTIONS"].includes(req.method)
			? await this.mutations.runRead(
					project.id,
					() => handler.authorizeApi(permissionRequest.clone(), localPath, authorization),
					() =>
						handler.dispatchApi(req, localPath, authorization, {
							recordKeyFor: this.mutations.recordKeysFor(project.id),
						}),
				)
			: await this.mutations.runProject(
					req,
					project,
					actor,
					() => handler.authorizeApi(permissionRequest.clone(), localPath, authorization),
					(context) => handler.dispatchApi(req, localPath, authorization, context),
					() => handler.listCentralRecordSnapshots(),
					() => this.retireProject(project.id),
				);
		const latestDenied = authorization.check("read");
		if (latestDenied) await this.retireProject(projectId);
		return latestDenied ?? response;
	}
}
