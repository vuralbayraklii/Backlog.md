import { useEffect, useRef, useState } from "react";
import type { Task } from "../../types";
import {
	openReviewRequests,
	type ReviewAction,
	type ReviewOutcome,
	type ReviewPerson,
	type ReviewRequestType,
	type TaskReviewEntry,
	type TaskReviewView,
	type VerificationResult,
} from "../../types/task-review";
import { useAuth } from "../contexts/AuthContext";
import { useUnsavedChanges } from "../contexts/UnsavedChangesContext";
import { projectScope } from "../lib/project-scope";
import { requestJson } from "../lib/request";
import { serverTime } from "../lib/server-time";
import { buttonClass, inputClass } from "./AccountForms";
import MermaidMarkdown from "./MermaidMarkdown";
import { isMutationConflict, MutationConflictNotice } from "./MutationConflictNotice";

interface ReviewData extends TaskReviewView {
	entries: TaskReviewEntry[];
	revision?: string;
}
type RequestEntry = Extract<TaskReviewEntry, { kind: "request" }>;

export default function TaskReviewPanel({
	task,
	disabled,
	onSaved,
}: {
	task: Task;
	disabled: boolean;
	onSaved?: () => Promise<void> | void;
}) {
	const { session, permissions, writesAvailable } = useAuth();
	const [data, setData] = useState<ReviewData | null>(null);
	const [people, setPeople] = useState<ReviewPerson[]>([]);
	const [form, setForm] = useState<"request" | "verification" | RequestEntry | null>(null);
	const [type, setType] = useState<ReviewRequestType>("review");
	const [reviewer, setReviewer] = useState("");
	const [reason, setReason] = useState("");
	const [notes, setNotes] = useState("");
	const [evidence, setEvidence] = useState("");
	const [commit, setCommit] = useState("");
	const [decision, setDecision] = useState("");
	const [result, setResult] = useState<VerificationResult>("passed");
	const [outcome, setOutcome] = useState<ReviewOutcome>("approved");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const [refresh, setRefresh] = useState(0);
	const baseline = useRef<string | undefined>(undefined);
	const generation = useRef(0);
	const mounted = useRef(false);
	const identity = useRef("");
	const mutationPending = useRef(false);
	identity.current = `${task.id}:${session?.user.id}`;
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const draft = Boolean(form && (reason || notes || evidence || commit || decision || reviewer));
	useUnsavedChanges(draft || busy);
	const base = `${projectScope.apiBase}/tasks/${encodeURIComponent(task.id)}/reviews`;
	useEffect(() => {
		const token = ++generation.current;
		const controller = new AbortController();
		void requestJson<ReviewData>(base, { signal: controller.signal })
			.then((value) => {
				if (!controller.signal.aborted && generation.current === token) setData(value);
			})
			.catch((reason) => {
				if (!controller.signal.aborted && generation.current === token) setError(reason);
			});
		void requestJson<ReviewPerson[]>(`${projectScope.apiBase}/reviewers`, { signal: controller.signal })
			.then((value) => {
				if (!controller.signal.aborted && generation.current === token) setPeople(value);
			})
			.catch((reason) => {
				if (!controller.signal.aborted && generation.current === token) setError(reason);
			});
		return () => {
			controller.abort();
			generation.current++;
		};
	}, [base, task.revision, session?.user.id, refresh]);
	const clear = () => {
		setForm(null);
		setReason("");
		setNotes("");
		setEvidence("");
		setCommit("");
		setDecision("");
		setReviewer("");
		baseline.current = undefined;
	};
	const start = (next: typeof form) => {
		if (draft && !window.confirm("Discard this review draft?")) return;
		clear();
		setError(null);
		setForm(next);
		setOutcome("approved");
		baseline.current = task.revision;
	};
	const blocked = disabled || !writesAvailable || busy;
	const save = async (verb: string, action: ReviewAction) => {
		if (blocked || mutationPending.current) return;
		const revision = baseline.current ?? task.revision;
		if (!revision) {
			setError(new Error("Open the current task before submitting a review."));
			return;
		}
		const owner = identity.current;
		mutationPending.current = true;
		setBusy(true);
		setError(null);
		try {
			await requestJson(`${base}/${verb}`, {
				method: "POST",
				headers: { "If-Match": revision },
				body: JSON.stringify(action),
			});
			if (!mounted.current || identity.current !== owner) return;
			clear();
			if (onSaved) await onSaved();
			setRefresh((value) => value + 1);
		} catch (reason) {
			if (mounted.current && identity.current === owner) setError(reason);
		} finally {
			mutationPending.current = false;
			if (mounted.current) setBusy(false);
		}
	};
	const trust = new Set(data?.trustedEntryIds ?? []);
	const stale = (entry: TaskReviewEntry) =>
		Boolean(data && (entry.contentHash !== data.contentHash || data.staleEntryIds.includes(entry.id)));
	const open = openReviewRequests(data?.entries ?? [], trust);
	const latestVerification = data?.entries.findLast((entry) => entry.kind === "verification" && !stale(entry));
	const canAccept =
		latestVerification?.kind === "verification" &&
		latestVerification.result !== "failed" &&
		trust.has(latestVerification.id) &&
		!stale(latestVerification);
	const requestTypes = new Map(
		(data?.entries ?? []).flatMap((entry) =>
			entry.kind === "request" && trust.has(entry.id) && !stale(entry) ? [[entry.id, entry.type] as const] : [],
		),
	);
	const latestAcceptance = data?.entries.findLast(
		(entry) =>
			entry.kind === "response" &&
			requestTypes.get(entry.requestId) === "acceptance" &&
			trust.has(entry.id) &&
			!stale(entry),
	);
	const authorLabel = (entry: TaskReviewEntry) =>
		trust.has(entry.id)
			? `${entry.author.kind === "agent" ? "Agent for " : ""}${entry.author.name}`
			: `Declared identity: ${entry.author.name}`;
	const canWrite = permissions.tasksWrite;
	const actionForForm = (): { verb: string; action: ReviewAction } | null => {
		if (form === "request") {
			const person = people.find((person) => person.userId === reviewer);
			return person ? { verb: "request", action: { kind: "request", type, reviewer: person, reason } } : null;
		}
		if (form === "verification")
			return {
				verb: "verify",
				action: {
					kind: "verification",
					result,
					notes,
					evidence: evidence
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean),
					...(commit.trim() && { commit: commit.trim() }),
				},
			};
		if (form)
			return {
				verb: "respond",
				action: {
					kind: "response",
					requestId: form.id,
					outcome: form.type === "decision" ? "answered" : outcome,
					notes,
					...(decision.trim() && { decision: decision.trim() }),
				},
			};
		return null;
	};
	return (
		<section
			aria-label="Reviews and verification"
			className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<h2 className="text-xl font-semibold">Reviews and verification</h2>
			{data && (
				<dl className="grid gap-3 text-sm sm:grid-cols-2">
					<div>
						<dt className="font-medium">Verification</dt>
						<dd>
							{latestVerification?.kind === "verification"
								? `${trust.has(latestVerification.id) ? "" : "Declared: "}${latestVerification.result === "not-applicable" ? "Not applicable" : latestVerification.result === "passed" ? "Passed" : "Failed"} · ${authorLabel(latestVerification)}`
								: "Not recorded for current content"}
						</dd>
					</div>
					<div>
						<dt className="font-medium">Acceptance</dt>
						<dd>
							{latestAcceptance?.kind === "response"
								? `${latestAcceptance.outcome === "approved" ? "Accepted" : "Changes requested"} · ${latestAcceptance.author.name}`
								: "Not recorded for current content"}
						</dd>
					</div>
				</dl>
			)}
			{Boolean(error) && (
				<MutationConflictNotice
					error={error}
					onOpenCurrent={() => {
						void Promise.resolve(onSaved?.()).then(() => {
							baseline.current = undefined;
							setRefresh((value) => value + 1);
							setError(null);
						});
					}}
					onDismiss={() => setError(null)}
				/>
			)}
			{Boolean(error) && !isMutationConflict(error) && (
				<p role="alert" className="break-words text-red-600 dark:text-red-400">
					{error instanceof Error ? error.message : String(error)}
				</p>
			)}
			{!data && !error && <p role="status">Loading reviews…</p>}
			{open.map((request) => (
				<div key={request.id} className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
					<h3 className="font-medium">
						#{request.id} ·{" "}
						{request.type === "acceptance" ? "Acceptance" : request.type === "decision" ? "Decision" : "Review"} ·{" "}
						{request.reviewer.name}
					</h3>
					<p className="whitespace-pre-wrap break-words text-sm">{request.reason}</p>
					{stale(request) && (
						<p role="status" className="text-sm text-amber-700 dark:text-amber-300">
							Task content changed. A new request is required.
						</p>
					)}
					{request.type === "acceptance" && !stale(request) && !canAccept && (
						<p className="text-sm text-amber-700 dark:text-amber-300">
							Acceptance requires a successful verification of the current task content.
						</p>
					)}
					<div className="flex flex-wrap gap-3">
						{request.reviewer.userId === session?.user.id && (
							<button
								type="button"
								className={buttonClass}
								disabled={blocked || stale(request)}
								onClick={() => start(request)}
							>
								Respond to #{request.id}
							</button>
						)}
						{(session?.user.role === "admin" || (canWrite && request.author.userId === session?.user.id)) && (
							<button
								type="button"
								className="text-sm underline disabled:opacity-50"
								disabled={blocked}
								onClick={() => {
									if (draft && !window.confirm("Discard this review draft?")) return;
									const reason = window.prompt("Reason for cancelling this request");
									if (reason?.trim()) {
										baseline.current = task.revision;
										void save("cancel", { kind: "cancellation", requestId: request.id, reason });
									}
								}}
							>
								Cancel request #{request.id}
							</button>
						)}
					</div>
				</div>
			))}
			{data && !open.length && <p className="text-sm text-gray-500 dark:text-gray-400">No open review requests.</p>}
			{canWrite && (
				<div className="flex flex-wrap gap-3">
					<button type="button" className={buttonClass} disabled={blocked} onClick={() => start("request")}>
						Request review
					</button>
					<button type="button" className={buttonClass} disabled={blocked} onClick={() => start("verification")}>
						Record verification
					</button>
				</div>
			)}
			{form && (
				<form
					aria-label="Review response form"
					className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700"
					onSubmit={(event) => {
						event.preventDefault();
						const value = actionForForm();
						if (value) void save(value.verb, value.action);
					}}
				>
					{form === "request" ? (
						<>
							<label className="block text-sm">
								Request type
								<select
									name="review-type"
									className={inputClass}
									value={type}
									onChange={(event) => setType(event.target.value as ReviewRequestType)}
								>
									<option value="review">Review</option>
									<option value="decision">Decision</option>
									<option value="acceptance">Acceptance</option>
								</select>
							</label>
							<label className="block text-sm">
								Reviewer
								<select
									name="reviewer"
									className={inputClass}
									required
									value={reviewer}
									onChange={(event) => setReviewer(event.target.value)}
								>
									<option value="">Choose a person</option>
									{people.map((person) => (
										<option key={person.userId} value={person.userId}>
											{person.name}
										</option>
									))}
								</select>
							</label>
							<label className="block text-sm">
								Requested action
								<textarea
									name="review-reason"
									className={inputClass}
									required
									value={reason}
									onChange={(event) => setReason(event.target.value)}
								/>
							</label>
						</>
					) : (
						<>
							{form === "verification" ? (
								<label className="block text-sm">
									Verification result
									<select
										name="verification-result"
										className={inputClass}
										value={result}
										onChange={(event) => setResult(event.target.value as VerificationResult)}
									>
										<option value="passed">Passed</option>
										<option value="failed">Failed</option>
										<option value="not-applicable">Not applicable</option>
									</select>
								</label>
							) : (
								form.type !== "decision" && (
									<label className="block text-sm">
										Response
										<select
											name="review-outcome"
											className={inputClass}
											value={outcome}
											onChange={(event) => setOutcome(event.target.value as ReviewOutcome)}
										>
											<option value="approved">{form.type === "acceptance" ? "Accept" : "Approve"}</option>
											<option value="changes-requested">Request changes</option>
										</select>
									</label>
								)
							)}
							<label className="block text-sm">
								{form === "verification" ? "Verification notes" : "Response notes"}
								<textarea
									name="review-notes"
									className={inputClass}
									required
									value={notes}
									onChange={(event) => setNotes(event.target.value)}
								/>
							</label>
							{form === "verification" && (
								<>
									<label className="block text-sm">
										Evidence (one reference per line)
										<textarea
											name="review-evidence"
											className={inputClass}
											required={result !== "not-applicable"}
											value={evidence}
											onChange={(event) => setEvidence(event.target.value)}
										/>
									</label>
									<label className="block text-sm">
										Commit (optional)
										<input
											name="review-commit"
											className={inputClass}
											value={commit}
											onChange={(event) => setCommit(event.target.value)}
										/>
									</label>
								</>
							)}
							{typeof form === "object" && form.type === "decision" && (
								<label className="block text-sm">
									Decision reference (optional)
									<input
										name="review-decision"
										className={inputClass}
										value={decision}
										onChange={(event) => setDecision(event.target.value)}
									/>
								</label>
							)}
						</>
					)}
					<div className="flex flex-wrap gap-3">
						<button
							type="submit"
							className={buttonClass}
							disabled={
								blocked ||
								(typeof form === "object" && form.type === "acceptance" && outcome === "approved" && !canAccept)
							}
						>
							{busy ? "Saving…" : "Submit review record"}
						</button>
						<button
							type="button"
							className="text-sm underline"
							disabled={busy}
							onClick={() => {
								if (!draft || window.confirm("Discard this review draft?")) clear();
							}}
						>
							Discard review draft
						</button>
					</div>
				</form>
			)}
			{!!data?.entries.length && (
				<details>
					<summary className="cursor-pointer text-sm font-medium">Review records ({data.entries.length})</summary>
					<ol className="mt-3 space-y-3">
						{[...data.entries].reverse().map((entry) => (
							<li key={entry.id} className="space-y-1 border-l-2 border-gray-200 pl-3 text-sm dark:border-gray-600">
								<p className="font-medium">
									#{entry.id} ·{" "}
									{entry.kind === "verification"
										? `Verification: ${entry.result}`
										: entry.kind === "response"
											? `Response to #${entry.requestId}: ${entry.outcome}`
											: entry.kind === "request"
												? `${entry.type} requested from ${entry.reviewer.name}`
												: `Request #${entry.requestId} cancelled`}
								</p>
								<p className="text-xs text-gray-500 dark:text-gray-400">
									{authorLabel(entry)} · {serverTime(entry.createdAt)} (Istanbul)
									{stale(entry) ? " · Previous task content" : ""}
								</p>
								<div className="prose prose-sm max-w-none break-words dark:prose-invert">
									<MermaidMarkdown
										source={entry.kind === "request" || entry.kind === "cancellation" ? entry.reason : entry.notes}
									/>
								</div>
								{entry.kind === "verification" && (
									<>
										<ul className="list-inside list-disc break-words">
											{entry.evidence.map((item, index) => (
												<li key={`${entry.id}-${index}`}>
													<MermaidMarkdown source={item} />
												</li>
											))}
										</ul>
										{entry.commit && <p className="break-all">Commit: {entry.commit}</p>}
									</>
								)}
								{entry.kind === "response" && entry.decision && (
									<div className="break-words">
										<MermaidMarkdown
											source={
												/^decision-\d+$/i.test(entry.decision)
													? `[${entry.decision}](/decisions/${entry.decision})`
													: entry.decision
											}
										/>
									</div>
								)}
							</li>
						))}
					</ol>
				</details>
			)}
		</section>
	);
}
