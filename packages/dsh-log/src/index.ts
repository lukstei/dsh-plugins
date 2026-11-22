import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { format } from "node:util";
import type { Context, Exporter, Message } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";

export const name = "file-log";

export type LogMessage = Message;

export type Output = {
	/** Cordis per-logger minimum severity; -1 silences a logger. */
	levels: Record<string, number>;
} & ({ target: "stdout" } | { target: "file"; filePath: string });

export interface Config {
	outputs: Output[];
}

const levels = Schema.dict(Schema.number()).description(
	"Log severity per logger name; `default` is the catch-all, -1 silences.",
);

export const Config: Schema<Config> = Schema.object({
	outputs: Schema.array(
		Schema.union([
			Schema.object({
				target: Schema.const("stdout").required(),
				levels: levels.required(),
			}),
			Schema.object({
				target: Schema.const("file").required(),
				filePath: Schema.string()
					.required()
					.description("Log file path; a leading `~` expands to home."),
				levels: levels.required(),
			}),
		]),
	).description("Destinations; each receives the loggers its levels admit."),
});

export function formatMessage(message: LogMessage): string {
	const ts = new Date(message.ts).toISOString();
	const type = String(message.type).toUpperCase().padEnd(5);
	const text = format(...message.args);
	return `${ts} [${type}] [${message.name}] ${text}\n`;
}

export function expandHome(filePath: string): string {
	return filePath === "~" || filePath.startsWith("~/")
		? path.join(homedir(), filePath.slice(1))
		: filePath;
}

export function createFileWriter(rawPath: string): (content: string) => void {
	const filePath = expandHome(rawPath);
	let dirEnsured = false;

	return (content: string) => {
		try {
			if (!dirEnsured) {
				mkdirSync(path.dirname(filePath), { recursive: true });
				dirEnsured = true;
			}
			appendFileSync(filePath, content, "utf8");
		} catch {
			// edge case: disk write failures must not throw or cause recursive logger crashes
		}
	};
}

export function apply(ctx: Context, config: Config): void {
	for (const output of config.outputs) {
		const write =
			output.target === "stdout"
				? (line: string) => process.stdout.write(line)
				: createFileWriter(output.filePath);
		const exporter: Exporter = {
			colors: false,
			levels: output.levels,
			export: (message) => write(formatMessage(message)),
		};
		ctx.logger.exporter(exporter);
	}
}
