import { describe, expect, test } from "bun:test";
import {
	MutationError,
	MutationQueue,
	recordRevision,
	requestHash,
	requireOperationId,
	responseFromResult,
	safeResult,
	taskCollectionRevision,
} from "../server/mutations.ts";

describe("central mutation helpers", () => {
	test("hashes semantic JSON and revision without credentials", async () => {
		const request = (body: string, revision: string, cookie: string) =>
			new Request("http://localhost/api/projects/1/tasks/TASK-1?b=2&a=1", {
				method: "PUT",
				headers: { "Content-Type": "application/json", "If-Match": revision, Cookie: cookie, "X-CSRF-Token": cookie },
				body,
			});
		expect(await requestHash(request('{"title":"Updated","status":"Done"}', "old", "secret-a"))).toBe(
			await requestHash(request('{ "status": "Done", "title": "Updated" }', "old", "secret-b")),
		);
		expect(await requestHash(request('{"title":"Updated","status":"Done"}', "old", "secret-a"))).not.toBe(
			await requestHash(request('{"title":"Updated","status":"Done"}', "new", "secret-a")),
		);
	});

	test("keeps text/plain decision bytes significant", async () => {
		const request = (body: string | Uint8Array<ArrayBuffer>) =>
			new Request("http://localhost/api/projects/1/decisions/DECISION-1", {
				method: "PUT",
				headers: { "Content-Type": "text/plain" },
				body,
			});
		expect(await requestHash(request("a\n"))).not.toBe(await requestHash(request("a")));
		expect(await requestHash(request(new Uint8Array([0xff])))).not.toBe(
			await requestHash(request(new Uint8Array([0xfe]))),
		);
		expect(await requestHash(request(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])))).not.toBe(
			await requestHash(request("a")),
		);
	});

	test("revisions include lifecycle and collection content", () => {
		const bytes = new TextEncoder().encode("task markdown");
		const active = recordRevision("key-1", "/project/backlog/tasks/task-1.md", "active", bytes);
		const archived = recordRevision("key-1", "/project/backlog/archive/tasks/task-1.md", "archived", bytes);
		expect(active).not.toBe(archived);
		expect(taskCollectionRevision([{ recordKey: "key-1", revision: active }])).not.toBe(
			taskCollectionRevision([{ recordKey: "key-1", revision: archived }]),
		);
		expect(
			taskCollectionRevision([
				{ recordKey: "key-1", revision: active },
				{ recordKey: "key-2", revision: archived },
			]),
		).toBe(
			taskCollectionRevision([
				{ recordKey: "key-2", revision: archived },
				{ recordKey: "key-1", revision: active },
			]),
		);
	});

	test("requires a UUID operation key", () => {
		const missing = new Request("http://localhost/api/projects/1/tasks", { method: "POST" });
		expect(() => requireOperationId(missing)).toThrow(MutationError);
		expect(requireOperationId(new Request(missing, { headers: { "Idempotency-Key": crypto.randomUUID() } }))).toMatch(
			/^[0-9a-f-]{36}$/,
		);
	});

	test("serializes writes to one project without blocking another", async () => {
		const queue = new MutationQueue();
		const sequence: string[] = [];
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = queue.run("project:1", async () => {
			sequence.push("first-start");
			await gate;
			sequence.push("first-end");
		});
		const second = queue.run("project:1", async () => sequence.push("second"));
		const other = queue.run("project:2", async () => sequence.push("other"));
		await other;
		expect(sequence).toEqual(["first-start", "other"]);
		release();
		await Promise.all([first, second]);
		expect(sequence).toEqual(["first-start", "other", "first-end", "second"]);
	});

	test("replays a safe response without Set-Cookie", async () => {
		const original = Response.json(
			{ success: true },
			{ status: 201, headers: { ETag: "rev", "Set-Cookie": "secret=1" } },
		);
		const stored = await safeResult(original);
		expect(stored.headers?.["set-cookie"]).toBeUndefined();
		const replay = responseFromResult(stored);
		expect(replay.status).toBe(201);
		expect(replay.headers.get("etag")).toBe("rev");
		expect(await replay.json()).toEqual({ success: true });
	});
});
