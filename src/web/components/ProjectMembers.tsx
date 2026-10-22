import { useEffect, useState } from "react";
import {
	DEFAULT_PERMISSIONS,
	PERMISSION_NAMES,
	type ProjectMember,
	type ProjectPermissions,
	type ServerUser,
} from "../../server/auth-types";
import { useAuth } from "../contexts/AuthContext";
import type { RecordVersionLike } from "../lib/api";
import { projectScope } from "../lib/project-scope";
import { requestJson } from "../lib/request";
import { buttonClass, inputClass } from "./AccountForms";
import { isMutationConflict, MutationConflictNotice } from "./MutationConflictNotice";

const LABELS: Record<keyof ProjectPermissions, string> = {
	tasksWrite: "Tasks, drafts and milestones",
	docsWrite: "Documents",
	decisionsWrite: "Decision drafts",
	decisionsManage: "Decision management",
	archive: "Archive and restore",
	delete: "Permanent deletion",
};
export default function ProjectMembers() {
	const { session, refresh } = useAuth();
	const [members, setMembers] = useState<(ProjectMember & RecordVersionLike)[]>([]);
	const [users, setUsers] = useState<ServerUser[]>([]);
	const [userId, setUserId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [conflict, setConflict] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const base = `/api/admin/projects/${projectScope.id}/members`;
	const load = async () => {
		const [nextMembers, nextUsers] = await Promise.all([
			requestJson<(ProjectMember & RecordVersionLike)[]>(base),
			requestJson<ServerUser[]>("/api/admin/users"),
		]);
		setMembers(nextMembers);
		setUsers(nextUsers);
	};
	const failed = (reason: unknown) => {
		setError(reason instanceof Error ? reason.message : String(reason));
		setConflict(isMutationConflict(reason) ? reason : null);
	};
	useEffect(() => {
		if (session?.user.role === "admin") void load().catch(failed);
	}, [session?.user.role]);
	const change = async (id: string, permissions?: Partial<ProjectPermissions>) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		setConflict(null);
		try {
			const current = members.find((member) => member.userId === id);
			await requestJson(
				`${base}/${encodeURIComponent(id)}`,
				permissions
					? {
							method: "PUT",
							headers: current?.revision ? { "If-Match": current.revision } : undefined,
							body: JSON.stringify({ permissions }),
						}
					: { method: "DELETE", headers: current?.revision ? { "If-Match": current.revision } : undefined },
			);
			await load();
			if (id === userId) setUserId("");
			await refresh();
		} catch (reason) {
			failed(reason);
		} finally {
			setBusy(false);
		}
	};
	if (session?.user.role !== "admin")
		return (
			<p role="alert" className="p-8">
				Admin access required.
			</p>
		);
	return (
		<section className="mx-auto max-w-4xl p-8">
			<h1 className="mb-8 text-2xl font-bold">Project access</h1>
			{error && (
				<MutationConflictNotice
					error={conflict}
					draft={false}
					onOpenCurrent={() => {
						if (window.confirm("Discard current form values and reload project access?")) window.location.reload();
					}}
					onDismiss={() => setConflict(null)}
				/>
			)}
			{error && !conflict && (
				<p role="alert" className="mb-5 text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (userId) void change(userId, DEFAULT_PERMISSIONS);
				}}
				className="mb-8 flex flex-wrap items-end gap-4"
			>
				<label>
					User
					<select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)} required>
						<option value="">Select user</option>
						{users
							.filter(
								(user) => user.active && user.role !== "admin" && !members.some((member) => member.userId === user.id),
							)
							.map((user) => (
								<option key={user.id} value={user.id}>
									{user.displayName} ({user.username})
								</option>
							))}
					</select>
				</label>
				<button className={buttonClass} type="submit" disabled={busy || !userId}>
					Add member
				</button>
			</form>
			<ul className="space-y-4">
				{members.map((member) => {
					const user = users.find((user) => user.id === member.userId);
					return (
						<li key={member.userId} className="rounded-lg border border-gray-200 dark:border-gray-700 p-5">
							<h2 className="mb-4 font-semibold">{user ? `${user.displayName} (${user.username})` : member.userId}</h2>
							<div className="mb-4 grid gap-3 sm:grid-cols-2">
								{PERMISSION_NAMES.map((name) => (
									<label key={name}>
										<input
											type="checkbox"
											checked={member.permissions[name]}
											disabled={busy}
											onChange={(event) => void change(member.userId, { [name]: event.target.checked })}
										/>{" "}
										{LABELS[name]}
									</label>
								))}
							</div>
							<button className={buttonClass} type="button" disabled={busy} onClick={() => void change(member.userId)}>
								Remove member
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
