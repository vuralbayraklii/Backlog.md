import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DocumentationDetail from "../web/components/DocumentationDetail";
import DecisionDetail from "../web/components/DecisionDetail";
import { ThemeProvider } from "../web/contexts/ThemeContext";
import type { Document as BacklogDocument, Decision } from "../types";
import { ADMIN_PERMISSIONS, type AuthSession } from "../server/auth-types";
import { AuthProvider, useAuth } from "../web/contexts/AuthContext";
import {
	projectScope,
	projectStorageKey,
	readProjectScope,
	scopeMarkdownUrl,
	setProjectStorageAccount,
} from "../web/lib/project-scope";
import { sessionFetch, setRequestSession } from "../web/lib/request";
import { setNativeInputValue } from "./react-dom-input";

const originalFetch = globalThis.fetch;
const originalBrowserGlobals = {
	HTMLElement: globalThis.HTMLElement,
	HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
	HTMLInputElement: globalThis.HTMLInputElement,
	Element: globalThis.Element,
	requestAnimationFrame: globalThis.requestAnimationFrame,
	cancelAnimationFrame: globalThis.cancelAnimationFrame,
	localStorage: globalThis.localStorage,
};
const originalScope = { ...projectScope };
let root: Root | null = null;
let dom: JSDOM | null = null;
const userSession = (id = "user-1", mustChangePassword = false): AuthSession => ({
	user: { id, username: id, displayName: id, role: "user", active: true, mustChangePassword },
	csrfToken: `csrf-${id}`,
	createdAt: "2026-01-01T00:00:00Z",
	expiresAt: "2026-01-01T12:00:00Z",
	lastActivityAt: "2026-01-01T00:00:00Z",
	idleExpiresAt: "2026-01-01T02:00:00Z",
});
function setup() {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost/projects/1/board",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	globalThis.localStorage = dom.window.localStorage;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
	globalThis.HTMLInputElement = dom.window.HTMLInputElement;
	globalThis.Element = dom.window.Element;
	globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
	globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
	Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
	Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(projectScope, readProjectScope(window.location.pathname));
	root = createRoot(document.getElementById("root")!);
	return dom;
}
async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}
async function submitLogin() {
	await act(async () => {
		setNativeInputValue(document.querySelector<HTMLInputElement>('input[name="username"]')!, "same-user");
		setNativeInputValue(document.querySelector<HTMLInputElement>('input[name="password"]')!, "  password spaces  ");
	});
	await act(async () => {
		document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
	await flush();
}
afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = null;
	dom?.window.close();
	dom = null;
	globalThis.fetch = originalFetch;
	Object.assign(globalThis, originalBrowserGlobals);
	Object.assign(projectScope, originalScope);
	setRequestSession(null);
	setProjectStorageAccount(null);
});

describe("central browser session", () => {
	it("waits for project permissions before mounting project content", async () => {
		setup();
		let mounts = 0;
		let resolvePermissions!: (response: Response) => void;
		globalThis.fetch = (async (input) => {
			if (String(input) === "/api/auth/session") return Response.json(userSession());
			if (String(input) === "/api/projects/1")
				return new Promise<Response>((resolve) => {
					resolvePermissions = resolve;
				});
			throw new Error(String(input));
		}) as typeof fetch;
		function Project() {
			useEffect(() => {
				mounts++;
			}, []);
			return <p>Project data</p>;
		}
		await act(async () => {
			root?.render(
				<AuthProvider>
					<Project />
				</AuthProvider>,
			);
		});
		expect(mounts).toBe(0);
		await act(async () => {
			resolvePermissions(Response.json({ permissions: ADMIN_PERMISSIONS }));
		});
		expect(mounts).toBe(1);
	});

	for (const sameAccount of [true, false]) {
		it(`${sameAccount ? "preserves" : "clears"} unsaved text after ${sameAccount ? "same" : "different"}-account login`, async () => {
			setup();
			let expired = false;
			let next = userSession();
			let mounts = 0;
			const calls: Array<{ path: string; options?: RequestInit }> = [];
			globalThis.fetch = (async (input, options) => {
				const path = String(input);
				calls.push({ path, options });
				if (path === "/api/auth/login") {
					expired = false;
					return Response.json(next);
				}
				if (path === "/api/auth/session")
					return expired ? Response.json({ error: "Login required" }, { status: 401 }) : Response.json(userSession());
				if (path === "/expire") return Response.json({ error: "Login required" }, { status: 401 });
				if (path === "/api/projects/1") return Response.json({ permissions: ADMIN_PERMISSIONS });
				throw new Error(path);
			}) as typeof fetch;
			function Editor() {
				const [text, setText] = useState("");
				const { ready } = useAuth();
				useEffect(() => {
					mounts++;
				}, []);
				return (
					<textarea
						aria-label="Draft text"
						value={text}
						disabled={!ready}
						onChange={(event) => setText(event.target.value)}
					/>
				);
			}
			await act(async () => {
				root?.render(
					<AuthProvider>
						<Editor />
					</AuthProvider>,
				);
			});
			await flush();
			await act(async () => {
				setNativeInputValue(document.querySelector("textarea")!, "unsaved in memory");
			});
			expired = true;
			next = userSession(sameAccount ? "user-1" : "user-2");
			await act(async () => {
				await sessionFetch("/expire");
			});
			expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("unsaved in memory");
			expect(document.querySelector<HTMLDivElement>("[hidden]")).not.toBeNull();
			await submitLogin();
			expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
				sameAccount ? "unsaved in memory" : "",
			);
			expect(mounts).toBe(sameAccount ? 1 : 2);
			const login = calls.find((call) => call.path === "/api/auth/login")!;
			expect(JSON.parse(login.options?.body as string).password).toBe("  password spaces  ");
			expect(new Headers(login.options?.headers).has("X-CSRF-Token")).toBe(false);
		});
	}

	it("blocks project content until mandatory password change and sends session CSRF", async () => {
		setup();
		let projectReads = 0;
		let passwordOptions: RequestInit | undefined;
		globalThis.fetch = (async (input, options) => {
			if (String(input) === "/api/auth/session") return Response.json(userSession("user-1", true));
			if (String(input) === "/api/auth/password") {
				passwordOptions = options;
				return Response.json(userSession());
			}
			if (String(input) === "/api/projects/1") {
				projectReads++;
				return Response.json({ permissions: ADMIN_PERMISSIONS });
			}
			throw new Error(String(input));
		}) as typeof fetch;
		await act(async () => {
			root?.render(
				<AuthProvider>
					<p>Protected project</p>
				</AuthProvider>,
			);
		});
		await flush();
		expect(projectReads).toBe(0);
		expect(document.body.textContent).toContain("Change your password");
		await act(async () => {
			setNativeInputValue(document.querySelector<HTMLInputElement>('input[name="password"]')!, "  initial password  ");
			setNativeInputValue(
				document.querySelector<HTMLInputElement>('input[name="new-password"]')!,
				"  replacement password  ",
			);
		});
		await act(async () => {
			document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		});
		await flush();
		expect(projectReads).toBe(1);
		expect(new Headers(passwordOptions?.headers).get("X-CSRF-Token")).toBe("csrf-user-1");
		expect(JSON.parse(passwordOptions?.body as string)).toEqual({
			currentPassword: "  initial password  ",
			newPassword: "  replacement password  ",
		});
	});

	for (const kind of ["document", "decision"] as const) {
		it(`preserves a dirty ${kind} editor through expiry, same-account login and data refresh`, async () => {
			setup();
			const documentRecord: BacklogDocument = {
				id: "doc-1",
				title: "Runbook",
				type: "other",
				createdDate: "2026-01-01",
				rawContent: "Original document",
				path: "doc-1 - Runbook.md",
			};
			const decisionRecord: Decision = {
				id: "decision-1",
				title: "Choice",
				status: "proposed",
				date: "2026-01-01",
				context: "",
				decision: "",
				consequences: "",
				rawContent: "Original decision",
			};
			globalThis.fetch = (async (input) => {
				const path = String(input);
				if (path === "/api/auth/session" || path === "/api/auth/login") return Response.json(userSession());
				if (path === "/api/projects/1") return Response.json({ permissions: ADMIN_PERMISSIONS });
				if (path === "/expire") return Response.json({ error: "Login required" }, { status: 401 });
				if (path === "/api/projects/1/docs/doc-1") return Response.json(documentRecord);
				if (path === "/api/projects/1/decisions/decision-1") return Response.json(decisionRecord);
				throw new Error(path);
			}) as typeof fetch;
			function Page() {
				const [version, setVersion] = useState(0);
				return (
					<>
						<button type="button" onClick={() => setVersion((value) => value + 1)}>
							Refresh list
						</button>
						<MemoryRouter initialEntries={[kind === "document" ? "/documentation/1" : "/decisions/1"]}>
							<ThemeProvider>
								<Routes>
									<Route
										path="/documentation/:id"
										element={
											<DocumentationDetail
												docs={[{ ...documentRecord, title: `Runbook ${version}` }]}
												onRefreshData={async () => {}}
											/>
										}
									/>
									<Route
										path="/decisions/:id"
										element={
											<DecisionDetail
												decisions={[{ ...decisionRecord, title: `Choice ${version}` }]}
												onRefreshData={async () => {}}
											/>
										}
									/>
								</Routes>
							</ThemeProvider>
						</MemoryRouter>
					</>
				);
			}
			await act(async () => {
				root?.render(
					<AuthProvider>
						<Page />
					</AuthProvider>,
				);
			});
			await flush();
			await act(async () => {
				[...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit")!.click();
			});
			await act(async () => {
				setNativeInputValue(document.querySelector("textarea")!, `Unsaved ${kind}`);
			});
			await act(async () => {
				await sessionFetch("/expire");
			});
			await submitLogin();
			await act(async () => {
				[...document.querySelectorAll("button")].find((button) => button.textContent === "Refresh list")!.click();
			});
			expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(`Unsaved ${kind}`);
		});
	}

	it("keeps saved project preferences separate between central accounts", () => {
		const scope = readProjectScope("/projects/1/board");
		setProjectStorageAccount("user-a");
		const first = projectStorageKey("filters", scope);
		setProjectStorageAccount("user-b");
		expect(projectStorageKey("filters", scope)).not.toBe(first);
		setProjectStorageAccount(null);
		expect(projectStorageKey("filters", scope)).toBe("backlog.md:project:1:filters");
	});

	it("does not let a stale unauthenticated response clear a newer login", async () => {
		let release!: (response: Response) => void;
		globalThis.fetch = (async () =>
			new Promise<Response>((resolve) => {
				release = resolve;
			})) as unknown as typeof fetch;
		setRequestSession(null);
		const pending = sessionFetch("/api/auth/session");
		setRequestSession(userSession());
		release(Response.json({ error: "old request" }, { status: 401 }));
		await pending;
		let sent: RequestInit | undefined;
		globalThis.fetch = (async (_input, options) => {
			sent = options;
			return Response.json({});
		}) as typeof fetch;
		await sessionFetch("/write", { method: "POST" });
		expect(new Headers(sent?.headers).get("X-CSRF-Token")).toBe("csrf-user-1");
	});
});

describe("Markdown URL policy", () => {
	it("blocks active schemes even with whitespace and scopes attachments", () => {
		expect(scopeMarkdownUrl("javascript:alert(1)", "href")).toBe("");
		expect(scopeMarkdownUrl("java\nscript:alert(1)", "href")).toBe("");
		expect(scopeMarkdownUrl("data:text/html,script", "src")).toBe("");
		expect(scopeMarkdownUrl("https://example.com", "href")).toBe("https://example.com");
		Object.assign(projectScope, readProjectScope("/projects/1/board"));
		expect(scopeMarkdownUrl("/assets/note.txt", "href")).toBe("/api/projects/1/assets/note.txt");
	});
});
