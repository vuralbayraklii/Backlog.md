import type { DuplicateRepairPlan, DuplicateRepairResult } from "../../core/duplicate-task-repair.ts";
import type { TaskStatistics } from "../../core/statistics.ts";
import type { TaskDetail } from "../../core/task-detail.ts";
import type {
	BacklogConfig,
	Decision,
	Document,
	Milestone,
	SearchPriorityFilter,
	SearchResult,
	SearchResultType,
	Task,
	TaskStatus,
} from "../../types/index.ts";
import { projectScope } from "./project-scope";
import { sessionFetch, UncertainMutationError } from "./request";

export interface ReorderTaskPayload {
	taskId: string;
	targetStatus: string;
	orderedTaskIds: string[];
	targetMilestone?: string | null;
	expectedRevisions?: Record<string, string>;
}

export interface MoveTasksPayload {
	taskIds: string[];
	targetStatus: string;
	targetMilestone?: string | null;
	expectedRevisions?: Record<string, string>;
}

export interface RecordVersionLike {
	recordKey?: string;
	revision?: string;
}

function versionHeaders(record?: RecordVersionLike | null): Record<string, string> | undefined {
	return projectScope.id && record?.revision ? { "If-Match": record.revision } : undefined;
}

export interface MoveTasksResult {
	success: boolean;
	tasks: Task[];
	changedTasks: Task[];
	failures: Array<{ taskId: string; reason: string }>;
	tasksRevision?: string | null;
}

/**
 * Read the marker the server forwards when a mutation failed after the record had already moved.
 * The view converges on what happened instead of offering a retry of a move that already ran.
 */
function readMovedFailureData(error: unknown): Record<string, unknown> | null {
	if (
		!(error instanceof ApiError) ||
		error.status === undefined ||
		error.status < 500 ||
		typeof error.data !== "object" ||
		error.data === null
	) {
		return null;
	}
	return error.data as Record<string, unknown>;
}

export function readMovedFailureState(
	error: unknown,
	key: "archiveState" | "demotionState",
): "moved" | "partial" | null {
	const state = readMovedFailureData(error)?.[key];
	return state === "moved" || state === "partial" ? state : null;
}

export function readDemotionFailureCause(error: unknown): "cleanup" | "commit" | null {
	const cause = readMovedFailureData(error)?.demotionFailureCause;
	return cause === "cleanup" || cause === "commit" ? cause : null;
}

/** Demoting vacates a task ID: `cleanedTaskIds` names the records that lost a reference to it. */
export interface TaskVacancyResponse {
	success: boolean;
	cleanedTaskIds: string[];
}

export type TaskUpdateRequest = Omit<Partial<Task>, "milestone" | "dueDate" | "project"> & {
	milestone?: string | null;
	dueDate?: string | null;
	project?: string | null;
	commentsAppend?: string[];
	commentAuthor?: string;
};

export interface InitializationStatus {
	initialized: boolean;
	projectPath: string;
	backlogDirectory?: string | null;
	backlogDirectorySource?: "backlog" | ".backlog" | "custom" | null;
	configLocation?: "folder" | "root" | null;
	rootConfigPath?: string | null;
}

// Enhanced error types for better error handling
export class ApiError extends Error {
	constructor(
		message: string,
		public status?: number,
		public code?: string,
		public data?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}

	static fromResponse(response: Response, data?: unknown): ApiError {
		const errorMessage =
			typeof data === "object" && data !== null && "error" in data ? (data as { error?: unknown }).error : undefined;
		const message =
			typeof errorMessage === "string" && errorMessage.trim().length > 0
				? errorMessage
				: `HTTP ${response.status}: ${response.statusText}`;
		const code = typeof data === "object" && data !== null && "code" in data ? (data as { code?: unknown }).code : null;
		return new ApiError(message, response.status, typeof code === "string" ? code : response.statusText, data);
	}
}

export class NetworkError extends Error {
	constructor(message = "Network request failed") {
		super(message);
		this.name = "NetworkError";
	}
}

/** Builds an ApiError that keeps the server's message when the response body carries one. */
async function toApiError(response: Response, fallbackMessage: string): Promise<ApiError> {
	const data = await response.json().catch(() => undefined);
	const serverMessage = typeof data === "object" && data !== null ? (data as { error?: unknown }).error : undefined;
	const message =
		typeof serverMessage === "string" && serverMessage.trim().length > 0 ? serverMessage : fallbackMessage;
	const code = typeof data === "object" && data !== null && "code" in data ? (data as { code?: unknown }).code : null;
	return new ApiError(message, response.status, typeof code === "string" ? code : response.statusText, data);
}

/** Legacy local 409 responses had no code; central responses distinguish their cause. */
export function isAmbiguousIdConflict(error: unknown): error is ApiError {
	return (
		error instanceof ApiError &&
		error.status === 409 &&
		(error.code === "AMBIGUOUS_ID" || typeof error.data !== "object" || error.data === null || !("code" in error.data))
	);
}

// Request configuration interface
interface RequestConfig {
	retries?: number;
	timeout?: number;
	Headers?: Record<string, string>;
}

type SearchRequestOptions = {
	query?: string;
	types?: SearchResultType[];
	status?: string | string[];
	excludeStatus?: string | string[];
	priority?: SearchPriorityFilter | SearchPriorityFilter[];
	assignee?: string | string[];
	labels?: string[];
	modifiedFiles?: string[];
	limit?: number;
};

// Default configuration
const DEFAULT_CONFIG: RequestConfig = {
	retries: 3,
	timeout: 10000,
};

export class ApiClient {
	private config: RequestConfig;

	constructor(config: RequestConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// Enhanced fetch with retry logic and better error handling
	private async fetchWithRetry(url: string, options: RequestInit = {}, retriesOverride?: number): Promise<Response> {
		const { retries: configuredRetries = 3, timeout = 10000 } = this.config;
		const retries = ["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase())
			? (retriesOverride ?? configuredRetries)
			: 0;
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);
				const headers = new Headers(options.headers);
				if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
				let response: Response;
				try {
					response = await sessionFetch(url, { ...options, signal: controller.signal, headers });
				} finally {
					clearTimeout(timeoutId);
				}

				if (!response.ok) {
					let errorData: unknown = null;
					try {
						errorData = await response.json();
					} catch {
						// Ignore JSON parse errors for error data
					}
					throw ApiError.fromResponse(response, errorData);
				}

				return response;
			} catch (error) {
				lastError = error as Error;
				if (error instanceof UncertainMutationError) throw error;

				// Don't retry on client errors (4xx) or specific cases
				if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) {
					throw error;
				}

				// For network errors or server errors, retry with exponential backoff
				if (attempt < retries) {
					const delay = Math.min(1000 * 2 ** attempt, 10000);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}

		// If we get here, all retries failed
		if (lastError instanceof ApiError) {
			throw lastError;
		}
		throw new NetworkError(`Request failed after ${retries + 1} attempts: ${lastError?.message}`);
	}

	private async fetchWithoutRetry(url: string, options: RequestInit = {}): Promise<Response> {
		return await this.fetchWithRetry(url, options, 0);
	}

	// Helper method for JSON responses
	private async fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
		const response = await this.fetchWithRetry(url, options);
		return response.json();
	}
	async fetchTasks(options?: {
		status?: string;
		excludeStatus?: string | string[];
		assignee?: string;
		parent?: string;
		priority?: SearchPriorityFilter;
		labels?: string[];
		crossBranch?: boolean;
	}): Promise<Task[]> {
		const params = new URLSearchParams();
		if (options?.status) params.append("status", options.status);
		if (options?.excludeStatus) {
			const statuses = Array.isArray(options.excludeStatus) ? options.excludeStatus : [options.excludeStatus];
			for (const status of statuses) {
				if (status && status.trim().length > 0) {
					params.append("excludeStatus", status.trim());
				}
			}
		}
		if (options?.assignee) params.append("assignee", options.assignee);
		if (options?.parent) params.append("parent", options.parent);
		if (options?.priority) params.append("priority", options.priority);
		if (options?.labels) {
			for (const label of options.labels) {
				if (label && label.trim().length > 0) {
					params.append("label", label.trim());
				}
			}
		}
		// Default to true for cross-branch loading to match TUI behavior
		if (options?.crossBranch !== false) params.append("crossBranch", "true");

		const url = `${projectScope.apiBase}/tasks${params.toString() ? `?${params.toString()}` : ""}`;
		return this.fetchJson<Task[]>(url);
	}

	async search(options: SearchRequestOptions = {}): Promise<SearchResult[]> {
		return (await this.searchSnapshot(options)).results;
	}

	async searchSnapshot(
		options: SearchRequestOptions = {},
	): Promise<{ results: SearchResult[]; tasksRevision: string | null }> {
		const params = new URLSearchParams();
		if (options.query) {
			params.set("query", options.query);
		}
		if (options.types && options.types.length > 0) {
			for (const type of options.types) {
				params.append("type", type);
			}
		}
		if (options.status) {
			const statuses = Array.isArray(options.status) ? options.status : [options.status];
			for (const status of statuses) {
				params.append("status", status);
			}
		}
		if (options.excludeStatus) {
			const statuses = Array.isArray(options.excludeStatus) ? options.excludeStatus : [options.excludeStatus];
			for (const status of statuses) {
				if (status && status.trim().length > 0) {
					params.append("excludeStatus", status.trim());
				}
			}
		}
		if (options.priority) {
			const priorities = Array.isArray(options.priority) ? options.priority : [options.priority];
			for (const priority of priorities) {
				params.append("priority", priority);
			}
		}
		if (options.assignee) {
			const assignees = Array.isArray(options.assignee) ? options.assignee : [options.assignee];
			for (const assignee of assignees) {
				if (assignee && assignee.trim().length > 0) {
					params.append("assignee", assignee.trim());
				}
			}
		}
		if (options.labels) {
			for (const label of options.labels) {
				if (label && label.trim().length > 0) {
					params.append("label", label.trim());
				}
			}
		}
		if (options.modifiedFiles) {
			for (const file of options.modifiedFiles) {
				if (file && file.trim().length > 0) {
					params.append("modifiedFile", file.trim());
				}
			}
		}
		if (options.limit !== undefined) {
			params.set("limit", String(options.limit));
		}

		const url = `${projectScope.apiBase}/search${params.toString() ? `?${params.toString()}` : ""}`;
		const response = await this.fetchWithRetry(url);
		return {
			results: (await response.json()) as SearchResult[],
			tasksRevision: response.headers.get("X-Backlog-Tasks-Revision"),
		};
	}

	/** Reads one task through the detail path, so the response already carries its dependency graph. */
	async fetchTask(id: string): Promise<TaskDetail> {
		return this.fetchJson<TaskDetail>(`${projectScope.apiBase}/task/${encodeURIComponent(id)}`);
	}

	async createTask(task: Omit<Task, "id" | "createdDate">): Promise<Task> {
		return this.fetchJson<Task>(`${projectScope.apiBase}/tasks`, {
			method: "POST",
			body: JSON.stringify(task),
		});
	}

	async updateTask(id: string, updates: TaskUpdateRequest, record?: RecordVersionLike | null): Promise<Task> {
		return this.fetchJson<Task>(`${projectScope.apiBase}/tasks/${id}`, {
			method: "PUT",
			headers: versionHeaders(record),
			body: JSON.stringify(updates),
		});
	}

	async reorderTask(
		payload: ReorderTaskPayload,
		tasksRevision?: string | null,
	): Promise<{ success: boolean; task: Task; changedTasks: Task[]; tasksRevision?: string | null }> {
		const response = await this.fetchWithRetry(`${projectScope.apiBase}/tasks/reorder`, {
			method: "POST",
			headers: projectScope.id && tasksRevision ? { "If-Match": tasksRevision } : undefined,
			body: JSON.stringify(payload),
		});
		return {
			...((await response.json()) as { success: boolean; task: Task; changedTasks: Task[] }),
			tasksRevision: response.headers.get("X-Backlog-Tasks-Revision"),
		};
	}

	async moveTasks(payload: MoveTasksPayload): Promise<MoveTasksResult> {
		const response = await this.fetchWithRetry(`${projectScope.apiBase}/tasks/move`, {
			method: "POST",
			body: JSON.stringify(payload),
		});
		return {
			...((await response.json()) as MoveTasksResult),
			tasksRevision: response.headers.get("X-Backlog-Tasks-Revision"),
		};
	}

	// Not retried, for the same reason demote is not: the second attempt would target a task the
	// first attempt already archived, and its "not found" would replace the real outcome.
	async archiveTask(id: string, record?: RecordVersionLike | null): Promise<void> {
		await this.fetchWithoutRetry(`${projectScope.apiBase}/tasks/${encodeURIComponent(id)}/archive`, {
			method: "POST",
			headers: versionHeaders(record),
		});
	}

	async demoteTask(id: string, record?: RecordVersionLike | null): Promise<TaskVacancyResponse> {
		const response = await this.fetchWithoutRetry(`${projectScope.apiBase}/tasks/${encodeURIComponent(id)}/demote`, {
			method: "POST",
			headers: versionHeaders(record),
		});
		return response.json();
	}

	async getCleanupPreview(age: number): Promise<{
		count: number;
		fingerprint?: string;
		tasks: Array<{ id: string; title: string; updatedDate?: string; createdDate: string }>;
	}> {
		return this.fetchJson<{
			count: number;
			fingerprint?: string;
			tasks: Array<{ id: string; title: string; updatedDate?: string; createdDate: string }>;
		}>(`${projectScope.apiBase}/tasks/cleanup?age=${age}`);
	}

	/**
	 * Archive the tasks a cleanup preview showed, and only those. The server skips a task that has left
	 * the board or the final status since the preview.
	 */
	async executeCleanup(
		taskIds: string[],
		fingerprint?: string,
	): Promise<{ success: boolean; movedCount: number; totalCount: number; message: string; failedTasks?: string[] }> {
		return this.fetchJson<{
			success: boolean;
			movedCount: number;
			totalCount: number;
			message: string;
			failedTasks?: string[];
		}>(`${projectScope.apiBase}/tasks/cleanup/execute`, {
			method: "POST",
			body: JSON.stringify({ taskIds, ...(projectScope.id && fingerprint ? { fingerprint } : {}) }),
		});
	}

	async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
		return this.updateTask(id, { status });
	}

	async fetchDuplicateTaskRepairPlan(): Promise<DuplicateRepairPlan> {
		return await this.fetchJson<DuplicateRepairPlan>(`${projectScope.apiBase}/tasks/duplicates`);
	}

	async repairDuplicateTaskIds(fingerprint: string): Promise<DuplicateRepairResult> {
		return await this.fetchJson<DuplicateRepairResult>(`${projectScope.apiBase}/tasks/duplicates`, {
			method: "POST",
			body: JSON.stringify({ fingerprint }),
		});
	}

	async fetchStatuses(): Promise<string[]> {
		const response = await sessionFetch(`${projectScope.apiBase}/statuses`);
		if (!response.ok) {
			throw new Error("Failed to fetch statuses");
		}
		return response.json();
	}

	async fetchConfig(): Promise<BacklogConfig> {
		return (await this.fetchConfigSnapshot()).config;
	}

	async fetchConfigSnapshot(): Promise<{ config: BacklogConfig; revision: string | null }> {
		const response = await sessionFetch(`${projectScope.apiBase}/config`);
		if (!response.ok) {
			throw new Error("Failed to fetch config");
		}
		return { config: (await response.json()) as BacklogConfig, revision: response.headers.get("ETag") };
	}

	async updateConfig(config: Partial<BacklogConfig>, revision?: string | null): Promise<BacklogConfig> {
		return (await this.updateConfigSnapshot(config, revision)).config;
	}

	async updateConfigSnapshot(
		config: Partial<BacklogConfig>,
		revision?: string | null,
	): Promise<{ config: BacklogConfig; revision: string | null }> {
		const response = await sessionFetch(`${projectScope.apiBase}/config`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				...(projectScope.id && revision ? { "If-Match": revision } : {}),
			},
			body: JSON.stringify(config),
		});
		if (!response.ok) throw await toApiError(response, "Failed to update config");
		return { config: (await response.json()) as BacklogConfig, revision: response.headers.get("ETag") };
	}

	async fetchDocs(): Promise<Document[]> {
		const response = await sessionFetch(`${projectScope.apiBase}/docs`);
		if (!response.ok) {
			throw new Error("Failed to fetch documentation");
		}
		return response.json();
	}

	async fetchDoc(filename: string): Promise<Document> {
		const response = await sessionFetch(`${projectScope.apiBase}/docs/${encodeURIComponent(filename)}`);
		if (!response.ok) {
			throw await toApiError(response, "Failed to fetch document");
		}
		return response.json();
	}

	async fetchDocument(id: string): Promise<Document> {
		const response = await sessionFetch(`${projectScope.apiBase}/doc/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw await toApiError(response, "Failed to fetch document");
		}
		return response.json();
	}

	async updateDoc(
		filename: string,
		content: string,
		title?: string,
		path?: string | null,
		record?: RecordVersionLike | null,
	): Promise<Document> {
		const payload: Record<string, unknown> = { content };
		if (typeof title === "string") {
			payload.title = title;
		}
		if (path !== undefined) {
			payload.path = path;
		}

		const response = await sessionFetch(`${projectScope.apiBase}/docs/${encodeURIComponent(filename)}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				...versionHeaders(record),
			},
			body: JSON.stringify(payload),
		});
		if (!response.ok) {
			throw await toApiError(response, "Failed to update document");
		}
		return response.json();
	}

	async createDoc(filename: string, content: string, path?: string): Promise<Document & { success?: boolean }> {
		const response = await sessionFetch(`${projectScope.apiBase}/docs`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ filename, content, path }),
		});
		if (!response.ok) {
			throw await toApiError(response, "Failed to create document");
		}
		return response.json();
	}

	// Archive is not retried, for the reason task archive is not: the second attempt would target a
	// record the first attempt already archived, and its refusal would replace the real outcome.
	async archiveDoc(id: string, record?: RecordVersionLike | null): Promise<void> {
		await this.fetchWithoutRetry(`${projectScope.apiBase}/docs/${encodeURIComponent(id)}/archive`, {
			method: "POST",
			headers: versionHeaders(record),
		});
	}

	async archiveDecision(id: string, record?: RecordVersionLike | null): Promise<void> {
		await this.fetchWithoutRetry(`${projectScope.apiBase}/decisions/${encodeURIComponent(id)}/archive`, {
			method: "POST",
			headers: versionHeaders(record),
		});
	}

	async fetchDecisions(): Promise<Decision[]> {
		const response = await sessionFetch(`${projectScope.apiBase}/decisions`);
		if (!response.ok) {
			throw new Error("Failed to fetch decisions");
		}
		return response.json();
	}

	async fetchDecision(id: string): Promise<Decision> {
		const response = await sessionFetch(`${projectScope.apiBase}/decisions/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw await toApiError(response, "Failed to fetch decision");
		}
		return response.json();
	}

	async fetchDecisionData(id: string): Promise<Decision> {
		const response = await sessionFetch(`${projectScope.apiBase}/decision/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw await toApiError(response, "Failed to fetch decision");
		}
		return response.json();
	}

	async updateDecision(id: string, content: string, record?: RecordVersionLike | null): Promise<void> {
		const response = await sessionFetch(`${projectScope.apiBase}/decisions/${encodeURIComponent(id)}`, {
			method: "PUT",
			headers: {
				"Content-Type": "text/plain",
				...versionHeaders(record),
			},
			body: content,
		});
		if (!response.ok) {
			throw await toApiError(response, "Failed to update decision");
		}
	}

	async createDecision(title: string): Promise<Decision> {
		const response = await sessionFetch(`${projectScope.apiBase}/decisions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title }),
		});
		if (!response.ok) {
			throw await toApiError(response, "Failed to create decision");
		}
		return response.json();
	}

	async fetchMilestones(): Promise<Milestone[]> {
		const response = await sessionFetch(`${projectScope.apiBase}/milestones`);
		if (!response.ok) {
			throw new Error("Failed to fetch milestones");
		}
		return response.json();
	}

	async fetchArchivedMilestones(): Promise<Milestone[]> {
		const response = await sessionFetch(`${projectScope.apiBase}/milestones/archived`);
		if (!response.ok) {
			throw new Error("Failed to fetch archived milestones");
		}
		return response.json();
	}

	async fetchMilestone(id: string): Promise<Milestone> {
		const response = await sessionFetch(`${projectScope.apiBase}/milestones/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw new Error("Failed to fetch milestone");
		}
		return response.json();
	}

	async createMilestone(title: string, description?: string, dueDate?: string): Promise<Milestone> {
		const response = await sessionFetch(`${projectScope.apiBase}/milestones`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title, description, dueDate }),
		});
		if (!response.ok) throw await toApiError(response, "Failed to create milestone");
		return response.json();
	}

	async updateMilestone(
		id: string,
		title: string,
		dueDate?: string | null,
		record?: RecordVersionLike | null,
	): Promise<{ success: boolean; milestone?: Milestone | null; message?: string }> {
		const response = await sessionFetch(`${projectScope.apiBase}/milestones/${encodeURIComponent(id)}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				...versionHeaders(record),
			},
			body: JSON.stringify({ title, dueDate }),
		});
		if (!response.ok) throw await toApiError(response, "Failed to update milestone");
		return response.json();
	}

	async removeMilestone(
		id: string,
		options: { taskHandling?: "clear" | "keep" | "reassign"; reassignTo?: string } = {},
		record?: RecordVersionLike | null,
	): Promise<{ success: boolean; message?: string }> {
		const response = await sessionFetch(`${projectScope.apiBase}/milestones/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers: {
				"Content-Type": "application/json",
				...versionHeaders(record),
			},
			body: JSON.stringify(options),
		});
		if (!response.ok) throw await toApiError(response, "Failed to remove milestone");
		return response.json();
	}

	async archiveMilestone(
		id: string,
		record?: RecordVersionLike | null,
	): Promise<{ success: boolean; milestone?: Milestone | null }> {
		const response = await sessionFetch(`${projectScope.apiBase}/milestones/${encodeURIComponent(id)}/archive`, {
			method: "POST",
			headers: versionHeaders(record),
		});
		if (!response.ok) throw await toApiError(response, "Failed to archive milestone");
		return response.json();
	}

	async fetchStatistics(): Promise<
		TaskStatistics & { statusCounts: Record<string, number>; priorityCounts: Record<string, number> }
	> {
		return this.fetchJson<
			TaskStatistics & { statusCounts: Record<string, number>; priorityCounts: Record<string, number> }
		>(`${projectScope.apiBase}/statistics`);
	}

	async checkStatus(): Promise<InitializationStatus> {
		return this.fetchJson<InitializationStatus>(`${projectScope.apiBase}/status`);
	}

	async initializeProject(options: {
		projectName: string;
		backlogDirectory?: string;
		backlogDirectorySource?: "backlog" | ".backlog" | "custom";
		configLocation?: "folder" | "root";
		integrationMode: "mcp" | "cli" | "none";
		mcpClients?: ("claude" | "codex" | "gemini" | "kiro" | "guide")[];
		agentInstructions?: ("CLAUDE.md" | "AGENTS.md" | "GEMINI.md" | ".github/copilot-instructions.md")[];
		installClaudeAgent?: boolean;
		filesystemOnly?: boolean;
		advancedConfig?: {
			checkActiveBranches?: boolean;
			remoteOperations?: boolean;
			activeBranchDays?: number;
			bypassGitHooks?: boolean;
			autoCommit?: boolean;
			zeroPaddedIds?: number;
			taskPrefix?: string;
			defaultEditor?: string;
			defaultPort?: number;
			autoOpenBrowser?: boolean;
		};
	}): Promise<{ success: boolean; projectName: string; mcpResults?: Record<string, string> }> {
		return this.fetchJson<{ success: boolean; projectName: string; mcpResults?: Record<string, string> }>(
			`${projectScope.apiBase}/init`,
			{
				method: "POST",
				body: JSON.stringify(options),
			},
		);
	}
}

export const apiClient = new ApiClient();
