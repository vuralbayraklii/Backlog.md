import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { ADMIN_PERMISSIONS } from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { ProjectStore } from "../server/project-store.ts";
import { centralFixtureFetch } from "./central-test-client.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("central project server", () => {
	let root: string;
	let dataDir: string;
	let server: CentralServer;
	let base: string;
	let cookie: string;
	let csrf: string;
	const password = "central test password";
	async function authenticate() {
		if (cookie) return;
		const auth = new AuthStore(dataDir);
		const login = await auth.login("admin", password);
		const result = await auth.changePassword(login.token, password, `${password} replacement`);
		cookie = `backlog_session=${result.token}`;
		csrf = result.session.csrfToken;
	}
	async function request(input: string, init?: RequestInit) {
		await authenticate();
		const headers = new Headers(init?.headers);
		headers.set("Cookie", cookie);
		headers.set("Origin", base);
		headers.set("X-CSRF-Token", csrf);
		return centralFixtureFetch(input, { ...init, headers });
	}

	async function seed(name: string, directory?: string): Promise<string> {
		const projectRoot = join(root, name);
		const core = new Core(projectRoot);
		await initializeFilesystemTestProject(core, name, directory);
		await core.fs.saveTask({
			id: "TASK-1",
			title: `${name} task`,
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-21",
			rawContent: `${name} body`,
		});
		await core.fs.saveDraft({
			id: "DRAFT-1",
			title: `${name} draft`,
			status: "Draft",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-21",
		});
		await core.fs.createMilestone(`${name} milestone`);
		await core.fs.saveDocument({
			id: "doc-1",
			title: `${name} document`,
			type: "guide",
			createdDate: "2026-10-21",
			rawContent: `${name} document body`,
		});
		await core.fs.saveDecision({
			id: "decision-1",
			title: `${name} decision`,
			date: "2026-10-21",
			status: "proposed",
			context: name,
			decision: name,
			consequences: name,
			rawContent: `## Context\n${name}\n\n## Decision\n${name}\n\n## Consequences\n${name}`,
		});
		await mkdir(join(core.fs.backlogDir, "assets"), { recursive: true });
		await Bun.write(join(core.fs.backlogDir, "assets", "same.txt"), name);
		return projectRoot;
	}

	beforeEach(async () => {
		root = createUniqueTestDir("central-server");
		dataDir = join(root, "data");
		await new AuthStore(dataDir).initializeAdmin("admin", password);
		cookie = "";
		csrf = "";
		server = new CentralServer(dataDir);
		const port = await findNextAvailablePort(18000);
		if (!port) throw new Error("No test port available");
		base = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await server.stop();
		await safeCleanup(root);
	});

	it("starts with an empty selector and refuses corrupt databases", async () => {
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		expect((await request(`${base}/api/projects`)).status).toBe(200);
		expect(await (await request(`${base}/api/projects`)).json()).toEqual([]);
		expect((await request(`${base}/`, { redirect: "manual" })).headers.get("location")).toBe(`${base}/projects`);
		const html = await (await request(`${base}/projects`)).text();
		const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css)[^"]*)"/g)].map((match) => match[1]);
		expect(assets.length).toBeGreaterThan(0);
		for (const asset of assets) expect((await request(`${base}${asset}`)).status).toBe(200);
		expect((await request(`${base}/api/tasks`)).status).toBe(404);
		expect((await request(`${base}/api/version`)).status).toBe(200);
		expect(await Bun.file(join(dataDir, "server.sqlite")).exists()).toBe(true);
	});

	it("fails clearly when the requested port is occupied or the database is damaged", async () => {
		const occupied = Bun.serve({
			port: Number(new URL(base).port),
			hostname: "127.0.0.1",
			fetch: () => new Response("occupied"),
		});
		try {
			await expect(server.start(occupied.port, false, { publicUrl: base, allowHttpLoopback: true })).rejects.toThrow(
				`Port ${occupied.port} is already in use`,
			);
		} finally {
			await occupied.stop();
		}
		await mkdir(dataDir, { recursive: true });
		await Bun.write(join(dataDir, "server.sqlite"), "damaged");
		await expect(
			server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true }),
		).rejects.toThrow();
	});

	it("opens a browser only when requested", async () => {
		const launched = join(root, "browser-url");
		const executable = join(root, "browser.sh");
		await Bun.write(executable, `#!/bin/sh\nprintf '%s' "$1" > '${launched}'\n`);
		await chmod(executable, 0o755);
		const previous = process.env.BROWSER;
		process.env.BROWSER = executable;
		try {
			await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
			expect(await Bun.file(launched).exists()).toBe(false);
			await server.stop();
			const opened = new CentralServer(dataDir);
			try {
				await opened.start(Number(new URL(base).port), true, { publicUrl: base, allowHttpLoopback: true });
				expect(await Bun.file(launched).text()).toBe(`${base}/projects`);
			} finally {
				await opened.stop();
			}
		} finally {
			if (previous === undefined) delete process.env.BROWSER;
			else process.env.BROWSER = previous;
		}
	});

	it("routes matching IDs and assets only through registered project identities", async () => {
		const alpha = await seed("Alpha");
		const beta = await seed("Beta");
		const store = new ProjectStore(dataDir);
		await store.register("Shown Alpha", alpha);
		await store.register("Shown Beta", beta);
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });

		const observation = {
			state: "ready",
			error: null,
			checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
			lastSuccessfulScanAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
		};
		expect(await (await request(`${base}/api/projects`)).json()).toEqual([
			{ id: "1", name: "Shown Alpha", observation },
			{ id: "2", name: "Shown Beta", observation },
		]);
		expect(await (await request(`${base}/api/projects/1`)).json()).toEqual({
			id: "1",
			name: "Shown Alpha",
			permissions: ADMIN_PERMISSIONS,
			writeState: "ready",
			observation,
		});
		for (const [id, name] of [
			["1", "Alpha"],
			["2", "Beta"],
		] as const) {
			const taskResponse = await request(`${base}/api/projects/${id}/task/TASK-1`);
			expect(taskResponse.status, await taskResponse.clone().text()).toBe(200);
			const task = await taskResponse.json();
			expect(task.title).toBe(`${name} task`);
			const doc = await (await request(`${base}/api/projects/${id}/doc/doc-1`)).json();
			expect(doc.title).toBe(`${name} document`);
			const decision = await (await request(`${base}/api/projects/${id}/decision/decision-1`)).json();
			expect(decision.title).toBe(`${name} decision`);
			const drafts = await (await request(`${base}/api/projects/${id}/drafts`)).json();
			expect(drafts[0].title).toBe(`${name} draft`);
			const milestones = await (await request(`${base}/api/projects/${id}/milestones`)).json();
			expect(milestones[0].title).toBe(`${name} milestone`);
			const search = await (await request(`${base}/api/projects/${id}/search?query=${name}`)).json();
			expect(JSON.stringify(search)).toContain(`${name} task`);
			expect(JSON.stringify(search)).not.toContain(`${name === "Alpha" ? "Beta" : "Alpha"} task`);
			expect(await (await request(`${base}/api/projects/${id}/assets/same.txt`)).text()).toBe(name);
			expect((await request(`${base}/projects/${id}/board`)).status).toBe(200);
		}
		expect((await request(`${base}/api/projects/3/tasks`)).status).toBe(404);
		expect((await request(`${base}/projects/3/board`)).status).toBe(404);
		await rename(alpha, `${alpha}-missing`);
		expect((await request(`${base}/api/projects/1/tasks`)).status).toBe(503);
		expect((await request(`${base}/api/projects/1`)).status).toBe(503);
		expect((await request(`${base}/api/projects/2/tasks`)).status).toBe(200);
	});

	it("does not recreate a missing custom Backlog directory", async () => {
		const alpha = await seed("Alpha", "planning/records");
		await new ProjectStore(dataDir).register("Alpha", alpha);
		await rm(join(alpha, "planning", "records"), { recursive: true });
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		expect((await request(`${base}/api/projects/1/tasks`)).status).toBe(503);
		expect((await request(`${base}/projects/1/board`)).status).toBe(503);
		expect(await Bun.file(join(alpha, "planning", "records", "config.yml")).exists()).toBe(false);
	});

	it("merges approved settings and rejects server policy fields", async () => {
		const alpha = await seed("Alpha");
		const store = new ProjectStore(dataDir);
		await store.register("Shown Alpha", alpha);
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		const put = (body: unknown) =>
			request(`${base}/api/projects/1/config`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		expect((await put({ autoCommit: true })).status).toBe(400);
		expect((await put({ projectName: "Renamed" })).status).toBe(400);
		const response = await put({ hideEmptyColumns: true });
		expect(response.status, await response.clone().text()).toBe(200);
		expect((await response.json()).projectName).toBe("Shown Alpha");
		const config = await new Core(alpha).fs.loadConfig();
		expect(config?.hideEmptyColumns).toBe(true);
		expect(config?.projectName).toBe("Alpha");
	});

	it("keeps task writes and live notifications within one project and ignores configured commands", async () => {
		const alpha = await seed("Alpha");
		const beta = await seed("Beta");
		const store = new ProjectStore(dataDir);
		await store.register("Alpha", alpha);
		await store.register("Beta", beta);
		const source = new Core(alpha);
		const config = await source.fs.loadConfig();
		if (!config) throw new Error("Missing fixture config");
		const sentinel = join(root, "callback-ran");
		await source.fs.saveConfig({
			...config,
			autoCommit: true,
			remoteOperations: true,
			checkActiveBranches: true,
			onStatusChange: `touch ${sentinel}`,
		});
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });

		await authenticate();
		const messages: string[][] = [[], []];
		const sockets = [1, 2].map((id, index) => {
			const socket = new WebSocket(`${base.replace("http", "ws")}/api/projects/${id}/ws`, {
				headers: { Cookie: cookie, Origin: base },
			} as never);
			socket.addEventListener("message", (event) => messages[index]?.push(String(event.data)));
			return socket;
		});
		try {
			await Promise.all(
				sockets.map(
					(socket) =>
						new Promise<void>((resolve, reject) => {
							socket.addEventListener("open", () => resolve(), { once: true });
							socket.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
						}),
				),
			);
			await Bun.sleep(250);
			messages[0]?.splice(0);
			messages[1]?.splice(0);
			const response = await request(`${base}/api/projects/1/tasks/TASK-1`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Alpha changed", status: "Done" }),
			});
			expect(response.status).toBe(200);
			await Bun.sleep(300);
			expect((await (await request(`${base}/api/projects/1/task/TASK-1`)).json()).title).toBe("Alpha changed");
			expect((await (await request(`${base}/api/projects/2/task/TASK-1`)).json()).title).toBe("Beta task");
			expect(messages[0]).toContain("tasks-updated");
			expect(messages[1]).not.toContain("tasks-updated");
			expect(await Bun.file(sentinel).exists()).toBe(false);
		} finally {
			for (const socket of sockets) socket.close();
		}
	});

	it("keeps creation, editing, and archiving inside the selected project files", async () => {
		const alpha = await seed("Alpha");
		const beta = await seed("Beta");
		const store = new ProjectStore(dataDir);
		await store.register("Alpha", alpha);
		await store.register("Beta", beta);
		const snapshot = async () => {
			const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: beta, onlyFiles: true, dot: true }));
			return await Promise.all(paths.sort().map(async (path) => [path, await Bun.file(join(beta, path)).text()]));
		};
		const betaBefore = await snapshot();
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		expect(
			(
				await request(`${base}/api/projects/1/tasks`, {
					method: "POST",
					...json({ title: "Only Alpha" }),
				})
			).status,
		).toBe(201);
		expect(
			(
				await request(`${base}/api/projects/1/docs/doc-1`, {
					method: "PUT",
					...json({ content: "Changed only in Alpha" }),
				})
			).status,
		).toBe(200);
		expect((await request(`${base}/api/projects/1/decisions/decision-1/archive`, { method: "POST" })).status).toBe(200);
		expect((await request(`${base}/api/projects/1/tasks/TASK-1/archive`, { method: "POST" })).status).toBe(200);
		expect(await snapshot()).toEqual(betaBefore);
		expect((await (await request(`${base}/api/projects/2/task/TASK-1`)).json()).title).toBe("Beta task");
	});

	it("drains project contexts and can restart after concurrent stop calls", async () => {
		const alpha = await seed("Alpha");
		await new ProjectStore(dataDir).register("Alpha", alpha);
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		expect((await request(`${base}/api/projects/1/tasks`)).status).toBe(200);
		await Promise.all([server.stop(), server.stop()]);
		expect(server.getPort()).toBeNull();
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		expect((await request(`${base}/api/projects/1/tasks`)).status).toBe(200);
	});
});
