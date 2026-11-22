import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ScriptContext } from "./types.ts";

async function run(): Promise<void> {
	const [, , scriptPath, inputPath, outputPath] = process.argv;
	if (!scriptPath || !inputPath || !outputPath) {
		console.error("Usage: runner-cli.ts <scriptPath> <inputPath> <outputPath>");
		process.exit(2);
	}

	try {
		const rawInput = await readFile(inputPath, "utf8");
		const input = JSON.parse(rawInput) as ScriptContext;
		if (!("state" in input) || input.state === undefined) {
			throw new Error("Invalid script context: 'state' is mandatory");
		}

		const resolvedScript = path.resolve(process.cwd(), scriptPath);
		const mod = (await import(pathToFileURL(resolvedScript).href)) as {
			main?: (ctx: ScriptContext) => unknown;
		};

		if (typeof mod.main !== "function") {
			throw new Error(
				`Script '${scriptPath}' does not export a 'main' function`,
			);
		}

		const rawResult = await mod.main(input);
		if (
			typeof rawResult !== "object" ||
			rawResult === null ||
			!("state" in rawResult) ||
			rawResult.state === undefined
		) {
			throw new Error("Invalid script result: 'state' is mandatory");
		}
		if (
			"prompt" in rawResult &&
			rawResult.prompt !== undefined &&
			typeof rawResult.prompt !== "string"
		) {
			throw new Error("Invalid script result: 'prompt' must be a string");
		}
		if (
			"error" in rawResult &&
			rawResult.error !== undefined &&
			typeof rawResult.error !== "string"
		) {
			throw new Error("Invalid script result: 'error' must be a string");
		}
		if (
			"stop" in rawResult &&
			rawResult.stop !== undefined &&
			typeof rawResult.stop !== "boolean"
		) {
			throw new Error("Invalid script result: 'stop' must be a boolean");
		}
		const result = rawResult;

		await writeFile(outputPath, JSON.stringify({ success: true, result }));
		process.exit(0);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		const stack = error instanceof Error ? error.stack : undefined;
		try {
			await writeFile(
				outputPath,
				JSON.stringify({ success: false, error: message, stack }),
			);
		} catch {
			// ignore secondary write errors
		}
		console.error(stack ?? message);
		process.exit(1);
	}
}

void run();
