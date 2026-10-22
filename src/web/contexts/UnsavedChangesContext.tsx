import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";

interface UnsavedChanges {
	register: (token: symbol, dirty: boolean) => void;
	isDirty: () => boolean;
	confirmDiscard: () => boolean;
}

const DirtyContext = createContext<UnsavedChanges | null>(null);
const noGuard = () => {};
const allowDiscard = () => true;

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
	const dirtyTokens = useRef(new Set<symbol>());
	const [dirty, setDirty] = useState(false);
	const register = useCallback((token: symbol, dirty: boolean) => {
		if (dirty) dirtyTokens.current.add(token);
		else dirtyTokens.current.delete(token);
		setDirty(dirtyTokens.current.size > 0);
	}, []);
	const isDirty = useCallback(() => dirtyTokens.current.size > 0, []);
	const confirmDiscard = useCallback(
		() => !isDirty() || window.confirm("Discard unsaved changes and leave this page?"),
		[isDirty],
	);
	const value = useMemo(() => ({ register, isDirty, confirmDiscard }), [register, isDirty, confirmDiscard]);

	useEffect(() => {
		if (!dirty) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (!isDirty()) return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty, isDirty]);

	return <DirtyContext.Provider value={value}>{children}</DirtyContext.Provider>;
}

/** Router blocking shares the registry with actions, such as logout, outside the router. */
export function UnsavedChangesNavigationGuard() {
	const guard = useContext(DirtyContext);
	const blocker = useBlocker(
		({ currentLocation, nextLocation }) =>
			Boolean(guard?.isDirty()) &&
			(currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
	);
	useEffect(() => {
		if (blocker.state !== "blocked") return;
		if (!guard || guard.confirmDiscard()) blocker.proceed();
		else blocker.reset();
	}, [blocker, guard]);
	return null;
}

export function useConfirmDiscardChanges(): () => boolean {
	return useContext(DirtyContext)?.confirmDiscard ?? allowDiscard;
}

export function useUnsavedChanges(dirty: boolean): () => void {
	const register = useContext(DirtyContext)?.register ?? noGuard;
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
