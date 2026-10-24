import type { Command, OptionValues } from "commander";
import type { Core } from "../core/backlog.ts";
import { taskReviewContentHash } from "../core/task-review.ts";
import { printJson } from "../formatters/json-output.ts";
import type { ReviewAction } from "../types/task-review.ts";

export function reviewActionFromOptions(verb: string, options: OptionValues): ReviewAction {
	switch (verb) {
		case "request":
			return {
				kind: "request",
				type: options.type,
				reviewer: { userId: options.to, name: options.to },
				reason: options.reason,
			};
		case "verify":
			return {
				kind: "verification",
				result: options.result,
				notes: options.notes,
				evidence: options.evidence ?? [],
				...(options.commit && { commit: options.commit }),
			};
		case "respond":
			return {
				kind: "response",
				requestId: Number(options.request),
				outcome: options.outcome,
				notes: options.notes,
				...(options.decision && { decision: options.decision }),
			};
		case "cancel":
			return { kind: "cancellation", requestId: Number(options.request), reason: options.reason };
		default:
			throw new Error("Unknown review action.");
	}
}

export function installTaskReviewCommands(task: Command, core: () => Promise<Core>): void {
	const group = task
		.command("review")
		.description("request reviews, record evidence and respond; local identities are declarations");
	for (const verb of ["list", "request", "verify", "respond", "cancel"]) {
		const command = group.command(`${verb} <taskId>`).option("--json", "print schemaVersion 1 JSON");
		if (verb === "request")
			command
				.requiredOption("--type <type>", "review, decision or acceptance")
				.requiredOption(
					"--to <account>",
					"reviewer account ID or username; @username disambiguates (local: declared name)",
				)
				.requiredOption("--reason <text>");
		if (verb === "verify")
			command
				.requiredOption("--result <result>", "passed, failed or not-applicable")
				.requiredOption("--notes <text>")
				.option(
					"--evidence <reference>",
					"evidence path, command result or link; repeatable",
					(value: string, previous: string[]) => [...previous, value],
					[],
				)
				.option("--commit <commit>");
		if (verb === "respond" || verb === "cancel") command.requiredOption("--request <number>", "request entry number");
		if (verb === "respond")
			command
				.requiredOption("--outcome <outcome>", "approved, changes-requested or answered")
				.requiredOption("--notes <text>")
				.option("--decision <reference>");
		if (verb === "cancel") command.requiredOption("--reason <text>");
		if (verb !== "list")
			command.option(
				"--by <name>",
				"local declared author; authenticated server commands use the session identity",
				"local",
			);
		command.action(async (id: string, options: OptionValues) => {
			const instance = await core();
			const saved =
				verb === "list"
					? await instance.loadTaskById(id, { includeCrossBranch: false })
					: await instance.updateTaskReview(id, reviewActionFromOptions(verb, options), {
							author: { kind: "local", userId: options.by, name: options.by },
							canWrite: true,
							admin: true,
						});
			if (!saved) throw new Error(`Task not found: ${id}`);
			const result = {
				schemaVersion: 1,
				kind: "task-review",
				taskId: saved.id,
				contentHash: taskReviewContentHash(saved),
				entries: saved.review ?? [],
				identity: "declared",
			};
			if (options.json || task.opts().json) printJson(result);
			else {
				console.log(`${saved.id} reviews (local identity declarations)`);
				for (const entry of result.entries)
					console.log(
						`#${entry.id} ${entry.kind} ${entry.author.name} ${entry.createdAt}\n${JSON.stringify(entry, null, 2)}`,
					);
				if (!result.entries.length) console.log("No review entries.");
			}
		});
	}
}
