import { isCancel, password as promptPassword } from "@clack/prompts";

export async function readPassword(options: { passwordStdin?: boolean; message?: string }): Promise<string> {
	if (options.passwordStdin) return (await Bun.stdin.text()).replace(/\r?\n$/, "");
	if (!process.stdin.isTTY)
		throw new Error("A terminal is required for the hidden password prompt. Use --password-stdin.");
	const result = await promptPassword({ message: options.message ?? "Password", output: process.stderr });
	if (isCancel(result)) throw new Error("Password entry canceled.");
	return result;
}
