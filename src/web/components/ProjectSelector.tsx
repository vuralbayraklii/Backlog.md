import { useEffect, useState } from "react";
import type { ProjectRegistrationAccess } from "../../server/registration-types";
import { useAuth } from "../contexts/AuthContext";
import { requestJson } from "../lib/request";
import { buttonClass } from "./AccountForms";
import AccountNavigation from "./AccountNavigation";
import ProjectRegistration from "./ProjectRegistration";

interface ProjectChoice {
	id: string;
	name: string;
}

export default function ProjectSelector() {
	const { central, session, ready } = useAuth();
	const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
	const [error, setError] = useState(false);
	const [access, setAccess] = useState<ProjectRegistrationAccess | null>(null);
	const [accessError, setAccessError] = useState(false);
	const [registering, setRegistering] = useState(false);

	useEffect(() => {
		if (!ready) return;
		const controller = new AbortController();
		requestJson<ProjectChoice[]>("/api/projects", { signal: controller.signal })
			.then((projects) => {
				if (!controller.signal.aborted) {
					setProjects(projects);
					setError(false);
				}
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				setError(true);
			});
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
		return () => controller.abort();
	}, [central, ready, session?.csrfToken]);

	return (
		<main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-16 text-gray-900 dark:text-gray-100">
			<div className="mx-auto max-w-4xl">
				<div className="mb-8 flex flex-wrap items-center justify-between gap-4">
					<h1 className="text-3xl font-bold">Projects</h1>
					<AccountNavigation />
				</div>
				{access?.allowed && !registering && (
					<button type="button" className={`${buttonClass} mb-6`} onClick={() => setRegistering(true)}>
						Register project
					</button>
				)}
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
					<p>{session?.user.role === "admin" ? "No projects registered." : "No accessible projects."}</p>
				)}
				{projects?.length === 0 && !central && (
					<p>
						No projects registered. Use{" "}
						<code>backlog server --data-dir &lt;directory&gt; project register &lt;path&gt; --name &lt;name&gt;</code>.
					</p>
				)}
				{projects && projects.length > 0 && (
					<ul className="space-y-3">
						{projects.map((project) => (
							<li key={project.id}>
								<a
									href={`/projects/${encodeURIComponent(project.id)}/board`}
									className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4 font-medium shadow-sm hover:border-stone-500 focus-visible:outline-2 focus-visible:outline-stone-600 dark:border-gray-700 dark:bg-gray-800"
								>
									<span>{project.name}</span>
									<span className="text-sm text-gray-500 dark:text-gray-400">{project.id}</span>
								</a>
							</li>
						))}
					</ul>
				)}
			</div>
		</main>
	);
}
