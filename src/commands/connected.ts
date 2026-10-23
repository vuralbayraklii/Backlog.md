import type { Command } from "commander";
import { buildMilestoneBuckets, collectArchivedMilestoneKeys } from "../core/milestones.ts";
import type { TaskDetail, TaskListItem } from "../core/task-detail.ts";
import {
	decisionListJson,
	formatJson,
	printJson,
	type SearchResultInput,
	searchJson,
	taskListJson,
	taskViewJson,
} from "../formatters/json-output.ts";
import { formatTaskPlainText } from "../formatters/task-plain-text.ts";
import { ServerClient, type ServerConnectionOptions } from "../server/client.ts";
import type { BacklogConfig, Decision, Document, Milestone, SearchResult, Task } from "../types/index.ts";
import type { TaskEditArgs } from "../types/task-edit-args.ts";
import { parseListWindow, printListWindow, selectListWindow } from "../utils/list-window.ts";
import { createMilestoneFilterValueResolver } from "../utils/milestone-filter.ts";
import { createReadinessGraph, getTaskReadiness } from "../utils/readiness.ts";
import { parseDelimitedStringList, parsePositiveIndexList } from "../utils/task-builders.ts";
import { applyTaskFilters } from "../utils/task-search.ts";
import { sortTasks } from "../utils/task-sorting.ts";
import { watchJson } from "./watch-json.ts";

type Options = Record<string, unknown>;
type Versioned = { recordKey?: string; revision?: string };

function text(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
function strings(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	return Array.isArray(value) ? value.map(String) : [String(value)];
}
function list(value: unknown): string[] | undefined {
	return parseDelimitedStringList(strings(value));
}

/** Translate command spelling once; semantic edit rules remain in the shared Core builder. */
export function connectedTaskEditArgs(options: Options): TaskEditArgs {
	const args: TaskEditArgs = {};
	for (const field of [
		"title",
		"status",
		"priority",
		"type",
		"project",
		"milestone",
		"dueDate",
		"finalSummary",
		"commentAuthor",
	] as const) {
		if (typeof options[field] === "string") args[field] = String(options[field]);
	}
	args.description = text(options.description ?? options.desc);
	if (options.ordinal !== undefined) {
		const ordinal = Number(options.ordinal);
		if (!Number.isFinite(ordinal) || ordinal < 0) throw new Error("Ordinal must be a non-negative number.");
		args.ordinal = ordinal;
	}
	for (const [field, flag, clear, add, remove] of [
		["labels", "label", "clearLabels", "addLabel", "removeLabel"],
		["dependencies", "dependsOn", "clearDeps", "dep", "dep"],
		["references", "ref", "clearRefs", "addRef", "removeRef"],
		["documentation", "doc", "clearDocs", "addDoc", "removeDoc"],
	] as const) {
		if (options[clear] && [flag, add, remove].some((key) => options[key] !== undefined))
			throw new Error(
				`Cannot combine --${clear.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} with replacement or incremental values.`,
			);
		if (
			field !== "dependencies" &&
			options[flag] !== undefined &&
			(options[add] !== undefined || options[remove] !== undefined)
		)
			throw new Error(`Cannot combine replacement and incremental ${field}.`);
		if (options[clear]) args[field] = [];
		else if (field === "dependencies")
			args.dependencies = list([...(strings(options.dependsOn) ?? []), ...(strings(options.dep) ?? [])]);
		else args[field] = list(options[flag]);
	}
	args.addLabels = list(options.addLabel);
	args.removeLabels = list(options.removeLabel);
	args.addReferences = list(options.addRef);
	args.removeReferences = list(options.removeRef);
	args.addDocumentation = list(options.addDoc);
	args.removeDocumentation = list(options.removeDoc);
	if (options.assignee !== undefined) args.assignee = list(options.assignee) ?? [];
	args.modifiedFiles = list(options.modifiedFile);
	args.planSet = text(options.plan);
	args.planAppend = strings(options.appendPlan);
	args.notesSet = text(options.notes);
	args.notesAppend = strings(options.appendNotes);
	args.commentsAppend = strings(options.comment);
	args.finalSummaryAppend = strings(options.appendFinalSummary);
	args.finalSummaryClear = Boolean(options.clearFinalSummary);
	for (const [field, flag] of [
		["milestone", "clearMilestone"],
		["dueDate", "clearDueDate"],
	] as const) {
		if (options[flag] && options[field] !== undefined) throw new Error(`Cannot both set and clear ${field}.`);
		if (options[flag]) args[field] = null;
	}
	if (
		(options.clearAc || options.acceptanceCriteria !== undefined) &&
		["ac", "removeAc", "checkAc", "uncheckAc"].some((key) => options[key] !== undefined)
	)
		throw new Error("Cannot combine replacement and incremental acceptance criteria.");
	if (options.clearAc && options.acceptanceCriteria !== undefined)
		throw new Error("Cannot both set and clear acceptance criteria.");
	args.acceptanceCriteriaSet = options.clearAc ? [] : strings(options.acceptanceCriteria);
	args.acceptanceCriteriaAdd = strings(options.ac);
	args.acceptanceCriteriaRemove = parsePositiveIndexList(strings(options.removeAc));
	args.acceptanceCriteriaCheck = parsePositiveIndexList(strings(options.checkAc));
	args.acceptanceCriteriaUncheck = parsePositiveIndexList(strings(options.uncheckAc));
	args.definitionOfDoneAdd = strings(options.dod);
	args.definitionOfDoneRemove = parsePositiveIndexList(strings(options.removeDod));
	args.definitionOfDoneCheck = parsePositiveIndexList(strings(options.checkDod));
	args.definitionOfDoneUncheck = parsePositiveIndexList(strings(options.uncheckDod));
	return args;
}

function commandPath(command: Command): string[] {
	const path: string[] = [];
	for (let current: Command | null = command; current?.parent; current = current.parent) path.unshift(current.name());
	return path;
}

export function installConnectedCommands(program: Command): void {
	program
		.option("--server-url <origin>", "connect to the Backlog.md application on this machine or an HTTPS origin")
		.option("--server-project <id>", "registered server project ID (separate from task --project)")
		.option("--agent-key-file <path>", "read the access key from a file")
		.option("--allow-http-loopback", "allow an HTTP loopback connection")
		.option(
			"--if-match <revision>",
			"revision read before editing; repeat ID=revision for several records",
			(value: string, previous: string[] = []) => [...previous, value],
		)
		.option("--operation-id <uuid>", "reuse the original operation ID when explicitly retrying a write");
	program
		.command("history")
		.description("read project history through an explicit server connection")
		.command("list")
		.option("--record-key <key>")
		.option("--kind <kind>")
		.option("--cursor <cursor>")
		.option("--limit <count>", "page size, 1–100", "50")
		.option("--json")
		.action(() => {
			throw new Error("history list requires an explicit server connection.");
		});
	program
		.command("operation")
		.description("inspect a connected operation result")
		.command("view <id>")
		.option("--json")
		.action(() => {
			throw new Error("operation view requires an explicit server connection.");
		});
	program.hook("preAction", (_root, command) => {
		const connection = program.opts<ServerConnectionOptions>();
		if (!connection.serverUrl && !connection.serverProject && !connection.agentKeyFile) {
			if (program.opts().ifMatch || program.opts().operationId)
				throw new Error("--if-match and --operation-id require a server connection.");
			return;
		}
		const path = commandPath(command);
		if (path[0] === "mcp" || path[0] === "instructions") return;
		return ServerClient.connect(connection).then(async (client) => {
			await runConnectedCommand(client, command, program.opts<Options>());
			// Commander calls the action after its hooks; use the public setter to skip the local handler.
			command.action(() => {});
		});
	});
}

function requireRevision(options: Options, id: string, count = 1): string {
	const values = strings(options.ifMatch) ?? [];
	const prefixed = values.find((value) => value.toLowerCase().startsWith(`${id.toLowerCase()}=`));
	const revision = prefixed?.slice(id.length + 1) ?? (count === 1 && values.length === 1 ? values[0] : undefined);
	if (!revision)
		throw new Error(
			`Read ${id} first and provide its revision with --if-match${count > 1 ? ` '${id}=<revision>'` : " <revision>"}.`,
		);
	return revision;
}

async function runConnectedCommand(client: ServerClient, command: Command, rootOptions: Options): Promise<void> {
	const [group, verb] = commandPath(command);
	const options: Options = { ...command.parent?.opts(), ...command.opts(), ...rootOptions };
	const args = command.processedArgs as unknown[];
	const arg = (index: number): string => {
		const value = args[index];
		if (typeof value !== "string" || !value.trim())
			throw new Error("Provide the required command argument explicitly in server mode.");
		return value;
	};
	if (options.json && options.plain) throw new Error("--json and --plain cannot be combined.");
	const mutate = async (path: string, method: "POST" | "PUT" | "DELETE", body?: unknown, id?: string, count?: number) =>
		client.write<unknown>(path, method, body, {
			revision: id ? requireRevision(options, id, count) : undefined,
			operationId: text(options.operationId),
		});
	const print = (value: unknown, kind: string) => {
		if (options.json)
			printJson({ schemaVersion: 1, kind, ...(value && typeof value === "object" ? value : { value }) });
		else console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
	};
	const printTask = (task: TaskDetail & Versioned) => {
		if (options.json) {
			const payload = taskViewJson(task, "");
			printJson({ ...payload, task: { ...payload.task, recordKey: task.recordKey, revision: task.revision } });
		} else {
			console.log(formatTaskPlainText(task));
			if (task.revision) console.log(`\nRecord key: ${task.recordKey}\nRevision: ${task.revision}`);
		}
	};
	const printSavedTask = async (task: Task & Versioned) => {
		try {
			printTask(await client.read<TaskDetail & Versioned>(`tasks/${encodeURIComponent(task.id)}`));
		} catch {
			console.log(`Saved task ${task.id}\nRecord key: ${task.recordKey ?? ""}\nRevision: ${task.revision ?? ""}`);
		}
	};
	const printList = <T>(items: T[], kind: string, format: (item: T) => string) => {
		const window = parseListWindow(options, command, process.argv.slice(2));
		if (!window) return;
		if (options.json) {
			const page = selectListWindow(items, window);
			printJson({ schemaVersion: 1, kind, items: page.items, total: page.total, nextSkip: page.nextSkip });
		} else printListWindow(items, window, (page) => console.log(page.map(format).join("\n") || "No records found."));
	};
	if (group === "history" && verb === "list") {
		print(
			await client.read("history", {
				recordKey: text(options.recordKey),
				kind: text(options.kind),
				cursor: text(options.cursor),
				limit: text(options.limit),
			}),
			"project-history",
		);
		return;
	}
	if (group === "operation" && verb === "view") {
		print(await client.operation(arg(0)), "operation");
		return;
	}
	if (group === "config" && (!verb || ["get", "list"].includes(verb))) {
		const config = await client.read<BacklogConfig>("config");
		const key = verb === "get" ? (arg(0) as keyof BacklogConfig) : undefined;
		print(key ? config[key] : config, "config");
		return;
	}
	if ((group === "task" || group === "draft") && (!verb || verb === "view")) {
		printTask(await client.read<TaskDetail & Versioned>(`tasks/${encodeURIComponent(arg(0))}`));
		return;
	}
	if ((group === "task" || group === "draft") && verb === "create") {
		const body = {
			...connectedTaskEditArgs({ ...options, label: options.labels }),
			title: arg(0),
			status: group === "draft" || options.draft ? "Draft" : options.status,
			parentTaskId: text(options.parent),
			acceptanceCriteriaItems: [...(strings(options.ac) ?? []), ...(strings(options.acceptanceCriteria) ?? [])].map(
				(value) => ({ text: value, checked: false }),
			),
			definitionOfDoneAdd: strings(options.dod),
			disableDefinitionOfDoneDefaults: options.dodDefaults === false,
			implementationPlan: text(options.plan),
			implementationNotes: text(options.notes),
		};
		const created = (await mutate("tasks", "POST", body)) as Task & Versioned;
		await printSavedTask(created);
		return;
	}
	if ((group === "task" || group === "draft") && verb === "edit") {
		const ids = Array.isArray(args[0]) ? args[0].map(String) : [arg(0)];
		if (!ids.length) throw new Error("Provide record IDs explicitly in server mode.");
		for (const id of ids) requireRevision(options, id, ids.length);
		if (ids.length > 1 && options.operationId)
			throw new Error("Use a separate --operation-id for each record when retrying several edits.");
		const editArgs = connectedTaskEditArgs(options);
		for (const id of ids) {
			const saved = (await mutate(`tasks/${encodeURIComponent(id)}`, "PUT", { editArgs }, id, ids.length)) as Task &
				Versioned;
			await printSavedTask(saved);
		}
		return;
	}
	if (
		(group === "task" || group === "draft") &&
		["archive", "restore", "delete", "demote", "promote"].includes(verb ?? "")
	) {
		const id = arg(0);
		const base = group === "draft" && verb === "promote" ? "drafts" : "tasks";
		print(
			await mutate(
				`${base}/${encodeURIComponent(id)}${verb === "delete" ? "" : `/${verb}`}`,
				verb === "delete" ? "DELETE" : "POST",
				undefined,
				id,
			),
			"record-result",
		);
		return;
	}
	if ((group === "task" || group === "draft") && verb === "list") {
		if (options.watch && (!options.json || options.plain))
			throw new Error("--watch requires --json and cannot be combined with --plain.");
		if (options.unassigned && options.assignee) throw new Error("unassigned cannot be combined with assignee.");
		const window = parseListWindow(options, command, process.argv.slice(2));
		if (!window) return;
		const load = async () => {
			const [tasks, archivedTasks, config, milestones] = await Promise.all([
				client.read<Array<Task & Versioned>>(group === "draft" ? "drafts" : "tasks"),
				client.read<Task[]>("tasks/archived"),
				client.read<BacklogConfig>("config"),
				options.milestone ? client.read<Milestone[]>("milestones") : Promise.resolve([] as Milestone[]),
			]);
			const graph = createReadinessGraph({ tasks, archivedTasks, statuses: config.statuses ?? [] });
			const enriched = tasks.map((task) => ({ ...task, isReady: getTaskReadiness(task, graph).isReady }));
			let filtered = applyTaskFilters(enriched, {
				status: list(options.status),
				excludeStatus: list(options.excludeStatus),
				assignee: text(options.assignee),
				unassigned: Boolean(options.unassigned),
				labels: list(options.labels),
				type: list(options.type),
				project: list(options.project),
				milestone: text(options.milestone),
				query: text(options.search),
				priority: list(options.priority),
				resolveMilestoneLabel: createMilestoneFilterValueResolver(milestones),
			}) as Array<TaskListItem & Versioned>;
			if (options.ready) filtered = filtered.filter((task) => task.isReady);
			if (options.parent)
				filtered = filtered.filter((task) => task.parentTaskId?.toLowerCase() === String(options.parent).toLowerCase());
			filtered = sortTasks(filtered, text(options.sort), config.priorities);
			if (options.limit !== undefined) {
				const limit = Number(options.limit);
				if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
				filtered = filtered.slice(0, limit);
			}
			return filtered;
		};
		const json = (tasks: Array<TaskListItem & Versioned>) => {
			const page = selectListWindow(tasks, window);
			const payload = taskListJson(page.items, page);
			return {
				...payload,
				tasks: payload.tasks.map((task, index) => ({
					...task,
					recordKey: page.items[index]?.recordKey,
					revision: page.items[index]?.revision,
				})),
			};
		};
		if (options.watch) {
			await watchJson([], [], async () => formatJson(json(await load())), process.stdout, { poll: true });
			return;
		}
		const tasks = await load();
		if (options.json) printJson(json(tasks));
		else
			printListWindow(tasks, window, (page) =>
				console.log(
					page.map((task) => `${task.id} - ${task.title} (${task.status})\n  Revision: ${task.revision}`).join("\n") ||
						"No tasks found.",
				),
			);
		return;
	}
	if (group === "doc") {
		if (verb === "create") {
			print(
				await mutate("docs", "POST", {
					title: arg(0),
					content: "",
					path: options.path,
					type: options.type,
					tags: list(options.tags),
				}),
				"document",
			);
			return;
		}
		if (verb === "update") {
			const id = arg(0);
			requireRevision(options, id);
			const content = options.content ?? (await client.read<Document>(`docs/${encodeURIComponent(id)}`)).rawContent;
			print(
				await mutate(
					`docs/${encodeURIComponent(id)}`,
					"PUT",
					{
						title: options.title,
						content,
						path: options.path,
						type: options.type,
						tags: options.tags === undefined ? undefined : (list(options.tags) ?? []),
					},
					id,
				),
				"document",
			);
			return;
		}
		if (verb === "view") {
			print(await client.read(`docs/${encodeURIComponent(arg(0))}`), "document-view");
			return;
		}
		if (verb === "search") {
			const query = arg(0).trim();
			if (!query || query.length > 200) throw new Error("Document search query must contain 1–200 characters.");
			const limit = options.limit === undefined ? undefined : Number(options.limit);
			if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))
				throw new Error("Document search limit must be 1–100.");
			const results = await client.read<SearchResult[]>("search", { query, type: "document", limit });
			const documents = results.flatMap((result) => (result.type === "document" ? [result.document] : []));
			printList(documents, "document-search", (doc) => `${doc.id} - ${doc.title}\n  Path: ${doc.path ?? ""}`);
			return;
		}
		if (verb === "list") {
			const docs = await client.read<Array<Document & Versioned>>("docs");
			const query = text(options.search)?.toLowerCase();
			printList(
				query ? docs.filter((doc) => `${doc.title}\n${doc.rawContent}`.toLowerCase().includes(query)) : docs,
				"document-list",
				(doc) => `${doc.id} - ${doc.title}\n  Revision: ${doc.revision}`,
			);
			return;
		}
	}
	if (group === "decision") {
		if (verb === "create") {
			print(
				await mutate("decisions", "POST", {
					title: arg(0),
					status: options.status ?? "proposed",
					context: "",
					decision: "",
					consequences: "",
				}),
				"decision",
			);
			return;
		}
		if (verb === "edit") {
			const id = arg(0);
			requireRevision(options, id);
			if (!options.status) throw new Error("--status is required.");
			print(await mutate(`decisions/${encodeURIComponent(id)}`, "PUT", { status: options.status }, id), "decision");
			return;
		}
		if (verb === "list") {
			const window = parseListWindow(options, command, process.argv.slice(2));
			if (!window) return;
			const decisions = await client.read<Array<Decision & Versioned>>("decisions");
			if (options.json) {
				const page = selectListWindow(decisions, window);
				const payload = decisionListJson(page.items, page);
				printJson({
					...payload,
					decisions: payload.decisions.map((decision, index) => ({
						...decision,
						recordKey: page.items[index]?.recordKey,
						revision: page.items[index]?.revision,
					})),
				});
			} else
				printListWindow(decisions, window, (page) =>
					console.log(
						page
							.map(
								(decision) =>
									`${decision.id} - ${decision.title} (${decision.status})\n  Record key: ${decision.recordKey}\n  Revision: ${decision.revision}`,
							)
							.join("\n") || "No records found.",
					),
				);
			return;
		}
	}
	if ((group === "doc" || group === "decision") && ["archive", "restore", "delete"].includes(verb ?? "")) {
		const id = arg(0);
		const base = group === "doc" ? "docs" : "decisions";
		print(
			await mutate(
				`${base}/${encodeURIComponent(id)}${verb === "delete" ? "" : `/${verb}`}`,
				verb === "delete" ? "DELETE" : "POST",
				undefined,
				id,
			),
			"record-result",
		);
		return;
	}
	if (group === "milestone") {
		if (verb === "list") {
			const [tasks, milestones, archivedMilestones, config] = await Promise.all([
				client.read<Task[]>("tasks"),
				client.read<Array<Milestone & Versioned>>("milestones"),
				client.read<Milestone[]>("milestones/archived"),
				client.read<BacklogConfig>("config"),
			]);
			const buckets = buildMilestoneBuckets(tasks, milestones, config.statuses ?? [], {
				archivedMilestoneIds: collectArchivedMilestoneKeys(archivedMilestones, milestones),
				archivedMilestones,
			});
			const visible = buckets.filter(
				(bucket) => !bucket.isNoMilestone && (options.showCompleted || !bucket.isCompleted),
			);
			printList(visible, "milestone-list", (bucket) => {
				const record = milestones.find((milestone) => milestone.id === bucket.milestone);
				return `${bucket.milestone ?? bucket.label}: ${bucket.label} (${bucket.doneCount}/${bucket.total} done)${record?.revision ? `\n  Revision: ${record.revision}` : ""}`;
			});
			return;
		}
		if (verb === "add") {
			print(
				await mutate("milestones", "POST", {
					title: arg(0),
					description: options.description,
					dueDate: options.dueDate,
				}),
				"milestone",
			);
			return;
		}
		if (["rename", "remove", "archive"].includes(verb ?? "")) {
			const id = arg(0);
			if (options.clearDueDate && options.dueDate !== undefined) throw new Error("Cannot both set and clear due date.");
			print(
				await mutate(
					`milestones/${encodeURIComponent(id)}${verb === "archive" ? "/archive" : ""}`,
					verb === "remove" ? "DELETE" : verb === "archive" ? "POST" : "PUT",
					verb === "rename"
						? {
								title: arg(1),
								updateTasks: options.updateTasks !== false,
								dueDate: options.clearDueDate ? null : options.dueDate,
							}
						: verb === "remove"
							? { taskHandling: options.taskHandling, reassignTo: options.reassignTo }
							: undefined,
					id,
				),
				"milestone-result",
			);
			return;
		}
	}
	if (group === "search") {
		const results = await client.read<SearchResult[]>("search", {
			query: typeof args[0] === "string" ? args[0] : "",
			type: list(options.type) ?? (options.taskType || options.project || options.modifiedFile ? ["task"] : undefined),
			taskType: list(options.taskType),
			status: list(options.status),
			excludeStatus: list(options.excludeStatus),
			priority: text(options.priority),
			project: list(options.project),
			modifiedFile: list(options.modifiedFile),
			limit: text(options.limit),
		});
		const [tasks, archivedTasks, config] = await Promise.all([
			client.read<Task[]>("tasks"),
			client.read<Task[]>("tasks/archived"),
			client.read<BacklogConfig>("config"),
		]);
		const graph = createReadinessGraph({ tasks, archivedTasks, statuses: config.statuses });
		const enriched: SearchResultInput[] = results.map((result) =>
			result.type === "task"
				? { ...result, task: { ...result.task, isReady: getTaskReadiness(result.task, graph).isReady } }
				: result,
		);
		const window = parseListWindow(options, command, process.argv.slice(2));
		if (!window) return;
		const page = selectListWindow(enriched, window);
		if (options.json) {
			const payload = searchJson(page.items, "", "", page);
			printJson({
				...payload,
				results: payload.results.map((result, index) => {
					const original = page.items[index];
					const record =
						original?.type === "task"
							? original.task
							: original?.type === "document"
								? original.document
								: original?.decision;
					return {
						...result,
						data: {
							...result.data,
							...((record as Versioned)?.recordKey && {
								recordKey: (record as Versioned).recordKey,
								revision: (record as Versioned).revision,
							}),
						},
					};
				}),
			});
		} else
			printListWindow(enriched, window, (items) =>
				console.log(
					items
						.map((result) => {
							const record =
								result.type === "task" ? result.task : result.type === "document" ? result.document : result.decision;
							return `${result.type}: ${record.id} - ${record.title}`;
						})
						.join("\n") || "No results found.",
				),
			);
		return;
	}
	throw new Error(
		`Connected command '${commandPath(command).join(" ")}' is not supported. Server mode supports noninteractive records, search, config reads, history and operation results.`,
	);
}
