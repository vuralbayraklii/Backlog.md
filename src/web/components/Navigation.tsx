import React from "react";
import { projectScope } from "../lib/project-scope";
import AccountNavigation from "./AccountNavigation";
import { BranchIndexingIndicator } from "./BranchIndexingIndicator";
import ThemeToggle from "./ThemeToggle";

interface NavigationProps {
	projectName: string;
	loadingMessage?: string | null;
	showAttribution?: boolean;
}

const Navigation: React.FC<NavigationProps> = ({ projectName, loadingMessage, showAttribution = true }) => {
	return (
		<nav className="relative shrink-0 px-4 sm:px-8 min-h-18 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 transition-colors duration-200">
			<div className="min-h-18 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					{showAttribution ? (
						<h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 break-words">
							{projectName || "Loading..."}
						</h1>
					) : (
						<span className="text-xl font-bold text-gray-900 dark:text-gray-100">{projectName}</span>
					)}
					{showAttribution && (
						<>
							<span className="text-sm text-gray-500 dark:text-gray-400">powered by</span>
							<a
								href="https://backlog.md"
								target="_blank"
								rel="noopener noreferrer"
								className="text-sm text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300 hover:underline transition-colors duration-200"
							>
								Backlog.md
							</a>
						</>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-3">
					{projectScope.id && (
						<a href="/projects" className="text-sm text-stone-700 dark:text-stone-300 hover:underline">
							Projects
						</a>
					)}
					<AccountNavigation />
					<BranchIndexingIndicator message={loadingMessage} />
					<ThemeToggle />
				</div>
			</div>
		</nav>
	);
};

export default Navigation;
