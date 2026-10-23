import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { BacklogServer } from "../server/index.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("server task and decision bridge", () => {
	let temporary: string;
	let root: string;
	let handler: BacklogServer;
	let core: Core;

	beforeEach(async () => {
		temporary = createUniqueTestDir("server-agent-bridge");
		root = join(temporary, "project");
		core = new Core(root);
		await initializeFilesystemTestProject(core, "Bridge Project");
		handler = new BacklogServer(root);
	});

	afterEach(async () => {
		await handler.stop();
		await safeCleanup(temporary);
	});

	function dispatch(method: string, path: string, body: unknown): Promise<Response> {
		return handler.dispatchApi(
			new Request(`http://localhost${path}`, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
			path,
		);
	}

	it("passes create documentation and ordinal through the existing Core input", async () => {
		const response = await dispatch("POST", "/api/tasks", {
			title: "Created over local API",
			documentation: ["docs/doc-1 - Guide.md"],
			ordinal: 1234,
			acceptanceCriteriaItems: [{ text: "Works", checked: false }],
		});
		expect(response.status).toBe(201);
		const created = (await response.json()) as {
			documentation: string[];
			ordinal: number;
			acceptanceCriteriaItems: Array<{ text: string }>;
		};
		expect(created.documentation).toEqual(["docs/doc-1 - Guide.md"]);
		expect(created.ordinal).toBe(1234);
		expect(created.acceptanceCriteriaItems[0]?.text).toBe("Works");
	});

	it("uses the shared task edit builder for additive CLI fields", async () => {
		const created = (await (await dispatch("POST", "/api/tasks", { title: "Before" })).json()) as { id: string };
		const response = await dispatch("PUT", `/api/tasks/${created.id}`, {
			editArgs: { planAppend: ["First step"], acceptanceCriteriaAdd: ["Ready"] },
		});
		expect(response.status).toBe(200);
		const task = (await response.json()) as {
			implementationPlan?: string;
			acceptanceCriteriaItems: Array<{ text: string }>;
		};
		expect(task.implementationPlan).toContain("First step");
		expect(task.acceptanceCriteriaItems.some((item) => item.text === "Ready")).toBe(true);
	});

	it("creates and changes decision status with the existing Core status edit", async () => {
		const createdResponse = await dispatch("POST", "/api/decisions", { title: "Agent choice", status: "accepted" });
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as { id: string; status: string };
		expect(created.status).toBe("accepted");
		const changedResponse = await dispatch("PUT", `/api/decisions/${created.id}`, { status: "superseded" });
		expect(changedResponse.status).toBe(200);
		expect((await core.getDecision(created.id))?.status).toBe("superseded");
	});

	it("requires manage permission for non-proposed decision JSON, including replay authorization", async () => {
		const decision = await core.createDecisionWithTitle("Review", undefined, "proposed");
		const central = new BacklogServer(root, { centralMode: true });
		const authorization = {
			check: (permission: string) =>
				permission === "decisionsManage" ? Response.json({ error: "Denied" }, { status: 403 }) : null,
		};
		try {
			const proposed = new Request("http://localhost/api/decisions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Open", status: "proposed" }),
			});
			expect(await central.authorizeApi(proposed, "/api/decisions", authorization)).toBeNull();
			const accepted = new Request("http://localhost/api/decisions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Closed", status: "accepted" }),
			});
			expect((await central.authorizeApi(accepted, "/api/decisions", authorization))?.status).toBe(403);
			const statusEdit = new Request(`http://localhost/api/decisions/${decision.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "accepted" }),
			});
			expect((await central.authorizeApi(statusEdit, `/api/decisions/${decision.id}`, authorization))?.status).toBe(
				403,
			);
		} finally {
			await central.stop();
		}
	});
});
