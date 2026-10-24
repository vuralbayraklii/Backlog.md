import { createHash } from "node:crypto";
import { parseTask } from "../markdown/parser.ts";
import { serializeTask } from "../markdown/serializer.ts";
import type { Task } from "../types/index.ts";
import type { ReviewAction, ReviewContext, TaskReviewEntry } from "../types/task-review.ts";
import { openReviewRequests } from "../types/task-review.ts";
import { taskContentForComparison } from "../utils/task-content.ts";

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid task review object.");
	return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Review ${field} is required.`);
	return value.trim();
}

function person(value: unknown): void {
	const item = object(value);
	text(item.userId, "userId");
	text(item.name, "name");
}

function integer(value: unknown): void {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("Invalid review entry number.");
}

export function parseTaskReview(value: unknown): TaskReviewEntry[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error("Task review must be a list.");
	let previousId = 0;
	for (const raw of value) {
		const entry = object(raw);
		integer(entry.id);
		if (Number(entry.id) <= previousId) throw new Error("Review entry numbers must increase.");
		previousId = Number(entry.id);
		if (typeof entry.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.contentHash))
			throw new Error("Invalid review content hash.");
		if (
			typeof entry.createdAt !== "string" ||
			!/^\d{4}-\d\d-\d\dT/.test(entry.createdAt) ||
			!Number.isFinite(Date.parse(entry.createdAt))
		)
			throw new Error("Invalid review time.");
		person(entry.author);
		const author = object(entry.author);
		if (!["user", "agent", "local"].includes(String(author.kind))) throw new Error("Invalid review author.");
		if (author.kind === "agent") text(author.agentKeyId, "agentKeyId");
		switch (entry.kind) {
			case "request":
				if (!["review", "decision", "acceptance"].includes(String(entry.type)))
					throw new Error("Invalid review request type.");
				person(entry.reviewer);
				text(entry.reason, "reason");
				break;
			case "verification":
				if (!["passed", "failed", "not-applicable"].includes(String(entry.result)))
					throw new Error("Invalid verification result.");
				text(entry.notes, "notes");
				if (!Array.isArray(entry.evidence) || entry.evidence.some((item) => typeof item !== "string" || !item.trim()))
					throw new Error("Review evidence must be a list of nonempty strings.");
				if (entry.result !== "not-applicable" && !entry.evidence.length)
					throw new Error("Verification evidence is required.");
				if (entry.commit !== undefined) text(entry.commit, "commit");
				break;
			case "response":
				integer(entry.requestId);
				if (!["approved", "changes-requested", "answered"].includes(String(entry.outcome)))
					throw new Error("Invalid review outcome.");
				text(entry.notes, "notes");
				if (entry.verificationId !== undefined) integer(entry.verificationId);
				if (entry.decision !== undefined) text(entry.decision, "decision");
				break;
			case "cancellation":
				integer(entry.requestId);
				text(entry.reason, "reason");
				break;
			default:
				throw new Error("Invalid review entry kind.");
		}
		if (entry.kind === "response" || entry.kind === "cancellation") {
			const request = value.find((item) => item.id === entry.requestId);
			if (request?.kind !== "request" || request.id >= Number(entry.id))
				throw new Error("Review request does not exist.");
		}
	}
	return value as TaskReviewEntry[];
}

/** Hash the persisted task content, excluding workflow bookkeeping and ordering. */
export function taskReviewContentHash(task: Task): string {
	const persisted = parseTask(serializeTask({ ...task }));
	const content = { ...taskContentForComparison(persisted), reviewRevision: persisted.reviewRevision };
	return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function appendTaskReview(task: Task, action: ReviewAction, context: ReviewContext): TaskReviewEntry[] {
	const entries = [...(task.review ?? [])];
	const contentHash = taskReviewContentHash(task);
	const base = {
		id: (entries.at(-1)?.id ?? 0) + 1,
		createdAt: new Date().toISOString(),
		contentHash,
		author: context.author,
	};
	let next: TaskReviewEntry;
	if (action.kind === "request" || action.kind === "verification") {
		if (!context.canWrite) throw new Error("Task write permission is required.");
		if (
			action.kind === "request" &&
			openReviewRequests(entries, context.trustedEntryIds)
				.filter((entry) => !context.staleEntryIds?.has(entry.id))
				.some(
					(entry) =>
						entry.type === action.type &&
						entry.reviewer.userId === action.reviewer.userId &&
						entry.contentHash === contentHash,
				)
		)
			throw new Error("An open request already exists for this person and task content.");
		next = { ...action, ...base };
	} else {
		const request = openReviewRequests(entries, context.trustedEntryIds).find((entry) => entry.id === action.requestId);
		if (!request) throw new Error("The review request is already closed or does not exist.");
		if (action.kind === "cancellation") {
			const ownsRequest =
				request.author.userId === context.author.userId &&
				(context.author.kind !== "agent" ||
					(request.author.kind === "agent" && request.author.agentKeyId === context.author.agentKeyId));
			if (!context.admin && (!context.canWrite || !ownsRequest))
				throw new Error("Only the requester with write permission or an admin can cancel this request.");
			next = { ...action, ...base };
		} else {
			if (context.author.kind === "agent" || request.reviewer.userId !== context.author.userId)
				throw new Error("Only the assigned person can respond to this request.");
			if (request.contentHash !== contentHash || context.staleEntryIds?.has(request.id))
				throw new Error("Task content changed. Request a new review.");
			if (request.type === "decision" ? action.outcome !== "answered" : action.outcome === "answered")
				throw new Error("The response does not match the request type.");
			let verificationId: number | undefined;
			if (request.type === "acceptance" && action.outcome === "approved") {
				const verification = entries.findLast(
					(entry) => entry.kind === "verification" && entry.contentHash === contentHash,
				);
				if (
					verification?.kind !== "verification" ||
					verification.result === "failed" ||
					context.staleEntryIds?.has(verification.id) ||
					(context.trustedEntryIds && !context.trustedEntryIds.has(verification.id))
				)
					throw new Error("Acceptance requires a successful, authenticated verification of the current task content.");
				verificationId = verification.id;
			}
			next = { ...action, ...base, ...(verificationId && { verificationId }) };
		}
	}
	entries.push(next);
	return parseTaskReview(entries) ?? [];
}
