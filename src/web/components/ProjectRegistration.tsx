import { useEffect, useRef, useState } from "react";
import type { ServerProject } from "../../server/project-store";
import type { FolderArea, ProjectPreview } from "../../server/registration-types";
import { useAuth } from "../contexts/AuthContext";
import { useConfirmDiscardChanges, useUnsavedChanges } from "../contexts/UnsavedChangesContext";
import { requestJson } from "../lib/request";
import { buttonClass, inputClass } from "./AccountForms";

export default function ProjectRegistration({
	areas,
	onRegistered,
	onCancel,
}: {
	areas: FolderArea[];
	onRegistered: (projectId: string) => void;
	onCancel: () => void;
}) {
	const { ready, session } = useAuth();
	const [name, setName] = useState("");
	const [path, setPath] = useState("");
	const [preview, setPreview] = useState<ProjectPreview | null>(null);
	const [busy, setBusy] = useState<"preview" | "register" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const request = useRef<AbortController | null>(null);
	const nameInput = useRef<HTMLInputElement | null>(null);
	const identity = useRef(session?.csrfToken);
	identity.current = session?.csrfToken;
	const available = useRef(ready);
	available.current = ready;
	const clearUnsaved = useUnsavedChanges(Boolean(name || path));
	const confirmDiscard = useConfirmDiscardChanges();
	useEffect(() => nameInput.current?.focus(), []);

	useEffect(() => {
		setBusy(null);
		setPreview(null);
		return () => {
			request.current?.abort();
			request.current = null;
		};
	}, [ready, session?.csrfToken]);

	const change = (field: "name" | "path", value: string) => {
		request.current?.abort();
		request.current = null;
		setBusy(null);
		setPreview(null);
		setError(null);
		if (field === "name") setName(value);
		else setPath(value);
	};
	const run = async (register: boolean) => {
		if (request.current || !ready || !name.trim() || !path.trim() || (register && !preview?.canRegister)) return;
		const controller = new AbortController();
		request.current = controller;
		const owner = identity.current;
		const ownsRequest = () =>
			request.current === controller && !controller.signal.aborted && available.current && identity.current === owner;
		setBusy(register ? "register" : "preview");
		setError(null);
		if (!register) setPreview(null);
		try {
			const result = await requestJson<ProjectPreview | ServerProject>(
				register ? "/api/projects" : "/api/projects/preview",
				{
					method: "POST",
					body: JSON.stringify({ name, path }),
					signal: controller.signal,
				},
			);
			if (!ownsRequest()) return;
			if (register) {
				clearUnsaved();
				setName("");
				setPath("");
				setPreview(null);
				onRegistered((result as ServerProject).id);
			} else setPreview(result as ProjectPreview);
		} catch (reason) {
			if (ownsRequest()) setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			if (request.current === controller) {
				request.current = null;
				setBusy(null);
			}
		}
	};

	return (
		<section
			aria-labelledby="project-registration-heading"
			className="mb-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
		>
			<h2 id="project-registration-heading" className="mb-5 text-xl font-semibold">
				Register project
			</h2>
			{areas.length > 0 && (
				<details className="mb-5">
					<summary className="cursor-pointer font-medium">Allowed folders</summary>
					<ul className="mt-2 space-y-1 break-all font-mono text-sm">
						{areas.map((area) => (
							<li key={area.id}>{area.rootPath}</li>
						))}
					</ul>
				</details>
			)}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void run(false);
				}}
				className="space-y-5"
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<label>
						Project name
						<input
							ref={nameInput}
							name="projectName"
							className={inputClass}
							value={name}
							onChange={(event) => change("name", event.target.value)}
							required
							disabled={busy === "register"}
						/>
					</label>
					<label>
						Server folder
						<input
							name="projectPath"
							className={inputClass}
							value={path}
							onChange={(event) => change("path", event.target.value)}
							required
							disabled={busy === "register"}
							autoComplete="off"
							spellCheck={false}
						/>
					</label>
				</div>
				{error && (
					<p role="alert" className="text-red-700 dark:text-red-300">
						{error}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-4">
					<button
						type="submit"
						className={buttonClass}
						disabled={busy !== null || !ready || !name.trim() || !path.trim()}
					>
						{busy === "preview" ? "Reading project..." : "Preview project"}
					</button>
					<button
						type="button"
						disabled={busy === "register"}
						onClick={() => {
							if (confirmDiscard()) {
								clearUnsaved();
								onCancel();
							}
						}}
						className="text-sm underline"
					>
						Cancel
					</button>
				</div>
			</form>
			{preview && (
				<div className="mt-6 space-y-5 border-t border-gray-200 pt-5 dark:border-gray-700">
					<h3 className="text-lg font-semibold">Preview</h3>
					<dl className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
						<dt className="font-medium">Project</dt>
						<dd>{preview.name}</dd>
						<dt className="font-medium">Root folder</dt>
						<dd className="break-all font-mono">{preview.rootPath}</dd>
						<dt className="font-medium">Backlog folder</dt>
						<dd className="break-all font-mono">{preview.backlogPath ?? "Not found"}</dd>
						<dt className="font-medium">Configuration file</dt>
						<dd className="break-all font-mono">{preview.configPath ?? "Not found"}</dd>
					</dl>
					<dl aria-label="Record counts" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
						{(
							[
								["Tasks", preview.counts.tasks],
								["Drafts", preview.counts.drafts],
								["Documents", preview.counts.documents],
								["Decisions", preview.counts.decisions],
								["Archived", preview.counts.archived],
							] as const
						).map(([label, count]) => (
							<div key={label} className="rounded-md bg-gray-50 p-3 dark:bg-gray-900">
								<dt className="text-sm">{label}</dt>
								<dd className="text-xl font-semibold">{count}</dd>
							</div>
						))}
					</dl>
					{preview.config && (
						<details>
							<summary className="cursor-pointer font-medium">Configuration</summary>
							<pre className="mt-3 max-h-80 overflow-auto rounded-md bg-gray-50 p-4 text-xs dark:bg-gray-900">
								{JSON.stringify(preview.config, null, 2)}
							</pre>
						</details>
					)}
					{preview.issues.length > 0 && (
						<ul aria-label="Project issues" className="space-y-2 text-sm">
							{preview.issues.map((issue, index) => (
								<li
									key={`${index}-${issue.message}`}
									className={
										issue.severity === "error" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300"
									}
								>
									<span className="font-semibold">{issue.severity === "error" ? "Error" : "Warning"}:</span>{" "}
									{issue.message}
									{issue.path && <code className="ml-2 break-all">{issue.path}</code>}
								</li>
							))}
						</ul>
					)}
					<button
						type="button"
						className={buttonClass}
						disabled={!preview.canRegister || busy !== null || !ready}
						onClick={() => void run(true)}
					>
						{busy === "register" ? "Registering..." : "Register project"}
					</button>
				</div>
			)}
		</section>
	);
}
