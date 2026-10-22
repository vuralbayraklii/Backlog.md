import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Milestone, Task } from "../types/index.ts";
import Board from "../web/components/Board.tsx";
import { ApiError, apiClient, type MoveTasksPayload, type ReorderTaskPayload } from "../web/lib/api.ts";
import { projectScope } from "../web/lib/project-scope.ts";
import { setRequestSession } from "../web/lib/request.ts";

const STATUSES = ["To Do", "In Progress", "Done"];

const MILESTONE: Milestone = {
	id: "Release 1",
	title: "Release 1",
	description: "",
	rawContent: "",
};

const buildTask = (id: string, ordinal: number): Task => ({
	id,
	title: `Card ${id}`,
	status: "To Do",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-01-01",
	ordinal,
});

const TASKS = [buildTask("TASK-1", 1000), buildTask("TASK-2", 2000), buildTask("TASK-3", 3000)];

let activeRoot: Root | null = null;

const setupDom = () => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost/board",
	});
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as unknown as Document;
	globalThis.navigator = dom.window.navigator as unknown as Navigator;
};

const renderBoard = (
	onEditTask: (task: Task) => void = () => {},
	extra: {
		onTasksUpdated?: (tasks: Task[], requestTask: Task) => void;
		onRefreshData?: () => Promise<void>;
		tasks?: Task[];
		tasksRevision?: string;
		filterPriority?: string;
	} = {},
): HTMLElement => {
	setupDom();
	const container = document.getElementById("root");
	expect(container).toBeTruthy();
	activeRoot = createRoot(container as HTMLElement);
	rerenderBoard(onEditTask, extra);
	return container as HTMLElement;
};

/** Render again on the live root, the way the app re-renders when a filter changes. */
const rerenderBoard = (
	onEditTask: (task: Task) => void = () => {},
	extra: {
		onTasksUpdated?: (tasks: Task[], requestTask: Task) => void;
		onRefreshData?: () => Promise<void>;
		tasks?: Task[];
		tasksRevision?: string;
		filterPriority?: string;
	} = {},
) => {
	act(() => {
		activeRoot?.render(
			<Board
				onEditTask={onEditTask}
				onNewTask={() => {}}
				tasks={extra.tasks ?? TASKS}
				tasksRevision={extra.tasksRevision}
				statuses={STATUSES}
				isLoading={false}
				milestones={[]}
				availableLabels={[]}
				milestoneEntities={[]}
				archivedMilestones={[]}
				laneMode="none"
				onLaneChange={() => {}}
				onTasksUpdated={extra.onTasksUpdated}
				onRefreshData={extra.onRefreshData}
				filterPriority={extra.filterPriority}
			/>,
		);
	});
};

// A lane with no tasks is hidden, so the milestone lane needs a card of its own to exist at all.
const MILESTONE_TASKS = [TASKS[0], TASKS[1], { ...TASKS[2], milestone: MILESTONE.title }] as Task[];

const renderMilestoneBoard = (tasks: Task[] = MILESTONE_TASKS): HTMLElement => {
	setupDom();
	const container = document.getElementById("root");
	expect(container).toBeTruthy();
	activeRoot = createRoot(container as HTMLElement);
	act(() => {
		activeRoot?.render(
			<Board
				onEditTask={() => {}}
				onNewTask={() => {}}
				tasks={tasks}
				statuses={STATUSES}
				isLoading={false}
				milestones={[MILESTONE.title]}
				availableLabels={[]}
				milestoneEntities={[MILESTONE]}
				archivedMilestones={[]}
				laneMode="milestone"
				onLaneChange={() => {}}
			/>,
		);
	});
	return container as HTMLElement;
};

const getCard = (container: HTMLElement, taskId: string): HTMLElement => {
	const card = Array.from(container.querySelectorAll('[draggable="true"]')).find((element) =>
		element.textContent?.includes(taskId),
	);
	expect(card).toBeTruthy();
	return card as HTMLElement;
};

const selectedCardIds = (container: HTMLElement): string[] =>
	Array.from(container.querySelectorAll('[aria-selected="true"]')).map(
		(element) => element.querySelector(".font-mono")?.textContent ?? "",
	);

const clickCard = async (card: HTMLElement, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
	await act(async () => {
		card.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }));
		await Promise.resolve();
	});
};

const findButton = (container: HTMLElement, label: string): HTMLButtonElement => {
	const button = Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.trim() === label,
	);
	expect(button).toBeTruthy();
	return button as HTMLButtonElement;
};

const dispatchDrop = (target: HTMLElement, data: Record<string, string>) => {
	const event = new window.Event("drop", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", {
		value: { setData: () => {}, getData: (key: string) => data[key] ?? "", effectAllowed: "" },
	});
	target.dispatchEvent(event);
};

const dispatchDragStart = async (
	card: HTMLElement,
	modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
): Promise<Array<{ element: HTMLElement; x: number; y: number }>> => {
	const dragImages: Array<{ element: HTMLElement; x: number; y: number }> = [];
	const event = new window.Event("dragstart", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", {
		value: {
			setData: () => {},
			getData: () => "",
			effectAllowed: "",
			setDragImage: (element: HTMLElement, x: number, y: number) => dragImages.push({ element, x, y }),
		},
	});
	for (const [key, value] of Object.entries(modifiers)) {
		Object.defineProperty(event, key, { value });
	}
	await act(async () => {
		card.dispatchEvent(event);
		await Promise.resolve();
	});
	return dragImages;
};

const dispatchDragOver = async (target: HTMLElement) => {
	await act(async () => {
		target.dispatchEvent(new window.Event("dragover", { bubbles: true, cancelable: true }));
		await Promise.resolve();
	});
};

const dispatchDragEnd = async (card: HTMLElement) => {
	await act(async () => {
		card.dispatchEvent(new window.Event("dragend", { bubbles: true, cancelable: true }));
		await Promise.resolve();
	});
};

const getColumn = (container: HTMLElement, status: string): HTMLElement => {
	const heading = Array.from(container.querySelectorAll("h3")).find((element) => element.textContent === status);
	const column = heading?.closest(".rounded-lg");
	expect(column).toBeTruthy();
	return column as HTMLElement;
};

/** Milestone view renders one column per status per lane, so the column has to be found inside its lane. */
const getLaneColumn = (container: HTMLElement, laneLabel: string, status: string): HTMLElement => {
	const lane = Array.from(container.querySelectorAll("h3")).find(
		(heading) => heading.textContent?.trim() === laneLabel,
	);
	expect(lane).toBeTruthy();
	const laneRoot = lane?.closest(".rounded-lg.border") as HTMLElement | null;
	expect(laneRoot).toBeTruthy();
	const column = Array.from((laneRoot as HTMLElement).querySelectorAll("h3"))
		.find((heading) => heading.textContent === status)
		?.closest(".rounded-lg");
	expect(column).toBeTruthy();
	return column as HTMLElement;
};

afterEach(() => {
	if (activeRoot) {
		act(() => {
			activeRoot?.unmount();
		});
		activeRoot = null;
	}
});

describe("Web board batch move", () => {
	it("adds a card to the selection on ctrl-click and removes it on a second ctrl-click", async () => {
		const container = renderBoard();

		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });
		expect(selectedCardIds(container)).toEqual(["TASK-1", "TASK-2"]);

		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		expect(selectedCardIds(container)).toEqual(["TASK-2"]);
	});

	it("selects the range between the anchor card and the shift-clicked card", async () => {
		const container = renderBoard();

		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-3"), { shiftKey: true });

		expect(selectedCardIds(container)).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
	});

	it("marks a selected card in both the light and the dark theme", async () => {
		const container = renderBoard();

		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });

		const card = getCard(container, "TASK-1");
		expect(card.className).toContain("ring-blue-500");
		expect(card.className).toContain("dark:ring-blue-400");
	});

	it("clears the selection on a click on empty board space", async () => {
		const container = renderBoard();

		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		expect(selectedCardIds(container)).toEqual(["TASK-1"]);

		const board = container.firstElementChild as HTMLElement;
		await act(async () => {
			board.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
			await Promise.resolve();
		});

		expect(selectedCardIds(container)).toEqual([]);
	});

	it("opens the task editor on a plain click", async () => {
		const opened: string[] = [];
		const container = renderBoard((task) => opened.push(task.id));

		await clickCard(getCard(container, "TASK-2"));

		expect(opened).toEqual(["TASK-2"]);
		expect(selectedCardIds(container)).toEqual([]);
	});

	it("clears the selection on Escape", async () => {
		const container = renderBoard();

		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		expect(selectedCardIds(container)).toEqual(["TASK-1"]);

		await act(async () => {
			document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			await Promise.resolve();
		});

		expect(selectedCardIds(container)).toEqual([]);
	});

	it("moves the whole selection through the toolbar", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};

		try {
			const container = renderBoard();
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-3"), { ctrlKey: true });

			const select = container.querySelector("#batch-move-status") as HTMLSelectElement;
			expect(select).toBeTruthy();
			await act(async () => {
				select.value = "Done";
				select.dispatchEvent(new window.Event("change", { bubbles: true }));
				await Promise.resolve();
			});

			await act(async () => {
				findButton(container, "Move").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
				await Promise.resolve();
			});

			expect(calls).toEqual([{ taskIds: ["TASK-1", "TASK-3"], targetStatus: "Done" }]);
			expect(selectedCardIds(container)).toEqual([]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("moves the whole selection when one selected card is dragged", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};

		try {
			const container = renderBoard();
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

			await act(async () => {
				dispatchDrop(getColumn(container, "In Progress"), { "text/plain": "TASK-1", "text/status": "To Do" });
				await Promise.resolve();
			});

			expect(calls).toEqual([{ taskIds: ["TASK-1", "TASK-2"], targetStatus: "In Progress" }]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("carries the milestone lane a batch is dropped into, exactly as a single-card drop does", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};

		try {
			const container = renderMilestoneBoard();
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

			await act(async () => {
				dispatchDrop(getLaneColumn(container, MILESTONE.title, "In Progress"), {
					"text/plain": "TASK-1",
					"text/status": "To Do",
				});
				await Promise.resolve();
			});

			expect(calls).toEqual([
				{ taskIds: ["TASK-1", "TASK-2"], targetStatus: "In Progress", targetMilestone: MILESTONE.title },
			]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("clears the milestone when a batch is dropped into the no-milestone lane", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};

		try {
			const container = renderMilestoneBoard();
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

			await act(async () => {
				dispatchDrop(getLaneColumn(container, "Unassigned", "Done"), {
					"text/plain": "TASK-1",
					"text/status": "To Do",
				});
				await Promise.resolve();
			});

			expect(calls).toEqual([{ taskIds: ["TASK-1", "TASK-2"], targetStatus: "Done", targetMilestone: null }]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("leaves the milestone alone when the toolbar moves the selection", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};

		try {
			const container = renderMilestoneBoard();
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });

			const select = container.querySelector("#batch-move-status") as HTMLSelectElement;
			await act(async () => {
				select.value = "Done";
				select.dispatchEvent(new window.Event("change", { bubbles: true }));
				await Promise.resolve();
			});
			await act(async () => {
				findButton(container, "Move").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
				await Promise.resolve();
			});

			expect(calls).toEqual([{ taskIds: ["TASK-1"], targetStatus: "Done" }]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("sends selected record revisions and refreshes after a central conflict", async () => {
		const originalScope = { ...projectScope };
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		Object.assign(projectScope, { id: "1", routeBase: "/projects/1", apiBase: "/api/projects/1" });
		const versionedTasks = TASKS.map((task, index) => ({
			...task,
			recordKey: `key-${index + 1}`,
			revision: `rev-${index + 1}`,
		}));
		let payload: MoveTasksPayload | null = null;
		let refreshes = 0;
		apiClient.moveTasks = async (value) => {
			payload = value;
			throw new ApiError("Board changed", 409, "REVISION_CONFLICT", { code: "REVISION_CONFLICT" });
		};
		try {
			const container = renderBoard(() => {}, { tasks: versionedTasks, onRefreshData: async () => void refreshes++ });
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			const select = container.querySelector("#batch-move-status") as HTMLSelectElement;
			await act(async () => {
				select.value = "Done";
				select.dispatchEvent(new window.Event("change", { bubbles: true }));
				await Promise.resolve();
			});
			await act(async () => {
				findButton(container, "Move").click();
				await Promise.resolve();
			});
			expect((payload as MoveTasksPayload | null)?.expectedRevisions).toEqual({ "key-1": "rev-1" });
			expect(refreshes).toBe(1);
			expect(container.textContent).toContain("This record changed. Open current data before changing it.");
		} finally {
			apiClient.moveTasks = originalMoveTasks;
			Object.assign(projectScope, originalScope);
		}
	});

	// A range only ever adds to the selection, so a second shift-click reaches the same union whether
	// it extends from the first anchor or from the card just clicked. This pins that down so a later
	// change to replacing selections has to decide the anchor question deliberately.
	it("reaches the same selection from two shift-clicks in a row", async () => {
		const container = renderBoard();

		await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-1"), { shiftKey: true });
		await clickCard(getCard(container, "TASK-3"), { shiftKey: true });

		expect(selectedCardIds(container)).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
	});

	// Releasing a card where it was picked up used to move the whole selection anyway, and the
	// refresh that followed rebuilt every board resource, which reads as a full page reload.
	it("does nothing when the selection is dropped back where it already is", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};
		let refreshes = 0;

		try {
			const container = renderBoard(() => {}, { onRefreshData: async () => void refreshes++ });
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });
			const locationBefore = window.location.href;

			await act(async () => {
				dispatchDrop(getColumn(container, "To Do"), { "text/plain": "TASK-1", "text/status": "To Do" });
				await Promise.resolve();
			});

			expect(calls).toEqual([]);
			expect(refreshes).toBe(0);
			expect(window.location.href).toBe(locationBefore);
			// The drop changed nothing, so the selection is still there to drag somewhere else.
			expect(selectedCardIds(container)).toEqual(["TASK-1", "TASK-2"]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("skips read-only cross-branch cards in a shift-range", async () => {
		const container = renderBoard(() => {}, {
			tasks: [TASKS[0] as Task, { ...TASKS[1], branch: "feature-x" } as Task, TASKS[2] as Task],
		});
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-3"), { shiftKey: true });

		expect(selectedCardIds(container)).toEqual(["TASK-1", "TASK-3"]);
	});

	it("prunes the selection to the cards a filter leaves visible", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};

		try {
			const tasks = [
				TASKS[0] as Task,
				{ ...TASKS[1], priority: "high" } as Task,
				{ ...TASKS[2], priority: "high" } as Task,
			];
			const container = renderBoard(() => {}, { tasks });
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-3"), { ctrlKey: true });

			// The priority filter hides TASK-1, so it must drop out of the selection instead of riding
			// along invisibly in the next batch move.
			rerenderBoard(() => {}, { tasks, filterPriority: "high" });
			expect(selectedCardIds(container).sort()).toEqual(["TASK-2", "TASK-3"]);

			await act(async () => {
				dispatchDrop(getColumn(container, "Done"), { "text/plain": "TASK-2", "text/status": "To Do" });
				await Promise.resolve();
			});

			expect(calls).toHaveLength(1);
			expect(calls[0]?.taskIds.sort()).toEqual(["TASK-2", "TASK-3"]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("keeps a single card lifted and released in place a pure no-op", async () => {
		const originalReorderTask = apiClient.reorderTask.bind(apiClient);
		const calls: unknown[] = [];
		apiClient.reorderTask = async (payload) => {
			calls.push(payload);
			return { success: true, task: TASKS[0] as Task, changedTasks: [] };
		};

		try {
			const container = renderBoard();
			const card = getCard(container, "TASK-1");
			await dispatchDragStart(card);
			// Releasing over the lifted card itself must not read as "append to the end".
			await dispatchDragOver(card);
			await act(async () => {
				dispatchDrop(getColumn(container, "To Do"), { "text/plain": "TASK-1", "text/status": "To Do" });
				await Promise.resolve();
			});

			expect(calls).toEqual([]);
		} finally {
			apiClient.reorderTask = originalReorderTask;
		}
	});

	it("still appends a card dropped on the empty space below a column", async () => {
		const originalReorderTask = apiClient.reorderTask.bind(apiClient);
		const calls: Array<{ taskId: string; orderedTaskIds?: string[] }> = [];
		apiClient.reorderTask = async (payload) => {
			calls.push(payload);
			return { success: true, task: TASKS[0] as Task, changedTasks: [] };
		};

		try {
			const container = renderBoard();
			await dispatchDragStart(getCard(container, "TASK-1"));
			await act(async () => {
				dispatchDrop(getColumn(container, "To Do"), { "text/plain": "TASK-1", "text/status": "To Do" });
				await Promise.resolve();
			});

			expect(calls).toHaveLength(1);
			expect(calls[0]?.orderedTaskIds).toEqual(["TASK-2", "TASK-3", "TASK-1"]);
		} finally {
			apiClient.reorderTask = originalReorderTask;
		}
	});

	it("uses the returned collection revision for a second own reorder", async () => {
		const originalFetch = globalThis.fetch;
		const originalScope = { ...projectScope };
		Object.assign(projectScope, { id: "1", routeBase: "/projects/1", apiBase: "/api/projects/1" });
		setRequestSession({
			user: {
				id: "alice",
				username: "alice",
				displayName: "Alice",
				role: "admin",
				active: true,
				mustChangePassword: false,
			},
			csrfToken: "csrf-alice",
			createdAt: "2026-01-01T00:00:00Z",
			expiresAt: "2026-01-01T12:00:00Z",
			lastActivityAt: "2026-01-01T00:00:00Z",
			idleExpiresAt: "2026-01-01T02:00:00Z",
		});
		const versionedTasks = TASKS.map((task, index) => ({
			...task,
			recordKey: `key-${index + 1}`,
			revision: `rev-${index + 1}`,
		}));
		const sent: Array<{ ifMatch: string | null; payload: ReorderTaskPayload }> = [];
		let applied = 0;
		let appliedOrdinal: number | undefined;
		globalThis.fetch = (async (input, options) => {
			expect(String(input)).toBe("/api/projects/1/tasks/reorder");
			const payload = JSON.parse(String(options?.body)) as ReorderTaskPayload;
			sent.push({ ifMatch: new Headers(options?.headers).get("If-Match"), payload });
			const originalTask = versionedTasks.find((item) => item.id === payload.taskId);
			if (!originalTask) throw new Error(`Missing task ${payload.taskId}`);
			const task = { ...originalTask, ordinal: 3000 + sent.length * 1000, revision: `next-${sent.length}` };
			return Response.json(
				{ success: true, task, changedTasks: [task] },
				{ headers: { "X-Backlog-Tasks-Revision": `collection-${sent.length}` } },
			);
		}) as typeof fetch;
		try {
			setupDom();
			const container = document.getElementById("root") as HTMLElement;
			activeRoot = createRoot(container);
			function Harness() {
				const [tasks, setTasks] = useState<Task[]>(versionedTasks);
				const [revision, setRevision] = useState<string | null>("collection-0");
				return (
					<Board
						onEditTask={() => {}}
						onNewTask={() => {}}
						tasks={tasks}
						tasksRevision={revision}
						statuses={STATUSES}
						isLoading={false}
						milestones={[]}
						availableLabels={[]}
						milestoneEntities={[]}
						archivedMilestones={[]}
						laneMode="none"
						onLaneChange={() => {}}
						onTasksUpdated={(changed, _requestTask, nextRevision) => {
							applied++;
							appliedOrdinal = changed[0]?.ordinal;
							setTasks((current) => current.map((item) => changed.find((update) => update.id === item.id) ?? item));
							if (nextRevision !== undefined) setRevision(nextRevision);
						}}
					/>
				);
			}
			await act(async () => activeRoot?.render(<Harness />));
			await dispatchDragStart(getCard(container, "TASK-1"));
			await act(async () => {
				dispatchDrop(getColumn(container, "To Do"), { "text/plain": "TASK-1", "text/status": "To Do" });
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			for (let attempt = 0; attempt < 20; attempt++) {
				const order = Array.from(getColumn(container, "To Do").querySelectorAll('[draggable="true"]')).map(
					(card) => card.textContent?.match(/TASK-\d+/)?.[0],
				);
				if (order[0] === "TASK-2") break;
				await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
			}
			await dispatchDragEnd(getCard(container, "TASK-1"));
			expect([applied, appliedOrdinal]).toEqual([1, 4000]);
			expect(
				Array.from(getColumn(container, "To Do").querySelectorAll('[draggable="true"]')).map(
					(card) => card.textContent?.match(/TASK-\d+/)?.[0],
				),
			).toEqual(["TASK-2", "TASK-3", "TASK-1"]);
			await act(async () =>
				getColumn(container, "To Do").querySelector<HTMLButtonElement>("button[title='Column actions']")?.click(),
			);
			await act(async () => {
				findButton(container, "Sort by Creation Date (oldest first)").click();
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			expect(sent.map((request) => request.ifMatch)).toEqual(["collection-0", "collection-1"]);
			expect(sent[1]?.payload.expectedRevisions?.["key-1"]).toBe("next-1");
		} finally {
			globalThis.fetch = originalFetch;
			Object.assign(projectScope, originalScope);
			setRequestSession(null);
		}
	});

	it("keeps an in-place release inside a milestone lane a pure no-op", async () => {
		const originalReorderTask = apiClient.reorderTask.bind(apiClient);
		const calls: unknown[] = [];
		apiClient.reorderTask = async (payload) => {
			calls.push(payload);
			return { success: true, task: TASKS[0] as Task, changedTasks: [] };
		};

		try {
			const container = renderMilestoneBoard([
				TASKS[0] as Task,
				{ ...TASKS[1], milestone: MILESTONE.title } as Task,
				{ ...TASKS[2], milestone: MILESTONE.title } as Task,
			]);
			const card = getCard(container, "TASK-2");
			await dispatchDragStart(card);
			await dispatchDragOver(card);
			await act(async () => {
				dispatchDrop(getLaneColumn(container, "Release 1", "To Do"), {
					"text/plain": "TASK-2",
					"text/status": "To Do",
				});
				await Promise.resolve();
			});

			expect(calls).toEqual([]);
		} finally {
			apiClient.reorderTask = originalReorderTask;
		}
	});

	it("does nothing when the toolbar moves the selection to the status it already has", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};

		try {
			const container = renderBoard();
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });

			const select = container.querySelector("#batch-move-status") as HTMLSelectElement;
			await act(async () => {
				select.value = "To Do";
				select.dispatchEvent(new window.Event("change", { bubbles: true }));
				await Promise.resolve();
			});
			await act(async () => {
				findButton(container, "Move").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
				await Promise.resolve();
			});

			expect(calls).toEqual([]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("feeds a completed batch move through the board store rather than reloading the board", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const moved: Task[] = [{ ...TASKS[0], status: "Done" } as Task, { ...TASKS[1], status: "Done" } as Task];
		apiClient.moveTasks = async () => ({ success: true, tasks: moved, changedTasks: moved, failures: [] });
		const updates: Array<{ tasks: Task[]; requestTask: Task }> = [];
		let refreshes = 0;

		try {
			const container = renderBoard(() => {}, {
				onTasksUpdated: (tasks, requestTask) => updates.push({ tasks, requestTask }),
				onRefreshData: async () => void refreshes++,
			});
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

			await act(async () => {
				dispatchDrop(getColumn(container, "Done"), { "text/plain": "TASK-1", "text/status": "To Do" });
				await Promise.resolve();
			});

			expect(updates).toHaveLength(1);
			expect(updates[0]?.tasks).toEqual(moved);
			// The board matches the request task by identity, so it has to be the rendered object.
			expect(updates[0]?.requestTask).toBe(TASKS[0] as Task);
			expect(refreshes).toBe(0);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("drops a lane's cards from the selection when the lane collapses", async () => {
		const container = renderMilestoneBoard([
			TASKS[0] as Task,
			{ ...TASKS[1], milestone: MILESTONE.title } as Task,
			{ ...TASKS[2], milestone: MILESTONE.title } as Task,
		]);
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-3"), { ctrlKey: true });
		expect(container.textContent).toContain("2 selected");

		// Collapsing the milestone lane hides TASK-3, so it must not ride along in the next move.
		const laneHeader = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes(MILESTONE.title),
		) as HTMLButtonElement;
		expect(laneHeader).toBeTruthy();
		await act(async () => {
			laneHeader.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});

		expect(container.textContent).toContain("1 selected");
		expect(selectedCardIds(container)).toEqual(["TASK-1"]);
	});

	it("hides the insertion indicator during a batch drag", async () => {
		const container = renderBoard();
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

		await dispatchDragStart(getCard(container, "TASK-1"));
		await dispatchDragOver(getCard(container, "TASK-3"));

		// A batch drop does not honor a card-level position, so no indicator may promise one.
		expect(container.querySelector(".bg-blue-500.animate-pulse")).toBeNull();
	});

	it("still shows the insertion indicator during a single-card drag", async () => {
		const container = renderBoard();

		await dispatchDragStart(getCard(container, "TASK-1"));
		await dispatchDragOver(getCard(container, "TASK-3"));

		expect(container.querySelector(".bg-blue-500.animate-pulse")).not.toBeNull();
	});

	it("sends the batch in board order, not click order", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		const calls: MoveTasksPayload[] = [];
		apiClient.moveTasks = async (payload) => {
			calls.push(payload);
			return { success: true, tasks: [], changedTasks: [], failures: [] };
		};

		try {
			const container = renderBoard();
			// Click the lower card first: the request must still read top-to-bottom.
			await clickCard(getCard(container, "TASK-3"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });

			await act(async () => {
				dispatchDrop(getColumn(container, "Done"), { "text/plain": "TASK-1", "text/status": "To Do" });
				await Promise.resolve();
			});

			expect(calls).toHaveLength(1);
			expect(calls[0]?.taskIds).toEqual(["TASK-1", "TASK-3"]);
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});

	it("shows the whole selection in the drag image", async () => {
		const container = renderBoard();
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

		const dragImages = await dispatchDragStart(getCard(container, "TASK-1"));

		expect(dragImages).toHaveLength(1);
		const ghost = dragImages[0]?.element as HTMLElement;
		// One card stacked behind a copy of the dragged card, plus the count of both.
		expect(ghost.children).toHaveLength(3);
		expect(ghost.lastElementChild?.textContent).toBe("2");
		expect(ghost.textContent).toContain("TASK-1");
	});

	it("counts every selected card in the drag image badge", async () => {
		const container = renderBoard();
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-3"), { ctrlKey: true });

		const dragImages = await dispatchDragStart(getCard(container, "TASK-2"));

		expect(dragImages).toHaveLength(1);
		const ghost = dragImages[0]?.element as HTMLElement;
		// Two cards stacked behind a copy of the dragged card, plus the count of all three.
		expect(ghost.children).toHaveLength(4);
		expect(ghost.lastElementChild?.textContent).toBe("3");
	});

	it("pulls a modifier-press-dragged card into the selection so the badge matches the drop", async () => {
		const container = renderBoard();
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

		// A ctrl/cmd press that turns straight into a drag never completes the click, so the third
		// card would otherwise be missing from both the badge and the move.
		const dragImages = await dispatchDragStart(getCard(container, "TASK-3"), { metaKey: true });

		expect(dragImages).toHaveLength(1);
		expect((dragImages[0]?.element as HTMLElement).lastElementChild?.textContent).toBe("3");
		expect(selectedCardIds(container).sort()).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
	});

	it("shows the dragging treatment on every selected card during a selection drag", async () => {
		const container = renderBoard();
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

		await dispatchDragStart(getCard(container, "TASK-1"));

		// The companion carries the grabbed card's dragging treatment; unselected cards stay inert.
		expect(getCard(container, "TASK-2").className).toContain("opacity-50");
		expect(getCard(container, "TASK-3").className).not.toContain("opacity-50");

		await dispatchDragEnd(getCard(container, "TASK-1"));
		expect(getCard(container, "TASK-1").className).not.toContain("opacity-50");
		expect(getCard(container, "TASK-2").className).not.toContain("opacity-50");
	});

	it("leaves the drag image alone when a single card is dragged", async () => {
		const container = renderBoard();
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });

		expect(await dispatchDragStart(getCard(container, "TASK-1"))).toEqual([]);
	});

	it("leaves the drag image and selection alone on an unmodified drag of an unselected card", async () => {
		const container = renderBoard();
		await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
		await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

		expect(await dispatchDragStart(getCard(container, "TASK-3"))).toEqual([]);
		expect(selectedCardIds(container).sort()).toEqual(["TASK-1", "TASK-2"]);
	});

	it("reports the tasks that failed to move", async () => {
		const originalMoveTasks = apiClient.moveTasks.bind(apiClient);
		apiClient.moveTasks = async () => ({
			success: false,
			tasks: [],
			changedTasks: [],
			failures: [{ taskId: "TASK-2", reason: "Task TASK-2 not found." }],
		});

		try {
			const container = renderBoard();
			await clickCard(getCard(container, "TASK-1"), { ctrlKey: true });
			await clickCard(getCard(container, "TASK-2"), { ctrlKey: true });

			await act(async () => {
				dispatchDrop(getColumn(container, "Done"), { "text/plain": "TASK-1", "text/status": "To Do" });
				await Promise.resolve();
			});

			expect(container.textContent).toContain("TASK-2");
			expect(container.textContent).toContain("Could not move 1 of 2 tasks");
		} finally {
			apiClient.moveTasks = originalMoveTasks;
		}
	});
});
