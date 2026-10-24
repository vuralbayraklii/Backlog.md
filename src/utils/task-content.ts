import type { Task } from "../types/index.ts";

/** Persisted content, including structured edits whose Markdown has not been serialized yet. */
export function taskContentForComparison(task: Task): Record<string, unknown> {
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		assignee: task.assignee ?? [],
		reporter: task.reporter,
		createdDate: task.createdDate,
		dueDate: task.dueDate,
		labels: task.labels ?? [],
		milestone: task.milestone,
		dependencies: task.dependencies ?? [],
		references: task.references ?? [],
		documentation: task.documentation ?? [],
		modifiedFiles: task.modifiedFiles ?? [],
		rawContent: task.rawContent ?? "",
		description: task.description,
		implementationPlan: task.implementationPlan,
		implementationNotes: task.implementationNotes,
		comments: task.comments ?? [],
		finalSummary: task.finalSummary,
		acceptanceCriteriaItems: task.acceptanceCriteriaItems ?? [],
		definitionOfDoneItems: task.definitionOfDoneItems ?? [],
		parentTaskId: task.parentTaskId,
		subtasks: task.subtasks ?? [],
		priority: task.priority,
		type: task.type,
		project: task.project,
		onStatusChange: task.onStatusChange,
	};
}
