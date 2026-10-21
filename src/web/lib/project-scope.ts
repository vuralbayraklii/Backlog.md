export interface ProjectScope {
	id: string | null;
	routeBase: string;
	apiBase: string;
}

export function readProjectScope(pathname: string): ProjectScope {
	const id = pathname.match(/^\/projects\/([1-9]\d*)(?:\/|$)/)?.[1] ?? null;
	return {
		id,
		routeBase: id ? `/projects/${id}` : "",
		apiBase: id ? `/api/projects/${id}` : "/api",
	};
}

/** Project switches reload the page, so this scope never changes while requests are in flight. */
export const projectScope = readProjectScope(typeof window === "undefined" ? "/" : window.location.pathname);

export function projectStorageKey(key: string, scope = projectScope): string {
	return scope.id ? `backlog.md:project:${scope.id}:${key}` : key;
}

export function projectWebSocketUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}${projectScope.id ? `${projectScope.apiBase}/ws` : ""}`;
}

export function scopeMarkdownUrl(url: string, key: string): string {
	if (key === "href" && url.startsWith("#") && typeof window !== "undefined") {
		return `${window.location.pathname}${window.location.search}${url}`;
	}
	if (!projectScope.id || !url.startsWith("/") || url.startsWith("//")) return url;
	if (url.startsWith("/assets/")) return `${projectScope.apiBase}${url}`;
	if (/^\/(board|tasks|drafts|documentation|decisions|milestones|statistics|settings)(\/|\?|#|$)/.test(url)) {
		return `${projectScope.routeBase}${url}`;
	}
	return url;
}
