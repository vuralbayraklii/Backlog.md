import type { FileEntry } from "../file-system/prepared-change.ts";
import type { StoredRecord } from "./mutation-store.ts";
import type { HistoryEvent, RecordKind } from "./mutation-types.ts";

export interface ObservedFileIdentity {
	dev: string;
	ino: string;
	birthtimeNs: string;
}

/** A fully parsed, guarded project path, including raw content behind a symlink. */
export interface ObservedPathSnapshot {
	path: string;
	entry: Exclude<FileEntry, null>;
	recordBytes: Uint8Array;
	recordKey: string;
	kind: RecordKind;
	visibleId: string;
	lifecycle: StoredRecord["lifecycle"];
	identity: ObservedFileIdentity | null;
}

export interface ObservationState {
	state: "checking" | "ready" | "degraded";
	lastSuccessfulScanAt: string | null;
	checkedAt: string | null;
	error: string | null;
}

export interface ObservationCheckpoint {
	state: ObservationState;
	entries: ObservedPathSnapshot[];
	fingerprint: string;
}

export interface ObservationCommit {
	expectedFingerprint: string;
	entries: readonly ObservedPathSnapshot[];
	recordUpdates: readonly StoredRecord[];
	event: HistoryEvent | null;
	checkedAt: string;
}
