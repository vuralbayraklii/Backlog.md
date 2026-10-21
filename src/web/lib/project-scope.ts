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

let storageAccount: string | null = null;

/** Preference keys are account-scoped in central mode; session credentials never enter storage. */
export function setProjectStorageAccount(userId: string | null): void {
	storageAccount = userId;
}

export function projectStorageKey(key: string, scope = projectScope): string {
	const projectKey = scope.id ? `backlog.md:project:${scope.id}:${key}` : key;
	return storageAccount ? `backlog.md:user:${storageAccount}:${projectKey}` : projectKey;
}

export function projectWebSocketUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}${projectScope.id ? `${projectScope.apiBase}/ws` : ""}`;
}

export function scopeMarkdownUrl(url: string, key: string): string {
	// Control characters and whitespace cannot disguise active URL schemes.
	const normalized = [...url]
		.filter((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
		.join("");
	if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) && !/^(https?:|ftp:|mailto:|tel:)/i.test(normalized)) return "";
	if (normalized.startsWith("//")) return "";
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
