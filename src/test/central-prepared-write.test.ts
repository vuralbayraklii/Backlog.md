import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Core } from "../core/backlog.ts";
import { AuthStore } from "../server/auth-store.ts";
import { CentralServer } from "../server/central.ts";
import { findNextAvailablePort } from "../server/index.ts";
import { recordRevision } from "../server/mutations.ts";
import { ProjectStore } from "../server/project-store.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("central prepared task write", () => {
	let root: string;
	let dataDir: string;
	let server: CentralServer;
	let base: string;
	let cookie: string;
	let csrf: string;
	const password = "prepared task password";

	const request = (path: string, init: RequestInit = {}) => {
		const headers = new Headers(init.headers);
		headers.set("Cookie", cookie);
		headers.set("Origin", base);
		headers.set("X-CSRF-Token", csrf);
		return fetch(`${base}${path}`, { ...init, headers });
	};

	beforeEach(async () => {
		root = createUniqueTestDir("central-prepared-task");
		dataDir = join(root, "data");
		const projectRoot = join(root, "project");
		const core = new Core(projectRoot);
		await initializeFilesystemTestProject(core, "Prepared Project");
		await core.fs.saveTask({
			id: "TASK-1",
			title: "Before",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
		});
		await core.fs.saveDraft({
			id: "DRAFT-1",
			title: "Prepared draft",
			status: "Draft",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
		});
		const linkedPath = await core.fs.saveTask({
			id: "TASK-3",
			title: "Linked",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
		});
		const linkedTarget = join(projectRoot, "linked-task.md");
		await writeFile(linkedTarget, await readFile(linkedPath));
		await unlink(linkedPath);
		await symlink(linkedTarget, linkedPath);
		await new ProjectStore(dataDir).register("Prepared", projectRoot);
		const secondRoot = join(root, "other-project");
		const secondCore = new Core(secondRoot);
		await initializeFilesystemTestProject(secondCore, "Other Project");
		await secondCore.fs.saveTask({
			id: "TASK-1",
			title: "Other project",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-22",
			milestone: "Old milestone",
		});
		await secondCore.fs.createMilestone("Old milestone");
		await new ProjectStore(dataDir).register("Other", secondRoot);
		const auth = new AuthStore(dataDir);
		await auth.initializeAdmin("admin", password);
		const login = await auth.login("admin", password);
		const changed = await auth.changePassword(login.token, password, `${password} changed`);
		cookie = `backlog_session=${changed.token}`;
		csrf = changed.session.csrfToken;
		server = new CentralServer(dataDir);
		const port = await findNextAvailablePort(30000);
		if (!port) throw new Error("No test port available");
		base = `http://127.0.0.1:${port}`;
		await server.start(port, false, { publicUrl: base, allowHttpLoopback: true });
	});

	afterEach(async () => {
		await server.stop();
		await safeCleanup(root);
	});

	it("returns a bound revision, commits once, and refuses a stale editor", async () => {
		const path = "/api/projects/1/tasks/TASK-1";
		const openedResponse = await request(path);
		expect(openedResponse.status).toBe(200);
		const opened = (await openedResponse.json()) as { recordKey: string; revision: string; title: string };
		expect(opened.recordKey).toBeTruthy();
		expect(openedResponse.headers.get("ETag")).toBe(opened.revision);
		expect(opened.title).toBe("Before");

		const write = (key: string, title: string) =>
			request(path, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": key,
					"If-Match": opened.revision,
				},
				body: JSON.stringify({ title }),
			});
		const key = "11111111-1111-4111-8111-111111111111";
		const updatedResponse = await write(key, "After");
		expect(updatedResponse.status).toBe(200);
		const updated = (await updatedResponse.json()) as { recordKey: string; revision: string; title: string };
		expect(updated.recordKey).toBe(opened.recordKey);
		expect(updated.revision).not.toBe(opened.revision);
		expect(updated.title).toBe("After");
		expect((await (await write(key, "After")).json()).title).toBe("After");

		const stale = await write("22222222-2222-4222-8222-222222222222", "Stale overwrite");
		expect(stale.status).toBe(409);
		expect((await stale.json()).code).toBe("REVISION_CONFLICT");
		expect((await (await request(path)).json()).title).toBe("After");
		const noOpKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		const noOp = await request(path, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": noOpKey,
				"If-Match": updated.revision,
			},
			body: JSON.stringify({ title: "After" }),
		});
		expect(noOp.status).toBe(200);
		const noOpBody = (await noOp.json()) as { recordKey: string; revision: string };
		expect(noOpBody.recordKey).toBe(updated.recordKey);
		expect(noOpBody.revision).toBe(updated.revision);
		const history = (await (await request("/api/projects/1/history")).json()) as {
			items: Array<{ operationId: string }>;
		};
		expect(history.items.filter((event) => event.operationId === key)).toHaveLength(1);
		expect(history.items.filter((event) => event.operationId === noOpKey)).toHaveLength(0);
	});

	it("prepares document and raw decision edits before their durable result", async () => {
		const createdDocumentResponse = await request("/api/projects/1/docs", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "33333333-3333-4333-8333-333333333333",
			},
			body: JSON.stringify({ title: "Guide", content: "# First" }),
		});
		expect(createdDocumentResponse.status).toBe(201);
		const createdDocument = (await createdDocumentResponse.json()) as {
			id: string;
			recordKey: string;
			revision: string;
		};
		expect(createdDocument.recordKey).toBeTruthy();
		expect(createdDocument.revision).toBe(createdDocumentResponse.headers.get("ETag") ?? "");
		const documentPath = `/api/projects/1/docs/${createdDocument.id}`;
		const updatedDocumentResponse = await request(documentPath, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "44444444-4444-4444-8444-444444444444",
				"If-Match": createdDocument.revision,
			},
			body: JSON.stringify({ title: "Updated Guide", content: "# Second" }),
		});
		expect(updatedDocumentResponse.status).toBe(200);
		const updatedDocument = (await updatedDocumentResponse.json()) as { recordKey: string; revision: string };
		expect(updatedDocument.recordKey).toBe(createdDocument.recordKey);
		expect(updatedDocument.revision).not.toBe(createdDocument.revision);

		const createdDecisionResponse = await request("/api/projects/1/decisions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "55555555-5555-4555-8555-555555555555",
			},
			body: JSON.stringify({ title: "Choose" }),
		});
		expect(createdDecisionResponse.status).toBe(201);
		const createdDecision = (await createdDecisionResponse.json()) as {
			id: string;
			recordKey: string;
			revision: string;
		};
		expect(createdDecision.recordKey).toBeTruthy();
		const decisionPath = `/api/projects/1/decisions/${createdDecision.id}`;
		const updatedDecisionResponse = await request(decisionPath, {
			method: "PUT",
			headers: {
				"Content-Type": "text/plain",
				"Idempotency-Key": "66666666-6666-4666-8666-666666666666",
				"If-Match": createdDecision.revision,
			},
			body: `---\nid: ${createdDecision.id}\ntitle: Choose\nstatus: proposed\ndate: 2026-10-22\n---\n## Context\nChanged\n\n## Decision\nYes\n\n## Consequences\nDone`,
		});
		expect(updatedDecisionResponse.status).toBe(200);
		expect(updatedDecisionResponse.headers.get("ETag")).toBeTruthy();
		const viewedDecision = (await (await request(decisionPath)).json()) as { context: string; recordKey: string };
		expect(viewedDecision.context).toBe("Changed");
		expect(viewedDecision.recordKey).toBe(createdDecision.recordKey);
	});

	it("keeps task identity through archive and restore", async () => {
		const path = "/api/projects/1/tasks/TASK-1";
		const opened = (await (await request(path)).json()) as { recordKey: string; revision: string };
		const archive = await request(`${path}/archive`, {
			method: "POST",
			headers: {
				"Idempotency-Key": "77777777-7777-4777-8777-777777777777",
				"If-Match": opened.revision,
			},
		});
		expect(archive.status).toBe(200);
		const archived = (await (await request(path)).json()) as {
			recordKey: string;
			revision: string;
			archived: boolean;
		};
		expect(archived.archived).toBe(true);
		expect(archived.recordKey).toBe(opened.recordKey);
		expect(archived.revision).not.toBe(opened.revision);

		const restore = await request(`${path}/restore`, {
			method: "POST",
			headers: {
				"Idempotency-Key": "88888888-8888-4888-8888-888888888888",
				"If-Match": archived.revision,
			},
		});
		expect(restore.status).toBe(200);
		const restored = (await (await request(path)).json()) as {
			recordKey: string;
			revision: string;
			archived?: boolean;
		};
		expect(restored.archived).toBeUndefined();
		expect(restored.recordKey).toBe(opened.recordKey);
		expect(restored.revision).toBe(opened.revision);
	});

	it("keeps identical visible task IDs separate across projects", async () => {
		const first = (await (await request("/api/projects/1/tasks/TASK-1")).json()) as {
			recordKey: string;
			revision: string;
		};
		const second = (await (await request("/api/projects/2/tasks/TASK-1")).json()) as {
			recordKey: string;
			title: string;
		};
		expect(second.title).toBe("Other project");
		expect(second.recordKey).not.toBe(first.recordKey);
		const write = await request("/api/projects/1/tasks/TASK-1", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "99999999-9999-4999-8999-999999999999",
				"If-Match": first.revision,
			},
			body: JSON.stringify({ title: "First only" }),
		});
		expect(write.status).toBe(200);
		expect((await (await request("/api/projects/2/tasks/TASK-1")).json()).title).toBe("Other project");
	});

	it("records a CLI-created file and preserves identity through a unique external move", async () => {
		const projectRoot = join(root, "project");
		const historyPath = "/api/projects/1/history";
		const beforeHistory = await (await request(historyPath)).json();
		const beforeSearch = await request("/api/projects/1/search?type=task");
		const beforeCollection = beforeSearch.headers.get("X-Backlog-Tasks-Revision");
		const child = Bun.spawn([process.execPath, getTestCliPath(), "task", "create", "Outside server", "--plain"], {
			cwd: projectRoot,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
		const local = (await new Core(projectRoot).fs.listTasks()).find((task) => task.title === "Outside server");
		if (!local?.filePath) throw new Error("CLI did not create the expected task file");
		type VersionedTask = { id: string; recordKey: string; revision: string };
		const readTask = async () => {
			for (let attempt = 0; attempt < 80; attempt += 1) {
				const response = await request("/api/projects/1/tasks");
				expect(response.status).toBe(200);
				const task = ((await response.json()) as VersionedTask[]).find((item) => item.id === local.id);
				if (task) return task;
				await Bun.sleep(25);
			}
			throw new Error("Watcher did not expose the CLI-created task");
		};
		const added = await readTask();
		expect(added.recordKey).toBeTruthy();
		expect(added.revision).toBe(
			recordRevision(added.recordKey, local.filePath, "active", await readFile(local.filePath)),
		);
		const afterSearch = await request("/api/projects/1/search?type=task");
		expect(afterSearch.status).toBe(200);
		expect(afterSearch.headers.get("X-Backlog-Tasks-Revision")).not.toBe(beforeCollection);
		const afterCreate = (await (await request(historyPath)).json()) as {
			items: Array<{ source: string; occurredAt: string | null; changes: Array<{ recordKey: string }> }>;
		};
		expect(afterCreate.items.filter((event) => event.source === "external")).toHaveLength(1);
		expect(afterCreate.items.find((event) => event.source === "external")?.occurredAt).toBeNull();
		expect(afterCreate.items.find((event) => event.source === "external")?.changes[0]?.recordKey).toBe(added.recordKey);

		const movedPath = join(
			dirname(local.filePath),
			`${basename(local.filePath).split(" - ")[0]} - Moved outside server.md`,
		);
		await rename(local.filePath, movedPath);
		let moved = added;
		for (let attempt = 0; attempt < 80 && moved.revision === added.revision; attempt += 1) {
			await Bun.sleep(25);
			moved = await readTask();
		}
		expect(moved.recordKey).toBe(added.recordKey);
		expect(moved.revision).toBe(recordRevision(moved.recordKey, movedPath, "active", await readFile(movedPath)));
		const afterMove = (await (await request(historyPath)).json()) as typeof afterCreate;
		expect(afterMove.items.filter((event) => event.source === "external")).toHaveLength(2);
		expect(afterMove.items.find((event) => event.source === "external")?.changes[0]?.recordKey).toBe(added.recordKey);

		await server.stop();
		server = new CentralServer(dataDir);
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		expect((await readTask()).recordKey).toBe(moved.recordKey);
		expect(await (await request(historyPath)).json()).toEqual(afterMove);
		expect(beforeHistory).not.toEqual(afterMove);
	});

	it("preserves one record key through draft promotion and task demotion", async () => {
		const drafts = (await (await request("/api/projects/1/drafts")).json()) as Array<{
			id: string;
			recordKey: string;
			revision: string;
		}>;
		const draft = drafts.find((item) => item.id === "DRAFT-1");
		if (!draft) throw new Error("Seed draft was not listed");
		expect(draft.recordKey).toBeTruthy();
		const promotion = await request("/api/projects/1/drafts/DRAFT-1/promote", {
			method: "POST",
			headers: {
				"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				"If-Match": draft.revision,
			},
		});
		expect(promotion.status).toBe(200);
		const taskList = (await (await request("/api/projects/1/tasks")).json()) as Array<{ id: string; title: string }>;
		const promotedId = taskList.find((task) => task.title === "Prepared draft")?.id;
		if (!promotedId) throw new Error("Promoted task was not listed");
		const promoted = (await (await request(`/api/projects/1/tasks/${promotedId}`)).json()) as {
			recordKey: string;
			revision: string;
		};
		expect(promoted.recordKey).toBe(draft.recordKey);

		const demotion = await request(`/api/projects/1/tasks/${promotedId}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				"If-Match": promoted.revision,
			},
			body: JSON.stringify({ status: "Draft" }),
		});
		expect(demotion.status).toBe(200);
		const demoted = (await demotion.json()) as { id: string; recordKey: string };
		expect(demoted.id).toMatch(/^DRAFT-/);
		expect(demoted.recordKey).toBe(draft.recordKey);
	});

	it("writes through an in-project task symlink without replacing the link", async () => {
		const path = "/api/projects/1/tasks/TASK-3";
		const opened = (await (await request(path)).json()) as { revision: string; recordKey: string };
		const updated = await request(path, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
				"If-Match": opened.revision,
			},
			body: JSON.stringify({ title: "Linked changed" }),
		});
		expect(updated.status).toBe(200);
		expect((await updated.json()).recordKey).toBe(opened.recordKey);
		const projectRoot = join(root, "project");
		const linkedPath = join(projectRoot, "backlog", "tasks", "task-3 - Linked.md");
		expect((await lstat(linkedPath)).isSymbolicLink()).toBe(true);
		expect(await readFile(join(projectRoot, "linked-task.md"), "utf8")).toContain("Linked changed");
	});

	it("denies decision-status replay after decisionsManage is revoked", async () => {
		const createdResponse = await request("/api/projects/1/decisions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
			},
			body: JSON.stringify({ title: "Controlled" }),
		});
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as { id: string };
		const memberPassword = "prepared member password";
		const auth = new AuthStore(dataDir);
		const userId = (await auth.createUser({ username: "member", password: memberPassword })).id;
		auth.setMember("1", userId, { decisionsWrite: true, decisionsManage: true });
		const login = await auth.login("member", memberPassword);
		const changed = await auth.changePassword(login.token, memberPassword, `${memberPassword} changed`);
		const memberCookie = `backlog_session=${changed.token}`;
		const memberCsrf = changed.session.csrfToken;
		const memberRequest = (path: string, init: RequestInit = {}) => {
			const headers = new Headers(init.headers);
			headers.set("Cookie", memberCookie);
			headers.set("Origin", base);
			headers.set("X-CSRF-Token", memberCsrf);
			return fetch(`${base}${path}`, { ...init, headers });
		};
		const path = `/api/projects/1/decisions/${created.id}`;
		const opened = (await (await memberRequest(path)).json()) as { revision: string };
		const operationId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
		const content = `---\nid: ${created.id}\ntitle: Controlled\nstatus: accepted\ndate: 2026-10-22\n---\n## Context\nApproved\n\n## Decision\nYes\n\n## Consequences\nDone`;
		const write = () =>
			memberRequest(path, {
				method: "PUT",
				headers: {
					"Content-Type": "text/plain",
					"Idempotency-Key": operationId,
					"If-Match": opened.revision,
				},
				body: content,
			});
		expect((await write()).status).toBe(200);
		auth.setMember("1", userId, { decisionsWrite: true, decisionsManage: false });
		const replay = await write();
		expect(replay.status).toBe(403);
		expect((await replay.text()).toLowerCase()).not.toContain("approved");
		const history = (await (await request("/api/projects/1/history")).json()) as {
			items: Array<{ operationId: string }>;
		};
		expect(history.items.filter((event) => event.operationId === operationId)).toHaveLength(1);
	});

	it("holds project reads until a physical write is finalized", async () => {
		await server.stop();
		let signalEntered = () => {};
		let release = () => {};
		const entered = new Promise<void>((resolve) => {
			signalEntered = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		server = new CentralServer(dataDir, {
			mutationCheckpoint: async (stage) => {
				if (stage === "before_finalize") {
					signalEntered();
					await held;
				}
			},
		});
		await server.start(Number(new URL(base).port), false, { publicUrl: base, allowHttpLoopback: true });
		const path = "/api/projects/1/tasks/TASK-1";
		const opened = (await (await request(path)).json()) as { revision: string };
		const write = request(path, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "abababab-abab-4bab-8bab-abababababab",
				"If-Match": opened.revision,
			},
			body: JSON.stringify({ title: "Finalized" }),
		});
		let read: Promise<Response> | undefined;
		try {
			await Promise.race([
				entered,
				write.then(() => {
					throw new Error("Write completed before the finalization checkpoint");
				}),
			]);
			read = request(path);
			const settledBeforeFinalize = await Promise.race([
				read.then(() => true),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 60)),
			]);
			expect(settledBeforeFinalize).toBe(false);
		} finally {
			release();
		}
		expect((await write).status).toBe(200);
		if (!read) throw new Error("Read did not start");
		const finalized = (await (await read).json()) as { title: string; revision: string };
		expect(finalized.title).toBe("Finalized");
		expect(finalized.revision).not.toBe(opened.revision);
	});

	it("keeps document and decision identity through archive, restore, and delete", async () => {
		for (const kind of ["docs", "decisions"] as const) {
			const collection = `/api/projects/1/${kind}`;
			const createdResponse = await request(collection, {
				method: "POST",
				headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
				body: JSON.stringify(kind === "docs" ? { title: "Lifecycle", content: "# Lifecycle" } : { title: "Lifecycle" }),
			});
			expect(createdResponse.status).toBe(201);
			const created = (await createdResponse.json()) as { id: string; recordKey: string; revision: string };
			const detail = `${collection}/${created.id}`;
			const mutate = (method: "POST" | "DELETE", suffix: string, revision: string) =>
				request(`${detail}${suffix}`, {
					method,
					headers: { "Idempotency-Key": randomUUID(), "If-Match": revision },
				});
			expect((await mutate("POST", "/archive", created.revision)).status).toBe(200);
			const archived = (await (await request(detail)).json()) as {
				recordKey: string;
				revision: string;
				archived: boolean;
			};
			expect(archived.archived).toBe(true);
			expect(archived.recordKey).toBe(created.recordKey);
			expect((await mutate("POST", "/restore", archived.revision)).status).toBe(200);
			const restored = (await (await request(detail)).json()) as { recordKey: string; revision: string };
			expect(restored.recordKey).toBe(created.recordKey);
			expect((await mutate("POST", "/archive", restored.revision)).status).toBe(200);
			const again = (await (await request(detail)).json()) as { revision: string };
			expect((await mutate("DELETE", "", again.revision)).status).toBe(200);
			expect((await request(detail)).status).toBe(404);
		}
	});

	it("prepares milestone rename and task cascade as one operation", async () => {
		const milestones = (await (await request("/api/projects/2/milestones")).json()) as Array<{
			id: string;
			recordKey: string;
			revision: string;
		}>;
		const source = milestones[0];
		if (!source) throw new Error("Seed milestone was not listed");
		const operationId = randomUUID();
		const updatedResponse = await request(`/api/projects/2/milestones/${source.id}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": operationId,
				"If-Match": source.revision,
			},
			body: JSON.stringify({ title: "New milestone", updateTasks: true }),
		});
		expect(updatedResponse.status).toBe(200);
		const updated = (await updatedResponse.json()) as {
			milestone: { id: string; title: string; recordKey: string; revision: string };
		};
		expect(updated.milestone.title).toBe("New milestone");
		expect(updated.milestone.recordKey).toBe(source.recordKey);
		expect(updatedResponse.headers.get("ETag")).toBe(updated.milestone.revision);
		expect((await (await request("/api/projects/2/tasks/TASK-1")).json()).milestone).toBe(source.id);
		const history = (await (await request("/api/projects/2/history")).json()) as {
			items: Array<{ operationId: string; changes: unknown[] }>;
		};
		expect(history.items.filter((event) => event.operationId === operationId)).toHaveLength(1);
		expect(history.items.find((event) => event.operationId === operationId)?.changes).toHaveLength(2);
		const removeId = randomUUID();
		const removedResponse = await request(`/api/projects/2/milestones/${source.id}`, {
			method: "DELETE",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": removeId,
				"If-Match": updated.milestone.revision,
			},
			body: JSON.stringify({ taskHandling: "clear" }),
		});
		expect(removedResponse.status).toBe(200);
		expect((await (await request("/api/projects/2/tasks/TASK-1")).json()).milestone).toBeUndefined();
		const archivedMilestones = (await (await request("/api/projects/2/milestones/archived")).json()) as Array<{
			id: string;
			recordKey: string;
		}>;
		expect(archivedMilestones.find((milestone) => milestone.id === source.id)?.recordKey).toBe(source.recordKey);
		const finalHistory = (await (await request("/api/projects/2/history")).json()) as {
			items: Array<{ operationId: string; changes: unknown[] }>;
		};
		expect(finalHistory.items.find((event) => event.operationId === removeId)?.changes).toHaveLength(2);
	});

	it("returns milestone create and archive revisions from prepared bytes", async () => {
		const createdResponse = await request("/api/projects/1/milestones", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
			body: JSON.stringify({ title: "Roadmap" }),
		});
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as { id: string; recordKey: string; revision: string };
		expect(created.recordKey).toBeTruthy();
		expect(createdResponse.headers.get("ETag")).toBe(created.revision);
		const path = `/api/projects/1/milestones/${created.id}`;
		const archivedResponse = await request(`${path}/archive`, {
			method: "POST",
			headers: { "Idempotency-Key": randomUUID(), "If-Match": created.revision },
		});
		expect(archivedResponse.status).toBe(200);
		const archived = (await archivedResponse.json()) as {
			milestone: { recordKey: string; revision: string };
		};
		expect(archived.milestone.recordKey).toBe(created.recordKey);
		expect(archived.milestone.revision).not.toBe(created.revision);
		expect(archivedResponse.headers.get("ETag")).toBe(archived.milestone.revision);
	});

	it("keeps config ETag current across successive prepared saves", async () => {
		const path = "/api/projects/1/config";
		const openedResponse = await request(path);
		expect(openedResponse.status).toBe(200);
		const opened = (await openedResponse.json()) as { recordKey: string; revision: string };
		expect(openedResponse.headers.get("ETag")).toBe(opened.revision);
		const save = (revision: string, hideEmptyColumns: boolean) =>
			request(path, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": randomUUID(),
					"If-Match": revision,
				},
				body: JSON.stringify({ hideEmptyColumns }),
			});
		const firstResponse = await save(opened.revision, true);
		expect(firstResponse.status).toBe(200);
		const first = (await firstResponse.json()) as { recordKey: string; revision: string };
		expect(first.recordKey).toBe(opened.recordKey);
		expect(firstResponse.headers.get("ETag")).toBe(first.revision);
		const secondResponse = await save(first.revision, false);
		expect(secondResponse.status).toBe(200);
		const second = (await secondResponse.json()) as { revision: string };
		expect(secondResponse.headers.get("ETag")).toBe(second.revision);
		expect(second.revision).not.toBe(first.revision);
	});

	it("returns versioned nested tasks and collection headers for bulk and reorder", async () => {
		const taskPath = (id: string) => `/api/projects/1/tasks/${id}`;
		const selected = await Promise.all(
			["TASK-1", "TASK-3"].map(
				async (id) =>
					(await (await request(taskPath(id))).json()) as { id: string; recordKey: string; revision: string },
			),
		);
		const expectedRevisions = Object.fromEntries(selected.map((task) => [task.recordKey, task.revision]));
		const movedResponse = await request("/api/projects/1/tasks/move", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
			body: JSON.stringify({ taskIds: selected.map((task) => task.id), targetStatus: "Done", expectedRevisions }),
		});
		expect(movedResponse.status).toBe(200);
		const moved = (await movedResponse.json()) as {
			tasks: Array<{ id: string; recordKey: string; revision: string }>;
			changedTasks: Array<{ id: string; recordKey: string; revision: string }>;
		};
		expect(moved.tasks).toHaveLength(2);
		expect(moved.changedTasks).toHaveLength(2);
		for (const task of [...moved.tasks, ...moved.changedTasks]) {
			expect(task.recordKey).toBeTruthy();
			expect(task.revision).toBeTruthy();
		}
		const movedCollection = movedResponse.headers.get("X-Backlog-Tasks-Revision");
		expect(movedCollection).toBeTruthy();
		const search = await request("/api/projects/1/search");
		expect(search.headers.get("X-Backlog-Tasks-Revision")).toBe(movedCollection ?? "");
		const currentRevisions = Object.fromEntries(moved.tasks.map((task) => [task.recordKey, task.revision]));
		const reorderedResponse = await request("/api/projects/1/tasks/reorder", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": randomUUID(),
				"If-Match": movedCollection ?? "",
			},
			body: JSON.stringify({
				taskId: "TASK-1",
				targetStatus: "Done",
				orderedTaskIds: ["TASK-3", "TASK-1"],
				expectedRevisions: currentRevisions,
			}),
		});
		expect(reorderedResponse.status).toBe(200);
		const reordered = (await reorderedResponse.json()) as {
			task: { recordKey: string; revision: string };
			changedTasks: Array<{ recordKey: string; revision: string }>;
		};
		expect(reordered.task.recordKey).toBeTruthy();
		expect(reordered.task.revision).toBeTruthy();
		expect(reordered.changedTasks.every((task) => !!task.recordKey && !!task.revision)).toBe(true);
		expect(reorderedResponse.headers.get("X-Backlog-Tasks-Revision")).toBeTruthy();
	});

	it("keeps bulk partial success and versions the task that moved", async () => {
		const selected = (await (await request("/api/projects/1/tasks/TASK-1")).json()) as {
			recordKey: string;
			revision: string;
		};
		const response = await request("/api/projects/1/tasks/move", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
			body: JSON.stringify({
				taskIds: ["TASK-1", "TASK-999"],
				targetStatus: "Done",
				expectedRevisions: { [selected.recordKey]: selected.revision },
			}),
		});
		expect(response.status).toBe(200);
		const result = (await response.json()) as {
			success: boolean;
			tasks: Array<{ id: string; recordKey: string; revision: string }>;
			failures: Array<{ taskId: string }>;
		};
		expect(result.success).toBe(false);
		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0]?.recordKey).toBe(selected.recordKey);
		expect(result.tasks[0]?.revision).not.toBe(selected.revision);
		expect(result.failures).toMatchObject([{ taskId: "TASK-999" }]);
	});

	it("rejects a stale cleanup fingerprint before archiving selected tasks", async () => {
		const taskPath = "/api/projects/1/tasks/TASK-1";
		const opened = (await (await request(taskPath)).json()) as { revision: string };
		const edit = (revision: string, body: Record<string, unknown>) =>
			request(taskPath, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": randomUUID(),
					"If-Match": revision,
				},
				body: JSON.stringify(body),
			});
		const completed = (await (await edit(opened.revision, { status: "Done" })).json()) as { revision: string };
		const preview = (await (await request("/api/projects/1/tasks/cleanup?age=0")).json()) as {
			tasks: Array<{ id: string }>;
			fingerprint: string;
		};
		expect(preview.tasks.map((task) => task.id)).toContain("TASK-1");
		expect(preview.fingerprint).toBeTruthy();
		await edit(completed.revision, { title: "Changed after preview" });
		const execute = (fingerprint: string) =>
			request("/api/projects/1/tasks/cleanup/execute", {
				method: "POST",
				headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
				body: JSON.stringify({ taskIds: preview.tasks.map((task) => task.id), fingerprint }),
			});
		const stale = await execute(preview.fingerprint);
		expect(stale.status).toBe(409);
		expect((await stale.json()).code).toBe("REVISION_CONFLICT");
		expect((await (await request(taskPath)).json()).archived).toBeUndefined();
		const fresh = (await (await request("/api/projects/1/tasks/cleanup?age=0")).json()) as { fingerprint: string };
		const applied = await execute(fresh.fingerprint);
		expect(applied.status).toBe(200);
		expect((await applied.json()).movedCount).toBe(1);
		expect((await (await request(taskPath)).json()).archived).toBe(true);
	});

	it("archives two previewed tasks in one cleanup operation", async () => {
		for (const id of ["TASK-1", "TASK-3"]) {
			const path = `/api/projects/1/tasks/${id}`;
			const opened = (await (await request(path)).json()) as { revision: string };
			const changed = await request(path, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": randomUUID(),
					"If-Match": opened.revision,
				},
				body: JSON.stringify({ status: "Done" }),
			});
			expect(changed.status).toBe(200);
		}
		const preview = (await (await request("/api/projects/1/tasks/cleanup?age=0")).json()) as {
			tasks: Array<{ id: string }>;
			fingerprint: string;
		};
		expect(preview.tasks).toHaveLength(2);
		const operationId = randomUUID();
		const resultResponse = await request("/api/projects/1/tasks/cleanup/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Idempotency-Key": operationId },
			body: JSON.stringify({ taskIds: preview.tasks.map((task) => task.id), fingerprint: preview.fingerprint }),
		});
		expect(resultResponse.status).toBe(200);
		const result = (await resultResponse.json()) as { movedCount: number; failedTasks?: string[] };
		expect(result.movedCount).toBe(2);
		expect(result.failedTasks).toBeUndefined();
		for (const id of ["TASK-1", "TASK-3"]) {
			expect((await (await request(`/api/projects/1/tasks/${id}`)).json()).archived).toBe(true);
		}
		const history = (await (await request("/api/projects/1/history")).json()) as {
			items: Array<{ operationId: string; changes: unknown[] }>;
		};
		expect(history.items.find((event) => event.operationId === operationId)?.changes).toHaveLength(2);
	});

	it("abandons a staged milestone rename when a task cascade lock fails", async () => {
		const source = (
			(await (await request("/api/projects/2/milestones")).json()) as Array<{
				id: string;
				revision: string;
			}>
		)[0];
		if (!source) throw new Error("Seed milestone was not listed");
		const external = new Core(join(root, "other-project"), { serverMode: true });
		const task = await external.fs.loadTask("TASK-1");
		if (!task) throw new Error("Seed task was not found");
		const operationId = randomUUID();
		const failed = await external.fs.withTaskLock(task, () =>
			request(`/api/projects/2/milestones/${source.id}`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": operationId,
					"If-Match": source.revision,
				},
				body: JSON.stringify({ title: "Should not land", updateTasks: true }),
			}),
		);
		expect(failed.status).toBe(500);
		expect((await failed.text()).toLowerCase()).not.toContain("rollback");
		expect(((await (await request("/api/projects/2/milestones")).json()) as Array<{ title: string }>)[0]?.title).toBe(
			"Old milestone",
		);
		expect((await (await request("/api/projects/2/tasks/TASK-1")).json()).milestone).toBe("Old milestone");
		const history = (await (await request("/api/projects/2/history")).json()) as {
			items: Array<{ operationId: string }>;
		};
		expect(history.items.filter((event) => event.operationId === operationId)).toHaveLength(0);
	});
});
