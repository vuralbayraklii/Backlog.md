import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ProjectSelector from "../web/components/ProjectSelector.tsx";
import { ThemeProvider } from "../web/contexts/ThemeContext";
import { projectStorageKey, readProjectScope } from "../web/lib/project-scope.ts";

let root: Root | null = null;
let dom: JSDOM | null = null;
const originalFetch = globalThis.fetch;

async function renderSelector(projects: Array<{ id: string; name: string }>) {
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
	root = createRoot(document.getElementById("root")!);
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
