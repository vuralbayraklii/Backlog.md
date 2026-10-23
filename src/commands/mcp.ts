/**
 * MCP Command Group - Model Context Protocol CLI commands.
 *
 * This simplified command set focuses on the stdio transport, which is the
 * only supported transport for Backlog.md's local MCP integration.
 */

import type { Command } from "commander";
import { isConfigValueError } from "../file-system/operations.ts";
import { createConnectedMcpServer } from "../mcp/connected.ts";
import { createMcpServer } from "../mcp/server.ts";
import { hasServerConnection, type ServerConnectionOptions } from "../server/client.ts";
import { findBacklogRoot } from "../utils/find-backlog-root.ts";
import { resolveRuntimeCwd } from "../utils/runtime-cwd.ts";

type StartOptions = {
	debug?: boolean;
	cwd?: string;
};

/**
 * Register MCP command group with CLI program.
 *
 * @param program - Commander program instance
 */
export function registerMcpCommand(program: Command): void {
	const mcpCmd = program.command("mcp");
	registerStartCommand(mcpCmd);
}

/**
 * Register 'mcp start' command for stdio transport.
 */
function registerStartCommand(mcpCmd: Command): void {
	mcpCmd
		.command("start")
		.description("Start the MCP server using stdio transport")
		.option("-d, --debug", "Enable debug logging", false)
		.option("--cwd <path>", "Directory to resolve Backlog root from (overrides BACKLOG_CWD)")
		.action(async (options: StartOptions, command: Command) => {
			try {
				let server: Awaited<ReturnType<typeof createMcpServer>> | Awaited<ReturnType<typeof createConnectedMcpServer>>;
				if (hasServerConnection(process.argv.slice(2))) {
					server = await createConnectedMcpServer(command.optsWithGlobals<ServerConnectionOptions>());
				} else {
					const runtimeCwd = await resolveRuntimeCwd({ cwd: options.cwd });
					const projectRoot = (await findBacklogRoot(runtimeCwd.cwd)) ?? runtimeCwd.cwd;
					// An explicit --cwd/BACKLOG_CWD pins the root; an inferred process.cwd()
					// lets the server follow the client's workspace roots instead.
					const pinned = runtimeCwd.source !== "process";
					server = await createMcpServer(projectRoot, { debug: options.debug, pinned });
					if (options.debug && runtimeCwd.source !== "process") {
						console.error(`Using MCP start directory from ${runtimeCwd.sourceLabel}: ${runtimeCwd.cwd}`);
					}
				}

				await server.connect();
				await server.start();

				if (options.debug) {
					console.error("Backlog.md MCP server started (stdio transport)");
				}

				let shutdownTriggered = false;
				const shutdown = async (signal: string) => {
					if (shutdownTriggered) {
						return;
					}
					shutdownTriggered = true;
					if (options.debug) {
						console.error(`Received ${signal}, shutting down MCP server...`);
					}

					try {
						await server.stop();
						process.exit(0);
					} catch (error) {
						console.error("Error during MCP server shutdown:", error);
						process.exit(1);
					}
				};

				const handleStdioClose = () => shutdown("stdio");
				process.stdin.once("end", handleStdioClose);
				if (process.platform !== "win32") {
					// On Windows, stdin can emit "close" while the MCP stdio pipe is still usable.
					process.stdin.once("close", handleStdioClose);
				}

				const handlePipeError = (error: unknown) => {
					const code =
						error && typeof error === "object" && "code" in error
							? String((error as { code?: string }).code ?? "")
							: "";
					if (code === "EPIPE") {
						void shutdown("EPIPE");
					}
				};
				process.stdout.once("error", handlePipeError);
				process.stderr.once("error", handlePipeError);

				process.once("SIGINT", () => shutdown("SIGINT"));
				process.once("SIGTERM", () => shutdown("SIGTERM"));
				if (process.platform !== "win32") {
					process.once("SIGHUP", () => shutdown("SIGHUP"));
					process.once("SIGPIPE", () => shutdown("SIGPIPE"));
				}
			} catch (error) {
				// A config value Backlog refuses to read already names the file, the key, and the fix,
				// so it is reported as written instead of behind a startup summary.
				if (isConfigValueError(error)) {
					console.error(error.message);
				} else {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`Failed to start MCP server: ${message}`);
				}
				process.exit(1);
			}
		});
}
