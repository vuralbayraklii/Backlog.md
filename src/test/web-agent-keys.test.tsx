import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentKey } from "../server/agent-types";
import type { AuthSession } from "../server/auth-types";
import AdminUsers from "../web/components/AdminUsers";
import { AuthProvider } from "../web/contexts/AuthContext";
import { ThemeProvider } from "../web/contexts/ThemeContext";
import { UnsavedChangesProvider } from "../web/contexts/UnsavedChangesContext";
import { projectScope, readProjectScope, setProjectStorageAccount } from "../web/lib/project-scope";
import { setRequestSession } from "../web/lib/request";
import { setNativeInputValue } from "./react-dom-input";

const admin = {
	id: "admin-1",
	username: "admin",
	displayName: "Admin",
	role: "admin" as const,
	active: true,
	mustChangePassword: false,
};
const owner = { ...admin, id: "user-2", username: "worker", displayName: "Worker", role: "user" as const };
const session: AuthSession = {
	user: admin,
	csrfToken: "csrf-admin",
	createdAt: "2026-01-01T00:00:00Z",
	expiresAt: "2026-01-01T12:00:00Z",
	lastActivityAt: "2026-01-01T00:00:00Z",
	idleExpiresAt: "2026-01-01T02:00:00Z",
};
const readOnly = {
	tasksWrite: false,
	docsWrite: false,
	decisionsWrite: false,
	decisionsManage: false,
	archive: false,
	delete: false,
};
const key = (overrides: Partial<AgentKey> = {}): AgentKey => ({
	id: "key-1",
	userId: owner.id,
	name: "Local agent",
	grants: [{ projectId: "1", permissions: readOnly }],
	createdAt: "2026-01-01T00:00:00Z",
	revokedAt: null,
	revision: "rev-key-1",
	...overrides,
});

const originalFetch = globalThis.fetch;
const originalGlobals = {
	window: globalThis.window,
	document: globalThis.document,
	navigator: globalThis.navigator,
	localStorage: globalThis.localStorage,
	HTMLElement: globalThis.HTMLElement,
	HTMLInputElement: globalThis.HTMLInputElement,
};
const originalScope = { ...projectScope };
let dom: JSDOM | null = null;
let root: Root | null = null;
let requests: Array<{ path: string; options?: RequestInit }> = [];

function setup(handler: (path: string, options?: RequestInit) => Response | Promise<Response>) {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost/admin/users",
	});
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	globalThis.localStorage = dom.window.localStorage;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLInputElement = dom.window.HTMLInputElement;
	Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
	Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(projectScope, readProjectScope(window.location.pathname));
	requests = [];
	globalThis.fetch = (async (input, options) => {
		const path = String(input);
		requests.push({ path, options });
		if (path === "/api/auth/session") return Response.json(session);
		if (path === "/api/version") return Response.json({ version: "1.53.0" });
		if (path === "/api/admin/users" && !options?.method) return Response.json([admin, owner]);
		if (path === "/api/admin/folder-areas") return Response.json([]);
		if (path === "/api/admin/projects")
			return Response.json([
				{ id: "1", name: "Alpha", tracking: true },
				{ id: "2", name: "Dormant", tracking: false },
			]);
		return handler(path, options);
	}) as typeof fetch;
	root = createRoot(document.getElementById("root") as HTMLElement);
}

async function render() {
	await act(async () => {
		root?.render(
			<UnsavedChangesProvider>
				<ThemeProvider>
					<AuthProvider>
						<AdminUsers />
					</AuthProvider>
				</ThemeProvider>
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

function section() {
	const element = document.querySelector<HTMLElement>("#agent-keys");
	if (!element) throw new Error("Agent keys section missing");
	return element;
}

function unloadIsBlocked() {
	const event = new window.Event("beforeunload", { cancelable: true });
	window.dispatchEvent(event);
	return event.defaultPrevented;
}

async function click(label: string) {
	const button = [...section().querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
	if (!button) throw new Error(`Button missing: ${label}`);
	await act(async () => button.click());
	await flush();
}

async function fillForm(name = "Local agent") {
	const ownerSelect = section().querySelector<HTMLSelectElement>("form select");
	const nameInput = section().querySelector<HTMLInputElement>('form input:not([type="checkbox"])');
	const projectBox = section().querySelector<HTMLInputElement>('fieldset input[type="checkbox"]');
	if (!ownerSelect || !nameInput || !projectBox) throw new Error("Agent key form missing");
	await act(async () => {
		ownerSelect.value = owner.id;
		ownerSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
		setNativeInputValue(nameInput, name);
		projectBox.click();
	});
}

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = null;
	dom?.window.close();
	dom = null;
	globalThis.fetch = originalFetch;
	Object.assign(globalThis, originalGlobals);
	Object.assign(projectScope, originalScope);
	setRequestSession({ ...session, user: { ...admin, id: "cleanup" } });
	setRequestSession(null);
	setProjectStorageAccount(null);
});

describe("agent key management in Users", () => {
	it("creates explicit grants and displays the first secret only until dismissed", async () => {
		let stored: AgentKey[] = [];
		setup((path, options) => {
			if (path === "/api/admin/agent-keys" && !options?.method) return Response.json(stored);
			if (path === "/api/admin/agent-keys" && options?.method === "POST") {
				const created = key({ grants: JSON.parse(String(options.body)).grants });
				stored = [created];
				return Response.json({ key: created, secret: "one-time-secret" });
			}
			throw new Error(path);
		});
		window.localStorage.setItem("backlog-theme", "dark");
		await render();
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		await click("Manage agent keys");
		await fillForm();
		expect(unloadIsBlocked()).toBe(true);
		const tasks = [...section().querySelectorAll("label")].find((label) => label.textContent?.trim() === "Tasks");
		const archive = [...section().querySelectorAll("label")].find(
			(label) => label.textContent?.trim() === "Archive and restore",
		);
		if (!tasks || !archive) throw new Error("Grant permission boxes missing");
		await act(async () => {
			tasks.querySelector("input")?.click();
			archive.querySelector("input")?.click();
		});
		await click("Create key");
		const sent = requests.find(
			(request) => request.path === "/api/admin/agent-keys" && request.options?.method === "POST",
		);
		if (!sent) throw new Error("Key create request missing");
		expect(JSON.parse(String(sent.options?.body))).toEqual({
			userId: owner.id,
			name: "Local agent",
			grants: [{ projectId: "1", permissions: { ...readOnly, tasksWrite: true, archive: true } }],
		});
		expect(new Headers(sent.options?.headers).get("X-CSRF-Token")).toBe("csrf-admin");
		expect(new Headers(sent.options?.headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
		expect(section().textContent).toContain("one-time-secret");
		expect(unloadIsBlocked()).toBe(true);
		expect(window.localStorage.getItem("one-time-secret")).toBeNull();
		await click("Dismiss secret");
		expect(section().textContent).not.toContain("one-time-secret");
		expect(unloadIsBlocked()).toBe(false);
		await click("Close agent keys");
		await click("Manage agent keys");
		expect(section().textContent).not.toContain("one-time-secret");
		expect(section().textContent).toContain("Local agent");
	});

	it("permits read-only grants and explains a safe replay without a secret", async () => {
		setup((path, options) => {
			if (path === "/api/admin/agent-keys" && !options?.method) return Response.json([]);
			if (path === "/api/admin/agent-keys" && options?.method === "POST") return Response.json({ key: key() });
			throw new Error(path);
		});
		await render();
		await click("Manage agent keys");
		await fillForm();
		await click("Create key");
		const sent = requests.find(
			(request) => request.path === "/api/admin/agent-keys" && request.options?.method === "POST",
		);
		expect(JSON.parse(String(sent?.options?.body)).grants).toEqual([{ projectId: "1", permissions: readOnly }]);
		expect(section().textContent).toContain("secret is no longer available");
		expect(section().textContent).toContain("Read only");
	});

	it("revokes the listed revision with one UUID and retains management in the shared theme", async () => {
		let stored = [key()];
		setup((path, options) => {
			if (path === "/api/admin/agent-keys" && !options?.method) return Response.json(stored);
			if (path === "/api/admin/agent-keys/key-1/revoke" && options?.method === "POST") {
				stored = [key({ revokedAt: "2026-01-02T00:00:00Z", revision: "rev-key-2" })];
				return Response.json({ key: stored[0] });
			}
			throw new Error(path);
		});
		await render();
		await click("Manage agent keys");
		window.confirm = () => true;
		await click("Revoke");
		const sent = requests.find((request) => request.path.endsWith("/revoke") && request.options?.method === "POST");
		expect(new Headers(sent?.options?.headers).get("If-Match")).toBe("rev-key-1");
		expect(new Headers(sent?.options?.headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
		expect(section().textContent).toContain("Revoked");
		expect([...section().querySelectorAll("button")].some((button) => button.textContent?.trim() === "Revoke")).toBe(
			false,
		);
	});
});
