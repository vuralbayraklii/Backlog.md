import type { BacklogConfig } from "../types/index.ts";

export interface FolderArea {
	id: string;
	userId: string;
	rootPath: string;
	createdAt: string;
}

export interface ProjectRegistrationInput {
	name: string;
	path: string;
}

export interface ProjectPreview {
	name: string;
	rootPath: string;
	backlogPath: string | null;
	configPath: string | null;
	config: BacklogConfig | null;
	counts: {
		tasks: number;
		drafts: number;
		documents: number;
		decisions: number;
		archived: number;
	};
	issues: { severity: "error" | "warning"; message: string; path?: string }[];
	canRegister: boolean;
}

export interface ProjectRegistrationAccess {
	allowed: boolean;
	areas: FolderArea[];
}
