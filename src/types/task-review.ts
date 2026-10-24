export interface ReviewPerson {
	userId: string;
	name: string;
}

export interface ReviewAuthor extends ReviewPerson {
	kind: "user" | "agent" | "local";
	agentKeyId?: string;
}

interface ReviewEntryBase {
	id: number;
	createdAt: string;
	contentHash: string;
	author: ReviewAuthor;
}

export type ReviewRequestType = "review" | "decision" | "acceptance";
export type VerificationResult = "passed" | "failed" | "not-applicable";
export type ReviewOutcome = "approved" | "changes-requested" | "answered";

export type TaskReviewEntry = ReviewEntryBase &
	(
		| { kind: "request"; type: ReviewRequestType; reviewer: ReviewPerson; reason: string }
		| { kind: "verification"; result: VerificationResult; notes: string; evidence: string[]; commit?: string }
		| {
				kind: "response";
				requestId: number;
				outcome: ReviewOutcome;
				notes: string;
				verificationId?: number;
				decision?: string;
		  }
		| { kind: "cancellation"; requestId: number; reason: string }
	);

export type ReviewAction =
	| { kind: "request"; type: ReviewRequestType; reviewer: ReviewPerson; reason: string }
	| { kind: "verification"; result: VerificationResult; notes: string; evidence: string[]; commit?: string }
	| { kind: "response"; requestId: number; outcome: ReviewOutcome; notes: string; decision?: string }
	| { kind: "cancellation"; requestId: number; reason: string };

/** Supplied by the caller's authenticated context, never accepted from an HTTP body. */
export interface ReviewContext {
	author: ReviewAuthor;
	canWrite: boolean;
	admin?: boolean;
	trustedEntryIds?: ReadonlySet<number>;
	staleEntryIds?: ReadonlySet<number>;
}

export interface TaskReviewView {
	contentHash: string;
	trustedEntryIds: number[];
	staleEntryIds: number[];
}

export function openReviewRequests(
	entries: readonly TaskReviewEntry[],
	trustedEntryIds?: ReadonlySet<number>,
): Extract<TaskReviewEntry, { kind: "request" }>[] {
	const closed = new Set(
		entries.flatMap((entry) =>
			(entry.kind === "response" || entry.kind === "cancellation") &&
			(!trustedEntryIds || trustedEntryIds.has(entry.id))
				? [entry.requestId]
				: [],
		),
	);
	return entries.filter(
		(entry): entry is Extract<TaskReviewEntry, { kind: "request" }> =>
			entry.kind === "request" && !closed.has(entry.id),
	);
}
