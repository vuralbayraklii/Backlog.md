import type { Command } from "commander";
import { printJson } from "../formatters/json-output.ts";
import { CentralServer } from "../server/central.ts";
import { ProjectStore, type ServerProject } from "../server/project-store.ts";
import { addHelpSchema } from "./help-schema.ts";

function formatProject(project: ServerProject): string {
	return `${project.id} - ${project.name}\n  Root: ${project.rootPath}\n  Registered: ${project.createdAt}`;
}

function printProject(project: ServerProject, json?: boolean): void {
	if (json) printJson({ schemaVersion: 1, kind: "server-project", project });
	else console.log(formatProject(project));
}

export function registerServerCommand(program: Command): void {
	const server = program
		.command("server")
		.description("manage central Backlog.md server data")
		.requiredOption("--data-dir <directory>", "directory containing server.sqlite (required; no default)")
		.addHelpText("after", "\nPaths are relative to the terminal working directory. BACKLOG_CWD is not used.");
	addHelpSchema(server.command("start"), {
		required: [{ name: "--data-dir", type: "Directory", description: "Server data directory" }],
		optional: [
			{ name: "--port", type: "Integer", description: "Listening port; default 6420" },
			{ name: "--open", type: "Boolean", description: "Open the project selector in a browser" },
		],
		reads: "Project bindings from <data-dir>/server.sqlite; absent database means no registered projects",
		writes: "No project files at startup",
		output: "Local server URL at 127.0.0.1; Ctrl+C stops the listener",
		examples: ["backlog server --data-dir ./server-data start --port 6420"],
	})
		.description("start the central project server on this machine only")
		.option("--port <port>", "port to listen on", "6420")
		.option("--open", "open a browser after starting")
		.action(async (options: { port: string; open?: boolean }) => {
			const port = Number(options.port);
			const central = new CentralServer(server.opts<{ dataDir: string }>().dataDir);
			try {
				await central.start(port, options.open ?? false);
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
	const recordOutput = "Server project: id (string), name, rootPath (canonical absolute path), createdAt (UTC)";

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
}
