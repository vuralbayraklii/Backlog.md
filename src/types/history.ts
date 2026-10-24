export const HISTORY_ACTIONS = [
	{ kind: "review-request", label: "Review requested", patterns: ["POST %/reviews/request"] },
	{ kind: "verification", label: "Verification recorded", patterns: ["POST %/reviews/verify"] },
	{ kind: "review-response", label: "Review answered", patterns: ["POST %/reviews/respond"] },
	{ kind: "review-cancel", label: "Review cancelled", patterns: ["POST %/reviews/cancel"] },
	{ kind: "archive", label: "Archived", patterns: ["POST %/archive", "POST /api/tasks/cleanup"] },
	{ kind: "restore", label: "Restored", patterns: ["POST %/restore"] },
	{
		kind: "create",
		label: "Created",
		patterns: ["POST /api/tasks", "POST /api/drafts", "POST /api/docs", "POST /api/decisions", "POST /api/milestones"],
	},
	{
		kind: "update",
		label: "Updated",
		patterns: ["PUT %", "POST /api/tasks/move", "POST /api/tasks/reorder", "POST %/demote", "POST %/promote"],
	},
	{ kind: "delete", label: "Deleted", patterns: ["DELETE %"] },
	{ kind: "external", label: "External file change", source: "external" },
	{ kind: "baseline", label: "Initial inventory", source: "baseline" },
	{ kind: "recovery", label: "Recovery", source: "recovery" },
] as const;

export function historyActionLabel(action: string, source: string): string {
	return (
		HISTORY_ACTIONS.find((item) =>
			"source" in item
				? item.source === source
				: item.patterns.some((pattern) => {
						const [start, end] = pattern.split("%");
						return end === undefined ? action === start : action.startsWith(start ?? "") && action.endsWith(end);
					}),
		)?.label ?? "Records changed"
	);
}
