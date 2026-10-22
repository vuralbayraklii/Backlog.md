import { type FormEvent, useEffect, useState } from "react";
import type { ServerUser } from "../../server/auth-types";
import { useAuth } from "../contexts/AuthContext";
import type { RecordVersionLike } from "../lib/api";
import { requestJson } from "../lib/request";
import { buttonClass, inputClass } from "./AccountForms";
import AccountNavigation from "./AccountNavigation";
import AdminProjectRegistration from "./AdminProjectRegistration";
import { isMutationConflict, MutationConflictNotice } from "./MutationConflictNotice";

function UserRow({
	user,
	changed,
	failed,
}: {
	user: ServerUser & RecordVersionLike;
	changed: () => Promise<void>;
	failed: (error: unknown) => void;
}) {
	const [displayName, setDisplayName] = useState(user.displayName);
	const [role, setRole] = useState(user.role);
	const [active, setActive] = useState(user.active);
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const save = async (reset: boolean) => {
		if (busy) return;
		setBusy(true);
		try {
			await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}${reset ? "/reset-password" : ""}`, {
				method: reset ? "POST" : "PATCH",
				headers: !reset && user.revision ? { "If-Match": user.revision } : undefined,
				body: JSON.stringify(reset ? { password } : { displayName, role, active }),
			});
			setPassword("");
			await changed();
		} catch (reason) {
			failed(reason);
		} finally {
			setBusy(false);
		}
	};
	return (
		<li className="space-y-4 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
			<h2 className="font-semibold">
				{user.username} <span className="text-sm font-normal">{user.id}</span>
			</h2>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void save(false);
				}}
				className="flex flex-wrap items-end gap-4"
			>
				<label>
					Display name
					<input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
				</label>
				<label>
					Role
					<select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as ServerUser["role"])}>
						<option value="user">User</option>
						<option value="admin">Admin</option>
					</select>
				</label>
				<label className="py-2">
					<input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
				</label>
				<button className={buttonClass} type="submit" disabled={busy}>
					Save
				</button>
			</form>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void save(true);
				}}
				className="flex flex-wrap items-end gap-4"
			>
				<label>
					New password
					<input
						className={inputClass}
						type="password"
						autoComplete="new-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={15}
						maxLength={256}
					/>
				</label>
				<button className={buttonClass} type="submit" disabled={busy}>
					Reset password
				</button>
			</form>
		</li>
	);
}

export default function AdminUsers() {
	const { central, session, refresh } = useAuth();
	const [users, setUsers] = useState<(ServerUser & RecordVersionLike)[]>([]);
	const [username, setUsername] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [password, setPassword] = useState("");
	const [role, setRole] = useState<ServerUser["role"]>("user");
	const [error, setError] = useState<string | null>(null);
	const [conflict, setConflict] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const failed = (reason: unknown) => {
		setError(reason instanceof Error ? reason.message : String(reason));
		setConflict(isMutationConflict(reason) ? reason : null);
	};
	const load = async () => {
		setUsers(await requestJson<(ServerUser & RecordVersionLike)[]>("/api/admin/users"));
	};
	useEffect(() => {
		if (session?.user.role === "admin") void load().catch(failed);
	}, [session?.user.role]);
	const changed = async () => {
		setError(null);
		setConflict(null);
		await load();
		await refresh();
	};
	const create = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await requestJson("/api/admin/users", {
				method: "POST",
				body: JSON.stringify({ username, displayName: displayName || username, password, role }),
			});
			setUsername("");
			setDisplayName("");
			setPassword("");
			setRole("user");
			await load();
		} catch (reason) {
			failed(reason);
		} finally {
			setBusy(false);
		}
	};
	if (session?.user.role !== "admin" && (!central || session))
		return (
			<p role="alert" className="p-8">
				Admin access required.
			</p>
		);
	return (
		<main className="mx-auto max-w-5xl p-8 text-gray-900 dark:text-gray-100">
			<div className="mb-8 flex flex-wrap justify-between gap-4">
				<h1 className="text-3xl font-bold">Users</h1>
				<AccountNavigation />
				<a href="/projects" className="underline">
					Projects
				</a>
				<a href="#folder-access" className="underline">
					Folder access
				</a>
				<a href="#project-tracking" className="underline">
					Project tracking
				</a>
			</div>
			{error && (
				<MutationConflictNotice
					error={conflict}
					draft={false}
					onOpenCurrent={() => {
						if (window.confirm("Discard current form values and reload users?")) window.location.reload();
					}}
					onDismiss={() => setConflict(null)}
				/>
			)}
			{error && !conflict && (
				<p role="alert" className="mb-5 text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
			<form onSubmit={create} className="mb-8 space-y-4 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
				<h2 className="text-xl font-semibold">Create user</h2>
				<div className="grid gap-4 sm:grid-cols-2">
					<label>
						Username
						<input
							name="username"
							className={inputClass}
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							required
							minLength={3}
							maxLength={64}
							pattern="[a-zA-Z0-9._-]+"
							autoComplete="off"
						/>
					</label>
					<label>
						Display name
						<input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
					</label>
					<label>
						Password
						<input
							className={inputClass}
							type="password"
							autoComplete="new-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={15}
							maxLength={256}
						/>
					</label>
					<label>
						Role
						<select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as ServerUser["role"])}>
							<option value="user">User</option>
							<option value="admin">Admin</option>
						</select>
					</label>
				</div>
				<button className={buttonClass} type="submit" disabled={busy}>
					Create user
				</button>
			</form>
			<AdminProjectRegistration users={users} />
			<ul className="space-y-4">
				{users.map((user) => (
					<UserRow key={user.id} user={user} changed={changed} failed={failed} />
				))}
			</ul>
		</main>
	);
}
