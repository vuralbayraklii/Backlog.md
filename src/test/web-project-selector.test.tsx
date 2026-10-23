import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AuthSession } from "../server/auth-types";
import type { ProjectObservation } from "../web/components/ObservationStatus";
import ProjectSelector from "../web/components/ProjectSelector.tsx";
import { AuthProvider } from "../web/contexts/AuthContext";
import { ThemeProvider } from "../web/contexts/ThemeContext";
import { UnsavedChangesProvider } from "../web/contexts/UnsavedChangesContext";
import { projectStorageKey, readProjectScope, setProjectStorageAccount } from "../web/lib/project-scope.ts";
import { setRequestSession } from "../web/lib/request";

let root: Root | null = null;
let dom: JSDOM | null = null;
const originalFetch = globalThis.fetch;

async function renderSelector(projects: Array<{ id: string; name: string; observation?: ProjectObservation }>) {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost/projects",
	});
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	globalThis.fetch = (async (input) => {
		expect(String(input)).toBe("/api/projects");
		return Response.json(projects);
	}) as typeof fetch;
	const container = document.getElementById("root");
	if (!container) throw new Error("Project selector root missing");
	root = createRoot(container);
	await act(async () => {
		root?.render(
			<ThemeProvider>
				<ProjectSelector />
			</ThemeProvider>,
		);
		await Promise.resolve();
	});
	return document;
}

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = null;
	dom?.window.close();
	dom = null;
	globalThis.fetch = originalFetch;
	setRequestSession({
		user: {
			id: "cleanup",
			username: "cleanup",
			displayName: "Cleanup",
			role: "admin",
			active: true,
			mustChangePassword: false,
		},
		csrfToken: "cleanup",
		createdAt: "2026-01-01T00:00:00Z",
		expiresAt: "2026-01-01T12:00:00Z",
		lastActivityAt: "2026-01-01T00:00:00Z",
		idleExpiresAt: "2026-01-01T02:00:00Z",
	});
	setRequestSession(null);
	setProjectStorageAccount(null);
});

describe("project selector", () => {
	it("shows registered names and IDs as full-page project links", async () => {
		const document = await renderSelector([
			{ id: "1", name: "Alpha" },
			{ id: "2", name: "Beta" },
		]);
		expect(
			[...document.querySelectorAll("a")].map((link) => [link.textContent?.trim(), link.getAttribute("href")]),
		).toEqual([
			["Alpha1", "/projects/1/board"],
			["Beta2", "/projects/2/board"],
		]);
	});

	it("shows last successful scans and a degraded project error without calling it current", async () => {
		const document = await renderSelector([
			{
				id: "1",
				name: "Alpha",
				observation: {
					state: "ready",
					lastSuccessfulScanAt: "2026-01-01T00:00:00.000Z",
					checkedAt: "2026-01-01T00:00:00.000Z",
					error: null,
				},
			},
			{
				id: "2",
				name: "Beta",
				observation: {
					state: "degraded",
					lastSuccessfulScanAt: "2026-01-01T00:00:00.000Z",
					checkedAt: "2026-01-02T00:00:00.000Z",
					error: "Task file is unreadable.",
				},
			},
		]);
		const alpha = document.querySelector('a[href="/projects/1/board"]');
		const beta = document.querySelector('a[href="/projects/2/board"]');
		expect(alpha?.textContent).toContain("Project files checked");
		expect(alpha?.textContent).toContain("(Istanbul)");
		expect(beta?.textContent).toContain("Project file check needs attention");
		expect(beta?.textContent).toContain("Writes are paused.");
		expect(beta?.textContent).toContain("Last successful scan:");
		expect(beta?.textContent).toContain("Task file is unreadable.");
		expect(beta?.textContent).not.toContain("Project files checked");
	});

	it("refreshes project file-check state when the Projects page regains focus", async () => {
		dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
			url: "http://localhost/projects",
			pretendToBeVisual: true,
		});
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.window = dom.window as unknown as Window & typeof globalThis;
		globalThis.document = dom.window.document as Document;
		globalThis.navigator = dom.window.navigator as Navigator;
		const session: AuthSession = {
			user: {
				id: "admin",
				username: "admin",
				displayName: "Admin",
				role: "admin",
				active: true,
				mustChangePassword: false,
			},
			csrfToken: "csrf-admin",
			createdAt: "2026-01-01T00:00:00Z",
			expiresAt: "2026-01-01T12:00:00Z",
			lastActivityAt: "2026-01-01T00:00:00Z",
			idleExpiresAt: "2026-01-01T02:00:00Z",
		};
		let state: ProjectObservation["state"] = "degraded";
		let projectReads = 0;
		let releaseOld: (() => void) | null = null;
		const projectResponse = (current: ProjectObservation["state"]) =>
			Response.json([
				{
					id: "1",
					name: "Alpha",
					observation: {
						state: current,
						lastSuccessfulScanAt: null,
						checkedAt: null,
						error: current === "degraded" ? "Unreadable task" : null,
					},
				},
			]);
		globalThis.fetch = (async (input) => {
			const path = String(input);
			if (path === "/api/auth/session") return Response.json(session);
			if (path === "/api/projects/registration") return Response.json({ allowed: false, areas: [] });
			if (path === "/api/projects") {
				projectReads++;
				if (projectReads === 2)
					return new Promise<Response>((resolve) => {
						releaseOld = () => resolve(projectResponse("degraded"));
					});
				return projectResponse(state);
			}
			if (path === "/api/version") return Response.json({ version: "1.53.0" });
			throw new Error(path);
		}) as typeof fetch;
		root = createRoot(document.getElementById("root") as HTMLElement);
		await act(async () => {
			root?.render(
				<UnsavedChangesProvider>
					<ThemeProvider>
						<AuthProvider>
							<ProjectSelector />
						</AuthProvider>
					</ThemeProvider>
				</UnsavedChangesProvider>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(document.body.textContent).toContain("Project file check needs attention");
		state = "ready";
		await act(async () => window.dispatchEvent(new window.Event("focus")));
		await act(async () => window.dispatchEvent(new window.Event("focus")));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(projectReads).toBeGreaterThanOrEqual(3);
		expect(document.body.textContent).toContain("Project files checked");
		expect(document.body.textContent).not.toContain("Unreadable task");
		const release = releaseOld as (() => void) | null;
		if (!release) throw new Error("Older project response was not held");
		await act(async () => release());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(document.body.textContent).toContain("Project files checked");
	});

	it("points an empty selector to the CLI registration command", async () => {
		const document = await renderSelector([]);
		expect(document.body.textContent).toContain("backlog server --data-dir");
		expect(document.querySelector("a")).toBeNull();
	});
});

describe("immutable project path scope", () => {
	it("derives API and route bases from the URL rather than a task project field", () => {
		expect(readProjectScope("/projects/12/tasks/TASK-1")).toEqual({
			id: "12",
			routeBase: "/projects/12",
			apiBase: "/api/projects/12",
		});
		expect(readProjectScope("/projects").id).toBeNull();
		expect(readProjectScope("/projects/0/board").id).toBeNull();
		expect(projectStorageKey("docsFolderExpanded", readProjectScope("/projects/12/board"))).toBe(
			"backlog.md:project:12:docsFolderExpanded",
		);
	});
});
