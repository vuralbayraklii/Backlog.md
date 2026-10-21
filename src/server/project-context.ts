import { resolve } from "node:path";
import { Core } from "../core/backlog.ts";
import type { ContentStore } from "../core/content-store.ts";
import type { SearchService } from "../core/search-service.ts";

/** Workspace identity is separate from a task's optional project field. */
export interface ProjectContext {
	readonly projectId: string;
	readonly projectRoot: string;
	readonly core: Core;
	readonly contentStore: ContentStore;
	readonly searchService: SearchService;
}

interface ContextEntry {
	projectRoot: string;
	core: Core;
	ready: Promise<ProjectContext>;
}

function disposeCore(core: Core): void {
	core.disposeSearchService();
	core.disposeContentStore();
}

/** Runtime contexts for trusted project bindings; persistence and access checks live outside this registry. */
export class ProjectContextRegistry {
	private readonly contexts = new Map<string, ContextEntry>();
	private readonly closing = new Set<Promise<void>>();
	private closed = false;

	async open(projectId: string, projectRoot: string): Promise<ProjectContext> {
		if (this.closed) throw new Error("Project context registry has been disposed.");
		if (!projectId.trim()) throw new Error("Project ID is required.");
		if (!projectRoot.trim()) throw new Error("Project root is required.");

		const root = resolve(projectRoot);
		const existing = this.contexts.get(projectId);
		if (existing) {
			if (existing.projectRoot !== root) {
				throw new Error(`Project "${projectId}" is already open with a different root.`);
			}
			return existing.ready;
		}

		const core = new Core(root, { enableWatchers: true });
		const ready = this.initialize(projectId, root, core);
		this.contexts.set(projectId, { projectRoot: root, core, ready });
		return ready;
	}

	async get(projectId: string): Promise<ProjectContext> {
		const entry = this.contexts.get(projectId);
		if (!entry) throw new Error(`Project "${projectId}" is not open.`);
		return entry.ready;
	}

	async close(projectId: string): Promise<void> {
		const entry = this.contexts.get(projectId);
		if (!entry) return;
		this.contexts.delete(projectId);
		// Drain initialization before disposal so an unfinished Core load cannot restart its watchers.
		const closing = entry.ready.catch(() => undefined).then(() => disposeCore(entry.core));
		this.closing.add(closing);
		try {
			await closing;
		} finally {
			this.closing.delete(closing);
		}
	}

	async dispose(): Promise<void> {
		this.closed = true;
		await Promise.all([...this.contexts.keys()].map((projectId) => this.close(projectId)));
		await Promise.all(this.closing);
	}

	private async initialize(projectId: string, projectRoot: string, core: Core): Promise<ProjectContext> {
		try {
			const contentStore = await core.getContentStore();
			const searchService = await core.getSearchService();
			if (this.contexts.get(projectId)?.core !== core) {
				throw new Error(`Project "${projectId}" was closed during initialization.`);
			}
			return { projectId, projectRoot, core, contentStore, searchService };
		} catch (error) {
			if (this.contexts.get(projectId)?.core === core) this.contexts.delete(projectId);
			disposeCore(core);
			throw error;
		}
	}
}
