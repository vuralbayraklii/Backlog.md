import { afterEach, describe, expect, it, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AuthSession, ServerUser } from "../server/auth-types";
import type { ProjectPreview } from "../server/registration-types";
import AccountNavigation from "../web/components/AccountNavigation";
import AdminUsers from "../web/components/AdminUsers";
import ProjectRegistration from "../web/components/ProjectRegistration";
import ProjectSelector from "../web/components/ProjectSelector";
import { AuthProvider, useAuth } from "../web/contexts/AuthContext";
import { UnsavedChangesProvider, useConfirmDiscardChanges } from "../web/contexts/UnsavedChangesContext";
import { projectScope, readProjectScope, setProjectStorageAccount } from "../web/lib/project-scope";
import { sessionFetch, setRequestSession } from "../web/lib/request";
import { setNativeInputValue } from "./react-dom-input";

const originalFetch = globalThis.fetch;
const originalGlobals = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator };
const originalScope = { ...projectScope };
const ordinary: ServerUser = {
	id: "2",
	username: "creator",
	displayName: "Creator",
	role: "user",
	active: true,
	mustChangePassword: false,
};
const admin: ServerUser = { ...ordinary, id: "1", username: "admin", displayName: "Admin", role: "admin" };
const area = { id: "7", userId: ordinary.id, rootPath: "/srv/creator", createdAt: "2026-01-01T00:00:00Z" };
const project = {
	id: "13",
	name: "Alpha",
	rootPath: "/srv/creator/alpha",
	createdAt: "2026-01-01T00:00:00Z",
	tracking: true,
};
const preview: ProjectPreview = {
	name: "Alpha",
	rootPath: project.rootPath,
	backlogPath: `${project.rootPath}/backlog`,
	configPath: `${project.rootPath}/backlog/config.yml`,
	config: { projectName: "Source project", statuses: ["To Do", "Done"], labels: ["feature"], dateFormat: "yyyy-mm-dd" },
	counts: { tasks: 12, drafts: 3, documents: 4, decisions: 5, archived: 6 },
	issues: [],
	canRegister: true,
};
const session = (user = ordinary, token = `csrf-${user.id}`): AuthSession => ({
	user,
	csrfToken: token,
	createdAt: "2026-01-01T00:00:00Z",
	expiresAt: "2026-01-01T12:00:00Z",
	lastActivityAt: "2026-01-01T00:00:00Z",
	idleExpiresAt: "2026-01-01T02:00:00Z",
});
let root: Root | null = null;
let dom: JSDOM | null = null;
let currentAuth: ReturnType<typeof useAuth> | null = null;
let confirmDiscard = () => true;
let currentSession = session();
let calls: { path: string; options?: RequestInit }[] = [];

function setup(handler: (path: string, options?: RequestInit) => Response | Promise<Response>, user = ordinary) {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost/projects",
	});
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
	Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(projectScope, readProjectScope("/projects"));
	currentSession = session(user);
	calls = [];
	globalThis.fetch = (async (input, options) => {
		const path = String(input);
		calls.push({ path, options });
		if (path === "/api/auth/session") return Response.json(currentSession);
		if (path === "/expire") return Response.json({ error: "Login required" }, { status: 401 });
		return handler(path, options);
	}) as typeof fetch;
	root = createRoot(element("#root"));
}
function Probe() {
	currentAuth = useAuth();
	confirmDiscard = useConfirmDiscardChanges();
	return null;
}
async function render(children: ReactNode) {
	await act(async () => {
		root?.render(
			<UnsavedChangesProvider>
				<AuthProvider>
					<Probe />
					{children}
				</AuthProvider>
			</UnsavedChangesProvider>,
		);
	});
	await flush();
}
async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}
function button(label: string) {
	const result = [...document.querySelectorAll("button")].find(
		(item) => item.textContent?.trim() === label && !item.closest("[hidden]"),
	);
	if (!result) throw new Error(`Missing button: ${label}`);
	return result;
}
async function click(label: string) {
	await act(async () => {
		button(label).click();
	});
	await flush();
}
async function input(name: string, value: string) {
	await act(async () => {
		setNativeInputValue(element<HTMLInputElement>(`input[name="${name}"]`), value);
	});
}
function element<T extends Element>(selector: string): T {
	const result = document.querySelector<T>(selector);
	if (!result) throw new Error(`Missing element: ${selector}`);
	return result;
}
async function fillProject() {
	await input("projectName", "Alpha");
	await input("projectPath", project.rootPath);
}
async function renderRegistration(onRegistered = (_id: string) => {}) {
	await render(
		<>
			<AccountNavigation />
			<ProjectRegistration areas={[area]} onRegistered={onRegistered} onCancel={() => {}} />
		</>,
	);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
function unloadIsBlocked() {
	const event = new window.Event("beforeunload", { cancelable: true });
	window.dispatchEvent(event);
	return event.defaultPrevented;
}

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = null;
	dom?.window.close();
	dom = null;
	globalThis.fetch = originalFetch;
	Object.assign(globalThis, originalGlobals);
	Object.assign(projectScope, originalScope);
	// A lost central response belongs to its account even through expiry. A different
	// account ends that operation before the next isolated test starts.
	setRequestSession(session({ ...ordinary, id: "test-cleanup" }));
	setRequestSession(null);
	setProjectStorageAccount(null);
	currentAuth = null;
});

describe("project registration", () => {
	for (const allowed of [false, true]) {
		it(`${allowed ? "offers" : "hides"} registration according to the account's folder capability`, async () => {
			setup((path) => {
				if (path === "/api/projects") return Response.json([]);
				if (path === "/api/projects/registration") return Response.json({ allowed, areas: allowed ? [area] : [] });
				throw new Error(path);
			});
			await render(<ProjectSelector />);
			expect(document.body.textContent).toContain("No accessible projects.");
			expect(document.body.textContent?.includes("Register project")).toBe(allowed);
			expect(calls.some((call) => call.path.startsWith("/api/admin"))).toBe(false);
			if (allowed) {
				await click("Register project");
				expect(document.body.textContent).toContain(area.rootPath);
				expect(document.activeElement).toBe(document.querySelector('input[name="projectName"]'));
				expect(document.body.textContent).not.toContain("backlog server");
			}
		});
	}

	it("shows a registration access error without granting the capability", async () => {
		setup((path) =>
			path === "/api/projects" ? Response.json([]) : Response.json({ error: "Unavailable" }, { status: 503 }),
		);
		await render(<ProjectSelector />);
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not load project registration access",
		);
		expect(document.querySelector('input[name="projectName"]')).toBeNull();
	});

	it("ignores old capability responses after the session is replaced", async () => {
		const old = deferred<Response>();
		let accessReads = 0;
		setup((path) => {
			if (path === "/api/projects") return Response.json([]);
			return ++accessReads === 1 ? old.promise : Response.json({ allowed: false, areas: [] });
		});
		await render(<ProjectSelector />);
		await act(async () => {
			currentSession = session(ordinary, "replacement-session");
			await currentAuth?.acceptSession(currentSession);
		});
		await flush();
		await act(async () => old.resolve(Response.json({ allowed: true, areas: [area] })));
		expect(document.body.textContent).not.toContain("Register project");
	});

	it("previews content and registers once with CSRF, then clears dirty state before navigation", async () => {
		setup((path) => {
			if (path === "/api/projects/preview")
				return Response.json({ ...preview, issues: [{ severity: "warning", message: "Duplicate task IDs" }] });
			if (path === "/api/projects") return Response.json(project, { status: 201 });
			throw new Error(path);
		});
		const navigated = mock((_id: string) => {
			expect(confirmDiscard()).toBe(true);
		});
		const confirm = mock(() => false);
		window.confirm = confirm;
		await renderRegistration(navigated);
		await fillProject();
		expect(unloadIsBlocked()).toBe(true);
		await click("Preview project");
		expect(calls.filter((call) => call.path === "/api/projects")).toHaveLength(0);
		expect(document.body.textContent).toContain(preview.rootPath);
		expect(document.body.textContent).toContain(String(preview.backlogPath));
		expect(document.body.textContent).toContain(String(preview.configPath));
		expect(document.querySelector("pre")?.textContent).toContain('"projectName": "Source project"');
		expect([...document.querySelectorAll('[aria-label="Record counts"] dd')].map((item) => item.textContent)).toEqual([
			"12",
			"3",
			"4",
			"5",
			"6",
		]);
		expect(document.body.textContent).toContain("Warning: Duplicate task IDs");
		await click("Register project");
		expect(navigated).toHaveBeenCalledTimes(1);
		expect(navigated).toHaveBeenCalledWith(project.id);
		expect(confirm).not.toHaveBeenCalled();
		expect(unloadIsBlocked()).toBe(false);
		for (const call of calls.filter((call) => call.options?.method === "POST")) {
			expect(new Headers(call.options?.headers).get("X-CSRF-Token")).toBe("csrf-2");
			expect(call.options?.credentials).toBe("same-origin");
			expect(JSON.parse(String(call.options?.body))).toEqual({ name: "Alpha", path: project.rootPath });
		}
		expect(calls.filter((call) => call.path === "/api/projects")).toHaveLength(1);
	});

	it("blocks registration for invalid prepared content and shows the issues", async () => {
		setup(() =>
			Response.json({
				...preview,
				config: null,
				configPath: null,
				canRegister: false,
				issues: [{ severity: "error", message: "Configuration is missing" }],
			}),
		);
		await renderRegistration();
		await fillProject();
		await click("Preview project");
		expect(document.body.textContent).toContain("Error: Configuration is missing");
		expect(button("Register project").disabled).toBe(true);
		await click("Register project");
		expect(calls.filter((call) => call.path === "/api/projects")).toHaveLength(0);
	});

	it("allows the registration navigation to unload synchronously after saving", async () => {
		setup((path) => Response.json(path === "/api/projects/preview" ? preview : project));
		let navigationWasBlocked: boolean | undefined;
		const navigated = mock((_id: string) => {
			// ProjectSelector calls location.assign here, before React removes the
			// beforeunload listener installed for the previously dirty form.
			navigationWasBlocked = unloadIsBlocked();
		});
		await renderRegistration(navigated);
		await fillProject();
		expect(unloadIsBlocked()).toBe(true);
		await click("Preview project");
		await click("Register project");
		expect(navigated).toHaveBeenCalledTimes(1);
		expect(navigationWasBlocked).toBe(false);
	});

	for (const field of ["projectName", "projectPath"]) {
		it(`invalidates a completed preview when ${field} changes`, async () => {
			setup(() => Response.json(preview));
			await renderRegistration();
			await fillProject();
			await click("Preview project");
			await input(field, "Changed");
			expect(document.querySelector('[aria-label="Record counts"]')).toBeNull();
			expect([...document.querySelectorAll("button")].some((item) => item.textContent === "Register project")).toBe(
				false,
			);
		});
	}

	for (const failed of [false, true]) {
		it(`ignores a late preview ${failed ? "failure" : "success"} after newer input and preview`, async () => {
			const old = deferred<Response>();
			let previews = 0;
			setup(() => (++previews === 1 ? old.promise : Response.json({ ...preview, name: "New preview" })));
			await renderRegistration();
			await fillProject();
			await click("Preview project");
			await input("projectPath", "/srv/creator/new");
			expect(calls.find((call) => call.path === "/api/projects/preview")?.options?.signal?.aborted).toBe(true);
			await click("Preview project");
			await act(async () => {
				if (failed) old.reject(new Error("Old failure"));
				else old.resolve(Response.json({ ...preview, name: "Old preview" }));
			});
			expect(document.body.textContent).toContain("New preview");
			expect(document.body.textContent).not.toContain("Old preview");
			expect(document.body.textContent).not.toContain("Old failure");
			expect(button("Register project").disabled).toBe(false);
		});
	}

	it("keeps the newer preview request busy when an aborted request settles", async () => {
		const old = deferred<Response>();
		const next = deferred<Response>();
		let previews = 0;
		setup(() => (++previews === 1 ? old.promise : next.promise));
		await renderRegistration();
		await fillProject();
		await click("Preview project");
		await input("projectName", "New name");
		await click("Preview project");
		await act(async () => old.resolve(Response.json(preview)));
		expect(button("Reading project...").disabled).toBe(true);
		expect(document.querySelector('[aria-label="Record counts"]')).toBeNull();
		await act(async () => next.resolve(Response.json({ ...preview, name: "New name" })));
		expect(document.body.textContent).toContain("New name");
		expect(button("Register project").disabled).toBe(false);
	});

	it("keeps the form and reports a revoked grant without retrying registration", async () => {
		setup((path) =>
			path === "/api/projects/preview"
				? Response.json(preview)
				: Response.json({ error: "Folder access denied" }, { status: 403 }),
		);
		await renderRegistration();
		await fillProject();
		await click("Preview project");
		await click("Register project");
		expect(document.body.textContent).toContain("The request result is uncertain");
		expect(document.body.textContent).toContain("has no confirmed result");
		expect(document.querySelector<HTMLInputElement>('input[name="projectPath"]')?.value).toBe(project.rootPath);
		expect(calls.filter((call) => call.path === "/api/projects")).toHaveLength(1);
		expect(unloadIsBlocked()).toBe(true);
	});

	it("shows preview errors without enabling registration", async () => {
		setup(() => Response.json({ error: "Folder is not available" }, { status: 400 }));
		await renderRegistration();
		await fillProject();
		await click("Preview project");
		expect(document.querySelector('[role="alert"]')?.textContent).toBe("Folder is not available");
		expect(document.querySelector('[aria-label="Record counts"]')).toBeNull();
	});

	it("preserves input across expiry and rejects a late response from the previous session", async () => {
		const old = deferred<Response>();
		setup(() => old.promise);
		const navigated = mock((_id: string) => {});
		await renderRegistration(navigated);
		await fillProject();
		await click("Preview project");
		await act(async () => {
			await sessionFetch("/expire");
		});
		await act(async () => {
			currentSession = session(ordinary, "new-session");
			await currentAuth?.acceptSession(currentSession);
		});
		await act(async () => {
			old.resolve(Response.json(preview));
		});
		expect(document.querySelector<HTMLInputElement>('input[name="projectName"]')?.value).toBe("Alpha");
		expect(document.querySelector('[aria-label="Record counts"]')).toBeNull();
		expect(navigated).not.toHaveBeenCalled();
		expect(button("Preview project").disabled).toBe(false);
	});

	it("does not navigate from registration that finishes after session expiry", async () => {
		const registration = deferred<Response>();
		setup((path) => (path === "/api/projects/preview" ? Response.json(preview) : registration.promise));
		const navigated = mock((_id: string) => {});
		await renderRegistration(navigated);
		await fillProject();
		await click("Preview project");
		await click("Register project");
		await click("Registering...");
		expect(calls.filter((call) => call.path === "/api/projects")).toHaveLength(1);
		await act(async () => {
			await sessionFetch("/expire");
		});
		await act(async () => {
			registration.resolve(Response.json(project, { status: 201 }));
		});
		expect(navigated).not.toHaveBeenCalled();
		expect(unloadIsBlocked()).toBe(true);
	});

	it("clears the registration draft when a different account signs in", async () => {
		setup(() => Response.json(preview));
		await renderRegistration();
		await fillProject();
		await click("Preview project");
		await act(async () => {
			await sessionFetch("/expire");
		});
		await act(async () => {
			currentSession = session({ ...ordinary, id: "other-account", username: "other" });
			await currentAuth?.acceptSession(currentSession);
		});
		expect(document.querySelector<HTMLInputElement>('input[name="projectName"]')?.value).toBe("");
		expect(document.querySelector<HTMLInputElement>('input[name="projectPath"]')?.value).toBe("");
		expect(document.querySelector('[aria-label="Record counts"]')).toBeNull();
		expect(unloadIsBlocked()).toBe(false);
	});

	it("asks through the shared draft guard before logout and cancellation", async () => {
		setup(() => Response.json(preview));
		const cancelled = mock(() => {});
		await render(
			<>
				<AccountNavigation />
				<ProjectRegistration areas={[area]} onRegistered={() => {}} onCancel={cancelled} />
			</>,
		);
		await fillProject();
		const confirm = mock(() => false);
		window.confirm = confirm;
		await click("Log out");
		await click("Cancel");
		expect(confirm).toHaveBeenCalledTimes(2);
		expect(calls.some((call) => call.path === "/api/auth/logout")).toBe(false);
		expect(cancelled).not.toHaveBeenCalled();
		window.confirm = () => true;
		await click("Cancel");
		expect(cancelled).toHaveBeenCalledTimes(1);
		expect(confirmDiscard()).toBe(true);
	});
});

describe("admin registration management", () => {
	function adminSetup(handler?: (path: string, options?: RequestInit) => Response | Promise<Response>) {
		setup((path, options) => {
			if (!options?.method) {
				if (path === "/api/admin/users") return Response.json([admin, ordinary]);
				if (path === "/api/admin/folder-areas") return Response.json([{ ...area, revision: "rev-area" }]);
				if (path === "/api/admin/projects")
					return Response.json([
						{ ...project, revision: "rev-project" },
						{ ...project, id: "14", name: "Dormant", tracking: false, revision: "rev-dormant" },
					]);
			}
			if (handler) return handler(path, options);
			throw new Error(path);
		}, admin);
	}
	async function fillArea() {
		await act(async () => {
			const select = element<HTMLSelectElement>('select[name="folderUser"]');
			select.value = ordinary.id;
			select.dispatchEvent(new window.Event("change", { bubbles: true }));
		});
		await input("folderPath", "/srv/new-area");
	}

	it("assigns and removes personal folders with CSRF and without changing project memberships", async () => {
		const added = { ...area, id: "8", rootPath: "/srv/new-area", revision: "rev-added" };
		adminSetup((path, options) =>
			path === "/api/admin/folder-areas" && options?.method === "POST"
				? Response.json(added)
				: Response.json({ success: true }),
		);
		await render(<AdminUsers />);
		await fillArea();
		expect(unloadIsBlocked()).toBe(true);
		await click("Assign folder");
		expect(document.querySelector<HTMLInputElement>('input[name="folderPath"]')?.value).toBe("");
		expect(unloadIsBlocked()).toBe(false);
		expect(document.body.textContent).toContain(added.rootPath);
		const remove = element<HTMLButtonElement>(`button[aria-label="Remove folder ${added.rootPath}"]`);
		window.confirm = () => false;
		await act(async () => remove.click());
		expect(calls.some((call) => call.options?.method === "DELETE")).toBe(false);
		window.confirm = () => true;
		await act(async () => remove.click());
		await flush();
		expect(document.querySelector(`button[aria-label="Remove folder ${added.rootPath}"]`)).toBeNull();
		const writes = calls.filter((call) => call.options?.method);
		expect(writes.map((call) => [call.path, call.options?.method])).toEqual([
			["/api/admin/folder-areas", "POST"],
			["/api/admin/folder-areas/8", "DELETE"],
		]);
		expect(JSON.parse(String(writes[0]?.options?.body))).toEqual({ userId: ordinary.id, path: added.rootPath });
		for (const call of writes) expect(new Headers(call.options?.headers).get("X-CSRF-Token")).toBe("csrf-1");
		expect(new Headers(writes[0]?.options?.headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
		expect(new Headers(writes[1]?.options?.headers).get("If-Match")).toBe("rev-added");
	});

	it("stops and re-enables tracking in place while retaining project identity", async () => {
		adminSetup((path, options) => {
			const id = path.split("/").at(-2);
			return Response.json({
				...project,
				id,
				name: id === "14" ? "Dormant" : "Alpha",
				tracking: JSON.parse(String(options?.body)).tracking,
			});
		});
		await render(<AdminUsers />);
		expect(document.body.textContent).toContain("Not tracked");
		window.confirm = () => false;
		await click("Stop tracking");
		expect(calls.some((call) => call.options?.method === "PUT")).toBe(false);
		window.confirm = () => true;
		await click("Stop tracking");
		expect(document.querySelector('a[href="/projects/13/members"]')).toBeNull();
		await act(async () => element<HTMLButtonElement>('button[aria-label="Enable tracking Dormant"]').click());
		await flush();
		expect(document.querySelector('a[href="/projects/14/members"]')).not.toBeNull();
		const writes = calls.filter((call) => call.options?.method === "PUT");
		expect(writes.map((call) => [call.path, JSON.parse(String(call.options?.body))])).toEqual([
			["/api/admin/projects/13/tracking", { tracking: false }],
			["/api/admin/projects/14/tracking", { tracking: true }],
		]);
		for (const call of writes) expect(new Headers(call.options?.headers).get("X-CSRF-Token")).toBe("csrf-1");
		expect(writes.map((call) => new Headers(call.options?.headers).get("If-Match"))).toEqual([
			"rev-project",
			"rev-dormant",
		]);
	});

	it("shows folder and tracking errors while retaining form and current state", async () => {
		adminSetup(() => Response.json({ error: "Folder overlaps another area" }, { status: 409 }));
		await render(<AdminUsers />);
		await fillArea();
		await click("Assign folder");
		expect(document.body.textContent).toContain("Folder overlaps another area");
		expect(document.querySelector<HTMLInputElement>('input[name="folderPath"]')?.value).toBe("/srv/new-area");
		await act(async () => element<HTMLButtonElement>('button[aria-label="Enable tracking Dormant"]').click());
		await flush();
		expect(document.querySelector('button[aria-label="Enable tracking Dormant"]')).not.toBeNull();
		expect(calls.filter((call) => call.options?.method === "POST")).toHaveLength(1);
		expect(calls.filter((call) => call.options?.method === "PUT")).toHaveLength(1);
	});

	it("keeps a folder assignment visible when removal fails", async () => {
		adminSetup(() => Response.json({ error: "Could not remove folder" }, { status: 503 }));
		await render(<AdminUsers />);
		window.confirm = () => true;
		await act(async () => element<HTMLButtonElement>(`button[aria-label="Remove folder ${area.rootPath}"]`).click());
		await flush();
		expect(document.body.textContent).toContain("The request result is uncertain");
		expect(document.querySelector(`button[aria-label="Remove folder ${area.rootPath}"]`)).not.toBeNull();
		expect(calls.filter((call) => call.options?.method === "DELETE")).toHaveLength(1);
	});

	it("keeps admin controls and requests unavailable to normal accounts", async () => {
		setup((path) => {
			throw new Error(`Unexpected request: ${path}`);
		});
		await render(<AdminUsers />);
		expect(document.body.textContent).toContain("Admin access required.");
		expect(calls.filter((call) => call.path.startsWith("/api/admin"))).toHaveLength(0);
	});

	it("ignores an admin mutation that completes after expiry", async () => {
		const pending = deferred<Response>();
		adminSetup(() => pending.promise);
		await render(<AdminUsers />);
		await fillArea();
		await click("Assign folder");
		await act(async () => {
			await sessionFetch("/expire");
		});
		await act(async () => {
			pending.resolve(Response.json({ ...area, id: "8", rootPath: "/srv/new-area" }));
		});
		await act(async () => {
			currentSession = session(admin, "renewed-admin");
			await currentAuth?.acceptSession(currentSession);
		});
		await flush();
		expect(document.querySelector('button[aria-label="Remove folder /srv/new-area"]')).toBeNull();
		expect(document.querySelector<HTMLInputElement>('input[name="folderPath"]')?.value).toBe("/srv/new-area");
	});
});
