import { type FormEvent, useState } from "react";
import type { AuthSession } from "../../server/auth-types";
import { requestJson } from "../lib/request";
import ServerLayout from "./ServerLayout";

export const inputClass =
	"mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
export const buttonClass =
	"inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-gray-900";

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
		<ServerLayout>
			<section className="mx-auto w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-8">
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
					{error && (
						<p role="alert" className="text-red-600 dark:text-red-400">
							{error}
						</p>
					)}
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
			</section>
		</ServerLayout>
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
