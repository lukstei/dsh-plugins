import { spawn } from "node:child_process";
import type { Context } from "@deepseek-ai/cordis";
import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import Schema from "@deepseek-ai/schemastery";

export const name = "debug";
export const inject = ["commands"];

export interface Config {
	readonly copy?: (text: string) => Promise<void>;
}

export const Config: Schema<Config> = Schema.object({
	copy: Schema.any().hidden(),
});

export function serializeEventsToJsonl(
	events: readonly SessionEvent[],
): string {
	if (events.length === 0) return "";
	return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

export function copyToClipboard(text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (process.platform !== "darwin") {
			// edge case: clipboard command differs outside macOS
			reject(
				new Error(
					`Clipboard copy is unsupported on ${process.platform}; expected darwin`,
				),
			);
			return;
		}

		const proc = spawn("pbcopy");
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`pbcopy exited with code ${code}`));
		});
		proc.stdin.write(text);
		proc.stdin.end();
	});
}

export function apply(ctx: Context, config?: Config): void {
	const copy = config && config.copy ? config.copy : copyToClipboard;

	ctx.commands.register({
		name: "copy-transcript",
		description: "Copy current session transcript (JSONL) to clipboard",
		handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
			// oxlint-disable-next-line typescript/no-deprecated -- reading live in-memory session snapshot
			const events = invocation.agent.session.snapshotEvents();
			if (events.length === 0) {
				// edge case: do not overwrite user clipboard when session has no events
				return {
					kind: "error",
					text: "Session contains no events to copy",
				};
			}

			const jsonl = serializeEventsToJsonl(events);
			try {
				await copy(jsonl);
				return {
					kind: "success",
					text: `Copied ${events.length} session events to clipboard`,
				};
			} catch (error: unknown) {
				return {
					kind: "error",
					text: `Failed to copy transcript: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},
	});

	ctx.commands.register({
		name: "copy-session-id",
		description: "Copy current session ID to clipboard",
		handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
			try {
				await copy(invocation.agent.session.id);
				return {
					kind: "success",
					text: "Copied session ID to clipboard",
				};
			} catch (error: unknown) {
				return {
					kind: "error",
					text: `Failed to copy session ID: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},
	});
}
