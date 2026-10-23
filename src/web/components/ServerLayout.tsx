import { type ReactNode, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getWebVersion } from "../utils/version";
import AppFrame from "./AppFrame";
import Navigation from "./Navigation";

function WorkspaceIcon({ users = false }: { users?: boolean }) {
	return (
		<svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
			{users ? (
				<>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2m22 0v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
					/>
					<circle cx="9" cy="7" r="4" strokeWidth={2} />
				</>
			) : (
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={2}
					d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
				/>
			)}
		</svg>
	);
}

export default function ServerLayout({ children }: { children: ReactNode }) {
	const { ready, session } = useAuth();
	const showNavigation = ready && Boolean(session);
	const [version, setVersion] = useState("");
	useEffect(() => {
		if (!showNavigation) return;
		let current = true;
		void getWebVersion().then((value) => {
			if (current) setVersion(value);
		});
		return () => {
			current = false;
		};
	}, [showNavigation]);
	const links = [
		{ href: "/projects", label: "Projects", active: window.location.pathname === "/projects", users: false },
		...(session?.user.role === "admin"
			? [{ href: "/admin/users", label: "Users", active: window.location.pathname.startsWith("/admin"), users: true }]
			: []),
	];
	return (
		<AppFrame
			navigation={<Navigation projectName="Backlog.md" showAttribution={false} />}
			sidebar={
				showNavigation && (
					<aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 md:flex">
						<div className="flex h-18 items-center border-b border-gray-200 px-7 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
							Workspace
						</div>
						<nav aria-label="Workspace navigation" className="flex-1 space-y-1 px-4 py-6">
							{links.map((link) => (
								<a
									key={link.href}
									href={link.href}
									aria-current={link.active ? "page" : undefined}
									className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${
										link.active
											? "bg-blue-50 text-blue-600 dark:bg-blue-600/20 dark:text-blue-400"
											: "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
									}`}
								>
									<WorkspaceIcon users={link.users} />
									{link.label}
								</a>
							))}
						</nav>
						<div className="border-t border-gray-200 px-7 py-5 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
							Backlog.md{version ? ` - v${version}` : ""}
						</div>
					</aside>
				)
			}
		>
			<div className={showNavigation ? "page-shell" : "flex min-h-full items-center justify-center px-6 py-12"}>
				{children}
			</div>
		</AppFrame>
	);
}
