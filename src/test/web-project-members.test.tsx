import { afterEach, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS, type AuthSession, type ProjectMember } from "../server/auth-types";
import ProjectMembers from "../web/components/ProjectMembers";
import { AuthProvider } from "../web/contexts/AuthContext";
import { projectScope, readProjectScope, setProjectStorageAccount } from "../web/lib/project-scope";
import { setRequestSession } from "../web/lib/request";

const originalFetch = globalThis.fetch;
const originalScope = { ...projectScope };
let root: Root | null = null;
let dom: JSDOM | null = null;
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
it("adds default membership once, changes a single grant, and removes membership", async () => {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost/projects/1/members",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(projectScope, readProjectScope(window.location.pathname));
	let members: ProjectMember[] = [];
	const writes: Array<{ method: string; body: unknown; csrf: string | null }> = [];
	const session: AuthSession = {
		user: {
			id: "admin-id",
			username: "admin",
			displayName: "Admin",
			role: "admin",
			active: true,
			mustChangePassword: false,
		},
		csrfToken: "admin-csrf",
		createdAt: "2026-01-01",
		expiresAt: "2026-01-02",
		lastActivityAt: "2026-01-01",
		idleExpiresAt: "2026-01-01",
	};
	globalThis.fetch = (async (input, options) => {
		const path = String(input);
		if (path === "/api/auth/session") return Response.json(session);
		if (path === "/api/projects/1") return Response.json({ permissions: ADMIN_PERMISSIONS });
		if (path === "/api/admin/users")
			return Response.json([
				{
					id: "member-id",
					username: "member",
					displayName: "Member",
					role: "user",
					active: true,
					mustChangePassword: false,
				},
			]);
		if (path === "/api/admin/projects/1/members") return Response.json(members);
		if (path === "/api/admin/projects/1/members/member-id") {
			const body = options?.body ? JSON.parse(options.body as string) : null;
			writes.push({ method: options?.method ?? "GET", body, csrf: new Headers(options?.headers).get("X-CSRF-Token") });
			if (options?.method === "DELETE") members = [];
			else
				members = [
					{
						projectId: "1",
						userId: "member-id",
						permissions: { ...(members[0]?.permissions ?? DEFAULT_PERMISSIONS), ...body.permissions },
					},
				];
			return Response.json({ success: true });
		}
		throw new Error(path);
	}) as typeof fetch;
	root = createRoot(document.getElementById("root")!);
	await act(async () => {
		root?.render(
			<AuthProvider>
				<ProjectMembers />
			</AuthProvider>,
		);
	});
	await act(async () => {
		const select = document.querySelector("select")!;
		select.value = "member-id";
		select.dispatchEvent(new window.Event("change", { bubbles: true }));
	});
	await act(async () => {
		document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
	expect(writes).toEqual([{ method: "PUT", body: { permissions: DEFAULT_PERMISSIONS }, csrf: "admin-csrf" }]);
	expect(document.querySelector<HTMLSelectElement>("select")?.value).toBe("");
	expect([...document.querySelectorAll("button")].find((button) => button.textContent === "Add member")?.disabled).toBe(
		true,
	);
	await act(async () => {
		const archive = [...document.querySelectorAll("label")]
			.find((label) => label.textContent?.includes("Archive and restore"))!
			.querySelector("input")!;
		archive.click();
	});
	expect(writes[1]).toEqual({ method: "PUT", body: { permissions: { archive: true } }, csrf: "admin-csrf" });
	expect(members[0]?.permissions).toEqual({ ...DEFAULT_PERMISSIONS, archive: true });
	await act(async () => {
		[...document.querySelectorAll("button")].find((button) => button.textContent === "Remove member")!.click();
	});
	expect(writes[2]?.method).toBe("DELETE");
	expect(members).toEqual([]);
});
