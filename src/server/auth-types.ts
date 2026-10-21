export const PERMISSION_NAMES = [
	"tasksWrite",
	"docsWrite",
	"decisionsWrite",
	"decisionsManage",
	"archive",
	"delete",
] as const;

export type ProjectPermission = (typeof PERMISSION_NAMES)[number];
export type ProjectPermissions = Record<ProjectPermission, boolean>;
export const DEFAULT_PERMISSIONS: ProjectPermissions = {
	tasksWrite: true,
	docsWrite: true,
	decisionsWrite: true,
	decisionsManage: false,
	archive: false,
	delete: false,
};
export const ADMIN_PERMISSIONS: ProjectPermissions = {
	tasksWrite: true,
	docsWrite: true,
	decisionsWrite: true,
	decisionsManage: true,
	archive: true,
	delete: true,
};

export interface ServerUser {
	id: string;
	username: string;
	displayName: string;
	role: "admin" | "user";
	active: boolean;
	mustChangePassword: boolean;
}

export interface AuthSession {
	user: ServerUser;
	csrfToken: string;
	createdAt: string;
	expiresAt: string;
	lastActivityAt: string;
	idleExpiresAt: string;
}

export interface ProjectMember {
	projectId: string;
	userId: string;
	permissions: ProjectPermissions;
}

/** Each invocation rechecks the session and current membership. Never store a current user on a server. */
export interface ProjectAuthorization {
	check(permission: ProjectPermission | "read" | "admin"): Response | null;
}
