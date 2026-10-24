import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import type { HistoryEvent, HistoryPage } from "../../server/mutation-types";
import type { Task } from "../../types";
import { HISTORY_ACTIONS, historyActionLabel } from "../../types/history";
import type { ReviewPerson } from "../../types/task-review";
import { useAuth } from "../contexts/AuthContext";
import { projectScope } from "../lib/project-scope";
import { requestJson } from "../lib/request";
import { serverTime } from "../lib/server-time";
import { buttonClass, inputClass } from "./AccountForms";

const sources = ["browser", "server-cli", "agent", "external", "recovery", "baseline"];

function HistoryItem({
	event,
	recordKey,
	actors,
}: {
	event: HistoryEvent;
	recordKey?: string;
	actors: Record<string, string>;
}) {
	const [expanded, setExpanded] = useState(false);
	const [count, setCount] = useState(10);
	const [linkError, setLinkError] = useState<string | null>(null);
	const { session } = useAuth();
	const mounted = useRef(false);
	const owner = useRef(session?.user.id);
	owner.current = session?.user.id;
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const navigate = useNavigate();
	const openRecord = async (kind: string, id: string, key: string) => {
		const account = owner.current;
		const apiKind = kind === "document" ? "docs" : kind === "decision" ? "decisions" : "tasks";
		const pageKind = kind === "document" ? "documentation" : apiKind;
		try {
			const record = await requestJson<{ recordKey?: string }>(
				`${projectScope.apiBase}/${apiKind}/${encodeURIComponent(id)}`,
			);
			if (!mounted.current || owner.current !== account) return;
			if (record.recordKey !== key)
				throw new Error("This identifier now belongs to a different record. The original history is preserved.");
			navigate(`/${pageKind}/${encodeURIComponent(id)}`);
		} catch (reason) {
			if (!mounted.current || owner.current !== account) return;
			setLinkError(reason instanceof Error ? reason.message : "This record is unavailable; its history is preserved.");
		}
	};
	const changes = event.changes.filter((change) => !recordKey || change.recordKey === recordKey);
	const actor =
		event.actor.kind === "unknown"
			? "Unknown actor"
			: `${event.actor.kind === "agent" ? "Agent for " : ""}${actors[event.actor.userId] ?? event.actor.userId}`;
	return (
		<li className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
			<details onToggle={(event) => setExpanded(event.currentTarget.open)}>
				<summary className="cursor-pointer break-words font-medium">
					{historyActionLabel(event.action, event.source)} · {actor}
					<span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400">
						{event.occurredAt
							? `${serverTime(event.occurredAt)} (Istanbul)`
							: `Occurred: unknown · Detected: ${serverTime(event.detectedAt ?? null)} (Istanbul)`}{" "}
						· {event.source}
					</span>
				</summary>
				{expanded && (
					<div className="mt-4 space-y-4">
						{changes.slice(0, count).map((change) => (
							<div key={change.recordKey} className="min-w-0">
								<div className="mb-2 flex flex-wrap items-center gap-3 text-sm font-medium">
									<span>
										{change.kind} {change.visibleId}
									</span>
									{["task", "document", "decision"].includes(change.kind) && change.after !== null && (
										<button
											type="button"
											className="text-blue-600 underline dark:text-blue-400"
											onClick={() => void openRecord(change.kind, change.visibleId, change.recordKey)}
										>
											Open {change.kind}
										</button>
									)}
									{!recordKey && (
										<Link
											className="underline"
											to={`/history?recordKey=${encodeURIComponent(change.recordKey)}&recordLabel=${encodeURIComponent(change.visibleId)}`}
										>
											Record history
										</Link>
									)}
								</div>
								<div className="grid min-w-0 gap-3 lg:grid-cols-2">
									{(["before", "after"] as const).map((side) => (
										<div key={side} className="min-w-0">
											<h3 className="mb-1 text-sm font-medium capitalize">{side}</h3>
											<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
												{change[side] === null
													? "No record"
													: typeof change[side] === "string"
														? change[side]
														: JSON.stringify(change[side], null, 2)}
											</pre>
										</div>
									))}
								</div>
							</div>
						))}
						{changes.length > count && (
							<button type="button" className={buttonClass} onClick={() => setCount((value) => value + 10)}>
								Show more records
							</button>
						)}
					</div>
				)}
			</details>
			{linkError && (
				<p role="alert" className="mt-2 text-sm text-amber-700 dark:text-amber-300">
					{linkError}
				</p>
			)}
		</li>
	);
}

export default function HistoryPanel({ recordKey, tasks = [] }: { recordKey?: string; tasks?: Task[] }) {
	const { session } = useAuth();
	const [search, setSearch] = useSearchParams();
	const [filters, setFilters] = useState<Record<string, string>>({});
	const [items, setItems] = useState<HistoryEvent[]>([]);
	const [actors, setActors] = useState<Record<string, string>>({});
	const [cursor, setCursor] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [refresh, setRefresh] = useState(0);
	const generation = useRef(0);
	const controller = useRef<AbortController | null>(null);
	const selectedKey = recordKey ?? search.get("recordKey") ?? "";
	const query = new URLSearchParams({ limit: "20", ...(selectedKey && { recordKey: selectedKey }) });
	for (const [key, value] of Object.entries(filters)) {
		if (!value) continue;
		if (key === "from" || key === "until") {
			const date = new Date(`${value}+03:00`);
			query.set(key, Number.isNaN(date.valueOf()) ? value : date.toISOString());
		} else query.set(key, value);
	}
	const queryString = query.toString();
	const load = async (nextCursor: string | null, token: number, signal: AbortSignal) => {
		setBusy(true);
		setError(null);
		try {
			const page = await requestJson<HistoryPage>(
				`${projectScope.apiBase}/history?${queryString}${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`,
				{ signal },
			);
			if (signal.aborted || generation.current !== token) return;
			setItems((previous) => (nextCursor ? [...previous, ...page.items] : page.items));
			setActors((previous) => ({ ...previous, ...page.actors }));
			setCursor(page.nextCursor);
		} catch (reason) {
			if (!signal.aborted && generation.current === token)
				setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			if (!signal.aborted && generation.current === token) setBusy(false);
		}
	};
	useEffect(() => {
		const token = ++generation.current;
		const next = new AbortController();
		controller.current = next;
		setItems([]);
		setActors({});
		setCursor(null);
		void requestJson<ReviewPerson[]>(`${projectScope.apiBase}/reviewers`, { signal: next.signal })
			.then((people) => {
				if (!next.signal.aborted && generation.current === token)
					setActors((previous) => ({
						...Object.fromEntries(people.map((person) => [person.userId, person.name])),
						...previous,
					}));
			})
			.catch(() => {});
		void load(null, token, next.signal);
		return () => {
			next.abort();
			generation.current++;
		};
	}, [queryString, session?.user.id, refresh]);
	const field = (key: string, value: string) => setFilters((current) => ({ ...current, [key]: value }));
	return (
		<section className="space-y-4 text-gray-900 dark:text-gray-100" aria-label="History">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-xl font-semibold">
					History{!recordKey && search.get("recordLabel") ? ` · ${search.get("recordLabel")}` : ""}
				</h2>
				<button type="button" className="text-sm underline" onClick={() => setRefresh((value) => value + 1)}>
					Refresh history
				</button>
			</div>
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				<label className="text-sm">
					From (Istanbul)
					<input
						className={inputClass}
						type="datetime-local"
						value={filters.from ?? ""}
						onChange={(event) => field("from", event.target.value)}
					/>
				</label>
				<label className="text-sm">
					Until (exclusive, Istanbul)
					<input
						className={inputClass}
						type="datetime-local"
						value={filters.until ?? ""}
						onChange={(event) => field("until", event.target.value)}
					/>
				</label>
				<label className="text-sm">
					Person
					<select
						className={inputClass}
						value={filters.actor ?? ""}
						onChange={(event) => field("actor", event.target.value)}
					>
						<option value="">All people</option>
						<option value="unknown">Unknown actor</option>
						{Object.entries(actors).map(([id, name]) => (
							<option key={id} value={id}>
								{name}
							</option>
						))}
					</select>
				</label>
				<label className="text-sm">
					Action
					<select
						className={inputClass}
						value={filters.action ?? ""}
						onChange={(event) => field("action", event.target.value)}
					>
						<option value="">All actions</option>
						{HISTORY_ACTIONS.map((item) => (
							<option key={item.kind} value={item.kind}>
								{item.label}
							</option>
						))}
					</select>
				</label>
				<label className="text-sm">
					Record type
					<select
						className={inputClass}
						value={filters.kind ?? ""}
						onChange={(event) => field("kind", event.target.value)}
					>
						<option value="">All records</option>
						{["task", "document", "decision", "milestone", "config"].map((kind) => (
							<option key={kind} value={kind}>
								{kind}
							</option>
						))}
					</select>
				</label>
				<label className="text-sm">
					Source
					<select
						className={inputClass}
						value={filters.source ?? ""}
						onChange={(event) => field("source", event.target.value)}
					>
						<option value="">All sources</option>
						{sources.map((source) => (
							<option key={source} value={source}>
								{source}
							</option>
						))}
					</select>
				</label>
				{!recordKey && (
					<label className="text-sm">
						Task
						<select
							className={inputClass}
							value={selectedKey}
							onChange={(event) => {
								const next = new URLSearchParams(search);
								const task = tasks.find((task) => task.recordKey === event.target.value);
								if (task?.recordKey) {
									next.set("recordKey", task.recordKey);
									next.set("recordLabel", task.id);
								} else {
									next.delete("recordKey");
									next.delete("recordLabel");
								}
								setSearch(next);
							}}
						>
							<option value="">All tasks and records</option>
							{selectedKey && !tasks.some((task) => task.recordKey === selectedKey) && (
								<option value={selectedKey}>{search.get("recordLabel") ?? "Selected record"}</option>
							)}
							{tasks
								.filter((task) => task.recordKey)
								.map((task) => (
									<option key={task.recordKey} value={task.recordKey}>
										{task.id} · {task.title}
									</option>
								))}
						</select>
					</label>
				)}
			</div>
			{error && (
				<p role="alert" className="text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
			{!busy && !error && !items.length && (
				<p className="text-sm text-gray-500 dark:text-gray-400">No history events.</p>
			)}
			<ul className="space-y-3">
				{items.map((event) => (
					<HistoryItem key={event.eventId} event={event} recordKey={selectedKey || undefined} actors={actors} />
				))}
			</ul>
			{busy && <p role="status">Loading history…</p>}
			{cursor && (
				<button
					type="button"
					className={buttonClass}
					disabled={busy}
					onClick={() => {
						if (controller.current) void load(cursor, generation.current, controller.current.signal);
					}}
				>
					Load more history
				</button>
			)}
		</section>
	);
}

export function ProjectHistory() {
	const { tasks } = useOutletContext<{ tasks: Task[] }>();
	return (
		<div className="p-4 sm:p-8">
			<HistoryPanel tasks={tasks} />
		</div>
	);
}
