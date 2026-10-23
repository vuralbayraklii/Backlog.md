import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { ProjectStore } from "../server/project-store.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("central observed HTTP publication", () => {
	let temporary: string;
	let taskPath: string;
	let server: CentralServer;
	let base: string;
	let cookie: string;
	let csrf: string;
	let data: string;

	beforeEach(async () => {
		temporary = createUniqueTestDir("central-observation-http");
		data = join(temporary, "data");
		const root = join(temporary, "project");
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Observed Project");
		taskPath = await core.fs.saveTask({
			id: "TASK-1",
			title: "Before",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-23",
		});
		await new ProjectStore(data).register("Observed Project", root);
		const auth = new AuthStore(data);
		await auth.initializeAdmin("admin", "observed password");
		const login = await auth.login("admin", "observed password");
		const changed = await auth.changePassword(login.token, "observed password", "observed password changed");
		cookie = `backlog_session=${changed.token}`;
		csrf = changed.session.csrfToken;
		server = new CentralServer(data);
		const port = await findNextAvailablePort(30000);
		if (!port) throw new Error("No localhost test port available");
		base = `http://127.0.0.1:${port}`;
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
	});

	afterEach(async () => {
		await server.stop();
		await safeCleanup(temporary);
	});

	function request(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set("Cookie", cookie);
		headers.set("Origin", base);
		headers.set("X-CSRF-Token", csrf);
		return fetch(`${base}${path}`, { ...init, headers });
	}

	it("hydrates trusted lists and search after restarting with an invalid file", async () => {
		const { recordKey, revision } = (await (await request("/api/projects/1/tasks/TASK-1")).json()) as {
			recordKey: string;
			revision: string;
		};
		const first = { recordKey, revision };
		await writeFile(taskPath, "---\nid: TASK-1\ntitle: [unfinished\n---\n");
		for (let restart = 0; restart < 2; restart++) {
			await server.stop();
			server = new CentralServer(data);
			await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
			const detail = await request("/api/projects/1");
			expect(((await detail.json()) as { observation: { state: string } }).observation.state).toBe("degraded");
			const list = await request("/api/projects/1/tasks");
			expect(list.status).toBe(200);
			expect(await list.json()).toEqual([expect.objectContaining({ id: "TASK-1", title: "Before", ...first })]);
			const search = await request("/api/projects/1/search?query=Before&type=task");
			expect(search.status).toBe(200);
			expect(await search.json()).toEqual([
				expect.objectContaining({ type: "task", task: expect.objectContaining({ title: "Before", ...first }) }),
			]);
			expect((await request("/api/projects/1/tasks/TASK-1")).status).toBe(503);
			const write = await request("/api/projects/1/tasks/TASK-1", {
				method: "PUT",
				headers: { "Content-Type": "application/json", "If-Match": first.revision, "Idempotency-Key": randomUUID() },
				body: JSON.stringify({ title: "Blocked" }),
			});
			expect(write.status).toBe(503);
		}
	});

	it("durably observes external edits, keeps safe lists on damage, resumes writes, and ignores self echo", async () => {
		const taskUrl = "/api/projects/1/tasks/TASK-1";
		const firstResponse = await request(taskUrl);
		expect(firstResponse.status).toBe(200);
		const first = (await firstResponse.json()) as { recordKey: string; revision: string; title: string };
		expect(first.title).toBe("Before");
		let externalHistory = (await (await request("/api/projects/1/history")).json()) as {
			items: Array<{ source: string }>;
		};
		expect(externalHistory.items.filter((event) => event.source === "external")).toHaveLength(0);

		const oldText = await readFile(taskPath, "utf8");
		await writeFile(taskPath, oldText.replace("title: Before", "title: Edited outside"));
		const updatedResponse = await request(taskUrl);
		expect(updatedResponse.status).toBe(200);
		const updated = (await updatedResponse.json()) as typeof first;
		expect(updated.title).toBe("Edited outside");
		expect(updated.recordKey).toBe(first.recordKey);
		expect(updated.revision).not.toBe(first.revision);
		externalHistory = (await (await request("/api/projects/1/history")).json()) as typeof externalHistory;
		expect(externalHistory.items.filter((event) => event.source === "external")).toHaveLength(1);

		await writeFile(taskPath, "---\nid: TASK-1\ntitle: [unfinished\n---\n");
		const detail = await request("/api/projects/1");
		expect(detail.status).toBe(200);
		expect(((await detail.json()) as { observation: { state: string } }).observation.state).toBe("degraded");
		const safeList = await request("/api/projects/1/tasks");
		expect(safeList.status).toBe(200);
		expect(JSON.stringify(await safeList.json())).toContain("Edited outside");
		expect((await request(taskUrl)).status).toBe(503);
		const refused = await request(taskUrl, {
			method: "PUT",
			headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), "If-Match": updated.revision },
			body: JSON.stringify({ title: "Blocked" }),
		});
		expect(refused.status).toBe(503);
		expect(((await refused.json()) as { code: string }).code).toBe("OBSERVATION_UNAVAILABLE");

		await writeFile(taskPath, oldText.replace("title: Before", "title: Edited outside"));
		const ready = await request("/api/projects/1");
		expect(((await ready.json()) as { observation: { state: string } }).observation.state).toBe("ready");
		const write = await request(taskUrl, {
			method: "PUT",
			headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), "If-Match": updated.revision },
			body: JSON.stringify({ title: "Managed" }),
		});
		expect(write.status).toBe(200);
		await request(taskUrl);
		externalHistory = (await (await request("/api/projects/1/history")).json()) as typeof externalHistory;
		expect(externalHistory.items.filter((event) => event.source === "external")).toHaveLength(1);
	});
});
