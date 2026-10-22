import { ApiError } from "../lib/api";
import { HttpError } from "../lib/request";

function conflictCode(error: unknown): string | undefined {
	return error instanceof ApiError || error instanceof HttpError ? error.code : undefined;
}

export function isMutationConflict(error: unknown): boolean {
	const code = conflictCode(error);
	return code === "REVISION_CONFLICT" || code === "OPERATION_RESOLVED";
}

export function MutationConflictNotice({
	error,
	onOpenCurrent,
	onDismiss,
	draft = true,
}: {
	error: unknown;
	onOpenCurrent: () => void;
	onDismiss: () => void;
	draft?: boolean;
}) {
	if (!isMutationConflict(error)) return null;
	const resolved = conflictCode(error) === "OPERATION_RESOLVED";
	return (
		<div
			role="alert"
			className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
		>
			{resolved
				? `The interrupted operation was resolved separately. Review current data before submitting again.${draft ? " Your draft is kept." : ""}`
				: draft
					? "This record changed. Your draft is kept."
					: "This record changed. Open current data before changing it."}
			<div className="mt-2 flex gap-4">
				<button type="button" className="underline" onClick={onOpenCurrent}>
					Open current version
				</button>
				<button type="button" className="underline" onClick={onDismiss}>
					{draft ? "Keep draft" : "Dismiss"}
				</button>
			</div>
		</div>
	);
}
