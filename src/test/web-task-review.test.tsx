import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { type AuthSession, DEFAULT_PERMISSIONS } from "../server/auth-types";
import type { Task } from "../types";
import type { TaskReviewEntry } from "../types/task-review";
import HistoryPanel from "../web/components/HistoryPanel";
import ProjectSelector from "../web/components/ProjectSelector";
import TaskReviewPanel from "../web/components/TaskReviewPanel";
import { AuthProvider } from "../web/contexts/AuthContext";
import { ThemeProvider } from "../web/contexts/ThemeContext";
import { UnsavedChangesProvider } from "../web/contexts/UnsavedChangesContext";
import { projectScope, readProjectScope, setProjectStorageAccount } from "../web/lib/project-scope";
import { setRequestSession } from "../web/lib/request";
import { setNativeInputValue } from "./react-dom-input";

const originalFetch = globalThis.fetch;
const originalScope = { ...projectScope };
let root: Root | null = null;
let dom: JSDOM | null = null;
const hash = "a".repeat(64);
const session: AuthSession = {
	user: {
		id: "reader",
		username: "reader",
		displayName: "Reader",
		role: "user",
		active: true,
		mustChangePassword: false,
	},
	csrfToken: "csrf",
	createdAt: "2026-10-23T00:00:00Z",
	expiresAt: "2026-10-23T12:00:00Z",
	lastActivityAt: "2026-10-23T00:00:00Z",
	idleExpiresAt: "2026-10-23T02:00:00Z",
};
const task: Task = {
	id: "TASK-1",
	title: "Work",
	status: "Done",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-10-23",
	recordKey: "record",
	revision: '"old"',
};
const entries: TaskReviewEntry[] = [
	{
		id: 1,
		kind: "request",
		type: "acceptance",
		reviewer: { userId: "reader", name: "reader" },
		reason: "Please accept",
		createdAt: "2026-10-23T00:00:00Z",
		contentHash: hash,
		author: { kind: "agent", userId: "writer", name: "writer", agentKeyId: "key" },
	},
	{
		id: 2,
		kind: "verification",
		result: "passed",
		notes: "Tests passed",
		evidence: ["report"],
		createdAt: "2026-10-23T00:01:00Z",
		contentHash: hash,
		author: { kind: "agent", userId: "writer", name: "writer", agentKeyId: "key" },
	},
];

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = null;
	dom?.window.close();
	dom = null;
	globalThis.fetch = originalFetch;
	Object.assign(projectScope, originalScope);
	setRequestSession(null);
	setProjectStorageAccount(null);
});

async function setup(
	options: {
		history?: boolean;
		stale?: boolean;
		trusted?: boolean;
		disabled?: boolean;
		conflict?: boolean;
		projects?: boolean;
		deferWrite?: boolean;
		reviewEntries?: TaskReviewEntry[];
		trustedEntryIds?: number[];
	} = {},
) {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: options.projects ? "http://localhost/projects" : "http://localhost/projects/1/tasks/TASK-1",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	globalThis.localStorage = dom.window.localStorage;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(projectScope, readProjectScope(window.location.pathname));
	const html = window.HTMLElement.prototype as unknown as { attachEvent: () => void; detachEvent: () => void };
	html.attachEvent = () => {};
	html.detachEvent = () => {};
	const writes: { headers: Headers; body: unknown }[] = [];
	const reads: string[] = [];
	let finishWrite: (value: Response) => void = () => {};
	globalThis.fetch = (async (input, init) => {
		const path = String(input);
		reads.push(path);
		if (path === "/api/projects") return Response.json([{ id: "1", name: "Alpha" }]);
		if (path === "/api/projects/registration") return Response.json({ allowed: false });
		if (path === "/api/me/reviews")
			return Response.json({
				projects: [
					{
						id: "1",
						name: "Alpha",
						openTasks: 2,
						nextDueDate: "2026-11-01",
						requests: [{ taskId: task.id, title: task.title, request: entries[0], stale: false }],
						observation: { state: "ready" },
					},
				],
			});
		if (path === "/api/auth/session") return Response.json(session);
		if (path === "/api/projects/1")
			return Response.json({
				permissions: { ...DEFAULT_PERMISSIONS, tasksWrite: false },
				observation: { state: "ready" },
			});
		if (path.endsWith("/reviewers")) return Response.json([{ userId: "reader", name: "reader" }]);
		if (path.endsWith("/reviews/respond")) {
			writes.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
			if (options.deferWrite)
				return new Promise<Response>((resolve) => {
					finishWrite = resolve;
				});
			return options.conflict
				? Response.json({ error: "Changed", code: "REVISION_CONFLICT" }, { status: 409 })
				: Response.json({ ...task, revision: '"new"' });
		}
		if (path.endsWith("/reviews"))
			return Response.json({
				entries: options.reviewEntries ?? entries,
				contentHash: hash,
				trustedEntryIds: options.trustedEntryIds ?? (options.trusted === false ? [1] : [1, 2]),
				staleEntryIds: options.stale ? [1, 2] : [],
				revision: task.revision,
			});
		if (path.includes("/history?"))
			return Response.json({
				items: [
					{
						eventId: path.includes("cursor=") ? "next-event" : "event",
						operationId: "operation",
						source: "external",
						actor: { kind: "unknown" },
						action: "external_file_change",
						occurredAt: null,
						detectedAt: "2026-10-23T10:00:00Z",
						changes: [
							{
								recordKey: "record",
								kind: "task",
								visibleId: "TASK-1",
								before: "Before",
								after: "After",
								beforeRevision: "a",
								afterRevision: "b",
							},
						],
					},
				],
				nextCursor: path.includes("cursor=") ? null : "1",
			});
		throw new Error(`Unexpected ${path}`);
	}) as typeof fetch;
	const container = document.getElementById("root");
	if (!container) throw new Error("Missing test root");
	root = createRoot(container);
	const render = async (value: Task = task) => {
		await act(async () => {
			root?.render(
				<MemoryRouter>
					<ThemeProvider>
						<UnsavedChangesProvider>
							<AuthProvider>
								{options.projects ? (
									<ProjectSelector />
								) : options.history ? (
									<HistoryPanel />
								) : (
									<TaskReviewPanel task={value} disabled={options.disabled ?? false} />
								)}
							</AuthProvider>
						</UnsavedChangesProvider>
					</ThemeProvider>
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	await render();
	return { writes, reads, render, finishWrite: () => finishWrite(Response.json({ ...task, revision: '"new"' })) };
}
async function click(text: string) {
	await act(async () => {
		const button = [...document.querySelectorAll("button")].find((button) => button.textContent === text);
		expect(button).toBeDefined();
		button?.click();
	});
}
async function notes(text: string) {
	await act(async () => {
		const field = document.querySelector<HTMLTextAreaElement>('textarea[name="review-notes"]');
		if (!field) throw new Error("Missing response field");
		setNativeInputValue(field, text);
	});
}

describe("review and history views", () => {
	it("does not report acceptance when an approved general request was changed in the file", async () => {
		await setup({
			reviewEntries: [
				...entries.filter((entry) => entry.kind === "request"),
				{
					id: 2,
					kind: "response",
					requestId: 1,
					outcome: "approved",
					notes: "General review approved",
					createdAt: "2026-10-23T00:01:00Z",
					contentHash: hash,
					author: { kind: "user", userId: "reader", name: "reader" },
				},
			],
			trustedEntryIds: [2],
		});
		expect(document.querySelector("dl")?.textContent).not.toContain("Accepted");
	});
	it("reports acceptance for an authenticated request, verification and response", async () => {
		await setup({
			reviewEntries: [
				...entries,
				{
					id: 3,
					kind: "response",
					requestId: 1,
					verificationId: 2,
					outcome: "approved",
					notes: "Accepted",
					createdAt: "2026-10-23T00:02:00Z",
					contentHash: hash,
					author: { kind: "user", userId: "reader", name: "reader" },
				},
			],
			trustedEntryIds: [1, 2, 3],
		});
		expect(document.querySelector("dl")?.textContent).toContain("Accepted · reader");
	});
	it("shows explicit assigned requests and project summaries on Projects", async () => {
		await setup({ projects: true });
		expect(document.body.textContent).toContain("Awaiting your response");
		expect(document.body.textContent).toContain("Please accept");
		expect(document.querySelector('a[href="/projects/1/tasks/TASK-1"]')?.textContent).toContain("Alpha");
		expect(document.body.textContent).toContain("Open tasks");
		expect(document.body.textContent).toContain("2026-11-01");
	});
	it("allows an assigned read-only reviewer to submit with their session and original revision", async () => {
		const { writes } = await setup();
		expect(document.body.textContent).not.toContain("Record verification");
		await click("Respond to #1");
		await notes("Accepted after reading the report");
		await click("Submit review record");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.headers.get("If-Match")).toBe('"old"');
		expect(writes[0]?.headers.get("X-CSRF-Token")).toBe("csrf");
		expect(writes[0]?.body).toMatchObject({ kind: "response", requestId: 1, outcome: "approved" });
	});
	it("keeps a draft and its old revision through background refresh and conflict", async () => {
		const { writes, render } = await setup({ conflict: true });
		await click("Respond to #1");
		await notes("Keep this response");
		await render({ ...task, revision: '"new"' });
		await click("Submit review record");
		expect(writes[0]?.headers.get("If-Match")).toBe('"old"');
		expect((document.querySelector('textarea[name="review-notes"]') as HTMLTextAreaElement).value).toBe(
			"Keep this response",
		);
		expect(document.body.textContent).toContain("Your draft is kept");
	});
	it("finishes its own save when a live refresh arrives before the HTTP response", async () => {
		const { render, finishWrite, writes } = await setup({ deferWrite: true });
		await click("Respond to #1");
		await notes("Accepted");
		await click("Submit review record");
		await render({ ...task, revision: '"new"' });
		await act(async () => {
			finishWrite();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(writes).toHaveLength(1);
		expect(document.querySelector('textarea[name="review-notes"]')).toBeNull();
	});
	it("blocks stale requests and unverified acceptance without granting task editing", async () => {
		await setup({ stale: true });
		expect(
			[...document.querySelectorAll("button")].find((button) => button.textContent === "Respond to #1")?.disabled,
		).toBe(true);
		expect(document.body.textContent).toContain("new request is required");
	});
	it("excludes verification invalidated by an external edit and revert from the current summary", async () => {
		await setup({ stale: true });
		const summary = document.querySelector("dl");
		expect(summary?.textContent).not.toContain("Passed");
		expect(summary?.textContent).toContain("Not recorded for current content");
		expect(document.querySelector("details")?.textContent).toContain("Verification: passed");
		expect(document.querySelector("details")?.textContent).toContain("Previous task content");
	});
	it("keeps acceptance disabled when verification is only a file declaration", async () => {
		await setup({ trusted: false });
		await click("Respond to #1");
		expect(
			[...document.querySelectorAll("button")].find((button) => button.textContent === "Submit review record")
				?.disabled,
		).toBe(true);
		expect(document.body.textContent).toContain("Declared identity");
	});
	it("blocks workflow writes while the parent task has unsaved edits", async () => {
		const { writes } = await setup({ disabled: true });
		await click("Respond to #1");
		expect(writes).toHaveLength(0);
		expect(
			[...document.querySelectorAll("button")].find((button) => button.textContent === "Respond to #1")?.disabled,
		).toBe(true);
	});
	it("shows unknown occurrence separately and forwards logical action filters and pagination", async () => {
		const { reads } = await setup({ history: true });
		expect(document.body.textContent).toContain("Occurred: unknown");
		expect(document.body.textContent).toContain("Detected:");
		await act(async () => {
			const select = [...document.querySelectorAll("label")]
				.find((label) => label.textContent?.startsWith("Action"))
				?.querySelector("select");
			if (!select) throw new Error("Missing action filter");
			select.value = "external";
			select.dispatchEvent(new window.Event("change", { bubbles: true }));
		});
		expect(reads.some((path) => path.includes("action=external"))).toBe(true);
		await click("Load more history");
		expect(reads.some((path) => path.includes("cursor=1"))).toBe(true);
	});
	it("converts Istanbul date filters to UTC without dropping seconds", async () => {
		const { reads } = await setup({ history: true });
		await act(async () => {
			const from = document.querySelector<HTMLInputElement>('input[type="datetime-local"]');
			if (!from) throw new Error("Missing from filter");
			setNativeInputValue(from, "2026-10-23T13:30:20");
		});
		expect(
			reads.some((path) => new URL(path, "http://localhost").searchParams.get("from") === "2026-10-23T10:30:20.000Z"),
		).toBe(true);
	});
});
