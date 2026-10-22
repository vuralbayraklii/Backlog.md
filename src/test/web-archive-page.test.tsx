import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ArchivePage from "../web/components/ArchivePage";
import { projectScope, readProjectScope } from "../web/lib/project-scope";
import { setRequestSession } from "../web/lib/request";

const originalFetch = globalThis.fetch;
const originalScope = { ...projectScope };
let root: Root | null = null;
let dom: JSDOM | null = null;
function setup() {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost/projects/1/archive",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(projectScope, readProjectScope(window.location.pathname));
	setRequestSession({
		user: {
			id: "archive-user",
			username: "archive-user",
			displayName: "Archive User",
			role: "admin",
			active: true,
			mustChangePassword: false,
		},
		csrfToken: "csrf-archive",
		createdAt: "2026-01-01T00:00:00Z",
		expiresAt: "2026-01-01T12:00:00Z",
		lastActivityAt: "2026-01-01T00:00:00Z",
		idleExpiresAt: "2026-01-01T02:00:00Z",
	});
	root = createRoot(document.getElementById("root")!);
}
async function click(text: string) {
	const button = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)!;
	await act(async () => {
		button.click();
	});
}
afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = null;
	dom?.window.close();
	dom = null;
	globalThis.fetch = originalFetch;
	Object.assign(projectScope, originalScope);
	setRequestSession({
		user: {
			id: "archive-cleanup",
			username: "archive-cleanup",
			displayName: "Cleanup",
			role: "admin",
			active: true,
			mustChangePassword: false,
		},
		csrfToken: "csrf-cleanup",
		createdAt: "2026-01-01T00:00:00Z",
		expiresAt: "2026-01-01T12:00:00Z",
		lastActivityAt: "2026-01-01T00:00:00Z",
		idleExpiresAt: "2026-01-01T02:00:00Z",
	});
	setRequestSession(null);
});

describe("project archive", () => {
	for (const [kind, id] of [
		["tasks", "TASK-1"],
		["docs", "doc-1"],
		["decisions", "decision-1"],
	]) {
		it(`restores ${kind} and confirms ${id} before one permanent delete`, async () => {
			setup();
			const requests: Array<{ path: string; method: string }> = [];
			globalThis.fetch = (async (input, options) => {
				const path = String(input);
				const method = options?.method ?? "GET";
				requests.push({ path, method });
				if (path.endsWith("/archived"))
					return Response.json([
						{ id, title: "Archived record", rawContent: "Archived text", recordKey: `key-${id}`, revision: "rev-1" },
					]);
				return Response.json({ success: true });
			}) as typeof fetch;
			let refreshes = 0;
			const render = async (key: number) => {
				await act(async () => {
					root?.render(
						<ArchivePage
							key={key}
							onRefreshData={async () => {
								refreshes++;
							}}
						/>,
					);
				});
				if (kind !== "tasks")
					await act(async () => {
						const select = document.querySelector("select")!;
						select.value = kind!;
						select.dispatchEvent(new window.Event("change", { bubbles: true }));
					});
			};
			await render(1);
			await click("Restore");
			expect(requests).toContainEqual({ path: `/api/projects/1/${kind}/${id}/restore`, method: "POST" });
			expect(refreshes).toBe(1);
			await render(2);
			let question = "";
			window.confirm = (message) => {
				question = message ?? "";
				return false;
			};
			await click("Delete permanently");
			expect(question).toContain(id!);
			expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
			window.confirm = () => true;
			await click("Delete permanently");
			expect(requests.filter((request) => request.method === "DELETE")).toEqual([
				{ path: `/api/projects/1/${kind}/${id}`, method: "DELETE" },
			]);
			expect(refreshes).toBe(2);
		});
	}

	it("keeps the first server failure and never retries deletion", async () => {
		setup();
		let deletes = 0;
		globalThis.fetch = (async (_input, options) => {
			if (options?.method === "DELETE") {
				deletes++;
				return Response.json({ error: "Existing subtasks block deletion" }, { status: 409 });
			}
			return Response.json([{ id: "TASK-1", title: "Parent task", recordKey: "key-1", revision: "rev-1" }]);
		}) as typeof fetch;
		window.confirm = () => true;
		await act(async () => {
			root?.render(<ArchivePage onRefreshData={async () => {}} />);
		});
		await click("Delete permanently");
		expect(deletes).toBe(1);
		expect(document.querySelector('[role="alert"]')?.textContent).toBe("Existing subtasks block deletion");
		expect(document.body.textContent).toContain("Parent task");
	});

	it("uses the durable result when an applied deletion returns 500", async () => {
		setup();
		let refreshes = 0;
		let deletes = 0;
		let lookups = 0;
		globalThis.fetch = (async (input, options) => {
			if (String(input).startsWith("/api/operations/")) {
				lookups++;
				return Response.json({
					state: "completed",
					result: { status: 200, body: { success: true }, headers: { "content-type": "application/json" } },
				});
			}
			if (options?.method === "DELETE") {
				deletes++;
				return Response.json({ error: "Deleted, commit failed", deleteState: "applied" }, { status: 500 });
			}
			return Response.json([{ id: "TASK-1", title: "Gone task", recordKey: "key-1", revision: "rev-1" }]);
		}) as typeof fetch;
		window.confirm = () => true;
		await act(async () => {
			root?.render(
				<ArchivePage
					onRefreshData={async () => {
						refreshes++;
					}}
				/>,
			);
		});
		await click("Delete permanently");
		expect(deletes).toBe(1);
		expect(lookups).toBe(1);
		expect(refreshes).toBe(1);
		expect(document.querySelector('[role="alert"]')).toBeNull();
		expect(document.body.textContent).not.toContain("Gone task");
	});
});
