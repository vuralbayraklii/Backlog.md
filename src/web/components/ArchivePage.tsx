import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { projectScope } from "../lib/project-scope";
import { HttpError, requestJson } from "../lib/request";
import { buttonClass, inputClass } from "./AccountForms";
import MermaidMarkdown from "./MermaidMarkdown";
import { isMutationConflict, MutationConflictNotice } from "./MutationConflictNotice";

type Kind = "tasks" | "docs" | "decisions";
interface ArchivedRecord {
	id: string;
	title: string;
	recordKey?: string;
	revision?: string;
	rawContent?: string;
	content?: string;
	description?: string;
	context?: string;
	decision?: string;
	consequences?: string;
}
export default function ArchivePage({ onRefreshData }: { onRefreshData: () => Promise<void> }) {
	const { permissions, writesAvailable } = useAuth();
	const [kind, setKind] = useState<Kind>("tasks");
	const [records, setRecords] = useState<ArchivedRecord[]>([]);
	const [selected, setSelected] = useState<ArchivedRecord | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [conflict, setConflict] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const generation = useRef(0);
	const base = `${projectScope.apiBase}/${kind}`;
	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setRecords([]);
		setSelected(null);
		setError(null);
		setConflict(null);
		generation.current++;
		void requestJson<ArchivedRecord[]>(`${base}/archived`, { signal: controller.signal })
			.then(setRecords)
			.catch((reason) => {
				if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [base]);
	const mutate = async (record: ArchivedRecord, remove: boolean) => {
		if (busy) return;
		if (remove && !window.confirm(`Permanently delete ${record.id} — ${record.title}? This cannot be undone.`)) return;
		setBusy(true);
		setError(null);
		setConflict(null);
		const owner = generation.current;
		try {
			const outcome = await requestJson<{ cleanedTaskIds?: string[]; listedAsDocumentationBy?: string[] }>(
				`${base}/${encodeURIComponent(record.id)}${remove ? "" : "/restore"}`,
				{
					method: remove ? "DELETE" : "POST",
					headers: projectScope.id && record.revision ? { "If-Match": record.revision } : undefined,
				},
			);
			if (owner !== generation.current) return;
			setRecords((current) => current.filter((item) => item.id !== record.id));
			setSelected(null);
			const affected = [...(outcome.cleanedTaskIds ?? []), ...(outcome.listedAsDocumentationBy ?? [])];
			if (affected.length) window.alert(`Affected records: ${affected.join(", ")}`);
			await onRefreshData();
		} catch (reason) {
			if (owner !== generation.current) return;
			if (
				reason instanceof HttpError &&
				(reason.data?.restoreState === "moved" || reason.data?.deleteState === "applied")
			) {
				setRecords((current) => current.filter((item) => item.id !== record.id));
				setSelected(null);
				await onRefreshData();
			}
			setError(reason instanceof Error ? reason.message : String(reason));
			setConflict(isMutationConflict(reason) ? reason : null);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="mx-auto max-w-5xl p-8">
			<div className="mb-8 flex flex-wrap items-center justify-between gap-4">
				<h1 className="text-2xl font-bold">Archive</h1>
				<label>
					Record type
					<select className={inputClass} value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as Kind)}>
						<option value="tasks">Tasks</option>
						<option value="docs">Documents</option>
						<option value="decisions">Decisions</option>
					</select>
				</label>
			</div>
			<MutationConflictNotice
				error={conflict}
				draft={false}
				onOpenCurrent={() => window.location.reload()}
				onDismiss={() => setConflict(null)}
			/>
			{error && !conflict && (
				<p role="alert" className="mb-5 text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
			{loading ? (
				<p role="status">Loading archive...</p>
			) : records.length === 0 ? (
				<p>No archived records.</p>
			) : (
				<ul className="space-y-3">
					{records.map((record) => (
						<li
							key={record.id}
							className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
						>
							<button type="button" onClick={() => setSelected(record)} className="text-left hover:underline">
								<span className="mr-3 font-mono text-sm">{record.id}</span>
								{record.title}
							</button>
							<div className="flex gap-3">
								{permissions.archive && (
									<button
										type="button"
										className={buttonClass}
										disabled={busy || !writesAvailable}
										onClick={() => void mutate(record, false)}
									>
										Restore
									</button>
								)}
								{permissions.delete && (
									<button
										type="button"
										className="rounded-md bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50"
										disabled={busy || !writesAvailable}
										onClick={() => void mutate(record, true)}
									>
										Delete permanently
									</button>
								)}
							</div>
						</li>
					))}
				</ul>
			)}
			{selected && (
				<article className="mt-8 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
					<div className="mb-5 flex items-center justify-between gap-4">
						<h2 className="text-xl font-semibold">
							{selected.id} — {selected.title}
						</h2>
						<button type="button" onClick={() => setSelected(null)}>
							Close
						</button>
					</div>
					<MermaidMarkdown
						source={
							selected.rawContent ??
							selected.content ??
							selected.description ??
							[selected.context, selected.decision, selected.consequences].filter(Boolean).join("\n\n")
						}
					/>
				</article>
			)}
		</section>
	);
}
