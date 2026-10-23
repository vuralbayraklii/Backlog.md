import { afterEach, describe, expect, it, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";
import { ADMIN_PERMISSIONS, type AuthSession } from "../server/auth-types";
import type { Document as BacklogDocument, Decision } from "../types";
import AccountNavigation from "../web/components/AccountNavigation";
import DecisionDetail from "../web/components/DecisionDetail";
import DocumentationDetail from "../web/components/DocumentationDetail";
import { AuthProvider, useAuth } from "../web/contexts/AuthContext";
import { ThemeProvider } from "../web/contexts/ThemeContext";
import {
	UnsavedChangesNavigationGuard,
	UnsavedChangesProvider,
	useUnsavedChanges,
} from "../web/contexts/UnsavedChangesContext";
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
	window: globalThis.window,
	document: globalThis.document,
	navigator: globalThis.navigator,
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
let currentAuth: ReturnType<typeof useAuth> | null = null;
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function AuthProbe() {
	currentAuth = useAuth();
	return <output aria-label="Current account">{currentAuth.session?.user.id}</output>;
}

function auth() {
	if (!currentAuth) throw new Error("Auth probe has not mounted");
	return currentAuth;
}

async function renderAuth(children: ReactNode = <AuthProbe />, strict = false) {
	const content = (
		<UnsavedChangesProvider>
			<ThemeProvider>
				<AuthProvider>{children}</AuthProvider>
			</ThemeProvider>
		</UnsavedChangesProvider>
	);
	await act(async () => {
		root?.render(strict ? <StrictMode>{content}</StrictMode> : content);
	});
	await flush();
}

function visibleButton(label: string) {
	const button = [...document.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === label && !candidate.closest("[hidden]"),
	);
	if (!button) throw new Error(`Visible button not found: ${label}`);
	return button;
}

async function assertRequestCsrf(expected: string | null) {
	let sent: RequestInit | undefined;
	const previousFetch = globalThis.fetch;
	globalThis.fetch = (async (_input, options) => {
		sent = options;
		return Response.json({});
	}) as typeof fetch;
	try {
		await sessionFetch("/write", { method: "POST" });
		expect(new Headers(sent?.headers).get("X-CSRF-Token")).toBe(expected);
	} finally {
		globalThis.fetch = previousFetch;
	}
}

async function renderGuardedEditor() {
	function Editor() {
		const [text, setText] = useState("Saved text");
		useUnsavedChanges(text !== "Saved text");
		return <textarea aria-label="Draft text" value={text} onChange={(event) => setText(event.target.value)} />;
	}
	const router = createMemoryRouter(
		[
			{
				path: "*",
				element: (
					<>
						<UnsavedChangesNavigationGuard />
						<AccountNavigation />
						<AuthProbe />
						<Editor />
					</>
				),
			},
		],
		{ initialEntries: ["/board"] },
	);
	await renderAuth(<RouterProvider router={router} />);
	return router;
}

async function editDraft() {
	await act(async () => {
		setNativeInputValue(document.querySelector("textarea")!, "Unsaved document text");
	});
}

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = null;
	dom?.window.close();
	dom = null;
	globalThis.fetch = originalFetch;
	Object.assign(globalThis, originalBrowserGlobals);
	Object.assign(projectScope, originalScope);
	setRequestSession(userSession("test-cleanup"));
	setRequestSession(null);
	setProjectStorageAccount(null);
	currentAuth = null;
});

describe("central browser session", () => {
	it("keeps the application theme through login and same-account session expiry", async () => {
		setup();
		window.localStorage.setItem("backlog-theme", "dark");
		let signedIn = false;
		globalThis.fetch = (async (input) => {
			const path = String(input);
			if (path === "/api/auth/session")
				return signedIn
					? Response.json(userSession())
					: Response.json({ error: "Authentication required." }, { status: 401 });
			if (path === "/api/auth/login") {
				signedIn = true;
				return Response.json(userSession());
			}
			if (path === "/api/projects/1") return Response.json({ permissions: ADMIN_PERMISSIONS });
			if (path === "/expire-theme") {
				signedIn = false;
				return Response.json({ error: "Authentication required." }, { status: 401 });
			}
			return Response.json({ version: "1.53.0" });
		}) as typeof fetch;
		await renderAuth();
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Switch to light mode"]');
		if (!toggle) throw new Error("Login did not expose the shared theme control");
		await act(async () => toggle.click());
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(window.localStorage.getItem("backlog-theme")).toBe("light");
		await submitLogin();
		expect(auth().ready).toBe(true);
		await act(async () => {
			await sessionFetch("/expire-theme");
		});
		expect(auth().ready).toBe(false);
		expect(document.querySelector('button[aria-label="Switch to dark mode"]')).not.toBeNull();
		expect(window.localStorage.getItem("backlog-theme")).toBe("light");
		await submitLogin();
		expect(auth().ready).toBe(true);
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("shows recovery as project availability while preserving granted permissions", async () => {
		setup();
		globalThis.fetch = (async (input) => {
			if (String(input) === "/api/auth/session") return Response.json(userSession());
			if (String(input) === "/api/projects/1")
				return Response.json({
					permissions: ADMIN_PERMISSIONS,
					writeState: "recovery_required",
					pendingOperationId: "op-pending",
				});
			throw new Error(String(input));
		}) as typeof fetch;
		await renderAuth();
		expect(auth().permissions.tasksWrite).toBe(true);
		expect(auth().writeState).toBe("recovery_required");
		expect(document.body.textContent).toContain("Project writes are paused for recovery.");
		expect(document.body.textContent).toContain("Operation op-pending");
	});

	it("updates the read-only notice when a write returns recovery required", async () => {
		setup();
		let blocked = false;
		let operationId = "";
		globalThis.fetch = (async (input, options) => {
			const path = String(input);
			if (path === "/api/auth/session") return Response.json(userSession());
			if (path === "/api/projects/1")
				return Response.json({
					permissions: ADMIN_PERMISSIONS,
					writeState: blocked ? "recovery_required" : "ready",
					...(blocked ? { pendingOperationId: operationId } : {}),
				});
			if (path === "/api/projects/1/tasks" && options?.method === "POST") {
				operationId = new Headers(options.headers).get("Idempotency-Key") ?? "";
				blocked = true;
				return Response.json({ error: "Recovery required", code: "RECOVERY_REQUIRED", operationId }, { status: 503 });
			}
			throw new Error(path);
		}) as typeof fetch;
		await renderAuth();
		expect(auth().writeState).toBe("ready");
		await act(async () => {
			const response = await sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" });
			expect(response.status).toBe(503);
		});
		await flush();
		expect(auth().permissions.tasksWrite).toBe(true);
		expect(auth().writeState).toBe("recovery_required");
		expect(document.body.textContent).toContain("Project writes are paused for recovery.");
		expect(document.body.textContent).toContain(operationId);
	});

	it("offers a manual result check after a lost write without replaying it", async () => {
		setup();
		let writes = 0;
		let lookups = 0;
		globalThis.fetch = (async (input) => {
			const path = String(input);
			if (path === "/api/auth/session") return Response.json(userSession());
			if (path === "/api/projects/1") return Response.json({ permissions: ADMIN_PERMISSIONS, writeState: "ready" });
			if (path === "/api/projects/1/tasks") {
				writes++;
				throw new TypeError("response lost");
			}
			if (path.startsWith("/api/operations/"))
				return Response.json({
					state: ++lookups === 1 ? "pending" : "completed",
					result: { status: 200, body: { id: "TASK-1" }, headers: { "content-type": "application/json" } },
				});
			throw new Error(path);
		}) as typeof fetch;
		await renderAuth();
		await act(async () => {
			await expect(sessionFetch("/api/projects/1/tasks", { method: "POST", body: "{}" })).rejects.toThrow("uncertain");
		});
		expect(document.body.textContent).toContain("is still in progress.");
		await act(async () => {
			visibleButton("Check result").click();
		});
		await flush();
		expect(writes).toBe(1);
		expect(lookups).toBe(2);
		expect(document.body.textContent).toContain("Operation completed");
	});

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
				<ThemeProvider>
					<AuthProvider>
						<Project />
					</AuthProvider>
				</ThemeProvider>,
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
					<ThemeProvider>
						<AuthProvider>
							<Editor />
						</AuthProvider>
					</ThemeProvider>,
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
				<ThemeProvider>
					<AuthProvider>
						<p>Protected project</p>
					</AuthProvider>
				</ThemeProvider>,
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
				recordKey: "document-key-1",
				revision: "rev-1",
				title: "Runbook",
				type: "other",
				createdDate: "2026-01-01",
				rawContent: "Original document",
				path: "doc-1 - Runbook.md",
			};
			const decisionRecord: Decision = {
				id: "decision-1",
				recordKey: "decision-key-1",
				revision: "rev-1",
				title: "Choice",
				status: "proposed",
				date: "2026-01-01",
				context: "",
				decision: "",
				consequences: "",
				rawContent: "Original decision",
			};
			let saveHeaders: Headers | null = null;
			let savePath = "";
			globalThis.fetch = (async (input, options) => {
				const path = String(input);
				if (options?.method === "PUT" && (path.endsWith("/docs/doc-1") || path.endsWith("/decisions/decision-1"))) {
					savePath = path;
					saveHeaders = new Headers(options.headers);
					return Response.json({ error: "Another edit was saved", code: "REVISION_CONFLICT" }, { status: 409 });
				}
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
					<ThemeProvider>
						<AuthProvider>
							<Page />
						</AuthProvider>
					</ThemeProvider>,
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
				const refreshButton = [...document.querySelectorAll("button")].find(
					(button) => button.textContent === "Refresh list",
				);
				if (!refreshButton) throw new Error("Refresh list button missing");
				refreshButton.click();
			});
			expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(`Unsaved ${kind}`);
			await act(async () => {
				[...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save")!.click();
			});
			await flush();
			const sentHeaders = saveHeaders as Headers | null;
			expect(sentHeaders?.get("If-Match")).toBe("rev-1");
			expect(savePath).toContain("/api/projects/1/");
			expect(sentHeaders?.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
			if (kind === "decision") expect(sentHeaders?.get("Content-Type")).toBe("text/plain");
			expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(`Unsaved ${kind}`);
			expect(document.body.textContent).toContain("This record changed. Your draft is kept.");
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

describe("session response ownership", () => {
	for (const responseKind of ["success", "unauthorized", "server error", "network error"] as const) {
		it(`ignores an old account's delayed ${responseKind} after a different account logs in`, async () => {
			setup();
			const oldResponse = deferred<Response>();
			const newPermissions = { ...ADMIN_PERMISSIONS, docsWrite: false, archive: false };
			let reads = 0;
			let projectReads = 0;
			let loggedIn = false;
			globalThis.fetch = (async (input) => {
				const path = String(input);
				if (path === "/api/auth/session")
					return ++reads === 1 ? Response.json(userSession("account-a")) : oldResponse.promise;
				if (path === "/api/auth/login") {
					loggedIn = true;
					return Response.json(userSession("account-b"));
				}
				if (path === "/api/projects/1") {
					projectReads++;
					return Response.json({ permissions: loggedIn ? newPermissions : ADMIN_PERMISSIONS });
				}
				if (path === "/expire") return Response.json({ error: "Login required" }, { status: 401 });
				throw new Error(path);
			}) as typeof fetch;
			await renderAuth();
			expect(auth().session?.user.id).toBe("account-a");
			let pending!: Promise<void>;
			await act(async () => {
				pending = auth().refresh();
			});
			await act(async () => {
				await sessionFetch("/expire");
			});
			await submitLogin();
			expect(auth().session?.user.id).toBe("account-b");
			expect(auth().permissions).toEqual(newPermissions);
			await act(async () => {
				if (responseKind === "network error") oldResponse.reject(new Error("Old account response"));
				else
					oldResponse.resolve(
						responseKind === "success"
							? Response.json(userSession("account-a"))
							: Response.json(
									{ error: "Old account response" },
									{ status: responseKind === "unauthorized" ? 401 : 500 },
								),
					);
				await pending;
			});
			expect(auth().session?.user.id).toBe("account-b");
			expect(auth().permissions).toEqual(newPermissions);
			expect(auth().ready).toBe(true);
			expect(projectReads).toBe(2);
			expect(document.body.textContent).not.toContain("Old account response");
			await assertRequestCsrf("csrf-account-b");
		});
	}

	it("does not expose project content while a new account is still loading permissions", async () => {
		setup();
		const oldResponse = deferred<Response>();
		const newPermissions = deferred<Response>();
		let reads = 0;
		let loggedIn = false;
		globalThis.fetch = (async (input) => {
			const path = String(input);
			if (path === "/api/auth/session")
				return ++reads === 1 ? Response.json(userSession("account-a")) : oldResponse.promise;
			if (path === "/api/projects/1")
				return loggedIn ? newPermissions.promise : Response.json({ permissions: ADMIN_PERMISSIONS });
			if (path === "/api/auth/login") {
				loggedIn = true;
				return Response.json(userSession("account-b"));
			}
			if (path === "/expire") return Response.json({ error: "Login required" }, { status: 401 });
			throw new Error(path);
		}) as typeof fetch;
		await renderAuth();
		let pending!: Promise<void>;
		await act(async () => {
			pending = auth().refresh();
		});
		await act(async () => {
			await sessionFetch("/expire");
		});
		await submitLogin();
		expect(document.querySelector('output[aria-label="Current account"]')).toBeNull();
		expect(document.body.textContent).toContain("Loading session...");
		await act(async () => {
			oldResponse.resolve(Response.json(userSession("account-a")));
			await pending;
		});
		expect(document.querySelector('output[aria-label="Current account"]')).toBeNull();
		expect(document.body.textContent).toContain("Loading session...");
		await assertRequestCsrf("csrf-account-b");
		await act(async () => newPermissions.resolve(Response.json({ permissions: ADMIN_PERMISSIONS })));
		await flush();
		expect(auth().session?.user.id).toBe("account-b");
		expect(auth().ready).toBe(true);
	});

	it("keeps a newer refresh in flight when an invalidated request finishes", async () => {
		setup();
		const requests: ReturnType<typeof deferred<Response>>[] = [];
		let initial = true;
		globalThis.fetch = (async (input) => {
			const path = String(input);
			if (path === "/api/auth/session") {
				if (initial) {
					initial = false;
					return Response.json(userSession("account-a"));
				}
				const request = deferred<Response>();
				requests.push(request);
				return request.promise;
			}
			if (path === "/api/projects/1") return Response.json({ permissions: ADMIN_PERMISSIONS });
			if (path === "/expire") return Response.json({ error: "Login required" }, { status: 401 });
			if (path === "/api/auth/login") return Response.json(userSession("account-b"));
			throw new Error(path);
		}) as typeof fetch;
		await renderAuth();
		let oldRequest!: Promise<void>;
		await act(async () => {
			oldRequest = auth().refresh();
		});
		await act(async () => {
			await sessionFetch("/expire");
		});
		await submitLogin();
		let newRequest!: Promise<void>;
		await act(async () => {
			newRequest = auth().refresh();
		});
		expect(requests).toHaveLength(2);
		await act(async () => {
			requests[0]!.resolve(Response.json(userSession("account-a")));
			await oldRequest;
		});
		let duplicateRequest!: Promise<void>;
		await act(async () => {
			duplicateRequest = auth().refresh();
		});
		expect(requests).toHaveLength(2);
		const refreshed = { ...userSession("account-b"), csrfToken: "refreshed-account-b" };
		await act(async () => {
			requests[1]!.resolve(Response.json(refreshed));
			await Promise.all([newRequest, duplicateRequest]);
		});
		expect(auth().session).toEqual(refreshed);
		await assertRequestCsrf("refreshed-account-b");
	});

	it("preserves a replacement session when an earlier same-account refresh finishes", async () => {
		setup();
		const pendingResponse = deferred<Response>();
		let reads = 0;
		globalThis.fetch = (async (input) => {
			if (String(input) === "/api/auth/session")
				return ++reads === 1 ? Response.json(userSession()) : pendingResponse.promise;
			if (String(input) === "/api/projects/1") return Response.json({ permissions: ADMIN_PERMISSIONS });
			throw new Error(String(input));
		}) as typeof fetch;
		await renderAuth();
		let pending!: Promise<void>;
		await act(async () => {
			pending = auth().refresh();
		});
		const replacement = { ...userSession(), csrfToken: "replacement-session" };
		await act(async () => {
			await auth().acceptSession(replacement);
		});
		await act(async () => {
			pendingResponse.resolve(Response.json(userSession()));
			await pending;
		});
		expect(auth().session).toEqual(replacement);
		await assertRequestCsrf("replacement-session");
	});

	for (const releaseBeforeLogout of [true, false]) {
		it(`ignores a refresh completed ${releaseBeforeLogout ? "during" : "after"} logout`, async () => {
			setup();
			const refreshResponse = deferred<Response>();
			const logoutResponse = deferred<Response>();
			let reads = 0;
			let projectReads = 0;
			globalThis.fetch = (async (input) => {
				const path = String(input);
				if (path === "/api/auth/session") return ++reads === 1 ? Response.json(userSession()) : refreshResponse.promise;
				if (path === "/api/projects/1") {
					projectReads++;
					return Response.json({ permissions: ADMIN_PERMISSIONS });
				}
				if (path === "/api/auth/logout") return logoutResponse.promise;
				throw new Error(path);
			}) as typeof fetch;
			await renderAuth();
			let refreshRequest!: Promise<void>;
			let logoutRequest!: Promise<void>;
			await act(async () => {
				refreshRequest = auth().refresh();
				logoutRequest = auth().logout();
			});
			if (releaseBeforeLogout)
				await act(async () => {
					refreshResponse.resolve(Response.json(userSession()));
					await refreshRequest;
				});
			await act(async () => {
				logoutResponse.resolve(Response.json({ success: true }));
				await logoutRequest;
			});
			if (!releaseBeforeLogout)
				await act(async () => {
					refreshResponse.resolve(Response.json(userSession()));
					await refreshRequest;
				});
			expect(projectReads).toBe(1);
			expect(document.querySelector('output[aria-label="Current account"]')).toBeNull();
			expect(document.querySelector("h1")?.textContent).toBe("Log in");
			await assertRequestCsrf(null);
		});
	}

	it("aborts an unmounted provider's session request and ignores a late response", async () => {
		setup();
		const response = deferred<Response>();
		let signal: AbortSignal | null | undefined;
		let projectReads = 0;
		globalThis.fetch = (async (input, options) => {
			if (String(input) === "/api/auth/session") {
				signal = options?.signal;
				return response.promise;
			}
			if (String(input) === "/api/projects/1") {
				projectReads++;
				return Response.json({ permissions: ADMIN_PERMISSIONS });
			}
			throw new Error(String(input));
		}) as typeof fetch;
		await renderAuth();
		await act(async () => {
			root?.unmount();
		});
		root = null;
		expect(signal?.aborted).toBe(true);
		await act(async () => {
			response.resolve(Response.json(userSession()));
		});
		await flush();
		expect(projectReads).toBe(0);
		await assertRequestCsrf(null);
	});

	it("restarts initial session loading after StrictMode effect cleanup", async () => {
		setup();
		const requests: Array<{ response: ReturnType<typeof deferred<Response>>; signal?: AbortSignal | null }> = [];
		globalThis.fetch = (async (input, options) => {
			if (String(input) === "/api/auth/session") {
				const response = deferred<Response>();
				requests.push({ response, signal: options?.signal });
				return response.promise;
			}
			if (String(input) === "/api/projects/1") return Response.json({ permissions: ADMIN_PERMISSIONS });
			throw new Error(String(input));
		}) as typeof fetch;
		await renderAuth(<AuthProbe />, true);
		expect(requests).toHaveLength(2);
		expect(requests[0]!.signal?.aborted).toBe(true);
		await act(async () => {
			requests[1]!.response.resolve(Response.json(userSession("current-account")));
		});
		await flush();
		expect(auth().session?.user.id).toBe("current-account");
		expect(auth().ready).toBe(true);
		await act(async () => {
			requests[0]!.response.resolve(Response.json(userSession("discarded-account")));
		});
		await flush();
		expect(auth().session?.user.id).toBe("current-account");
		await assertRequestCsrf("csrf-current-account");
	});
});

describe("logout with unsaved changes", () => {
	function installFetch(logout: () => Promise<Response> | Response) {
		let logoutCalls = 0;
		let permissionFailure = false;
		globalThis.fetch = (async (input) => {
			const path = String(input);
			if (path === "/api/auth/session") return Response.json(userSession());
			if (path === "/api/projects/1")
				return permissionFailure
					? Response.json({ error: "Project temporarily unavailable" }, { status: 503 })
					: Response.json({ permissions: ADMIN_PERMISSIONS });
			if (path === "/api/auth/logout") {
				logoutCalls++;
				return logout();
			}
			throw new Error(path);
		}) as typeof fetch;
		return {
			get logoutCalls() {
				return logoutCalls;
			},
			failPermissions() {
				permissionFailure = true;
			},
		};
	}

	it("shares the dirty editor registry with router navigation", async () => {
		setup();
		installFetch(() => Response.json({ success: true }));
		const confirm = mock(() => false);
		window.confirm = confirm;
		const router = await renderGuardedEditor();
		await editDraft();
		await act(async () => router.navigate("/documentation"));
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(router.state.location.pathname).toBe("/board");
		expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Unsaved document text");
		confirm.mockImplementation(() => true);
		await act(async () => router.navigate("/documentation"));
		expect(confirm).toHaveBeenCalledTimes(2);
		expect(router.state.location.pathname).toBe("/documentation");
	});

	it("guards browser unload only while an editor has unsaved changes", async () => {
		setup();
		installFetch(() => Response.json({ success: true }));
		await renderGuardedEditor();
		const cleanEvent = new window.Event("beforeunload", { cancelable: true });
		window.dispatchEvent(cleanEvent);
		expect(cleanEvent.defaultPrevented).toBe(false);
		await editDraft();
		const dirtyEvent = new window.Event("beforeunload", { cancelable: true });
		window.dispatchEvent(dirtyEvent);
		expect(dirtyEvent.defaultPrevented).toBe(true);
		await act(async () => {
			setNativeInputValue(document.querySelector("textarea")!, "Saved text");
		});
		const savedEvent = new window.Event("beforeunload", { cancelable: true });
		window.dispatchEvent(savedEvent);
		expect(savedEvent.defaultPrevented).toBe(false);
	});

	it("keeps the account and editor when AccountNavigation logout is canceled", async () => {
		setup();
		const calls = installFetch(() => Response.json({ success: true }));
		const confirm = mock(() => false);
		window.confirm = confirm;
		await renderGuardedEditor();
		await editDraft();
		await act(async () => visibleButton("Log out").click());
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(calls.logoutCalls).toBe(0);
		expect(auth().session?.user.id).toBe("user-1");
		expect(auth().ready).toBe(true);
		expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Unsaved document text");
		await assertRequestCsrf("csrf-user-1");
	});

	it("sends one approved logout while repeated clicks are pending", async () => {
		setup();
		const response = deferred<Response>();
		const calls = installFetch(() => response.promise);
		const confirm = mock(() => true);
		window.confirm = confirm;
		await renderGuardedEditor();
		await editDraft();
		await act(async () => {
			const button = visibleButton("Log out");
			button.click();
			button.click();
		});
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(calls.logoutCalls).toBe(1);
		expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Unsaved document text");
		await act(async () => response.resolve(Response.json({ success: true })));
		await flush();
		expect(document.querySelector("textarea")).toBeNull();
		expect(document.querySelector("h1")?.textContent).toBe("Log in");
		await assertRequestCsrf(null);
	});

	for (const failure of ["network", "server"] as const) {
		it(`preserves the editor and account when logout has a ${failure} failure`, async () => {
			setup();
			const calls = installFetch(() =>
				failure === "network"
					? Promise.reject(new Error("Logout could not reach server"))
					: Response.json({ error: "Logout could not reach server" }, { status: 500 }),
			);
			window.confirm = mock(() => true);
			await renderGuardedEditor();
			await editDraft();
			await act(async () => visibleButton("Log out").click());
			await flush();
			expect(calls.logoutCalls).toBe(1);
			expect(auth().session?.user.id).toBe("user-1");
			expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Unsaved document text");
			expect(document.body.textContent).toContain("Logout could not reach server");
			await assertRequestCsrf("csrf-user-1");
		});
	}

	for (const status of [200, 401]) {
		it(`logs out a clean editor without confirmation when the server returns ${status}`, async () => {
			setup();
			const calls = installFetch(() =>
				Response.json(status === 200 ? { success: true } : { error: "Login required" }, { status }),
			);
			const confirm = mock(() => false);
			window.confirm = confirm;
			await renderGuardedEditor();
			await act(async () => visibleButton("Log out").click());
			await flush();
			expect(confirm).not.toHaveBeenCalled();
			expect(calls.logoutCalls).toBe(1);
			expect(document.querySelector("textarea")).toBeNull();
			expect(document.querySelector("h1")?.textContent).toBe("Log in");
			await assertRequestCsrf(null);
		});
	}

	it("uses the same dirty editor confirmation from the AuthProvider error screen", async () => {
		setup();
		const calls = installFetch(() => Response.json({ success: true }));
		const confirm = mock(() => false);
		window.confirm = confirm;
		await renderGuardedEditor();
		await editDraft();
		calls.failPermissions();
		await act(async () => auth().refresh());
		expect(document.body.textContent).toContain("Project temporarily unavailable");
		expect(document.querySelector("textarea")?.closest("[hidden]")).not.toBeNull();
		await act(async () => visibleButton("Log out").click());
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(calls.logoutCalls).toBe(0);
		expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Unsaved document text");
		confirm.mockImplementation(() => true);
		await act(async () => visibleButton("Log out").click());
		await flush();
		expect(calls.logoutCalls).toBe(1);
		expect(document.querySelector("textarea")).toBeNull();
		expect(document.querySelector("h1")?.textContent).toBe("Log in");
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
