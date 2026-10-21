import { useAuth } from "../contexts/AuthContext";
import { sessionFetch } from "../lib/request";
import { useEffect, useState } from "react";

import AccountNavigation from "./AccountNavigation";

interface ProjectChoice {
	id: string;
	name: string;
}

export default function ProjectSelector() {
	const { central, session } = useAuth();
	const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		const controller = new AbortController();
		sessionFetch("/api/projects", { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error("Could not load projects.");
				return (await response.json()) as ProjectChoice[];
			})
			.then(setProjects)
			.catch((reason) => {
				if (reason instanceof Error && reason.name === "AbortError") return;
				setError(true);
			});
		return () => controller.abort();
	}, []);

	return (
		<main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-16 text-gray-900 dark:text-gray-100">
			<div className="mx-auto max-w-2xl">
				<div className="mb-8 flex items-center justify-between gap-4"><h1 className="text-3xl font-bold">Projects</h1><AccountNavigation /></div>
				{error && <p role="alert">Could not load projects. Refresh this page to try again.</p>}
				{!error && projects === null && <p>Loading projects...</p>}
				{projects?.length === 0 && central && session?.user.role !== "admin" && <p>No accessible projects.</p>}
				{projects?.length === 0 && (!central || session?.user.role === "admin") && (
				<p>
					No projects registered. Use <code>backlog server --data-dir &lt;directory&gt; project register &lt;path&gt; --name &lt;name&gt;</code>.
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
