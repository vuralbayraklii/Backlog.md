import { type FormEvent, useEffect, useRef, useState } from "react";
import type { AgentKey, CreatedAgentKey } from "../../server/agent-types";
import {
	PERMISSION_NAMES,
	type ProjectPermission,
	type ProjectPermissions,
	type ServerUser,
} from "../../server/auth-types";
import type { ServerProject } from "../../server/project-store";
import { useAuth } from "../contexts/AuthContext";
import { useUnsavedChanges } from "../contexts/UnsavedChangesContext";
import { requestJson } from "../lib/request";
import { buttonClass, inputClass } from "./AccountForms";
import { isMutationConflict, MutationConflictNotice } from "./MutationConflictNotice";

const EMPTY_PERMISSIONS: ProjectPermissions = {
	tasksWrite: false,
	docsWrite: false,
	decisionsWrite: false,
	decisionsManage: false,
	archive: false,
	delete: false,
};

const PERMISSION_LABELS: Record<ProjectPermission, string> = {
	tasksWrite: "Tasks",
	docsWrite: "Documents",
	decisionsWrite: "Decisions",
	decisionsManage: "Manage decisions",
	archive: "Archive and restore",
	delete: "Delete permanently",
};

function grantLabel(permissions: ProjectPermissions): string {
	const enabled = PERMISSION_NAMES.filter((permission) => permissions[permission]);
	return enabled.length ? enabled.map((permission) => PERMISSION_LABELS[permission]).join(", ") : "Read only";
}

export default function AgentKeys({ users }: { users: ServerUser[] }) {
	const { session, ready } = useAuth();
	const [open, setOpen] = useState(false);
	const [keys, setKeys] = useState<AgentKey[] | null>(null);
	const [projects, setProjects] = useState<Pick<ServerProject, "id" | "name" | "tracking">[] | null>(null);
	const [userId, setUserId] = useState("");
	const [name, setName] = useState("");
	const [grants, setGrants] = useState<Record<string, ProjectPermissions>>({});
	const [secret, setSecret] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [conflict, setConflict] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const owner = useRef(session?.user.id);
	owner.current = session?.user.id;
	useUnsavedChanges(open && Boolean(userId || name || Object.keys(grants).length || secret));

	useEffect(() => {
		setSecret(null);
		if (!open || !ready || session?.user.role !== "admin") return;
		const controller = new AbortController();
		Promise.all([
			requestJson<AgentKey[]>("/api/admin/agent-keys", { signal: controller.signal }),
			requestJson<Pick<ServerProject, "id" | "name" | "tracking">[]>("/api/admin/projects", {
				signal: controller.signal,
			}),
		])
			.then(([nextKeys, nextProjects]) => {
				if (controller.signal.aborted) return;
				setKeys(nextKeys);
				setProjects(nextProjects);
				setError(null);
			})
			.catch((reason) => {
				if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
			});
		return () => controller.abort();
	}, [open, ready, session?.user.id, session?.user.role]);

	const loadKeys = async (requestOwner: string | undefined) => {
		const next = await requestJson<AgentKey[]>("/api/admin/agent-keys");
		if (owner.current === requestOwner) setKeys(next);
	};
	const failed = (reason: unknown) => {
		setError(reason instanceof Error ? reason.message : String(reason));
		setConflict(isMutationConflict(reason) ? reason : null);
	};
	const create = async (event: FormEvent) => {
		event.preventDefault();
		if (busy || secret || !ready || !session || !userId || !name.trim() || Object.keys(grants).length === 0) return;
		const requestOwner = owner.current;
		setBusy(true);
		setSecret(null);
		setError(null);
		setConflict(null);
		try {
			const result = await requestJson<{ key: AgentKey; secret?: CreatedAgentKey["secret"] }>("/api/admin/agent-keys", {
				method: "POST",
				body: JSON.stringify({
					userId,
					name: name.trim(),
					grants: Object.entries(grants).map(([projectId, permissions]) => ({ projectId, permissions })),
				}),
			});
			if (owner.current !== requestOwner) return;
			setKeys((current) => [result.key, ...(current ?? []).filter((key) => key.id !== result.key.id)]);
			setUserId("");
			setName("");
			setGrants({});
			if (result.secret) setSecret(result.secret);
			else setError("The key was created, but its secret is no longer available. Revoke it and create a new key.");
		} catch (reason) {
			if (owner.current === requestOwner) failed(reason);
		} finally {
			if (owner.current === requestOwner) setBusy(false);
		}
	};
	const revoke = async (key: AgentKey) => {
		if (busy || !ready || !window.confirm(`Revoke agent key "${key.name}"? Agents using it will lose access.`)) return;
		const requestOwner = owner.current;
		setBusy(true);
		setError(null);
		setConflict(null);
		try {
			await requestJson(`/api/admin/agent-keys/${encodeURIComponent(key.id)}/revoke`, {
				method: "POST",
				headers: { "If-Match": key.revision },
			});
			await loadKeys(requestOwner);
		} catch (reason) {
			if (owner.current === requestOwner) failed(reason);
		} finally {
			if (owner.current === requestOwner) setBusy(false);
		}
	};
	const toggleProject = (projectId: string) => {
		setGrants((current) => {
			const next = { ...current };
			if (next[projectId]) delete next[projectId];
			else next[projectId] = { ...EMPTY_PERMISSIONS };
			return next;
		});
	};
	const togglePermission = (projectId: string, permission: ProjectPermission) => {
		setGrants((current) => ({
			...current,
			[projectId]: { ...(current[projectId] ?? EMPTY_PERMISSIONS), [permission]: !current[projectId]?.[permission] },
		}));
	};

	return (
		<section
			id="agent-keys"
			aria-labelledby="agent-keys-heading"
			className="mb-8 rounded-lg border border-gray-200 p-5 dark:border-gray-700"
		>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<h2 id="agent-keys-heading" className="text-xl font-semibold">
					Agent keys
				</h2>
				<button
					type="button"
					className={buttonClass}
					onClick={() => {
						if (open && secret && !window.confirm("The secret will not be shown again. Close agent keys?")) return;
						setOpen((current) => !current);
					}}
				>
					{open ? "Close agent keys" : "Manage agent keys"}
				</button>
			</div>
			{open && (
				<div className="mt-5 space-y-6">
					<MutationConflictNotice
						error={conflict}
						draft={false}
						onOpenCurrent={() => {
							void loadKeys(owner.current)
								.then(() => setConflict(null))
								.catch(failed);
						}}
						onDismiss={() => setConflict(null)}
					/>
					{error && !conflict && (
						<p role="alert" className="text-red-700 dark:text-red-300">
							{error}
						</p>
					)}
					{secret && (
						<div
							role="status"
							className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
						>
							<p className="font-semibold">Copy this key now. It will not be shown again.</p>
							<code className="mt-2 block break-all select-all">{secret}</code>
							<button type="button" className="mt-3 underline" onClick={() => setSecret(null)}>
								Dismiss secret
							</button>
						</div>
					)}
					<form onSubmit={create} className="space-y-4">
						<h3 className="font-semibold">Create agent key</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<label>
								Owner
								<select
									className={inputClass}
									value={userId}
									onChange={(event) => setUserId(event.target.value)}
									required
									disabled={busy}
								>
									<option value="">Select user</option>
									{users.map((user) => (
										<option key={user.id} value={user.id} disabled={!user.active}>
											{user.username}
										</option>
									))}
								</select>
							</label>
							<label>
								Key name
								<input
									className={inputClass}
									value={name}
									onChange={(event) => setName(event.target.value)}
									required
									disabled={busy}
								/>
							</label>
						</div>
						<fieldset disabled={busy || projects === null} className="space-y-3">
							<legend className="font-medium">Project access</legend>
							<p className="text-sm text-gray-600 dark:text-gray-400">
								Selecting a project grants read access. Write permissions are limited by the owner's current access;
								leave all boxes empty for read-only access.
							</p>
							{projects?.map((project) => (
								<div key={project.id} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
									<label className="flex items-center gap-2 font-medium">
										<input
											type="checkbox"
											checked={Boolean(grants[project.id])}
											disabled={!project.tracking}
											onChange={() => toggleProject(project.id)}
										/>
										{project.name} <span className="text-xs text-gray-500">{project.id}</span>
									</label>
									{grants[project.id] && (
										<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
											{PERMISSION_NAMES.map((permission) => (
												<label key={permission} className="flex items-center gap-2 text-sm">
													<input
														type="checkbox"
														checked={grants[project.id]?.[permission] ?? false}
														onChange={() => togglePermission(project.id, permission)}
													/>
													{PERMISSION_LABELS[permission]}
												</label>
											))}
										</div>
									)}
								</div>
							))}
						</fieldset>
						<button
							type="submit"
							className={buttonClass}
							disabled={
								busy || Boolean(secret) || !ready || !userId || !name.trim() || Object.keys(grants).length === 0
							}
						>
							Create key
						</button>
					</form>
					<div>
						<h3 className="mb-3 font-semibold">Existing keys</h3>
						{keys === null ? (
							<p role="status">Loading keys...</p>
						) : keys.length === 0 ? (
							<p>No agent keys.</p>
						) : (
							<ul className="space-y-3">
								{keys.map((key) => (
									<li key={key.id} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
										<div className="flex flex-wrap items-center justify-between gap-3">
											<span className="font-medium">
												{key.name} · {users.find((user) => user.id === key.userId)?.username ?? key.userId}
											</span>
											{key.revokedAt ? (
												<span>Revoked</span>
											) : (
												<button
													type="button"
													className="text-red-700 underline dark:text-red-300"
													disabled={busy}
													onClick={() => void revoke(key)}
												>
													Revoke
												</button>
											)}
										</div>
										<ul className="mt-2 text-sm text-gray-600 dark:text-gray-400">
											{key.grants.map((grant) => (
												<li key={grant.projectId}>
													{projects?.find((project) => project.id === grant.projectId)?.name ?? grant.projectId}:{" "}
													{grantLabel(grant.permissions)}
												</li>
											))}
										</ul>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
