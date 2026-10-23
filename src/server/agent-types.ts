import type { ProjectPermissions } from "./auth-types.ts";

export interface AgentGrant {
	projectId: string;
	permissions: ProjectPermissions;
}

/** Public metadata. The bearer secret is never part of this value. */
export interface AgentKey {
	id: string;
	userId: string;
	name: string;
	grants: AgentGrant[];
	createdAt: string;
	revokedAt: string | null;
	revision: string;
}

/** Only the first successful create response contains the bearer secret. */
export interface CreatedAgentKey {
	key: AgentKey;
	secret: string;
}
