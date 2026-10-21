import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";

const DirtyContext = createContext<((token: symbol, dirty: boolean) => void) | null>(null);
const noGuard = () => {};

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
	const [dirtyTokens, setDirtyTokens] = useState<Set<symbol>>(() => new Set());
	const dirtyRef = useRef(dirtyTokens);
	const register = useCallback((token: symbol, dirty: boolean) => {
		const current = dirtyRef.current;
		if (current.has(token) === dirty) return;
		const next = new Set(current);
		if (dirty) next.add(token);
		else next.delete(token);
		dirtyRef.current = next;
		setDirtyTokens(next);
	}, []);
	const dirty = dirtyTokens.size > 0;
	const blocker = useBlocker(({ currentLocation, nextLocation }) =>
		dirtyRef.current.size > 0 &&
		(currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
	);

	useEffect(() => {
		if (blocker.state !== "blocked") return;
		if (window.confirm("Discard unsaved changes and leave this page?")) blocker.proceed();
		else blocker.reset();
	}, [blocker]);

	useEffect(() => {
		if (!dirty) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty]);

	return <DirtyContext.Provider value={register}>{children}</DirtyContext.Provider>;
}

export function useUnsavedChanges(dirty: boolean): () => void {
	const register = useContext(DirtyContext) ?? noGuard;
	const token = useRef(Symbol("unsaved-editor"));
	useEffect(() => {
		register(token.current, dirty);
		return () => register(token.current, false);
	}, [dirty, register]);
	return useCallback(() => register(token.current, false), [register]);
}

export function useIsUnsavedGuardActive(): boolean {
	return useContext(DirtyContext) !== null;
}
