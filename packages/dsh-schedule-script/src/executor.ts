import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempDisposable, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ScriptContext, ScriptResult } from "./types.ts";

const execFileAsync = promisify(execFile);

function resolveRunnerCliPath(): string {
	const direct = fileURLToPath(new URL("./runner-cli.ts", import.meta.url));
	if (existsSync(direct)) return direct;
	const fromDist = fileURLToPath(
		new URL("../src/runner-cli.ts", import.meta.url),
	);
	if (existsSync(fromDist)) return fromDist;
	return direct;
}

const RUNNER_CLI_PATH = resolveRunnerCliPath();

async function readRunnerOutput(
	outputPath: string,
): Promise<
	| { success: true; result: ScriptResult }
	| { success: false; error: string; stack?: string }
	| null
> {
	try {
		const rawOutput = await readFile(outputPath, "utf8");
		return JSON.parse(rawOutput);
	} catch (err: unknown) {
		if (
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			(err as NodeJS.ErrnoException).code === "ENOENT"
		) {
			return null;
		}
		throw err;
	}
}

export async function executeScript(
	scriptPath: string,
	ctx: ScriptContext,
	timeoutMs = 30000,
	cwd = process.cwd(),
	signal?: AbortSignal,
): Promise<ScriptResult> {
	await using tmp = await mkdtempDisposable(
		path.join(os.tmpdir(), "dsh-script-"),
	);
	const inputPath = path.join(tmp.path, "input.json");
	const outputPath = path.join(tmp.path, "output.json");

	await writeFile(inputPath, JSON.stringify(ctx), "utf8");

	try {
		await execFileAsync(
			process.execPath,
			[RUNNER_CLI_PATH, scriptPath, inputPath, outputPath],
			{
				signal,
				timeout: timeoutMs,
				cwd,
				env: { ...process.env },
			},
		);

		const data = await readRunnerOutput(outputPath);
		if (!data || !data.success) {
			throw new Error(data?.error ?? "Runner failed to produce output");
		}

		return data.result;
	} catch (error: unknown) {
		const fallbackOutput = await readRunnerOutput(outputPath).catch(() => null);
		if (fallbackOutput && !fallbackOutput.success && fallbackOutput.error) {
			const err = new Error(fallbackOutput.error, { cause: error });
			if (fallbackOutput.stack) {
				err.stack = fallbackOutput.stack;
			}
			throw err;
		}

		if (error instanceof Error) {
			if ("killed" in error && (error as { killed?: boolean }).killed) {
				throw new Error(
					`Script execution timed out after ${timeoutMs}ms: ${scriptPath}`,
					{ cause: error },
				);
			}
			throw error;
		}
		throw new Error(String(error), { cause: error });
	}
}
