import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ADMIN_PERMISSIONS, type AuthSession, type ProjectPermissions } from "../../server/auth-types";
import type { WriteState } from "../../server/mutation-types";
import { LoginForm, PasswordForm } from "../components/AccountForms";
import type { ProjectObservation } from "../components/ObservationStatus";
import { ProjectWriteNotice } from "../components/ProjectWriteNotice";
import { projectScope, setProjectStorageAccount } from "../lib/project-scope";
import { HttpError, onSessionExpired, requestJson, setRequestSession } from "../lib/request";
import { useConfirmDiscardChanges } from "./UnsavedChangesContext";

interface AuthState {
	central: boolean;
	session: AuthSession | null;
	permissions: ProjectPermissions;
	writeState: WriteState;
	observation: ProjectObservation | null;
	writesAvailable: boolean;
	pendingOperationId: string | null;
	ready: boolean;
	logoutPending: boolean;
	logoutError: string | null;
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
	writeState: "ready",
	observation: null,
	writesAvailable: true,
	pendingOperationId: null,
	ready: true,
	logoutPending: false,
	logoutError: null,
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
	const [writeState, setWriteState] = useState<WriteState>("ready");
	const [observation, setObservation] = useState<ProjectObservation | null>(null);
	const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
	const [checked, setChecked] = useState(!central);
	const [mounted, setMounted] = useState(!central);
	const [accountKey, setAccountKey] = useState("local");
	const [error, setError] = useState<string | null>(null);
	const [logoutPending, setLogoutPending] = useState(false);
	const [logoutError, setLogoutError] = useState<string | null>(null);
	const confirmDiscard = useConfirmDiscardChanges();
	const lastUser = useRef<string | null>(null);
	const refreshRequest = useRef<AbortController | null>(null);
	const logoutRequest = useRef<AbortController | null>(null);
	const active = useRef(false);
	const latestSession = useRef<AuthSession | null>(null);
	const lastActivity = useRef(0);
	const generation = useRef(0);

	const cancelRefresh = useCallback(() => {
		const request = refreshRequest.current;
		refreshRequest.current = null;
		request?.abort();
	}, []);

	const applySession = useCallback(async (next: AuthSession) => {
		const owner = ++generation.current;
		if (latestSession.current?.csrfToken !== next.csrfToken) lastActivity.current = 0;
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
				const detail = await requestJson<{
					permissions: ProjectPermissions;
					writeState?: WriteState;
					observation?: ProjectObservation;
					pendingOperationId?: string;
				}>(projectScope.apiBase);
				if (owner !== generation.current) return;
				setPermissions((current) =>
					JSON.stringify(current) === JSON.stringify(detail.permissions) ? current : detail.permissions,
				);
				setWriteState(detail.writeState ?? "ready");
				setObservation((current) => {
					const next = detail.observation ?? null;
					return current?.state === next?.state &&
						current?.lastSuccessfulScanAt === next?.lastSuccessfulScanAt &&
						current?.checkedAt === next?.checkedAt &&
						current?.error === next?.error
						? current
						: next;
				});
				setPendingOperationId(detail.pendingOperationId ?? null);
			} else {
				setPermissions(next.user.role === "admin" ? ADMIN_PERMISSIONS : NO_PERMISSIONS);
				setWriteState("ready");
				setObservation(null);
				setPendingOperationId(null);
			}
			setError(null);
			setMounted(true);
		} catch (reason) {
			if (owner !== generation.current) return;
			setPermissions(NO_PERMISSIONS);
			setWriteState("ready");
			setObservation(null);
			setPendingOperationId(null);
			setError(reason instanceof Error ? reason.message : String(reason));
		}
		setChecked(true);
	}, []);

	const acceptSession = useCallback(
		async (next: AuthSession) => {
			cancelRefresh();
			setLogoutError(null);
			await applySession(next);
		},
		[applySession, cancelRefresh],
	);

	const refresh = useCallback(async () => {
		if (!central || refreshRequest.current || logoutRequest.current) return;
		const request = new AbortController();
		refreshRequest.current = request;
		const owner = generation.current;
		try {
			const next = await requestJson<AuthSession>("/api/auth/session", { signal: request.signal });
			if (request.signal.aborted || owner !== generation.current || refreshRequest.current !== request) return;
			await applySession(next);
		} catch (reason) {
			if (request.signal.aborted || owner !== generation.current) return;
			if (latestSession.current) setError(reason instanceof Error ? reason.message : String(reason));
			setChecked(true);
		} finally {
			if (refreshRequest.current === request) refreshRequest.current = null;
		}
	}, [central, applySession]);

	useEffect(() => {
		if (!central) return;
		active.current = true;
		const unsubscribe = onSessionExpired(() => {
			generation.current++;
			cancelRefresh();
			latestSession.current = null;
			setSession(null);
			setPermissions(NO_PERMISSIONS);
			setWriteState("ready");
			setObservation(null);
			setPendingOperationId(null);
			setError(null);
			setChecked(true);
		});
		void refresh();
		const timer = setInterval(() => {
			if (latestSession.current && document.visibilityState === "visible") void refresh();
		}, 1000);
		return () => {
			active.current = false;
			generation.current++;
			unsubscribe();
			clearInterval(timer);
			cancelRefresh();
			logoutRequest.current?.abort();
		};
	}, [central, refresh, cancelRefresh]);

	useEffect(() => {
		if (!central || !projectScope.id) return;
		const changed = () => void refresh();
		window.addEventListener("backlog-project-write-state", changed);
		return () => window.removeEventListener("backlog-project-write-state", changed);
	}, [central, refresh]);

	useEffect(() => {
		if (!central) return;
		const activity = (event: Event) => {
			if (
				!event.isTrusted ||
				logoutRequest.current ||
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
		if (logoutRequest.current || !confirmDiscard()) return;
		const request = new AbortController();
		logoutRequest.current = request;
		const owner = ++generation.current;
		const userId = lastUser.current;
		cancelRefresh();
		setLogoutPending(true);
		setLogoutError(null);
		const timeout = setTimeout(() => request.abort(), 10000);
		const ownsSession = () =>
			active.current && (owner === generation.current || (!latestSession.current && lastUser.current === userId));
		try {
			try {
				await requestJson("/api/auth/logout", { method: "POST", signal: request.signal });
			} catch (reason) {
				if (!(reason instanceof HttpError && reason.status === 401)) throw reason;
			}
			if (!ownsSession()) return;
			generation.current++;
			setRequestSession(null);
			latestSession.current = null;
			setSession(null);
			setPermissions(NO_PERMISSIONS);
			setWriteState("ready");
			setObservation(null);
			setPendingOperationId(null);
			setError(null);
			setMounted(false);
			lastUser.current = null;
			setProjectStorageAccount(null);
		} catch (reason) {
			if (ownsSession()) setLogoutError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			clearTimeout(timeout);
			if (logoutRequest.current === request) logoutRequest.current = null;
			if (active.current) setLogoutPending(false);
		}
	};
	const ready =
		!central || (checked && session !== null && !session.user.mustChangePassword && !error && !logoutPending);
	return (
		<AuthContext.Provider
			value={{
				central,
				session,
				permissions: central ? permissions : ADMIN_PERMISSIONS,
				writeState,
				observation,
				writesAvailable: writeState === "ready" && (observation?.state ?? "ready") === "ready",
				pendingOperationId,
				ready,
				logoutPending,
				logoutError,
				refresh,
				logout,
				acceptSession,
			}}
		>
			{central && ready && <ProjectWriteNotice />}
			{mounted && (
				<div key={accountKey} hidden={!ready}>
					{children}
				</div>
			)}
			{central && !ready && (
				<div className="fixed inset-0 z-[200] overflow-auto bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
					{logoutPending ? (
						<p role="status" className="p-8">
							Logging out...
						</p>
					) : !checked ? (
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
							{logoutError && <p role="alert">{logoutError}</p>}
							<a href="/projects" className="underline">
								Projects
							</a>{" "}
							<button type="button" onClick={() => void refresh()}>
								Refresh
							</button>{" "}
							<button type="button" disabled={logoutPending} onClick={() => void logout()}>
								Log out
							</button>
						</main>
					)}
				</div>
			)}
		</AuthContext.Provider>
	);
}
