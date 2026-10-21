import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ADMIN_PERMISSIONS, type AuthSession, type ProjectPermissions } from "../../server/auth-types";
import { projectScope, setProjectStorageAccount } from "../lib/project-scope";
import { onSessionExpired, requestJson, setRequestSession } from "../lib/request";
import { LoginForm, PasswordForm } from "../components/AccountForms";

interface AuthState {
	central: boolean;
	session: AuthSession | null;
	permissions: ProjectPermissions;
	ready: boolean;
	refresh: () => Promise<void>;
	logout: () => Promise<void>;
	acceptSession: (session: AuthSession) => Promise<void>;
}
const NO_PERMISSIONS: ProjectPermissions = {
	tasksWrite: false,
	docsWrite: false,
	decisionsWrite: false,
	decisionsManage: false,
	archive: false,
	delete: false,
};
const AuthContext = createContext<AuthState>({
	central: false,
	session: null,
	permissions: ADMIN_PERMISSIONS,
	ready: true,
	refresh: async () => {},
	logout: async () => {},
	acceptSession: async () => {},
});
export const useAuth = () => useContext(AuthContext);

export function isCentralPage(pathname: string): boolean {
	return /^\/(projects|admin|login|password)(\/|$)/.test(pathname);
}

/** Keep an expired account's editor mounted, hidden behind login, until the same account returns. */
export function AuthProvider({ children }: { children: ReactNode }) {
	const central = isCentralPage(window.location.pathname);
	const [session, setSession] = useState<AuthSession | null>(null);
	const [permissions, setPermissions] = useState<ProjectPermissions>(NO_PERMISSIONS);
	const [checked, setChecked] = useState(!central);
	const [mounted, setMounted] = useState(!central);
	const [accountKey, setAccountKey] = useState("local");
	const [error, setError] = useState<string | null>(null);
	const lastUser = useRef<string | null>(null);
	const requestRunning = useRef(false);
	const latestSession = useRef<AuthSession | null>(null);
	const lastActivity = useRef(0);
	const generation = useRef(0);

	const acceptSession = useCallback(async (next: AuthSession) => {
		const owner = ++generation.current;
		if (!latestSession.current || lastUser.current !== next.user.id) setChecked(false);
		if (lastUser.current !== next.user.id) setMounted(false);
		setRequestSession(next);
		latestSession.current = next;
		setSession(next);
		if (lastUser.current !== next.user.id) {
			lastUser.current = next.user.id;
			setProjectStorageAccount(next.user.id);
			setAccountKey(next.user.id);
		}
		if (next.user.mustChangePassword) {
			setChecked(true);
			return;
		}
		try {
			if (projectScope.id) {
				const detail = await requestJson<{ permissions: ProjectPermissions }>(projectScope.apiBase);
				if (owner !== generation.current) return;
				setPermissions((current) =>
					JSON.stringify(current) === JSON.stringify(detail.permissions) ? current : detail.permissions,
				);
			} else setPermissions(next.user.role === "admin" ? ADMIN_PERMISSIONS : NO_PERMISSIONS);
			setError(null);
			setMounted(true);
		} catch (reason) {
			if (owner !== generation.current) return;
			setPermissions(NO_PERMISSIONS);
			setError(reason instanceof Error ? reason.message : String(reason));
		}
		setChecked(true);
	}, []);

	const refresh = useCallback(async () => {
		if (!central || requestRunning.current) return;
		requestRunning.current = true;
		try {
			await acceptSession(await requestJson<AuthSession>("/api/auth/session"));
		} catch (reason) {
			if (latestSession.current) setError(reason instanceof Error ? reason.message : String(reason));
			setChecked(true);
		} finally {
			requestRunning.current = false;
		}
	}, [central, acceptSession]);

	useEffect(() => {
		if (!central) return;
		const unsubscribe = onSessionExpired(() => {
			generation.current++;
			latestSession.current = null;
			setSession(null);
			setPermissions(NO_PERMISSIONS);
			setError(null);
			setChecked(true);
		});
		void refresh();
		const timer = setInterval(() => {
			if (latestSession.current && document.visibilityState === "visible") void refresh();
		}, 1000);
		return () => {
			unsubscribe();
			clearInterval(timer);
		};
	}, [central, refresh]);

	useEffect(() => {
		if (!central) return;
		const activity = (event: Event) => {
			if (
				!event.isTrusted ||
				document.visibilityState !== "visible" ||
				!latestSession.current ||
				latestSession.current.user.mustChangePassword
			)
				return;
			const now = Date.now();
			if (now - lastActivity.current < 60_000) return;
			lastActivity.current = now;
			void requestJson<AuthSession>("/api/auth/activity", { method: "POST" }).catch(() => {});
		};
		const events = ["pointerdown", "keydown", "input", "touchstart", "wheel"];
		for (const name of events) document.addEventListener(name, activity, { passive: true });
		return () => {
			for (const name of events) document.removeEventListener(name, activity);
		};
	}, [central]);

	const logout = async () => {
		await requestJson("/api/auth/logout", { method: "POST" });
		generation.current++;
		setRequestSession(null);
		latestSession.current = null;
		setSession(null);
		setMounted(false);
		lastUser.current = null;
		setProjectStorageAccount(null);
	};
	const ready = !central || (checked && session !== null && !session.user.mustChangePassword && !error);
	return (
		<AuthContext.Provider
			value={{
				central,
				session,
				permissions: central ? permissions : ADMIN_PERMISSIONS,
				ready,
				refresh,
				logout,
				acceptSession,
			}}
		>
			{mounted && (
				<div key={accountKey} hidden={!ready}>
					{children}
				</div>
			)}
			{central && !ready && (
				<div className="fixed inset-0 z-[200] overflow-auto bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
					{!checked ? (
						<p role="status" className="p-8">
							Loading session...
						</p>
					) : !session ? (
						<LoginForm onSession={acceptSession} />
					) : session.user.mustChangePassword ? (
						<PasswordForm onSession={acceptSession} required />
					) : (
						<main className="p-8">
							<p role="alert">{error}</p>
							<a href="/projects" className="underline">
								Projects
							</a>{" "}
							<button type="button" onClick={() => void refresh()}>
								Refresh
							</button>{" "}
							<button type="button" onClick={() => void logout()}>
								Log out
							</button>
						</main>
					)}
				</div>
			)}
		</AuthContext.Provider>
	);
}
