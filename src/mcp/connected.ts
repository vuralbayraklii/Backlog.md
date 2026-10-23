import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListResourceTemplatesRequestSchema,
	ListToolsRequestSchema,
	McpError,
	ReadResourceRequestSchema,
	RootsListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ServerClient, ServerClientError, type ServerConnectionOptions } from "../server/client.ts";
import type { BacklogConfig, Document, Milestone, SearchResult, Task } from "../types/index.ts";
import { getPackageName } from "../utils/app-info.ts";
import { createReadinessGraph, getTaskReadiness } from "../utils/readiness.ts";
import { createTaskSearchIndex } from "../utils/task-search.ts";
import { sortTasks } from "../utils/task-sorting.ts";
import { getVersion } from "../utils/version.ts";
import { BacklogToolError } from "./errors/mcp-errors.ts";
import {
	definitionOfDoneDefaultsGetSchema,
	definitionOfDoneDefaultsUpsertSchema,
} from "./tools/definition-of-done/schemas.ts";
import {
	documentArchiveSchema,
	documentCreateSchema,
	documentListSchema,
	documentSearchSchema,
	documentUpdateSchema,
	documentViewSchema,
} from "./tools/documents/schemas.ts";
import {
	milestoneAddSchema,
	milestoneArchiveSchema,
	milestoneListSchema,
	milestoneRemoveSchema,
	milestoneRenameSchema,
} from "./tools/milestones/schemas.ts";
import { taskArchiveSchema, taskViewSchema } from "./tools/tasks/schemas.ts";
import type { CallToolResult, McpToolHandler } from "./types.ts";
import {
	generateTaskCreateSchema,
	generateTaskEditSchema,
	generateTaskListSchema,
	generateTaskSearchSchema,
} from "./utils/schema-generators.ts";
import { createSimpleValidatedTool } from "./validation/tool-wrapper.ts";
import type { JsonSchema } from "./validation/validators.ts";
import {
	getWorkflowGuideByKey,
	getWorkflowGuideByUri,
	WORKFLOW_GUIDE_KEYS,
	WORKFLOW_GUIDES,
} from "./workflow-guides.ts";

const CONNECTED_GUIDE = `
## Connected server project

This MCP session is fixed to one registered Backlog.md project. MCP client workspace roots do not change it. Read a record before changing it and pass its top-level revision to every update, archive, restore, or delete tool. A create needs no revision.

Each write accepts an optional operationId UUID. Reuse the same ID, original revision and identical input only when explicitly retrying an uncertain result. Inspect it with the canonical CLI command 'operation view <id> --json' and the same connection flags before trying a new ID.

The key's explicit grants intersect its owner's current project permissions. This MCP session cannot administer users, projects, or config. Config and Definition of Done defaults are read only in connected mode. A failed server connection never falls back to local files.
`;

type Input = Record<string, unknown>;

function value<T>(input: Input, key: string): T | undefined {
	return input[key] as T | undefined;
}

function result(kind: string, data: unknown): CallToolResult {
	const payload = { kind, data };
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		structuredContent: payload,
	};
}

function writeSchema(schema: JsonSchema, revision = false): JsonSchema {
	return {
		...schema,
		properties: {
			...schema.properties,
			...(revision
				? { revision: { type: "string", minLength: 1, description: "Top-level revision from the record you read." } }
				: {}),
			operationId: {
				type: "string",
				minLength: 36,
				maxLength: 36,
				description: "Original UUID for an explicit retry.",
			},
		},
		required: [...(schema.required ?? []), ...(revision ? ["revision"] : [])],
	};
}

function revision(input: Input): string {
	const current = value<string>(input, "revision");
	if (!current) throw new BacklogToolError("Read the record first and provide its revision.", "REVISION_REQUIRED");
	return current;
}

/** A fixed-project MCP adapter. It never creates a local Core or consults client roots. */
export class ConnectedMcpServer {
	private readonly server: Server;
	private transport?: StdioServerTransport;
	private readonly tools = new Map<string, McpToolHandler>();
	private readonly resources = new Map<string, string>();

	constructor(
		private readonly client: ServerClient,
		private readonly config: BacklogConfig,
		version: string,
	) {
		this.server = new Server(
			{ name: getPackageName(), version },
			{
				capabilities: {
					tools: { listChanged: true },
					resources: { listChanged: true },
					prompts: { listChanged: true },
				},
				instructions:
					"Read backlog://workflow/overview first. This MCP session is connected to one fixed server project.",
			},
		);
		this.registerTools();
		for (const guide of WORKFLOW_GUIDES)
			this.resources.set(guide.uri, `${CONNECTED_GUIDE.trim()}\n\n${guide.resourceText}`);
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [...this.tools.values()].map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: { type: "object", ...tool.inputSchema },
				...(tool.annotations ? { annotations: tool.annotations } : {}),
			})),
		}));
		this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
			this.callTool(request.params.name, request.params.arguments ?? {}),
		);
		this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
			resources: WORKFLOW_GUIDES.map((guide) => ({
				uri: guide.uri,
				name: guide.name,
				description: guide.description,
				mimeType: guide.mimeType,
			})),
		}));
		this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
		this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
			const guide = getWorkflowGuideByUri(request.params.uri);
			if (!guide) throw new McpError(ErrorCode.InvalidParams, `Resource not found: ${request.params.uri}`);
			return { contents: [{ uri: guide.uri, mimeType: guide.mimeType, text: this.resources.get(guide.uri) ?? "" }] };
		});
		this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
		this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
			throw new McpError(ErrorCode.InvalidParams, `Prompt not found: ${request.params.name}`);
		});
		this.server.setNotificationHandler(RootsListChangedNotificationSchema, () => {});
	}

	private add(
		name: string,
		description: string,
		schema: JsonSchema,
		handler: (input: Input) => Promise<CallToolResult>,
		readOnly = false,
	): void {
		this.tools.set(
			name,
			createSimpleValidatedTool(
				{
					name,
					description,
					inputSchema: schema,
					annotations: { title: name, readOnlyHint: readOnly, destructiveHint: !readOnly },
				},
				schema,
				async (input) => {
					try {
						return await handler(input);
					} catch (error) {
						if (error instanceof ServerClientError) {
							throw new BacklogToolError(error.message, error.code ?? "SERVER_ERROR", {
								status: error.status,
								...(error.operationId ? { operationId: error.operationId } : {}),
							});
						}
						throw error;
					}
				},
			),
		);
	}

	private async write<T>(
		path: string,
		method: "POST" | "PUT" | "DELETE",
		input: Input,
		body?: unknown,
		requireRevision = false,
	): Promise<T> {
		return this.client.write<T>(path, method, body, {
			...(requireRevision ? { revision: revision(input) } : {}),
			operationId: value<string>(input, "operationId"),
		});
	}

	private registerTools(): void {
		this.add(
			"get_backlog_instructions",
			"Read Backlog.md workflow guidance for this connected project",
			{
				type: "object",
				properties: { instruction: { type: "string", enum: [...WORKFLOW_GUIDE_KEYS] } },
				required: [],
				additionalProperties: false,
			},
			async (input) => {
				const guide = getWorkflowGuideByKey(
					value<(typeof WORKFLOW_GUIDE_KEYS)[number]>(input, "instruction") ?? "overview",
				);
				if (!guide) throw new BacklogToolError("Workflow guide unavailable.", "RESOURCE_NOT_FOUND");
				const text = `${CONNECTED_GUIDE.trim()}\n\n${guide.toolText ?? guide.resourceText}`;
				return {
					content: [{ type: "text", text }],
					structuredContent: {
						type: "resource",
						uri: guide.uri,
						title: guide.name,
						description: guide.description,
						mimeType: guide.mimeType,
						text,
					},
				};
			},
			true,
		);

		this.add(
			"task_list",
			"List tasks in the connected project",
			generateTaskListSchema(this.config),
			async (input) => {
				if (input.assignee && input.unassigned)
					throw new BacklogToolError("unassigned cannot be combined with assignee.", "VALIDATION_ERROR");
				const [tasks, archivedTasks] = await Promise.all([
					this.client.read<Task[]>(value<string>(input, "status")?.toLowerCase() === "draft" ? "drafts" : "tasks"),
					this.client.read<Task[]>("tasks/archived"),
				]);
				const filtered = createTaskSearchIndex(tasks).search({
					query: value<string>(input, "search"),
					status: value<string>(input, "status"),
					type: value<string[]>(input, "type"),
					project: value<string[]>(input, "project"),
					assignee: value<string>(input, "assignee"),
					unassigned: value<boolean>(input, "unassigned"),
					milestone: value<string>(input, "milestone"),
					labels: value<string[]>(input, "labels"),
					labelMatch: "all",
				});
				const graph = createReadinessGraph({ tasks, archivedTasks, statuses: this.config.statuses ?? [] });
				const withReadiness = filtered.map((task) => ({ ...task, isReady: getTaskReadiness(task, graph).isReady }));
				const selected = value<boolean>(input, "ready") ? withReadiness.filter((task) => task.isReady) : withReadiness;
				return result(
					"task-list",
					sortTasks(selected, undefined, this.config.priorities).slice(0, value<number>(input, "limit")),
				);
			},
			true,
		);
		this.add(
			"task_search",
			"Search tasks in the connected project",
			generateTaskSearchSchema(this.config),
			async (input) => {
				const tasks = await this.client.read<Task[]>("tasks");
				const found = createTaskSearchIndex(tasks).search({
					query: value<string>(input, "query"),
					status: value<string>(input, "status"),
					type: value<string[]>(input, "type"),
					project: value<string[]>(input, "project"),
					priority: value<string>(input, "priority"),
					modifiedFiles: value<string[]>(input, "modifiedFiles"),
				});
				return result("task-search", found.slice(0, value<number>(input, "limit")));
			},
			true,
		);
		this.add(
			"task_view",
			"Read a task and its revision",
			taskViewSchema,
			async (input) => result("task", await this.client.read(`tasks/${encodeURIComponent(String(input.id))}`)),
			true,
		);
		this.add(
			"task_create",
			"Create a task in the connected project",
			writeSchema(generateTaskCreateSchema(this.config)),
			async (input) => {
				const { operationId: _operationId, acceptanceCriteria, ...body } = input;
				const created = await this.write<Task>("tasks", "POST", input, {
					...body,
					...(Array.isArray(acceptanceCriteria)
						? { acceptanceCriteriaItems: acceptanceCriteria.map((text) => ({ text, checked: false })) }
						: {}),
				});
				return result("task", created);
			},
		);
		this.add(
			"task_edit",
			"Edit a task using its read revision",
			writeSchema(generateTaskEditSchema(this.config), true),
			async (input) => {
				const { id, revision: _revision, operationId: _operationId, ...editArgs } = input;
				const updated = await this.write(`tasks/${encodeURIComponent(String(id))}`, "PUT", input, { editArgs }, true);
				return result("task", updated);
			},
		);
		for (const [name, suffix, method] of [
			["task_archive", "/archive", "POST"],
			["task_restore", "/restore", "POST"],
			["task_delete", "", "DELETE"],
		] as const) {
			this.add(
				name,
				`${name.replace("_", " ")} with an explicit revision`,
				writeSchema(taskArchiveSchema, true),
				async (input) =>
					result(
						"task-result",
						await this.write(`tasks/${encodeURIComponent(String(input.id))}${suffix}`, method, input, undefined, true),
					),
			);
		}

		this.add(
			"document_list",
			"List project documents",
			documentListSchema,
			async (input) => {
				const docs = await this.client.read<Document[]>("docs");
				const search = value<string>(input, "search")?.toLowerCase();
				return result(
					"document-list",
					search ? docs.filter((doc) => `${doc.title}\n${doc.rawContent}`.toLowerCase().includes(search)) : docs,
				);
			},
			true,
		);
		this.add(
			"document_view",
			"Read a document and its revision",
			documentViewSchema,
			async (input) => result("document", await this.client.read(`docs/${encodeURIComponent(String(input.id))}`)),
			true,
		);
		this.add(
			"document_search",
			"Search project documents",
			documentSearchSchema,
			async (input) => {
				const matches = await this.client.read<SearchResult[]>("search", {
					query: String(input.query),
					type: "document",
					limit: value<number>(input, "limit"),
				});
				return result(
					"document-search",
					matches.filter((match) => match.type === "document"),
				);
			},
			true,
		);
		this.add("document_create", "Create a project document", writeSchema(documentCreateSchema), async (input) => {
			const { operationId: _operationId, ...body } = input;
			return result("document", await this.write("docs", "POST", input, body));
		});
		this.add(
			"document_update",
			"Update a document using its read revision",
			writeSchema(documentUpdateSchema, true),
			async (input) => {
				const { id, revision: _revision, operationId: _operationId, ...body } = input;
				return result("document", await this.write(`docs/${encodeURIComponent(String(id))}`, "PUT", input, body, true));
			},
		);
		for (const [name, suffix, method] of [
			["document_archive", "/archive", "POST"],
			["document_restore", "/restore", "POST"],
			["document_delete", "", "DELETE"],
		] as const) {
			this.add(
				name,
				`${name.replace("_", " ")} with an explicit revision`,
				writeSchema(documentArchiveSchema, true),
				async (input) =>
					result(
						"document-result",
						await this.write(`docs/${encodeURIComponent(String(input.id))}${suffix}`, method, input, undefined, true),
					),
			);
		}

		this.add(
			"milestone_list",
			"List project milestones and milestone values still found on tasks",
			milestoneListSchema,
			async () => {
				const [active, archived, tasks] = await Promise.all([
					this.client.read<Milestone[]>("milestones"),
					this.client.read<Milestone[]>("milestones/archived"),
					this.client.read<Task[]>("tasks"),
				]);
				const aliases = (milestone: Milestone) => [milestone.id, milestone.title, milestone.id.replace(/^m-/i, "")];
				const activeKeys = new Set(active.flatMap(aliases).map((value) => value.toLowerCase()));
				const archivedKeys = new Set(archived.flatMap(aliases).map((value) => value.toLowerCase()));
				const taskValues = [
					...new Set(tasks.map((task) => task.milestone?.trim()).filter((value): value is string => Boolean(value))),
				].sort();
				return result("milestone-list", {
					milestones: active,
					unconfigured: taskValues.filter(
						(value) => !activeKeys.has(value.toLowerCase()) && !archivedKeys.has(value.toLowerCase()),
					),
					archivedTaskValues: taskValues.filter(
						(value) => !activeKeys.has(value.toLowerCase()) && archivedKeys.has(value.toLowerCase()),
					),
				});
			},
			true,
		);
		this.add("milestone_add", "Create a milestone", writeSchema(milestoneAddSchema), async (input) =>
			result(
				"milestone",
				await this.write("milestones", "POST", input, {
					title: input.name,
					description: input.description,
					dueDate: input.dueDate,
				}),
			),
		);
		this.add(
			"milestone_rename",
			"Rename a milestone using its read revision",
			writeSchema(milestoneRenameSchema, true),
			async (input) => {
				const id = String(input.from);
				return result(
					"milestone-result",
					await this.write(
						`milestones/${encodeURIComponent(id)}`,
						"PUT",
						input,
						{
							title: input.to,
							updateTasks: input.updateTasks,
							dueDate: input.dueDate,
						},
						true,
					),
				);
			},
		);
		this.add(
			"milestone_remove",
			"Remove a milestone using its read revision",
			writeSchema(milestoneRemoveSchema, true),
			async (input) => {
				const id = String(input.name);
				return result(
					"milestone-result",
					await this.write(
						`milestones/${encodeURIComponent(id)}`,
						"DELETE",
						input,
						{
							taskHandling: input.taskHandling,
							reassignTo: input.reassignTo,
						},
						true,
					),
				);
			},
		);
		this.add(
			"milestone_archive",
			"Archive a milestone using its read revision",
			writeSchema(milestoneArchiveSchema, true),
			async (input) => {
				const id = String(input.name);
				return result(
					"milestone-result",
					await this.write(`milestones/${encodeURIComponent(id)}/archive`, "POST", input, undefined, true),
				);
			},
		);

		this.add(
			"definition_of_done_defaults_get",
			"Read project Definition of Done defaults",
			definitionOfDoneDefaultsGetSchema,
			async () => {
				const config = await this.client.read<BacklogConfig>("config");
				return result("definition-of-done-defaults", { items: config.definitionOfDone ?? [] });
			},
			true,
		);
		this.add(
			"definition_of_done_defaults_upsert",
			"Unavailable in connected mode: agent keys cannot write config",
			definitionOfDoneDefaultsUpsertSchema,
			async () => {
				throw new BacklogToolError(
					"Agent keys cannot change project configuration in connected mode.",
					"UNSUPPORTED_CONNECTED_WRITE",
				);
			},
		);
	}

	private async callTool(name: string, args: Input): Promise<CallToolResult> {
		const tool = this.tools.get(name);
		if (!tool) throw new McpError(ErrorCode.InvalidParams, `Tool not found: ${name}`);
		return tool.handler(args);
	}

	async connect(): Promise<void> {
		if (this.transport) return;
		this.transport = new StdioServerTransport();
		await this.server.connect(this.transport);
	}

	async start(): Promise<void> {
		if (!this.transport) throw new Error("MCP server not connected. Call connect() before start().");
	}

	async stop(): Promise<void> {
		await this.server.close();
		this.transport = undefined;
	}

	get testInterface() {
		return {
			listTools: () => ({
				tools: [...this.tools.values()].map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema })),
			}),
			callTool: (name: string, args: Input = {}) => this.callTool(name, args),
			readResource: (uri: string) => this.resources.get(uri),
		};
	}
}

export async function createConnectedMcpServer(options: ServerConnectionOptions): Promise<ConnectedMcpServer> {
	const client = await ServerClient.connect(options);
	const [config, version] = await Promise.all([client.read<BacklogConfig>("config"), getVersion()]);
	return new ConnectedMcpServer(client, config, version);
}
