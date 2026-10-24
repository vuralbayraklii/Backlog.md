import type { Command } from "commander";
import { printJson } from "../formatters/json-output.ts";
import { ServerClient, type ServerConnectionOptions } from "../server/client.ts";
import { readPassword } from "../utils/password-input.ts";

export function installAuthCommands(program: Command): void {
	const auth = program.command("auth").description("use a human server session stored outside the project");
	for (const action of ["login", "password", "logout"] as const) {
		const command = auth.command(action).option("--json", "print safe session metadata");
		if (action === "login")
			command.requiredOption("--username <name>").option("--password-stdin", "read password from stdin");
		if (action === "password")
			command.option("--passwords-stdin", "read JSON containing currentPassword and newPassword from stdin");
		command.action(async (options) => {
			let body: unknown;
			if (action === "login") body = { username: options.username, password: await readPassword(options) };
			if (action === "password") {
				if (options.passwordsStdin) {
					try {
						body = JSON.parse(await Bun.stdin.text());
					} catch {
						throw new Error("Password input must be JSON containing currentPassword and newPassword.");
					}
				} else
					body = {
						currentPassword: await readPassword({ message: "Current password" }),
						newPassword: await readPassword({ message: "New password" }),
					};
			}
			const session = await ServerClient.auth(program.opts<ServerConnectionOptions>(), action, body);
			if (options.json)
				printJson({
					schemaVersion: 1,
					kind: "server-session",
					user: session?.user ?? null,
					expiresAt: session?.expiresAt ?? null,
				});
			else
				console.log(
					session
						? `Signed in as ${session.user.username}${session.user.mustChangePassword ? "; change your password with auth password before using project commands." : ""}`
						: "Signed out.",
				);
		});
	}
}
