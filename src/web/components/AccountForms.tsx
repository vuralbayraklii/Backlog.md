import { useState, type FormEvent } from "react";
import type { AuthSession } from "../../server/auth-types";
import { requestJson } from "../lib/request";

export const inputClass =
	"w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100";
export const buttonClass =
	"rounded-md bg-stone-700 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50";

function AccountForm({
	passwordChange,
	required,
	onSession,
}: {
	passwordChange: boolean;
	required?: boolean;
	onSession: (session: AuthSession) => Promise<void>;
}) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [complete, setComplete] = useState(false);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		setComplete(false);
		try {
			const next = await requestJson<AuthSession>(`/api/auth/${passwordChange ? "password" : "login"}`, {
				method: "POST",
				body: JSON.stringify(passwordChange ? { currentPassword: password, newPassword } : { username, password }),
			});
			setPassword("");
			setNewPassword("");
			await onSession(next);
			if (passwordChange) setComplete(true);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	};
	return (
		<main className="mx-auto max-w-md px-6 py-16">
			<h1 className="mb-8 text-2xl font-bold">
				{passwordChange ? (required ? "Change your password" : "Change password") : "Log in"}
			</h1>
			<form onSubmit={submit} className="space-y-5">
				{!passwordChange && (
					<label className="block">
						Username
						<input
							name="username"
							autoComplete="username"
							className={inputClass}
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							required
							maxLength={64}
							autoFocus
						/>
					</label>
				)}
				<label className="block">
					{passwordChange ? "Current password" : "Password"}
					<input
						name="password"
						type="password"
						autoComplete="current-password"
						className={inputClass}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						maxLength={256}
					/>
				</label>
				{passwordChange && (
					<label className="block">
						New password
						<input
							name="new-password"
							type="password"
							autoComplete="new-password"
							className={inputClass}
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							required
							minLength={15}
							maxLength={256}
						/>
					</label>
				)}
				{error && <p role="alert">{error}</p>}
				{complete && <p role="status">Password changed.</p>}
				<button type="submit" className={buttonClass} disabled={busy}>
					{busy ? "Please wait..." : passwordChange ? "Change password" : "Log in"}
				</button>
				{passwordChange && !required && (
					<a href="/projects" className="ml-4 underline">
						Projects
					</a>
				)}
			</form>
		</main>
	);
}
export function LoginForm({ onSession }: { onSession: (session: AuthSession) => Promise<void> }) {
	return <AccountForm passwordChange={false} onSession={onSession} />;
}
export function PasswordForm({
	onSession,
	required,
}: {
	onSession: (session: AuthSession) => Promise<void>;
	required?: boolean;
}) {
	return <AccountForm passwordChange required={required} onSession={onSession} />;
}
