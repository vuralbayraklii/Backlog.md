import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { appendTaskReview, parseTaskReview, taskReviewContentHash } from "../core/task-review.ts";
import { parseTask } from "../markdown/parser.ts";
import { serializeTask } from "../markdown/serializer.ts";
import type { Task, TaskUpdateInput } from "../types/index.ts";
import type { ReviewContext } from "../types/task-review.ts";
import { openReviewRequests } from "../types/task-review.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createTestDirOutsideRepository, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const person = { userId: "reader", name: "Reader" };
const writer: ReviewContext = {
	author: { kind: "agent", userId: "writer", name: "Agent", agentKeyId: "key" },
	canWrite: true,
};
const reader: ReviewContext = {
	author: { kind: "user", ...person },
	canWrite: false,
	trustedEntryIds: new Set([2]),
};

function task(): Task {
	return parseTask(
		"---\nid: TASK-1\ntitle: Work\nstatus: Done\nassignee: []\ncreated_date: '2026-01-01'\nlabels: []\ndependencies: []\n---\n\n## Description\n\nWork to review\n",
	);
}
function requested(): Task {
	const value = task();
	value.review = appendTaskReview(
		value,
		{ kind: "request", type: "acceptance", reviewer: person, reason: "Please accept" },
		writer,
	);
	return value;
}
function verified(): Task {
	const value = requested();
	value.review = appendTaskReview(
		value,
		{ kind: "verification", result: "passed", notes: "Tests passed", evidence: ["bun test: 12 passed"] },
		writer,
	);
	return value;
}

describe("portable task reviews", () => {
	it.each(["Acceptance Criteria", "Definition of Done"])(
		"hashes the saved content when a review write removes an empty %s block",
		async (heading) => {
			const directory = await createTestDirOutsideRepository("review-empty-block-");
			try {
				const core = new Core(directory);
				await initializeFilesystemTestProject(core, "Empty checklist review");
				const path = await core.fs.saveTask(task());
				const marker = heading === "Acceptance Criteria" ? "AC" : "DOD";
				await Bun.write(
					path,
					`${await Bun.file(path).text()}\n## ${heading}\n<!-- ${marker}:BEGIN -->\n<!-- ${marker}:END -->\n`,
				);
				const requested = await core.updateTaskReview(
					"TASK-1",
					{ kind: "request", type: "review", reviewer: person, reason: "Check" },
					writer,
				);
				const saved = await core.fs.loadTask("TASK-1");
				expect(saved?.rawContent).not.toContain(`<!-- ${marker}:BEGIN -->`);
				expect(saved && taskReviewContentHash(saved)).toBe(requested.review?.[0]?.contentHash ?? "");
				await core.updateTaskReview(
					"TASK-1",
					{ kind: "response", requestId: 1, outcome: "approved", notes: "OK" },
					reader,
				);
			} finally {
				await safeCleanup(directory);
			}
		},
	);
	it("keeps a legacy task identity and workflow-only writes on the same review revision", async () => {
		const directory = await createTestDirOutsideRepository("review-legacy-identity-");
		try {
			const core = new Core(directory);
			await initializeFilesystemTestProject(core, "Legacy review");
			const path = await core.fs.saveTask(task());
			await Bun.write(path, (await Bun.file(path).text()).replace("id: TASK-1", "id: task-1"));
			const requested = await core.updateTaskReview(
				"TASK-1",
				{ kind: "request", type: "review", reviewer: person, reason: "Check" },
				writer,
			);
			const verified = await core.updateTaskReview(
				"TASK-1",
				{ kind: "verification", result: "passed", notes: "OK", evidence: ["report"] },
				writer,
			);
			expect(verified.reviewRevision).toBe(requested.reviewRevision);
			expect(taskReviewContentHash(verified)).toBe(taskReviewContentHash(requested));
		} finally {
			await safeCleanup(directory);
		}
	});
	it.each(["dedicated", "edit", "filesystem"])(
		"invalidates reviews across draft edits and lifecycle writes through %s",
		async (mode) => {
			const directory = await createTestDirOutsideRepository("review-draft-revert-");
			try {
				const core = new Core(directory);
				await initializeFilesystemTestProject(core, "Draft review");
				await core.fs.saveTask({ ...task(), status: "To Do" });
				const before = await core.updateTaskReview(
					"TASK-1",
					{ kind: "request", type: "review", reviewer: person, reason: "Check" },
					writer,
				);
				if (mode === "edit") await core.editTaskOrDraft("TASK-1", { status: "Draft" }, false);
				else if (mode === "filesystem") await core.fs.demoteTask("TASK-1");
				else await core.demoteTask("TASK-1", false);
				const revisions = [(await core.fs.loadDraft("DRAFT-1"))?.reviewRevision];
				for (const title of ["Changed", "Work"]) {
					if (mode === "edit") await core.editTaskOrDraft("DRAFT-1", { title }, false);
					else {
						const draft = await core.fs.loadDraft("DRAFT-1");
						if (!draft) throw new Error("Missing draft");
						if (mode === "filesystem") await core.fs.saveDraft({ ...draft, title });
						else await core.updateDraft({ ...draft, title }, false);
					}
					revisions.push((await core.fs.loadDraft("DRAFT-1"))?.reviewRevision);
				}
				if (mode === "edit") await core.editTaskOrDraft("DRAFT-1", { status: "To Do" }, false);
				else if (mode === "filesystem") await core.fs.promoteDraft("DRAFT-1");
				else await core.promoteDraft("DRAFT-1", false);
				const after = await core.fs.loadTask("TASK-1");
				expect(after).not.toBeNull();
				await expect(
					core.updateTaskReview("TASK-1", { kind: "response", requestId: 1, outcome: "approved", notes: "OK" }, reader),
				).rejects.toThrow("Task content changed");
				expect([...revisions, after?.reviewRevision]).toEqual([2, 3, 4, 5]);
				expect(after?.review).toEqual(before.review);
				expect(after && taskReviewContentHash(after)).not.toBe(before.review?.[0]?.contentHash);
			} finally {
				await safeCleanup(directory);
			}
		},
	);
	it("advances content revisions when structured edits are reverted before another review", async () => {
		const directory = await createTestDirOutsideRepository("review-structured-revert-");
		const cases: [Partial<Task>, TaskUpdateInput, TaskUpdateInput][] = [
			[
				{ description: "Original description" },
				{ description: "Changed description" },
				{ description: "Original description" },
			],
			[
				{ implementationPlan: "Original plan" },
				{ implementationPlan: "Changed plan" },
				{ implementationPlan: "Original plan" },
			],
			[
				{ implementationNotes: "Original notes" },
				{ implementationNotes: "Changed notes" },
				{ implementationNotes: "Original notes" },
			],
			[{ finalSummary: "Original summary" }, { finalSummary: "Changed summary" }, { finalSummary: "Original summary" }],
			[
				{ acceptanceCriteriaItems: [{ index: 1, text: "Condition", checked: false }] },
				{ checkAcceptanceCriteria: [1] },
				{ uncheckAcceptanceCriteria: [1] },
			],
			[
				{ definitionOfDoneItems: [{ index: 1, text: "Condition", checked: false }] },
				{ checkDefinitionOfDone: [1] },
				{ uncheckDefinitionOfDone: [1] },
			],
		];
		try {
			for (const [index, [initial, changed, restored]] of cases.entries()) {
				const core = new Core(join(directory, String(index)));
				await initializeFilesystemTestProject(core, "Structured review");
				await core.fs.saveTask({ ...task(), rawContent: "", ...initial });
				const before = await core.updateTaskReview(
					"TASK-1",
					{ kind: "request", type: "review", reviewer: person, reason: "Check the content" },
					writer,
				);
				await core.updateTaskFromInput("TASK-1", changed, false);
				await core.updateTaskFromInput("TASK-1", restored, false);
				const after = await core.fs.loadTask("TASK-1");
				expect(after?.reviewRevision).toBe(3);
				expect(after && taskReviewContentHash(after)).not.toBe(before.review?.[0]?.contentHash);
			}
		} finally {
			await safeCleanup(directory);
		}
	});
	it("runs the local CLI workflow without claiming an authenticated identity", async () => {
		const directory = await createTestDirOutsideRepository("review-cli-");
		try {
			const core = new Core(directory);
			await initializeFilesystemTestProject(core, "Review CLI");
			await core.fs.saveTask(task());
			for (const args of [
				["request", "--type", "acceptance", "--to", "reader", "--reason", "Please accept"],
				["verify", "--result", "passed", "--notes", "Tests passed", "--evidence", "12 tests passed"],
				["respond", "--request", "1", "--outcome", "approved", "--notes", "Accepted", "--by", "reader"],
			]) {
				const child = Bun.spawn(
					[
						process.execPath,
						getTestCliPath(),
						"task",
						"review",
						args[0] as string,
						"TASK-1",
						...args.slice(1),
						"--json",
					],
					{ cwd: directory, stdout: "pipe", stderr: "pipe" },
				);
				const [stdout, stderr, code] = await Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]);
				expect(code, stderr).toBe(0);
				expect(JSON.parse(stdout).identity).toBe("declared");
			}
			expect((await core.fs.loadTask("TASK-1"))?.review).toHaveLength(3);
			for (const description of ["Changed through the CLI", task().description ?? ""]) {
				const child = Bun.spawn(
					[process.execPath, getTestCliPath(), "task", "edit", "TASK-1", "--description", description],
					{ cwd: directory, stdout: "pipe", stderr: "pipe" },
				);
				const [code, , stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);
				expect(code, stderr).toBe(0);
			}
			expect((await core.fs.loadTask("TASK-1"))?.reviewRevision).toBe(3);
		} finally {
			await safeCleanup(directory);
		}
	});
	it("retains review history through ordinary Core edits, archive and restore", async () => {
		const directory = await createTestDirOutsideRepository("review-core-");
		try {
			const core = new Core(directory);
			await initializeFilesystemTestProject(core, "Review workflow");
			await core.fs.saveTask(task());
			const saved = await core.updateTaskReview(
				"TASK-1",
				{ kind: "request", type: "review", reviewer: person, reason: "Check" },
				writer,
			);
			await core.updateTaskFromInput("TASK-1", { title: "Renamed", labels: ["reviewed"] }, false);
			await core.updateTaskFromInput("TASK-1", { title: "Work", labels: [] }, false);
			const restoredContent = await core.loadTaskById("TASK-1", { includeCrossBranch: false });
			expect(restoredContent?.reviewRevision).toBe(3);
			expect(restoredContent && taskReviewContentHash(restoredContent)).not.toBe(saved.review?.[0]?.contentHash);
			expect((await core.loadTaskById("TASK-1", { includeCrossBranch: false }))?.review).toEqual(saved.review);
			await core.archiveTask("TASK-1", false);
			await core.restoreTask("TASK-1", false);
			expect((await core.loadTaskById("TASK-1", { includeCrossBranch: false }))?.review).toEqual(saved.review);
		} finally {
			await safeCleanup(directory);
		}
	});
	it("preserves the workflow and content hash through Markdown roundtrips", () => {
		const value = verified();
		const roundtrip = parseTask(serializeTask(value));
		expect(roundtrip.review).toEqual(value.review);
		expect(taskReviewContentHash(roundtrip)).toBe(taskReviewContentHash(value));
	});
	it("does not add workflow fields to existing tasks", () => {
		expect(serializeTask(task())).not.toContain("review:");
	});
	it("permits an assigned read-only human to accept an authenticated verification", () => {
		const value = verified();
		value.review = appendTaskReview(
			value,
			{ kind: "response", requestId: 1, outcome: "approved", notes: "Accepted" },
			reader,
		);
		expect(value.review.at(-1)).toMatchObject({ kind: "response", verificationId: 2, author: reader.author });
		expect(openReviewRequests(value.review)).toEqual([]);
	});
	it("rejects an agent and an unassigned human response", () => {
		for (const context of [writer, { ...reader, author: { ...reader.author, userId: "other" } }])
			expect(() =>
				appendTaskReview(
					verified(),
					{ kind: "response", requestId: 1, outcome: "approved", notes: "Accepted" },
					context,
				),
			).toThrow("assigned person");
	});
	it("requires a trusted successful latest verification", () => {
		const respond = { kind: "response", requestId: 1, outcome: "approved", notes: "Accepted" } as const;
		expect(() => appendTaskReview(requested(), respond, reader)).toThrow("verification");
		expect(() => appendTaskReview(verified(), respond, { ...reader, trustedEntryIds: new Set() })).toThrow(
			"verification",
		);
		const value = verified();
		value.review = appendTaskReview(
			value,
			{ kind: "verification", result: "failed", notes: "Regression", evidence: ["test failure"] },
			writer,
		);
		expect(() => appendTaskReview(value, respond, reader)).toThrow("verification");
	});
	it("allows justified not-applicable verification without fabricating test evidence", () => {
		const value = requested();
		value.review = appendTaskReview(
			value,
			{
				kind: "verification",
				result: "not-applicable",
				notes: "Documentation review; no executable change",
				evidence: [],
			},
			writer,
		);
		expect(
			appendTaskReview(
				value,
				{ kind: "response", requestId: 1, outcome: "approved", notes: "Read and accepted" },
				reader,
			).at(-1)?.kind,
		).toBe("response");
	});
	it("makes status, assignee, body and checklist changes stale but ignores workflow, timestamp and order", () => {
		const value = verified();
		const original = taskReviewContentHash(value);
		expect(taskReviewContentHash({ ...value, updatedDate: "2026-02-02", ordinal: 4, review: [] })).toBe(original);
		for (const changed of [
			{ ...value, status: "In Progress" },
			{ ...value, assignee: ["new"] },
			{ ...value, rawContent: `${value.rawContent}\nmore` },
		]) {
			expect(taskReviewContentHash(changed)).not.toBe(original);
			expect(() =>
				appendTaskReview(changed, { kind: "response", requestId: 1, outcome: "approved", notes: "Accept" }, reader),
			).toThrow("changed");
		}
	});
	it("does not require verification for general review and decision responses", () => {
		for (const type of ["review", "decision"] as const) {
			const value = task();
			value.review = appendTaskReview(
				value,
				{ kind: "request", type, reviewer: person, reason: "Review this plan" },
				writer,
			);
			expect(
				appendTaskReview(
					value,
					{ kind: "response", requestId: 1, outcome: type === "decision" ? "answered" : "approved", notes: "Response" },
					reader,
				).at(-1)?.kind,
			).toBe("response");
		}
	});
	it("preserves cancelled requests and forbids duplicate responses", () => {
		const value = requested();
		value.review = appendTaskReview(
			value,
			{ kind: "cancellation", requestId: 1, reason: "Reassign" },
			{ ...writer, admin: true },
		);
		expect(value.review).toHaveLength(2);
		expect(() =>
			appendTaskReview(value, { kind: "response", requestId: 1, outcome: "approved", notes: "Late response" }, reader),
		).toThrow("closed");
	});
	it("rejects malformed workflow and requires evidence for executable verification", () => {
		expect(() => parseTaskReview({})).toThrow();
		expect(() => parseTaskReview([{ kind: "response" }])).toThrow();
		expect(() => parseTask("---\nid: TASK-1\nreview: broken\n---\n")).toThrow("list");
		expect(() =>
			appendTaskReview(task(), { kind: "verification", result: "passed", notes: "Passed", evidence: [] }, writer),
		).toThrow("evidence");
	});
});
