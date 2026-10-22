/** Existing auth/registration fixtures act like a client that just loaded its edit snapshot.
 * Protocol tests use raw fetch so missing/stale preconditions remain explicit assertions. */
export async function centralFixtureFetch(input: string, init: RequestInit = {}): Promise<Response> {
	const method = (init.method ?? "GET").toUpperCase();
	const headers = new Headers(init.headers);
	if (["GET", "HEAD", "OPTIONS"].includes(method)) return fetch(input, { ...init, headers });
	const url = new URL(input);
	if (/^\/api\/(projects|admin)(?:\/|$)/.test(url.pathname)) {
		if (!headers.has("Idempotency-Key")) headers.set("Idempotency-Key", crypto.randomUUID());
		if (!headers.has("If-Match")) {
			let readPath: string | null = null;
			let select: ((value: unknown) => unknown) | undefined;
			const content = url.pathname.match(
				/^(\/api\/projects\/[^/]+\/(?:tasks|docs|decisions|drafts|milestones)\/[^/]+)(?:\/(?:archive|restore|demote|promote))?$/,
			);
			if (content && !/\/(?:move|reorder|duplicates|cleanup)$/.test(content[1] ?? "")) readPath = content[1] ?? null;
			if (/^\/api\/projects\/[^/]+\/config$/.test(url.pathname)) readPath = url.pathname;
			if (/^\/api\/admin\/users\/[^/]+$/.test(url.pathname)) readPath = url.pathname;
			const member = url.pathname.match(/^(\/api\/admin\/projects\/[^/]+\/members)\/([^/]+)$/);
			if (member) {
				readPath = member[1] ?? null;
				select = (value) =>
					Array.isArray(value)
						? value.find((record) => record.userId === decodeURIComponent(member[2] ?? ""))
						: undefined;
			}
			const area = url.pathname.match(/^\/api\/admin\/folder-areas\/([^/]+)$/);
			if (area) {
				readPath = "/api/admin/folder-areas";
				select = (value) =>
					Array.isArray(value) ? value.find((record) => record.id === decodeURIComponent(area[1] ?? "")) : undefined;
			}
			const tracking = url.pathname.match(/^\/api\/admin\/projects\/([^/]+)\/tracking$/);
			if (tracking) {
				readPath = "/api/admin/projects";
				select = (value) => (Array.isArray(value) ? value.find((record) => record.id === tracking[1]) : undefined);
			}
			if (readPath) {
				const snapshot = await fetch(new URL(readPath, url), { headers, redirect: "manual" });
				if (snapshot.ok) {
					const body: unknown = await snapshot.json().catch(() => null);
					const record = select ? select(body) : body;
					const revision =
						snapshot.headers.get("ETag") ??
						(record && typeof record === "object" && "revision" in record ? record.revision : null);
					if (typeof revision === "string") headers.set("If-Match", revision);
				}
			}
		}
	}
	return fetch(input, { ...init, headers });
}
