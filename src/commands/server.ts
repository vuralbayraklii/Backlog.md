import { isCancel, password as promptPassword } from "@clack/prompts";
import type { Command } from "commander";
import { printJson } from "../formatters/json-output.ts";
import { AuthStore } from "../server/auth-store.ts";
import {
	PERMISSION_NAMES,
	type ProjectMember,
	type ProjectPermissions,
	type ServerUser,
} from "../server/auth-types.ts";
import { CentralServer } from "../server/central.ts";
import { ProjectStore, type ServerProject } from "../server/project-store.ts";
import type { FolderArea, ProjectPreview } from "../server/registration-types.ts";
import { addHelpSchema } from "./help-schema.ts";

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

export function registerServerCommand(program: Command): void {
	const server = program
		.command("server")
		.description("manage central Backlog.md server data")
		.requiredOption("--data-dir <directory>", "directory containing server.sqlite (required; no default)")
		.addHelpText("after", "\nPaths are relative to the terminal working directory. BACKLOG_CWD is not used.");
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
		writes: "No project files at startup",
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
					allowHttpLoopback: options.allowHttpLoopback,
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
			printProject(await store().register(options.name, path), options.json);
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
			printProject(await store().setTracking(id, options.enabled), options.json);
		});
	registerAccountCommands(server, projects);
	registerFolderAreaCommands(server);
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
			const area = await store().upsertFolderArea(userId, path);
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
			store().removeFolderArea(id);
			if (options.json) printJson({ schemaVersion: 1, kind: "server-folder-area-remove", id });
			else console.log(`Removed folder area ${id}.`);
		});
}

function booleanOption(value: string): boolean {
	if (value !== "true" && value !== "false") throw new Error("Boolean values must be true or false.");
	return value === "true";
}

async function readPassword(options: { passwordStdin?: boolean }): Promise<string> {
	if (options.passwordStdin) {
		// Remove only the terminal line ending; spaces are part of the password.
		return (await Bun.stdin.text()).replace(/\r?\n$/, "");
	}
	if (!process.stdin.isTTY)
		throw new Error("A terminal is required for the hidden password prompt. Use --password-stdin.");
	const result = await promptPassword({ message: "Password", output: process.stderr });
	if (isCancel(result)) throw new Error("Password entry canceled.");
	return result;
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
						? await store().initializeAdmin(loginName, password, options.displayName)
						: await store().createUser({
								username: loginName,
								password,
								displayName: options.displayName,
								role: options.role,
							});
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
				printUser(store().editUser(id, options), options.json);
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
			printUser(await store().resetPassword(id, await readPassword(options)), options.json);
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
		printMember(store().setMember(id, userId, patch), options.json);
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
			store().removeMember(projectId, userId);
			if (options.json) printJson({ schemaVersion: 1, kind: "server-project-member-remove", projectId, userId });
			else console.log(`Removed ${userId} from project ${projectId}.`);
		});
}
