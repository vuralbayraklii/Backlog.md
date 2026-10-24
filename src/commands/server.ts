import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { printJson } from "../formatters/json-output.ts";
import { AgentStore } from "../server/agent-store.ts";
import type { AgentGrant, AgentKey } from "../server/agent-types.ts";
import { AuthStore } from "../server/auth-store.ts";
import {
	PERMISSION_NAMES,
	type ProjectMember,
	type ProjectPermissions,
	type ServerUser,
} from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { MutationStore } from "../server/mutation-store.ts";
import type { HistoryKind, MutationScope } from "../server/mutation-types.ts";
import { type ManagementAuditHook, managementAudit } from "../server/mutations.ts";
import { ProjectStore, type ServerProject } from "../server/project-store.ts";
import { listRecovery, type RecoveryReport, resolveRecovery, viewRecovery } from "../server/recovery.ts";
import type { FolderArea, ProjectPreview } from "../server/registration-types.ts";
import { readPassword } from "../utils/password-input.ts";
import { addHelpSchema } from "./help-schema.ts";

const humanTime = new Intl.DateTimeFormat("sv-SE", {
	timeZone: "Europe/Istanbul",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

function formatEventTime(utc: string | null): string {
	return utc ? `${humanTime.format(new Date(utc))} Europe/Istanbul` : "Unknown occurrence time";
}

function formatProject(project: ServerProject): string {
	return `${project.id} - ${project.name}\n  Root: ${project.rootPath}\n  Registered: ${project.createdAt}\n  Tracking: ${project.tracking}`;
}

function printProject(project: ServerProject, json?: boolean): void {
	if (json) printJson({ schemaVersion: 1, kind: "server-project", project });
	else console.log(formatProject(project));
}

function printPreview(preview: ProjectPreview, json?: boolean): void {
	if (json) {
		printJson({ schemaVersion: 1, kind: "server-project-preview", preview });
		return;
	}
	console.log(
		`${preview.name}\n  Root: ${preview.rootPath}\n  Backlog: ${preview.backlogPath ?? "unavailable"}\n  Configuration: ${preview.configPath ?? "unavailable"}`,
	);
	if (preview.config) console.log(`  Project configuration:\n${JSON.stringify(preview.config, null, 2)}`);
	for (const [kind, count] of Object.entries(preview.counts)) console.log(`  ${kind}: ${count}`);
	for (const issue of preview.issues)
		console.log(`  ${issue.severity}: ${issue.message}${issue.path ? ` (${issue.path})` : ""}`);
	console.log(`  Can register: ${preview.canRegister}`);
}

function localAudit(
	server: Command,
	action: string,
	options: { scope?: MutationScope; status?: number; forceEvent?: boolean } = {},
): ManagementAuditHook {
	const operationId = randomUUID();
	const dataDir = server.opts<{ dataDir: string }>().dataDir;
	return managementAudit(new MutationStore(dataDir), {
		operationId,
		scope: options.scope ?? { kind: "admin" },
		actor: { kind: "unknown" },
		source: "server-cli",
		requestHash: createHash("sha256").update(`server-cli\0${action}\0${operationId}`).digest("hex"),
		action,
		status: options.status,
		forceEvent: options.forceEvent,
	});
}

function registerAgentKeyCommands(server: Command): void {
	const command = server.command("agent-key").description("manage user-owned agent access to this application");
	const store = () => new AgentStore(server.opts<{ dataDir: string }>().dataDir);
	const print = (key: AgentKey, json?: boolean, secret?: string) => {
		if (json) printJson({ schemaVersion: 1, kind: "server-agent-key", key, ...(secret && { secret }) });
		else {
			console.log(
				`${key.id} - ${key.name}\n  User: ${key.userId}\n  Projects: ${key.grants.map((grant) => grant.projectId).join(", ")}\n  Revoked: ${key.revokedAt ?? "no"}\n  Revision: ${key.revision}`,
			);
			if (secret) console.log(`  Access key (shown once): ${secret}`);
		}
	};
	addHelpSchema(command.command("create <userId>"), {
		required: [
			{ name: "userId", type: "User ID" },
			{ name: "--name", type: "String" },
			{
				name: "--grants-file",
				type: "JSON file",
				description: "Array of {projectId,permissions}; name all six boolean permissions explicitly",
			},
		],
		optional: [{ name: "--json", type: "Boolean" }],
		writes: "Creates a user-owned key and safe audit in server.sqlite; only a hash of the secret is stored",
		output: "Key metadata and the access key, shown once. Keep the key in an owner-readable file outside the project.",
		examples: [
			"backlog server --data-dir ./server-data agent-key create <user-id> --name local-agent --grants-file grants.json --json",
		],
	})
		.requiredOption("--name <name>")
		.requiredOption("--grants-file <path>")
		.option("--json")
		.action(async (userId: string, options: { name: string; grantsFile: string; json?: boolean }) => {
			const grants: unknown = JSON.parse(await readFile(options.grantsFile, "utf8"));
			const result = store().create(
				{ userId, name: options.name, grants: grants as AgentGrant[] },
				localAudit(server, "agent-key.create", { status: 201 }),
			);
			print(result.key, options.json, result.secret);
		});
	addHelpSchema(command.command("list"), {
		required: [],
		optional: [
			{ name: "--user", type: "User ID" },
			{ name: "--json", type: "Boolean" },
		],
		reads: "Non-secret agent key metadata from server.sqlite",
		output: "User-owned keys and project permissions",
	})
		.option("--user <id>")
		.option("--json")
		.action((options: { user?: string; json?: boolean }) => {
			const keys = store().list(options.user);
			if (options.json) printJson({ schemaVersion: 1, kind: "server-agent-keys", keys });
			else if (!keys.length) console.log("No agent keys.");
			else for (const key of keys) print(key);
		});
	addHelpSchema(command.command("revoke <keyId>"), {
		required: [{ name: "keyId", type: "Agent key ID" }],
		optional: [{ name: "--json", type: "Boolean" }],
		writes: "Permanently revokes this access key and appends safe audit atomically",
		output: "Revoked key metadata; the secret is never returned",
	})
		.option("--json")
		.action((keyId: string, options: { json?: boolean }) => {
			const current = store().load(keyId);
			if (!current) throw new Error("Agent key not found.");
			print(store().revoke(current.id, current.userId, localAudit(server, "agent-key.revoke")), options.json);
		});
}

export function registerServerCommand(program: Command): void {
	const server = program
		.command("server")
		.description("manage central Backlog.md server data")
		.requiredOption("--data-dir <directory>", "directory containing server.sqlite (required; no default)")
		.addHelpText("after", "\nPaths are relative to the terminal working directory. BACKLOG_CWD is not used.");
	registerAgentKeyCommands(server);
	addHelpSchema(server.command("start"), {
		required: [
			{ name: "--data-dir", type: "Directory", description: "Server data directory" },
			{ name: "--public-url", type: "HTTPS URL", description: "Browser origin served by the reverse proxy" },
		],
		optional: [
			{ name: "--port", type: "Integer", description: "Listening port; default 6420" },
			{ name: "--open", type: "Boolean", description: "Open the project selector in a browser" },
			{
				name: "--allow-http-loopback",
				type: "Boolean",
				description: "Allow an HTTP loopback public URL for development",
			},
		],
		reads: "Accounts and project bindings from <data-dir>/server.sqlite; an initial active admin is required",
		writes: "Initial inventory and interrupted-operation state in server.sqlite; project source files stay unchanged",
		output: "Local server URL at 127.0.0.1; Ctrl+C stops the listener",
		examples: ["backlog server --data-dir ./server-data start --public-url https://backlog.example.com --port 6420"],
	})
		.description("start the central project server on this machine only")
		.option("--port <port>", "port to listen on", "6420")
		.option("--open", "open a browser after starting")
		.requiredOption("--public-url <url>", "public HTTPS origin used for cookies and Origin checks")
		.option("--allow-http-loopback", "allow an HTTP loopback public URL for development and tests")
		.action(async (options: { port: string; open?: boolean; publicUrl: string; allowHttpLoopback?: boolean }) => {
			const port = Number(options.port);
			const central = new CentralServer(server.opts<{ dataDir: string }>().dataDir);
			try {
				await central.start(port, options.open ?? false, {
					publicUrl: options.publicUrl,
					allowHttpLoopback:
						options.allowHttpLoopback || program.opts<{ allowHttpLoopback?: boolean }>().allowHttpLoopback,
				});
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exitCode = 1;
				return;
			}
			let stopping = false;
			const stop = async () => {
				if (stopping) return;
				stopping = true;
				await central.stop();
				process.exit(0);
			};
			process.once("SIGINT", () => void stop());
			process.once("SIGTERM", () => void stop());
		});
	const projects = server.command("project").description("register and inspect server projects");
	const store = () => new ProjectStore(server.opts<{ dataDir: string }>().dataDir);
	const dataDirectory = { name: "--data-dir", type: "Directory", description: "Required option on backlog server" };
	const jsonOption = { name: "--json", type: "Boolean", description: "Print schemaVersion 1 JSON" };
	const recordOutput =
		"Server project: id (string), name, rootPath (canonical absolute path), createdAt (UTC), tracking (boolean)";

	addHelpSchema(projects.command("preview <path>"), {
		required: [dataDirectory, { name: "path", type: "Directory" }, { name: "--name", type: "String" }],
		optional: [jsonOption],
		reads:
			"Prepared Backlog configuration, records, identity warnings, and real-path boundaries; never initializes a project",
		writes: "None; source files and missing server data stay unchanged",
		output:
			"ProjectPreview with config, counts, issues and canRegister; JSON kind: server-project-preview, schemaVersion: 1",
		examples: ['backlog server --data-dir ./server-data project preview ./example-project --name "Example" --json'],
	})
		.description("preview an existing Backlog project without changing any files")
		.requiredOption("--name <name>", "display name for the server project")
		.option("--json", "print versioned JSON output")
		.action(async (path: string, options: { name: string; json?: boolean }) => {
			printPreview(await store().preview(options.name, path), options.json);
		});

	addHelpSchema(projects.command("register <path>"), {
		required: [dataDirectory, { name: "path", type: "Directory" }, { name: "--name", type: "String" }],
		optional: [jsonOption],
		reads: "Existing Backlog configuration in the specified project root; no parent directory search",
		writes: "Project binding in <data-dir>/server.sqlite; source Markdown and configuration stay unchanged",
		output: `${recordOutput}; JSON kind: server-project`,
		examples: ['backlog server --data-dir ./server-data project register ./example-project --name "Example"'],
	})
		.description("register an existing Backlog project without changing its files")
		.requiredOption("--name <name>", "display name for the server project")
		.option("--json", "print versioned JSON output")
		.action(async (path: string, options: { name: string; json?: boolean }) => {
			printProject(
				await store().register(
					options.name,
					path,
					undefined,
					undefined,
					localAudit(server, "project.register", { scope: { kind: "registration" }, status: 201 }),
				),
				options.json,
			);
		});

	addHelpSchema(projects.command("list"), {
		required: [dataDirectory],
		optional: [jsonOption],
		reads: "Project bindings from <data-dir>/server.sqlite; missing database means an empty list",
		writes: "None; missing directories and databases are not created",
		output: `${recordOutput}, ordered by numeric ID; JSON kind: server-project-list, projects: array`,
		examples: ["backlog server --data-dir ./server-data project list --json"],
	})
		.description("list registered projects in ID order")
		.option("--json", "print versioned JSON output")
		.action((options: { json?: boolean }) => {
			const records = store().list();
			if (options.json) printJson({ schemaVersion: 1, kind: "server-project-list", projects: records });
			else console.log(records.length ? records.map(formatProject).join("\n\n") : "No server projects registered.");
		});

	addHelpSchema(projects.command("view <id>"), {
		required: [dataDirectory, { name: "id", type: "Positive integer", description: "Persistent server project ID" }],
		optional: [jsonOption],
		reads: "Project metadata from <data-dir>/server.sqlite; project files are not opened",
		writes: "None; missing directories and databases are not created",
		output: `${recordOutput}; JSON kind: server-project. Unknown IDs fail without falling back to a local project.`,
		examples: ["backlog server --data-dir ./server-data project view 1 --json"],
	})
		.description("view a registered project by ID")
		.option("--json", "print versioned JSON output")
		.action((id: string, options: { json?: boolean }) => {
			const project = store().load(id);
			if (!project) throw new Error(`Server project "${id}" was not found.`);
			printProject(project, options.json);
		});
	addHelpSchema(projects.command("tracking <id>"), {
		required: [dataDirectory, { name: "id", type: "Positive integer" }, { name: "--enabled", type: "true | false" }],
		optional: [jsonOption],
		reads: "Project binding; enabling tracking revalidates the prepared folder and all file boundaries",
		writes: "Tracking state in server.sqlite; project identity, memberships and source files are preserved",
		output: `${recordOutput}; JSON kind: server-project`,
		examples: ["backlog server --data-dir ./server-data project tracking 1 --enabled false --json"],
	})
		.description("stop or resume tracking while preserving project identity and memberships")
		.requiredOption("--enabled <boolean>", "true to resume tracking, false to stop", booleanOption)
		.option("--json", "print versioned JSON output")
		.action(async (id: string, options: { enabled: boolean; json?: boolean }) => {
			printProject(
				await store().setTracking(id, options.enabled, undefined, localAudit(server, "project.tracking")),
				options.json,
			);
		});
	registerAccountCommands(server, projects);
	registerFolderAreaCommands(server);
	registerHistoryCommands(server);
	registerRecoveryCommands(server);
}

function printFolderArea(area: FolderArea): void {
	console.log(`${area.id} - ${area.userId}\n  Root: ${area.rootPath}\n  Assigned: ${area.createdAt}`);
}

function registerFolderAreaCommands(server: Command): void {
	const store = () => new AuthStore(server.opts<{ dataDir: string }>().dataDir);
	const areas = server
		.command("folder-area")
		.description("manage personal directories that grant project registration");
	const dataDirectory = { name: "--data-dir", type: "Directory", description: "Required option on backlog server" };
	const jsonOption = { name: "--json", type: "Boolean", description: "Print schemaVersion 1 JSON" };
	addHelpSchema(areas.command("list"), {
		required: [dataDirectory],
		optional: [jsonOption, { name: "--user", type: "String", description: "Only this user's areas" }],
		reads: "Canonical personal folder areas in server.sqlite",
		writes: "None; does not create or upgrade the database",
		output: "schemaVersion: 1, kind: server-folder-area-list, areas: {id,userId,rootPath,createdAt}[]",
		examples: ["backlog server --data-dir ./server-data folder-area list --json"],
	})
		.description("list personal folder areas")
		.option("--user <id>", "filter by permanent user ID")
		.option("--json", "print versioned JSON output")
		.action((options: { user?: string; json?: boolean }) => {
			const records = store().listFolderAreas(options.user);
			if (options.json) printJson({ schemaVersion: 1, kind: "server-folder-area-list", areas: records });
			else if (records.length) for (const area of records) printFolderArea(area);
			else console.log("No personal folder areas assigned.");
		});
	addHelpSchema(areas.command("set <userId> <path>"), {
		required: [dataDirectory, { name: "userId", type: "String" }, { name: "path", type: "Directory" }],
		optional: [jsonOption],
		reads: "Current account and canonical existing directory; different users' areas must not overlap",
		writes:
			"Upsert personal folder area in server.sqlite; grants registration within the directory and its descendants",
		output: "schemaVersion: 1, kind: server-folder-area, area: {id,userId,rootPath,createdAt}",
		examples: ["backlog server --data-dir ./server-data folder-area set <userId> /srv/projects/member --json"],
	})
		.description("assign an existing personal directory to a user")
		.option("--json", "print versioned JSON output")
		.action(async (userId: string, path: string, options: { json?: boolean }) => {
			const area = await store().upsertFolderArea(userId, path, undefined, localAudit(server, "folder_area.upsert"));
			if (options.json) printJson({ schemaVersion: 1, kind: "server-folder-area", area });
			else printFolderArea(area);
		});
	addHelpSchema(areas.command("remove <id>"), {
		required: [dataDirectory, { name: "id", type: "String", description: "Folder area ID" }],
		optional: [jsonOption],
		reads: "Folder area in server.sqlite",
		writes: "Remove registration permission only; existing project memberships are preserved",
		output: "schemaVersion: 1, kind: server-folder-area-remove, id",
		examples: ["backlog server --data-dir ./server-data folder-area remove <id> --json"],
	})
		.description("remove a personal folder area without removing project memberships")
		.option("--json", "print versioned JSON output")
		.action((id: string, options: { json?: boolean }) => {
			store().removeFolderArea(id, undefined, localAudit(server, "folder_area.remove"));
			if (options.json) printJson({ schemaVersion: 1, kind: "server-folder-area-remove", id });
			else console.log(`Removed folder area ${id}.`);
		});
}

function booleanOption(value: string): boolean {
	if (value !== "true" && value !== "false") throw new Error("Boolean values must be true or false.");
	return value === "true";
}

function printUser(user: ServerUser, json?: boolean): void {
	if (json) printJson({ schemaVersion: 1, kind: "server-user", user });
	else
		console.log(
			`${user.id} - ${user.username}\n  Name: ${user.displayName}\n  Role: ${user.role}\n  Active: ${user.active}\n  Password change required: ${user.mustChangePassword}`,
		);
}

function printMember(member: ProjectMember, json?: boolean): void {
	if (json) printJson({ schemaVersion: 1, kind: "server-project-member", member });
	else
		console.log(
			`${member.projectId} - ${member.userId}\n${PERMISSION_NAMES.map((key) => `  ${key}: ${member.permissions[key]}`).join("\n")}`,
		);
}

function registerAccountCommands(server: Command, projects: Command): void {
	const store = () => new AuthStore(server.opts<{ dataDir: string }>().dataDir);
	const users = server.command("user").description("manage central accounts without exposing passwords in arguments");
	const dataDirectory = { name: "--data-dir", type: "Directory", description: "Required option on backlog server" };
	const jsonOption = { name: "--json", type: "Boolean", description: "Print schemaVersion 1 JSON" };
	const passwordOption = {
		name: "--password-stdin",
		type: "Boolean",
		description: "Read the password from stdin instead of a hidden terminal prompt; preserve spaces",
	};
	const userId = { name: "id", type: "String", description: "Persistent user ID" };
	const userOutput =
		"User id, username, displayName, role, active, mustChangePassword; password summaries are never printed. JSON kind: server-user";
	for (const command of ["init-admin", "create"] as const) {
		const create = addHelpSchema(users.command(`${command} <username>`), {
			required: [
				dataDirectory,
				{
					name: "username",
					type: "String",
					description: "Immutable normalized 3–64 character username: a-z, 0-9, period, underscore, hyphen",
				},
			],
			optional: [
				jsonOption,
				passwordOption,
				{ name: "--display-name", type: "String", description: "Unicode display name" },
				...(command === "create"
					? [{ name: "--role", type: "admin | user", description: "Account role; default user" }]
					: []),
			],
			reads: "Existing accounts in <data-dir>/server.sqlite; password length is 15–128 characters",
			writes:
				command === "init-admin"
					? "Initial admin only when no accounts exist; additive database upgrade"
					: "New active account; password change required on first login",
			output: userOutput,
			examples: [`backlog server --data-dir ./server-data user ${command} example --password-stdin --json`],
		})
			.description(
				command === "init-admin"
					? "initialize the first admin once; use reset-password for recovery"
					: "create an account that must change its initial password",
			)
			.option("--display-name <name>", "Unicode display name (defaults to username)")
			.option("--password-stdin", "read password from stdin; preserve spaces")
			.option("--json", "print versioned JSON output");
		if (command === "create") create.option("--role <role>", "account role: admin or user", "user");
		create.action(
			async (
				loginName: string,
				options: { displayName?: string; role?: ServerUser["role"]; passwordStdin?: boolean; json?: boolean },
			) => {
				const password = await readPassword(options);
				const account =
					command === "init-admin"
						? await store().initializeAdmin(
								loginName,
								password,
								options.displayName,
								localAudit(server, "user.init_admin", { status: 201 }),
							)
						: await store().createUser(
								{
									username: loginName,
									password,
									displayName: options.displayName,
									role: options.role,
								},
								localAudit(server, "user.create", { status: 201 }),
							);
				printUser(account, options.json);
			},
		);
	}
	addHelpSchema(users.command("list"), {
		required: [dataDirectory],
		optional: [jsonOption],
		reads: "Accounts in server.sqlite",
		writes: "None; does not create or upgrade the database",
		output: "schemaVersion: 1, kind: server-user-list, users: array",
		examples: ["backlog server --data-dir ./server-data user list --json"],
	})
		.description("list accounts without password summaries")
		.option("--json", "print versioned JSON output")
		.action((options: { json?: boolean }) => {
			const records = store().listUsers();
			if (options.json) printJson({ schemaVersion: 1, kind: "server-user-list", users: records });
			else if (!records.length) console.log("No server users configured.");
			else for (const user of records) printUser(user);
		});
	addHelpSchema(users.command("view <id>"), {
		required: [dataDirectory, userId],
		optional: [jsonOption],
		reads: "Account in server.sqlite",
		writes: "None; does not create or upgrade the database",
		output: userOutput,
		examples: ["backlog server --data-dir ./server-data user view <id> --json"],
	})
		.description("view an account by permanent ID")
		.option("--json", "print versioned JSON output")
		.action((id: string, options: { json?: boolean }) => {
			const user = store().loadUser(id);
			if (!user) throw new Error(`Server user "${id}" was not found.`);
			printUser(user, options.json);
		});
	addHelpSchema(users.command("edit <id>"), {
		required: [dataDirectory, userId],
		optional: [
			jsonOption,
			{ name: "--display-name", type: "String" },
			{ name: "--role", type: "admin | user" },
			{ name: "--active", type: "true | false" },
		],
		reads: "Account and active admin count in server.sqlite",
		writes: "Display name, role or active state; deactivation revokes all sessions; last active admin is protected",
		output: userOutput,
		examples: ["backlog server --data-dir ./server-data user edit <id> --active false --json"],
	})
		.description("change display name, role or active state; username stays immutable")
		.option("--display-name <name>", "Unicode display name")
		.option("--role <role>", "admin or user")
		.option("--active <boolean>", "true or false", booleanOption)
		.option("--json", "print versioned JSON output")
		.action(
			(id: string, options: { displayName?: string; role?: ServerUser["role"]; active?: boolean; json?: boolean }) => {
				printUser(store().editUser(id, options, localAudit(server, "user.edit")), options.json);
			},
		);
	addHelpSchema(users.command("reset-password <id>"), {
		required: [dataDirectory, userId],
		optional: [jsonOption, passwordOption],
		reads: "Account in server.sqlite; password from hidden terminal prompt or stdin",
		writes: "Argon2id password summary; revoke all sessions and require password change",
		output: userOutput,
		examples: ["backlog server --data-dir ./server-data user reset-password <id> --password-stdin --json"],
	})
		.description("reset a password and revoke every existing session")
		.option("--password-stdin", "read password from stdin; preserve spaces")
		.option("--json", "print versioned JSON output")
		.action(async (id: string, options: { passwordStdin?: boolean; json?: boolean }) => {
			printUser(
				await store().resetPassword(
					id,
					await readPassword(options),
					localAudit(server, "user.reset_password", { forceEvent: true }),
				),
				options.json,
			);
		});

	const members = projects
		.command("member")
		.description("manage project membership and individual operation permissions");
	const projectId = { name: "projectId", type: "Positive integer", description: "Persistent server project ID" };
	const memberUserId = { name: "userId", type: "String", description: "Persistent user ID" };
	addHelpSchema(members.command("list <projectId>"), {
		required: [dataDirectory, projectId],
		optional: [jsonOption],
		reads: "Project members and permissions in server.sqlite; admin automatically accesses every project",
		writes: "None; does not create or upgrade the database",
		output: "schemaVersion: 1, kind: server-project-member-list, members: array",
		examples: ["backlog server --data-dir ./server-data project member list 1 --json"],
	})
		.description("list explicit project memberships")
		.option("--json", "print versioned JSON output")
		.action((id: string, options: { json?: boolean }) => {
			const records = store().listMembers(id);
			if (options.json) printJson({ schemaVersion: 1, kind: "server-project-member-list", members: records });
			else if (!records.length) console.log("No explicit project members.");
			else for (const member of records) printMember(member);
		});
	const permissionOptions = PERMISSION_NAMES.map((key) => ({
		key,
		option: key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
	}));
	const set = addHelpSchema(members.command("set <projectId> <userId>"), {
		required: [dataDirectory, projectId, memberUserId],
		optional: [jsonOption, ...permissionOptions.map(({ option }) => ({ name: `--${option}`, type: "true | false" }))],
		reads: "Existing membership in server.sqlite; omitted permissions keep existing values",
		writes:
			"Create or update membership; new defaults: task/doc/decision writing true, decision management/archive/delete false",
		output: "schemaVersion: 1, kind: server-project-member, member: {projectId,userId,permissions}",
		examples: ["backlog server --data-dir ./server-data project member set 1 <userId> --archive true --json"],
	})
		.description("grant project read access and create or update operation permissions")
		.option("--json", "print versioned JSON output");
	for (const { key, option } of permissionOptions)
		set.option(`--${option} <boolean>`, `${key}: true or false`, booleanOption);
	set.action((id: string, userId: string, options: Partial<ProjectPermissions> & { json?: boolean }) => {
		const patch = Object.fromEntries(
			PERMISSION_NAMES.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]),
		) as Partial<ProjectPermissions>;
		printMember(store().setMember(id, userId, patch, localAudit(server, "membership.set")), options.json);
	});
	addHelpSchema(members.command("remove <projectId> <userId>"), {
		required: [dataDirectory, projectId, memberUserId],
		optional: [jsonOption],
		reads: "Project and account in server.sqlite",
		writes: "Remove explicit membership; admin access remains automatic",
		output: "schemaVersion: 1, kind: server-project-member-remove, projectId, userId",
		examples: ["backlog server --data-dir ./server-data project member remove 1 <userId> --json"],
	})
		.description("remove a normal user's project access")
		.option("--json", "print versioned JSON output")
		.action((projectId: string, userId: string, options: { json?: boolean }) => {
			store().removeMember(projectId, userId, localAudit(server, "membership.remove"));
			if (options.json) printJson({ schemaVersion: 1, kind: "server-project-member-remove", projectId, userId });
			else console.log(`Removed ${userId} from project ${projectId}.`);
		});
}

function registerHistoryCommands(server: Command): void {
	const store = () => new MutationStore(server.opts<{ dataDir: string }>().dataDir);
	const projectStore = () => new ProjectStore(server.opts<{ dataDir: string }>().dataDir);
	const dataDirectory = { name: "--data-dir", type: "Directory", description: "Required server data directory" };
	const jsonOption = { name: "--json", type: "Boolean", description: "Print schemaVersion 1 JSON" };
	const history = server.command("history").description("inspect durable central project and management events");
	addHelpSchema(history.command("list"), {
		required: [dataDirectory],
		optional: [
			jsonOption,
			{ name: "--project", type: "Positive integer", description: "Project history; omit for management history" },
			{ name: "--scope", type: "admin | registration", description: "Management history scope" },
			{ name: "--record-key", type: "String", description: "Only events touching this record key" },
			{ name: "--kind", type: "String", description: "Only events touching this record kind" },
			{ name: "--cursor", type: "String", description: "Cursor from the previous page" },
			{ name: "--limit", type: "Integer", description: "Page size from 1 to 100" },
		],
		reads: "Immutable history from server.sqlite; missing data is not created or upgraded",
		writes: "None",
		output: "UTC events and next cursor; JSON schemaVersion 1, kind server-history-page",
		examples: ["backlog server --data-dir ./server-data history list --project 1 --json"],
	})
		.description("list a page of project or management history")
		.option("--project <id>", "registered project ID")
		.option("--scope <scope>", "management scope: admin or registration")
		.option("--record-key <key>", "only one record key")
		.option("--kind <kind>", "only one record kind")
		.option("--from <timestamp>", "inclusive ISO timestamp")
		.option("--until <timestamp>", "exclusive ISO timestamp")
		.option("--actor <userId>", "user ID (includes their agents), or unknown")
		.option("--action <action>", "exact history action")
		.option("--source <source>", "browser, server-cli, agent, external, recovery or baseline")
		.option("--cursor <cursor>", "cursor from a previous page")
		.option("--limit <count>", "page size, 1–100", "50")
		.option("--json", "print versioned JSON output")
		.action(
			(options: {
				project?: string;
				scope?: string;
				recordKey?: string;
				kind?: string;
				cursor?: string;
				limit: string;
				json?: boolean;
				from?: string;
				until?: string;
				actor?: string;
				action?: string;
				source?: import("../server/mutation-types.ts").MutationSource;
			}) => {
				if (options.project && options.scope) throw new Error("Use either --project or --scope.");
				if (options.project && !projectStore().load(options.project))
					throw new Error(`Server project ${options.project} was not found.`);
				if (options.scope && options.scope !== "admin" && options.scope !== "registration")
					throw new Error("--scope must be admin or registration.");
				const scope: MutationScope = options.project
					? { kind: "project", projectId: options.project }
					: options.scope === "registration"
						? { kind: "registration" }
						: { kind: "admin" };
				const kinds: HistoryKind[] = [
					"task",
					"document",
					"decision",
					"milestone",
					"config",
					"user",
					"membership",
					"folder-area",
					"project",
					"agent-key",
				];
				if (options.kind && !kinds.includes(options.kind as HistoryKind)) throw new Error("Unknown history kind.");
				const page = store().listHistory({
					scope,
					...(options.from && { from: options.from }),
					...(options.until && { until: options.until }),
					...(options.actor && { actor: options.actor }),
					...(options.action && { action: options.action }),
					...(options.source && { source: options.source }),
					...(options.recordKey && { recordKey: options.recordKey }),
					...(options.kind && { kind: options.kind as HistoryKind }),
					...(options.cursor && { cursor: options.cursor }),
					limit: Number(options.limit),
				});
				if (options.json) printJson({ schemaVersion: 1, kind: "server-history-page", scope, ...page });
				else {
					for (const event of page.items) {
						const actor =
							event.actor.kind === "user"
								? event.actor.userId
								: event.actor.kind === "agent"
									? `agent ${event.actor.agentKeyId} (user ${event.actor.userId})`
									: "unknown";
						console.log(`${formatEventTime(event.occurredAt)}  ${event.action}  ${actor}  ${event.operationId}`);
						if (event.detectedAt) console.log(`  Detected: ${formatEventTime(event.detectedAt)}`);
						for (const change of event.changes)
							console.log(`  ${change.kind} ${change.visibleId} (${change.recordKey})`);
					}
					if (!page.items.length) console.log("No history events.");
					if (page.nextCursor) console.log(`Next cursor: ${page.nextCursor}`);
				}
			},
		);

	const operations = server.command("operation").description("inspect durable central operation results");
	addHelpSchema(operations.command("view <operationId>"), {
		required: [dataDirectory, { name: "operationId", type: "UUID", description: "Operation ID" }],
		optional: [jsonOption],
		reads: "Safe operation state and result from server.sqlite; no physical file bytes",
		writes: "None; missing data is not created or upgraded",
		output: "Operation state, actor, scope, and safe result; JSON schemaVersion 1, kind server-operation",
		examples: ["backlog server --data-dir ./server-data operation view <uuid> --json"],
	})
		.description("view one operation without revealing raw recovery file bytes")
		.option("--json", "print versioned JSON output")
		.action((operationId: string, options: { json?: boolean }) => {
			const operation = store().loadOperation(operationId, { actor: { kind: "unknown" }, admin: true });
			if (!operation) throw new Error(`Operation ${operationId} was not found.`);
			if (options.json) printJson({ schemaVersion: 1, kind: "server-operation", operation });
			else {
				console.log(`${operation.operationId} - ${operation.state}`);
				console.log(
					`  Scope: ${operation.scope.kind}${operation.scope.kind === "project" ? ` ${operation.scope.projectId}` : ""}`,
				);
				console.log(`  Actor: ${operation.actor.kind === "user" ? operation.actor.userId : "unknown"}`);
				console.log(`  Source: ${operation.source}`);
				console.log(`  Started: ${formatEventTime(operation.createdAt)}`);
				if (operation.result) console.log(`  HTTP status: ${operation.result.status}`);
				if (operation.error) console.log(`  Result: ${operation.error.code} - ${operation.error.message}`);
				if (operation.resolvedBy) console.log(`  Resolved by: ${operation.resolvedBy}`);
			}
		});
}

function formatRecovery(report: RecoveryReport): string {
	const lines = [
		`${report.operationId} - ${report.state} (project ${report.projectId})`,
		`  Action: ${report.action}`,
		`  Started: ${formatEventTime(report.createdAt)}`,
		`  Observed: ${report.classification}`,
		`  Fingerprint: ${report.fingerprint ?? "unavailable"}`,
	];
	if (report.issue) lines.push(`  Issue: ${report.issue}`);
	for (const file of report.files) {
		const describe = (entry: typeof file.before | null) => {
			if (entry === null) return "unreadable";
			if (entry.type === "absent") return "absent";
			if (entry.type === "file") return `file ${entry.bytes} bytes sha256 ${entry.sha256}`;
			return `symlink -> ${entry.target} sha256 ${entry.sha256}`;
		};
		lines.push(`  ${file.path}`);
		lines.push(`    Before: ${describe(file.before)}`);
		lines.push(`    After: ${describe(file.after)}`);
		lines.push(`    Observed: ${describe(file.observed)}`);
	}
	return lines.join("\n");
}

function registerRecoveryCommands(server: Command): void {
	const dataDir = () => server.opts<{ dataDir: string }>().dataDir;
	const dataDirectory = { name: "--data-dir", type: "Directory", description: "Required server data directory" };
	const jsonOption = { name: "--json", type: "Boolean", description: "Print schemaVersion 1 JSON" };
	const operationId = { name: "operationId", type: "UUID", description: "Unresolved operation ID" };
	const recovery = server.command("recovery").description("inspect and resolve interrupted central project writes");
	addHelpSchema(recovery.command("list"), {
		required: [dataDirectory],
		optional: [jsonOption],
		reads: "Unresolved intents, safe path snapshots, and current registered project files",
		writes: "None; does not create or upgrade server data",
		output: "Project-scoped unresolved reports and fingerprints; JSON schemaVersion 1, kind server-recovery-list",
		examples: ["backlog server --data-dir ./server-data recovery list --json"],
	})
		.description("list pending and recovery-required project operations")
		.option("--json", "print versioned JSON output")
		.action(async (options: { json?: boolean }) => {
			const items = await listRecovery(dataDir());
			if (options.json) printJson({ schemaVersion: 1, kind: "server-recovery-list", items });
			else console.log(items.length ? items.map(formatRecovery).join("\n\n") : "No unresolved project operations.");
		});
	addHelpSchema(recovery.command("view <operationId>"), {
		required: [dataDirectory, operationId],
		optional: [jsonOption],
		reads: "One unresolved intent and its current physical paths; file bytes are not printed",
		writes: "None; does not create or upgrade server data",
		output: "Before, intended after, observed state, and fingerprint; JSON schemaVersion 1, kind server-recovery",
		examples: ["backlog server --data-dir ./server-data recovery view <uuid> --json"],
	})
		.description("inspect an unresolved operation and its observed files")
		.option("--json", "print versioned JSON output")
		.action(async (id: string, options: { json?: boolean }) => {
			const report = await viewRecovery(dataDir(), id);
			if (options.json) printJson({ schemaVersion: 1, kind: "server-recovery", report });
			else console.log(formatRecovery(report));
		});
	addHelpSchema(recovery.command("resolve <operationId>"), {
		required: [
			dataDirectory,
			operationId,
			{ name: "--accept-observed", type: "Boolean", description: "Explicitly accept the reviewed current files" },
			{ name: "--expected-fingerprint", type: "SHA-256", description: "Fingerprint printed by recovery view" },
		],
		optional: [jsonOption],
		reads: "Current fingerprint, project boundary, parser, record identities, and other unresolved operations",
		writes:
			"A separate recovery event and record snapshot in server.sqlite; the interrupted operation stays unsuccessful",
		output: "Recovery operation and accepted report; JSON schemaVersion 1, kind server-recovery-resolution",
		examples: [
			"backlog server --data-dir ./server-data recovery resolve <uuid> --accept-observed --expected-fingerprint <sha256> --json",
		],
	})
		.description("accept a reviewed physical state as a separate recovery event")
		.requiredOption("--expected-fingerprint <sha256>", "fingerprint shown by recovery view")
		.option("--accept-observed", "explicitly accept the reviewed current files")
		.option("--json", "print versioned JSON output")
		.action(async (id: string, options: { expectedFingerprint: string; acceptObserved?: boolean; json?: boolean }) => {
			if (!options.acceptObserved) throw new Error("--accept-observed is required to resolve a recovery operation.");
			const result = await resolveRecovery(dataDir(), id, options.expectedFingerprint);
			if (options.json) printJson({ schemaVersion: 1, kind: "server-recovery-resolution", ...result });
			else
				console.log(
					`Accepted observed files for ${id} as recovery operation ${result.operation.operationId}. The interrupted operation remains unsuccessful.`,
				);
		});
}
