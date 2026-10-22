import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
	checkPendingMutation,
	listPendingMutations,
	onPendingMutationsChanged,
	retryPendingMutation,
} from "../lib/request";

/** Available on project and admin pages so a lost response can be resolved under the current account. */
export function ProjectWriteNotice() {
	const { session, writeState, pendingOperationId, refresh } = useAuth();
	const ownerRef = useRef(session?.user.id);
	ownerRef.current = session?.user.id;
	const [pending, setPending] = useState(listPendingMutations);
	const [result, setResult] = useState<string | null>(null);
	useEffect(() => onPendingMutationsChanged(() => setPending(listPendingMutations())), []);
	useEffect(() => setResult(null), [session?.user.id]);

	const completed = () => {
		setResult("Operation completed. Check the current data before another change.");
		window.dispatchEvent(new window.Event("backlog-operation-resolved"));
		void refresh();
	};
	const check = async (operationId: string) => {
		const owner = ownerRef.current;
		const view = await checkPendingMutation(operationId);
		if (ownerRef.current !== owner) return;
		if (!view) setResult("Operation status is unavailable. Check again before submitting another change.");
		else if (view.resolvedBy) {
			setResult("The interrupted operation was resolved separately. Review the current data before submitting again.");
			window.dispatchEvent(new window.Event("backlog-operation-resolved"));
			void refresh();
		} else if (view.state === "completed") completed();
		else if (view.state === "not_applied") setResult("Operation was not applied. You can submit the form again.");
		else if (view.state === "recovery_required") {
			setResult("Project writes are paused for recovery.");
			void refresh();
		} else setResult("Operation is still in progress. Check again later.");
	};
	const retry = async (operationId: string) => {
		const owner = ownerRef.current;
		try {
			const response = await retryPendingMutation(operationId);
			if (ownerRef.current !== owner) return;
			if (!response.ok) {
				const data = await response.json().catch(() => null);
				throw new Error(data?.error ?? `Operation failed (${response.status}).`);
			}
			completed();
		} catch (error) {
			if (ownerRef.current !== owner) return;
			setResult(error instanceof Error ? error.message : String(error));
		}
	};
	if (writeState !== "recovery_required" && pending.length === 0 && !result) return null;
	return (
		<aside className="fixed bottom-4 right-4 z-[180] w-[min(30rem,calc(100vw-2rem))] space-y-2 text-sm">
			{writeState === "recovery_required" && (
				<div
					role="alert"
					className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
				>
					Project writes are paused for recovery.
					{pendingOperationId ? <span className="ml-2 font-mono">Operation {pendingOperationId}</span> : null}
					<button type="button" className="ml-3 underline" onClick={() => void refresh()}>
						Check again
					</button>
				</div>
			)}
			{pending.map((item) => (
				<div
					key={item.operationId}
					role="alert"
					className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
				>
					Operation {item.operationId}
					{item.state === "recovery_required"
						? " requires recovery."
						: item.state === "pending"
							? " is still in progress."
							: " has no confirmed result."}
					<div className="mt-2 flex gap-4">
						<button type="button" className="underline" onClick={() => void check(item.operationId)}>
							Check result
						</button>
						{item.state === "unknown" && (
							<button type="button" className="underline" onClick={() => void retry(item.operationId)}>
								Retry same request
							</button>
						)}
					</div>
				</div>
			))}
			{result && (
				<div
					role="status"
					className="rounded-lg border border-gray-300 bg-white p-3 text-gray-900 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
				>
					{result}
					<button type="button" className="ml-3 underline" onClick={() => window.location.reload()}>
						Reload view
					</button>
					<button type="button" className="ml-3 underline" onClick={() => setResult(null)}>
						Dismiss
					</button>
				</div>
			)}
		</aside>
	);
}
