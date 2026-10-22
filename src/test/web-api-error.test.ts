import { describe, expect, it } from "bun:test";
import { isMutationConflict } from "../web/components/MutationConflictNotice.tsx";
import { ApiError, isAmbiguousIdConflict } from "../web/lib/api.ts";
import { HttpError } from "../web/lib/request.ts";

describe("Web API errors", () => {
	it("uses server error payloads as the user-facing message", () => {
		const error = ApiError.fromResponse(new Response(null, { status: 400, statusText: "Bad Request" }), {
			error: "Comment body cannot contain standalone '---' delimiter lines.",
		});

		expect(error.message).toBe("Comment body cannot contain standalone '---' delimiter lines.");
		expect(error.status).toBe(400);
	});

	it("falls back to HTTP status text when no server error payload exists", () => {
		const error = ApiError.fromResponse(new Response(null, { status: 404, statusText: "Not Found" }));

		expect(error.message).toBe("HTTP 404: Not Found");
	});

	it("distinguishes coded revision conflicts from legacy ambiguous IDs", () => {
		const response = new Response(null, { status: 409, statusText: "Conflict" });
		const revision = ApiError.fromResponse(response, { error: "Changed", code: "REVISION_CONFLICT" });
		expect(revision.code).toBe("REVISION_CONFLICT");
		expect(isAmbiguousIdConflict(revision)).toBe(false);
		expect(isAmbiguousIdConflict(ApiError.fromResponse(response, { error: "Ambiguous" }))).toBe(true);
		expect(new HttpError("Locked", 409, { code: "WRITE_LOCKED" }).code).toBe("WRITE_LOCKED");
		expect(isMutationConflict(new ApiError("Review current data", 409, "OPERATION_RESOLVED"))).toBe(true);
	});
});
