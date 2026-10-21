import { realpath, stat } from "node:fs/promises";
import type { Server } from "bun";
import { FileSystem } from "../file-system/operations.ts";
import { launchBrowser } from "../utils/browser-launch.ts";
import { getVersion } from "../utils/version.ts";
import { BacklogServer, spaIndexHtml } from "./index.ts";
import { ProjectStore, type ServerProject } from "./project-store.ts";

const HOST = "127.0.0.1";
const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" };
const PROJECT_PAGES = new Set([
	"board",
	"tasks",
	"milestones",
	"drafts",
	"documentation",
	"decisions",
	"statistics",
	"settings",
]);

export class CentralServer {
	private readonly store: ProjectStore;
	private readonly handlers = new Map<string, BacklogServer>();
	private server: Server<{ projectId: string }> | null = null;
	private closing: Promise<void> | null = null;

	constructor(dataDirectory: string) {
		this.store = new ProjectStore(dataDirectory);
	}

	getPort(): number | null {
		return this.server?.port ?? null;
	}

	async start(port = 6420, openBrowser = false): Promise<void> {
		if (this.closing) await this.closing;
		if (this.server) return;
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535.");
		// Read before listening: an absent database is empty, but a corrupt one is a startup error.
		this.store.list();
		try {
			this.server = Bun.serve({
				port,
				hostname: HOST,
				development: process.env.NODE_ENV === "development",
				routes: { "/__backlog_entry": spaIndexHtml },
				fetch: (req, server) => this.handleRequest(req, server),
				websocket: {
					open: (ws) => this.handlers.get(ws.data.projectId)?.acceptSocket(ws),
					message: (ws) => {
						ws.send("pong");
					},
					close: (ws) => this.handlers.get(ws.data.projectId)?.removeSocket(ws),
				},
			}) as Server<{ projectId: string }>;
		} catch (error) {
			if ((error as { code?: string }).code === "EADDRINUSE") {
				throw new Error(`Port ${port} is already in use. Use --port to choose another port.`);
			}
			throw error;
		}
		const url = `http://${HOST}:${this.server.port}/projects`;
		console.log(`Backlog.md server running at ${url}`);
		if (openBrowser) {
			try {
				await launchBrowser(url);
			} catch (error) {
				console.warn("Could not open a browser automatically:", error);
			}
		}
	}

	async stop(): Promise<void> {
		if (this.closing) return this.closing;
		this.closing = (async () => {
			try {
				const server = this.server;
				this.server = null;
				if (server) await server.stop();
				await Promise.all([...this.handlers.values()].map((handler) => handler.stop()));
				this.handlers.clear();
			} finally {
				this.closing = null;
			}
		})();
		return this.closing;
	}

	private async project(projectId: string): Promise<ServerProject | null> {
		if (!/^[1-9]\d*$/.test(projectId)) return null;
		return this.store.load(projectId);
	}

	private async readable(project: ServerProject): Promise<boolean> {
		try {
			if ((await realpath(project.rootPath)) !== project.rootPath) return false;
			if (!(await stat(project.rootPath)).isDirectory()) return false;
			const filesystem = new FileSystem(project.rootPath);
			if (!(await filesystem.loadConfig())) return false;
			return (await stat(filesystem.backlogDir)).isDirectory();
		} catch {
			return false;
		}
	}

	private handler(project: ServerProject): BacklogServer {
		let handler = this.handlers.get(project.id);
		if (!handler) {
			handler = new BacklogServer(project.rootPath, { centralMode: true, projectName: project.name });
			this.handlers.set(project.id, handler);
		}
		return handler;
	}

	private async html(req: Request): Promise<Response> {
		// Bun owns the HTML bundle and its compiled assets at this shared entry route.
		const entry = await fetch(new URL("/__backlog_entry", req.url));
		const headers = new Headers(entry.headers);
		for (const [name, value] of Object.entries(NO_STORE)) headers.set(name, value);
		return new Response(entry.body, { status: entry.status, headers });
	}

	private async handleRequest(req: Request, server: Server<{ projectId: string }>): Promise<Response> {
		const path = new URL(req.url).pathname;
		if (path === "/" && req.method === "GET") {
			return Response.redirect(new URL("/projects", req.url), 302);
		}
		if (path === "/projects" && req.method === "GET") return this.html(req);
		if (path === "/api/version" && req.method === "GET") return Response.json({ version: await getVersion() });
		if (path === "/api/projects" && req.method === "GET") {
			return Response.json(this.store.list().map(({ id, name }) => ({ id, name })));
		}

		const api = path.match(/^\/api\/projects\/([^/]+)(?:\/(.+))?$/);
		if (api) {
			const project = await this.project(api[1] ?? "");
			if (!project) return new Response("Not Found", { status: 404 });
			if (!(await this.readable(project))) return Response.json({ error: "Project is unavailable." }, { status: 503 });
			if (!api[2]) {
				return req.method === "GET"
					? Response.json({ id: project.id, name: project.name })
					: new Response("Not Found", { status: 404 });
			}
			const handler = this.handler(project);
			if (api[2] === "ws") {
				if (req.headers.get("upgrade") !== "websocket") return new Response("Not Found", { status: 404 });
				return server.upgrade(req, { data: { projectId: project.id } })
					? new Response(null, { status: 101 })
					: new Response("WebSocket upgrade failed", { status: 400 });
			}
			const localPath = api[2].startsWith("assets/") ? `/${api[2]}` : `/api/${api[2]}`;
			return handler.dispatchApi(req, localPath);
		}

		const page = path.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
		if (page && req.method === "GET") {
			const project = await this.project(page[1] ?? "");
			if (!project) return new Response("Not Found", { status: 404 });
			if (!(await this.readable(project))) return new Response("Project is unavailable", { status: 503 });
			const remainder = page[2] ?? "";
			if (!remainder) return Response.redirect(new URL(`/projects/${project.id}/board`, req.url), 302);
			if (!PROJECT_PAGES.has(remainder.split("/")[0] ?? "")) return new Response("Not Found", { status: 404 });
			return this.html(req);
		}
		return new Response("Not Found", { status: 404 });
	}
}
