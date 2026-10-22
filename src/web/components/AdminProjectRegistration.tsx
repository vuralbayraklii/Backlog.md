import { useEffect, useRef, useState } from "react";
import type { ServerUser } from "../../server/auth-types";
import type { ServerProject } from "../../server/project-store";
import type { FolderArea } from "../../server/registration-types";
import { useAuth } from "../contexts/AuthContext";
import { useUnsavedChanges } from "../contexts/UnsavedChangesContext";
import type { RecordVersionLike } from "../lib/api";
import { requestJson } from "../lib/request";
import { buttonClass, inputClass } from "./AccountForms";
import { isMutationConflict, MutationConflictNotice } from "./MutationConflictNotice";

export default function AdminProjectRegistration({ users }: { users: ServerUser[] }) {
	const { ready, session } = useAuth();
	const [areas, setAreas] = useState<(FolderArea & RecordVersionLike)[] | null>(null);
	const [projects, setProjects] = useState<(ServerProject & RecordVersionLike)[] | null>(null);
	const [userId, setUserId] = useState("");
	const [path, setPath] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [conflict, setConflict] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const request = useRef<AbortController | null>(null);
	const identity = useRef(session?.csrfToken);
	identity.current = session?.csrfToken;
	const available = useRef(ready);
	available.current = ready;
	const clearUnsaved = useUnsavedChanges(Boolean(userId || path));
	const admin = session?.user.role === "admin";

	useEffect(() => {
		setBusy(false);
		if (!ready || !admin) return;
		setBusy(true);
		const controller = new AbortController();
		request.current = controller;
		Promise.all([
			requestJson<(FolderArea & RecordVersionLike)[]>("/api/admin/folder-areas", { signal: controller.signal }),
			requestJson<(ServerProject & RecordVersionLike)[]>("/api/admin/projects", { signal: controller.signal }),
		])
			.then(([nextAreas, nextProjects]) => {
				if (controller.signal.aborted) return;
				setAreas(nextAreas);
				setProjects(nextProjects);
				setError(null);
			})
			.catch((reason) => {
				if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
			})
			.finally(() => {
				if (request.current === controller) {
					request.current = null;
					setBusy(false);
				}
			});
		return () => {
			controller.abort();
			request.current?.abort();
			request.current = null;
		};
	}, [ready, admin, session?.csrfToken]);

	const mutate = async <T,>(url: string, options: RequestInit, saved: (value: T) => void) => {
		if (request.current || !ready || !admin) return;
		const controller = new AbortController();
		request.current = controller;
		const owner = identity.current;
		const ownsRequest = () =>
			request.current === controller && !controller.signal.aborted && available.current && identity.current === owner;
		setBusy(true);
		setError(null);
		setConflict(null);
		try {
			const result = await requestJson<T>(url, { ...options, signal: controller.signal });
			if (ownsRequest()) saved(result);
		} catch (reason) {
			if (ownsRequest()) {
				setError(reason instanceof Error ? reason.message : String(reason));
				setConflict(isMutationConflict(reason) ? reason : null);
			}
		} finally {
			if (request.current === controller) {
				request.current = null;
				setBusy(false);
			}
		}
	};
	if (!admin) return null;
	const disabled = busy || !ready || areas === null || projects === null;

	return (
		<div className="mb-8 space-y-8">
			<MutationConflictNotice
				error={conflict}
				draft={false}
				onOpenCurrent={() => {
					if (window.confirm("Discard current form values and reload registration settings?")) window.location.reload();
				}}
				onDismiss={() => setConflict(null)}
			/>
			{error && !conflict && (
				<p role="alert" className="text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
			<section
				id="folder-access"
				aria-labelledby="folder-access-heading"
				className="rounded-lg border border-gray-200 p-5 dark:border-gray-700"
			>
				<h2 id="folder-access-heading" className="mb-5 text-xl font-semibold">
					Project registration folders
				</h2>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (!userId || !path.trim()) return;
						void mutate<FolderArea & RecordVersionLike>(
							"/api/admin/folder-areas",
							{ method: "POST", body: JSON.stringify({ userId, path }) },
							(area) => {
								setAreas((current) => [...(current ?? []).filter((item) => item.id !== area.id), area]);
								setUserId("");
								setPath("");
								clearUnsaved();
							},
						);
					}}
					className="mb-5 flex flex-wrap items-end gap-4"
				>
					<label className="min-w-48 flex-1">
						User
						<select
							name="folderUser"
							className={inputClass}
							required
							value={userId}
							disabled={busy}
							onChange={(event) => setUserId(event.target.value)}
						>
							<option value="">Select user</option>
							{users
								.filter((user) => user.active && user.role !== "admin")
								.map((user) => (
									<option key={user.id} value={user.id}>
										{user.displayName} ({user.username})
									</option>
								))}
						</select>
					</label>
					<label className="min-w-48 flex-[2]">
						Server folder
						<input
							name="folderPath"
							className={inputClass}
							required
							value={path}
							disabled={busy}
							autoComplete="off"
							spellCheck={false}
							onChange={(event) => setPath(event.target.value)}
						/>
					</label>
					<button type="submit" className={buttonClass} disabled={disabled || !userId || !path.trim()}>
						Assign folder
					</button>
				</form>
				{areas === null ? (
					<p>Loading folders...</p>
				) : areas.length === 0 ? (
					<p>No folders assigned.</p>
				) : (
					<ul className="divide-y divide-gray-200 dark:divide-gray-700">
						{areas.map((area) => {
							const user = users.find((user) => user.id === area.userId);
							return (
								<li key={area.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
									<div className="min-w-0">
										<span className="font-medium">{user ? `${user.displayName} (${user.username})` : area.userId}</span>
										<div className="break-all font-mono text-sm">{area.rootPath}</div>
									</div>
									<button
										type="button"
										className="text-sm underline"
										disabled={disabled}
										aria-label={`Remove folder ${area.rootPath}`}
										onClick={() => {
											if (
												window.confirm(
													`Remove registration access to ${area.rootPath}? Existing project memberships will be kept.`,
												)
											)
												void mutate(
													`/api/admin/folder-areas/${encodeURIComponent(area.id)}`,
													{ method: "DELETE", headers: area.revision ? { "If-Match": area.revision } : undefined },
													() => setAreas((current) => current?.filter((item) => item.id !== area.id) ?? []),
												);
										}}
									>
										Remove
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</section>
			<section
				id="project-tracking"
				aria-labelledby="project-tracking-heading"
				className="rounded-lg border border-gray-200 p-5 dark:border-gray-700"
			>
				<h2 id="project-tracking-heading" className="mb-5 text-xl font-semibold">
					Project tracking
				</h2>
				{projects === null ? (
					<p>Loading projects...</p>
				) : projects.length === 0 ? (
					<p>No projects registered.</p>
				) : (
					<ul className="divide-y divide-gray-200 dark:divide-gray-700">
						{projects.map((project) => (
							<li key={project.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
								<div className="min-w-0">
									<span className="font-medium">{project.name}</span>
									<span className="ml-3 text-sm">{project.tracking ? "Tracking" : "Not tracked"}</span>
									<div className="break-all font-mono text-sm">{project.rootPath}</div>
								</div>
								<div className="flex items-center gap-4">
									{project.tracking && (
										<a href={`/projects/${encodeURIComponent(project.id)}/members`} className="text-sm underline">
											Project access
										</a>
									)}
									<button
										type="button"
										className={buttonClass}
										disabled={disabled}
										aria-label={`${project.tracking ? "Stop" : "Enable"} tracking ${project.name}`}
										onClick={() => {
											if (
												project.tracking &&
												!window.confirm(`Stop tracking ${project.name}? Project files and memberships will be kept.`)
											)
												return;
											void mutate<ServerProject & RecordVersionLike>(
												`/api/admin/projects/${encodeURIComponent(project.id)}/tracking`,
												{
													method: "PUT",
													headers: project.revision ? { "If-Match": project.revision } : undefined,
													body: JSON.stringify({ tracking: !project.tracking }),
												},
												(value) =>
													setProjects(
														(current) => current?.map((item) => (item.id === project.id ? value : item)) ?? [],
													),
											);
										}}
									>
										{project.tracking ? "Stop tracking" : "Enable tracking"}
									</button>
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
