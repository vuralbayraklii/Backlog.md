import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Server, ServerWebSocket } from "bun";
import { launchBrowser } from "../utils/browser-launch.ts";
import { getVersion } from "../utils/version.ts";
import { AuthStore, AuthStoreError } from "./auth-store.ts";
import type { AuthSession, ProjectAuthorization, ProjectPermissions } from "./auth-types.ts";
import { BacklogServer, spaIndexHtml } from "./index.ts";
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
	private readonly handlers = new Map<string, BacklogServer>();
	private readonly retiring = new Set<Promise<void>>();
	private readonly sockets = new Set<ServerWebSocket<SocketData>>();
	private server: Server<SocketData> | null = null;
	private closing: Promise<void> | null = null;
	private sweep: ReturnType<typeof setInterval> | null = null;
	private origin = "";

	constructor(dataDirectory: string) {
		this.store = new ProjectStore(dataDirectory);
		this.auth = new AuthStore(dataDirectory);
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
		try {
			this.server = Bun.serve<SocketData>({
				port,
				hostname: HOST,
				development: process.env.NODE_ENV === "development",
				routes: { "/__backlog_entry": spaIndexHtml },
				fetch: async (req, server) => {
					try {
						const response = await this.handleRequest(req, server);
						if (response) for (const [key, value] of Object.entries(NO_STORE)) response.headers.set(key, value);
						return response;
					} catch (error) {
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
			if ((error as { code?: string }).code === "EADDRINUSE")
				throw new Error(`Port ${port} is already in use. Use --port to choose another port.`);
			throw error;
		}
		this.sweep = setInterval(() => {
			for (const ws of this.sockets) this.socketAllowed(ws);
		}, 1000);
		this.sweep.unref();
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
				this.sweep = null;
				for (const ws of this.sockets) ws.close(1001, "Server stopping");
				this.sockets.clear();
				const server = this.server;
				this.server = null;
				if (server) await server.stop(true);
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
		const session = this.auth.loadSession(token);
		if (!session) throw new AuthStoreError("Authentication required.", 401);
		if (session.user.mustChangePassword) throw new AuthStoreError("Password change required.", 403);
		if (admin && session.user.role !== "admin") throw new AuthStoreError("Permission denied.", 403);
		return session;
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
			return this.sessionResponse(
				await this.auth.changePassword(token, stringField(body, "currentPassword"), stringField(body, "newPassword")),
			);
		}
		if (session.user.mustChangePassword) return errorResponse("Password change required.", 403);
		if (path === "/api/auth/activity") {
			const updated = this.auth.activity(token);
			return updated ? Response.json(updated) : errorResponse("Authentication required.", 401);
		}
		return errorResponse("Not Found", 404);
	}

	private async adminRequest(req: Request, path: string, token: string): Promise<Response> {
		if (path === "/api/admin/folder-areas") {
			if (req.method === "GET") return Response.json(this.auth.listFolderAreas());
			if (req.method === "POST") {
				const body = await jsonBody(req);
				fields(body, ["userId", "path"]);
				return Response.json(
					await this.auth.upsertFolderArea(stringField(body, "userId"), stringField(body, "path"), () => {
						this.requireCurrentSession(token, true);
					}),
				);
			}
		}
		const area = path.match(/^\/api\/admin\/folder-areas\/([^/]+)$/);
		if (area && req.method === "DELETE") {
			this.auth.removeFolderArea(decodeURIComponent(area[1] ?? ""), () => {
				this.requireCurrentSession(token, true);
			});
			return Response.json({ success: true });
		}
		if (path === "/api/admin/projects" && req.method === "GET") return Response.json(this.store.list());
		const tracking = path.match(/^\/api\/admin\/projects\/([^/]+)\/tracking$/);
		if (tracking && req.method === "PUT") {
			const body = await jsonBody(req);
			fields(body, ["tracking"]);
			if (typeof body.tracking !== "boolean") throw new AuthStoreError("tracking must be a boolean.", 400);
			const project = await this.store.setTracking(tracking[1] ?? "", body.tracking, () => {
				this.requireCurrentSession(token, true);
			});
			await this.retireProject(project.id);
			return Response.json(project);
		}
		if (path === "/api/admin/users") {
			if (req.method === "GET") return Response.json(this.auth.listUsers());
			if (req.method === "POST") {
				const body = await jsonBody(req);
				fields(body, ["username", "password", "displayName", "role"]);
				return Response.json(
					await this.auth.createUser({
						...body,
						username: stringField(body, "username"),
						password: stringField(body, "password"),
					}),
				);
			}
		}
		const user = path.match(/^\/api\/admin\/users\/([^/]+)(\/reset-password)?$/);
		if (user) {
			const id = decodeURIComponent(user[1] ?? "");
			if (user[2] && req.method === "POST") {
				const body = await jsonBody(req);
				fields(body, ["password"]);
				return Response.json(await this.auth.resetPassword(id, stringField(body, "password")));
			}
			if (!user[2] && req.method === "GET") {
				const record = this.auth.loadUser(id);
				return record ? Response.json(record) : errorResponse("Not Found", 404);
			}
			if (!user[2] && ["PUT", "PATCH"].includes(req.method)) {
				const body = await jsonBody(req);
				fields(body, ["displayName", "role", "active"]);
				return Response.json(this.auth.editUser(id, body));
			}
		}
		const member = path.match(/^\/api\/admin\/projects\/([^/]+)\/members(?:\/([^/]+))?$/);
		if (member) {
			const projectId = member[1] ?? "";
			if (!this.project(projectId)) return errorResponse("Not Found", 404);
			if (!member[2] && req.method === "GET") return Response.json(this.auth.listMembers(projectId));
			const userId = decodeURIComponent(member[2] ?? "");
			if (userId && ["PUT", "PATCH"].includes(req.method)) {
				const body = await jsonBody(req);
				fields(body, ["permissions"]);
				if (
					body.permissions !== undefined &&
					(!body.permissions || typeof body.permissions !== "object" || Array.isArray(body.permissions))
				)
					throw new AuthStoreError("Invalid permissions.", 400);
				return Response.json(
					this.auth.setMember(projectId, userId, body.permissions as Partial<ProjectPermissions> | undefined),
				);
			}
			if (userId && req.method === "DELETE") {
				this.auth.removeMember(projectId, userId);
				return Response.json({ success: true });
			}
		}
		return errorResponse("Not Found", 404);
	}

	private async handleRequest(req: Request, server: Server<SocketData>): Promise<Response | undefined> {
		const path = new URL(req.url).pathname;
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
		if (path.startsWith("/api/admin/")) {
			if (session.user.role !== "admin") return errorResponse("Permission denied.", 403);
			return this.adminRequest(req, path, token);
		}
		if (path === "/" && req.method === "GET") return Response.redirect(`${this.origin}/projects`, 302);
		if (path === "/projects" && req.method === "GET") return this.html();
		if ((path === "/admin/users" || path === "/admin") && req.method === "GET")
			return session.user.role === "admin" ? this.html() : errorResponse("Permission denied.", 403);
		if (path === "/api/projects/registration" && req.method === "GET") {
			const areas = this.auth.listFolderAreas(session.user.id);
			return Response.json({ allowed: session.user.role === "admin" || areas.length > 0, areas });
		}
		if ((path === "/api/projects/preview" || path === "/api/projects") && req.method === "POST") {
			const body = await jsonBody(req);
			fields(body, ["name", "path"]);
			const name = stringField(body, "name");
			const root = stringField(body, "path");
			const actor = this.requireCurrentSession(token);
			if (path === "/api/projects/preview") {
				const preview = await this.store.preview(name, root, actor.user.id);
				this.requireCurrentSession(token);
				return Response.json(preview);
			}
			const project = await this.store.register(name, root, actor.user.id, () => {
				this.requireCurrentSession(token);
			});
			return Response.json(project, { status: 201 });
		}
		if (path === "/api/projects" && req.method === "GET") {
			return Response.json(
				this.store
					.list()
					.filter((project) => project.tracking && this.auth.permissions(session.user, project.id))
					.map(({ id, name }) => ({ id, name })),
			);
		}
		const api = path.match(/^\/api\/projects\/([^/]+)(?:\/(.+))?$/);
		if (api) {
			const projectId = api[1] ?? "";
			const authorization = this.authorization(token, projectId);
			const denied = authorization.check("read");
			if (denied) return denied;
			const project = this.project(projectId);
			if (!project) return errorResponse("Not Found", 404);
			if (!api[2])
				return req.method === "GET"
					? Response.json({
							id: project.id,
							name: project.name,
							permissions: this.auth.permissions(session.user, project.id),
						})
					: errorResponse("Not Found", 404);
			const handler = this.handler(project);
			if (api[2] === "ws") {
				if (req.headers.get("origin") !== this.origin) return errorResponse("Invalid Origin.", 403);
				if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return errorResponse("Not Found", 404);
				const latestDenied = authorization.check("read");
				if (latestDenied) return latestDenied;
				return server.upgrade(req, { data: { projectId: project.id, token } })
					? undefined
					: errorResponse("WebSocket upgrade failed", 400);
			}
			const response = await handler.dispatchApi(
				req,
				api[2].startsWith("assets/") ? `/${api[2]}` : `/api/${api[2]}`,
				authorization,
			);
			const latestDenied = authorization.check("read");
			if (latestDenied || response.status === 503) await this.retireProject(projectId);
			return latestDenied ?? response;
		}
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
}
