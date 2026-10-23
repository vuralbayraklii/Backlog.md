import type { ReactNode } from "react";

export default function AppFrame({
	sidebar,
	navigation,
	children,
}: {
	sidebar?: ReactNode;
	navigation: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex h-screen overflow-hidden bg-gray-50 text-gray-900 transition-colors duration-200 dark:bg-gray-900 dark:text-gray-100">
			{sidebar}
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{navigation}
				<main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
			</div>
		</div>
	);
}
