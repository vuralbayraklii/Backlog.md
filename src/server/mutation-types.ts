/** Shared wire values for central writes and their durable operation record. */
export type MutationScope = { kind: "project"; projectId: string } | { kind: "admin" } | { kind: "registration" };

export type MutationActor =
	| { kind: "user"; userId: string }
	| { kind: "agent"; agentKeyId: string; userId: string }
	| { kind: "unknown" };

export type MutationSource = "browser" | "server-cli" | "agent" | "external" | "recovery" | "baseline";

export type OperationState = "pending" | "completed" | "not_applied" | "recovery_required";

export type WriteState = "ready" | "recovery_required";

export type RecordKind = "task" | "document" | "decision" | "milestone" | "config";

export type HistoryKind = RecordKind | "user" | "membership" | "folder-area" | "project" | "agent-key";

export interface RecordVersion {
	recordKey: string;
	revision: string;
}

export interface HistoryRecordChange {
	recordKey: string;
	kind: HistoryKind;
	visibleId: string;
	beforeRevision: string | null;
	afterRevision: string | null;
	before: unknown | null;
	after: unknown | null;
}

export interface HistoryEvent {
	eventId: string;
	operationId: string;
	scope: MutationScope;
	source: MutationSource;
	actor: MutationActor;
	action: string;
	occurredAt: string | null;
	detectedAt?: string;
	changes: HistoryRecordChange[];
}

/** Only an allowlisted, non-secret response may be stored for replay. */
export interface SafeHttpResult {
	status: number;
	body: unknown;
	headers?: Record<string, string>;
}

export interface OperationView {
	operationId: string;
	/** SHA-256 of the semantic request, for safe lost-response verification. */
	requestHash?: string;
	scope: MutationScope;
	state: OperationState;
	source: MutationSource;
	actor: MutationActor;
	createdAt: string;
	updatedAt: string;
	resolvedBy?: string;
	result?: SafeHttpResult;
	error?: { code: string; message: string };
}

export interface HistoryPage {
	items: HistoryEvent[];
	nextCursor: string | null;
	actors?: Record<string, string>;
}

export interface HistoryFilters {
	recordKey?: string;
	kind?: HistoryKind;
	cursor?: string;
	limit?: number;
	from?: string;
	until?: string;
	actor?: string;
	action?: string;
	source?: MutationSource;
}

export type MutationErrorCode =
	| "AMBIGUOUS_ID"
	| "WRITE_LOCKED"
	| "PRECONDITION_REQUIRED"
	| "REVISION_CONFLICT"
	| "IDEMPOTENCY_KEY_REUSED"
	| "OPERATION_IN_PROGRESS"
	| "OPERATION_NOT_APPLIED"
	| "OPERATION_RESOLVED"
	| "RECOVERY_REQUIRED"
	| "OBSERVATION_UNAVAILABLE";

export interface MutationErrorBody {
	error: string;
	code: MutationErrorCode;
	operationId?: string;
	resolvedBy?: string;
	recordKey?: string;
	expectedRevision?: string;
	currentRevision?: string;
}
