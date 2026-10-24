import { useEffect, useState } from "react";
import type { ProjectRegistrationAccess } from "../../server/registration-types";
import type { TaskReviewEntry } from "../../types/task-review";
import { useAuth } from "../contexts/AuthContext";
import { requestJson } from "../lib/request";
import { buttonClass } from "./AccountForms";
import { ObservationStatus, type ProjectObservation } from "./ObservationStatus";
import ProjectRegistration from "./ProjectRegistration";
import ServerLayout from "./ServerLayout";

interface ProjectChoice {
	id: string;
	name: string;
	observation?: ProjectObservation;
}

interface ProjectReviewSummary extends ProjectChoice {
	openTasks: number | null;
	nextDueDate: string | null;
	requests: { taskId: string; title: string; request: Extract<TaskReviewEntry, { kind: "request" }>; stale: boolean }[];
	error?: string;
}

export default function ProjectSelector() {
	const { central, session, ready } = useAuth();
	const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
	const [error, setError] = useState(false);
	const [access, setAccess] = useState<ProjectRegistrationAccess | null>(null);
	const [accessError, setAccessError] = useState(false);
	const [registering, setRegistering] = useState(false);
	const [summaries, setSummaries] = useState<ProjectReviewSummary[] | null>(null);
	const [summaryError, setSummaryError] = useState(false);

	useEffect(() => {
		if (!ready) return;
		const controller = new AbortController();
		let latestLoad = 0;
		const loadProjects = () => {
			const request = ++latestLoad;
			if (central)
				void requestJson<{ projects: ProjectReviewSummary[] }>("/api/me/reviews", { signal: controller.signal })
					.then((value) => {
						if (!Array.isArray(value.projects)) throw new Error("Invalid project summary.");
						if (!controller.signal.aborted && request === latestLoad) {
							setSummaries(value.projects);
							setSummaryError(false);
						}
					})
					.catch(() => {
						if (!controller.signal.aborted && request === latestLoad) setSummaryError(true);
					});
			return requestJson<ProjectChoice[]>("/api/projects", { signal: controller.signal })
				.then((projects) => {
					if (!controller.signal.aborted && request === latestLoad) {
						setProjects(projects);
						setError(false);
					}
				})
				.catch(() => {
					if (controller.signal.aborted || request !== latestLoad) return;
					setError(true);
				});
		};
		void loadProjects();
		setSummaries(null);
		setSummaryError(false);
		const refreshVisible = () => {
			if (document.visibilityState === "visible") void loadProjects();
		};
		if (central) window.addEventListener("focus", refreshVisible);
		const timer = central ? window.setInterval(refreshVisible, 30_000) : null;
		if (central)
			requestJson<ProjectRegistrationAccess>("/api/projects/registration", { signal: controller.signal })
				.then((next) => {
					if (!controller.signal.aborted) {
						setAccess(next);
						setAccessError(false);
					}
				})
				.catch(() => {
					if (!controller.signal.aborted) setAccessError(true);
				});
		return () => {
			controller.abort();
			if (timer !== null) window.clearInterval(timer);
			window.removeEventListener("focus", refreshVisible);
		};
	}, [central, ready, session?.csrfToken]);

	return (
		<ServerLayout>
			<div>
				<div className="mb-8 flex flex-wrap items-center justify-between gap-4">
					<h1 className="text-3xl font-bold">Projects</h1>
					{access?.allowed && !registering && (
						<button type="button" className={buttonClass} onClick={() => setRegistering(true)}>
							Register project
						</button>
					)}
				</div>
				{accessError && (
					<p role="alert" className="mb-5">
						Could not load project registration access. Refresh this page to try again.
					</p>
				)}
				{access?.allowed && registering && (
					<ProjectRegistration
						areas={access.areas}
						onCancel={() => setRegistering(false)}
						onRegistered={(id) => window.location.assign(`/projects/${encodeURIComponent(id)}/board`)}
					/>
				)}
				{error && <p role="alert">Could not load projects. Refresh this page to try again.</p>}
				{!error && projects === null && <p>Loading projects...</p>}
				{projects?.length === 0 && central && (
					<p className="rounded-lg border border-gray-200 bg-white p-8 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
						{session?.user.role === "admin" ? "No projects registered." : "No accessible projects."}
					</p>
				)}
				{projects?.length === 0 && !central && (
					<p>
						No projects registered. Use{" "}
						<code>backlog server --data-dir &lt;directory&gt; project register &lt;path&gt; --name &lt;name&gt;</code>.
					</p>
				)}
				{projects && projects.length > 0 && (
					<ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
						{projects.map((project) => {
							const summary = summaries?.find((item) => item.id === project.id);
							return (
								<li key={project.id}>
									<a
										href={`/projects/${encodeURIComponent(project.id)}/board`}
										className="block rounded-lg border border-gray-200 bg-white px-5 py-4 font-medium shadow-sm hover:border-blue-500 focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-gray-700 dark:bg-gray-800"
									>
										<span className="flex items-center justify-between gap-4">
											<span>{project.name}</span>
											<span className="text-sm text-gray-500 dark:text-gray-400">{project.id}</span>
										</span>
										{summary && (
											<dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-normal">
												<div>
													<dt className="text-gray-500 dark:text-gray-400">Open tasks</dt>
													<dd>{summary.openTasks ?? "Unavailable"}</dd>
												</div>
												<div>
													<dt className="text-gray-500 dark:text-gray-400">Next due</dt>
													<dd>{summary.nextDueDate ?? "None"}</dd>
												</div>
											</dl>
										)}
										<ObservationStatus observation={project.observation} compact />
									</a>
								</li>
							);
						})}
					</ul>
				)}
				{central && (
					<section className="mt-8 space-y-4" aria-label="Awaiting your response">
						<h2 className="text-2xl font-bold">Awaiting your response</h2>
						{summaryError && <p role="alert">Could not load assigned requests. Refresh to try again.</p>}
						{!summaryError && summaries === null && <p role="status">Loading assigned requests…</p>}
						{summaries
							?.filter((project) => project.error || project.observation?.state !== "ready")
							.map((project) => (
								<p key={project.id} role="status" className="text-sm text-amber-700 dark:text-amber-300">
									{project.name}: {project.error ?? "Showing the last reliable project data."}
								</p>
							))}
						{!summaryError &&
							summaries &&
							!summaries.some((project) => project.requests.length) &&
							!summaries.some((project) => project.error) && (
								<p className="text-gray-500 dark:text-gray-400">No requests awaiting your response.</p>
							)}
						<ul className="space-y-3">
							{summaries?.flatMap((project) =>
								project.requests.map((item) => (
									<li
										key={`${project.id}:${item.taskId}:${item.request.id}`}
										className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
									>
										<a
											className="break-words font-medium text-blue-600 underline dark:text-blue-400"
											href={`/projects/${project.id}/tasks/${encodeURIComponent(item.taskId)}`}
										>
											{project.name} · {item.taskId} · {item.title}
										</a>
										<p className="mt-1 text-sm font-medium">
											{item.request.type === "acceptance"
												? "Acceptance"
												: item.request.type === "decision"
													? "Decision"
													: "Review"}{" "}
											#{item.request.id}
										</p>
										<p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.request.reason}</p>
										{item.stale && (
											<p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
												Task content changed. A new request is required.
											</p>
										)}
									</li>
								)),
							)}
						</ul>
					</section>
				)}
			</div>
		</ServerLayout>
	);
}
