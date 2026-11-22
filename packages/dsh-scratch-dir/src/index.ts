import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-working-directory";

export const name = "scratch-dir";
export const inject = ["systemPrompt", "workingDirectory"];

const SECTION_NAME = "lukstei-dsh-plugins:scratch-directory";
const SECTION_ORDER = 10300;
const GITIGNORE = "*\n";

export function scratchDirectory(
	cwd: string,
	sessionId: string,
): string | undefined {
	const root = path.resolve(cwd, ".agents", "scratch");
	const dir = path.resolve(root, sessionId);
	if (path.dirname(dir) !== root) return undefined;
	return dir;
}

async function ensureScratchDirectory(
	cwd: string,
	sessionId: string,
): Promise<string | undefined> {
	const dir = scratchDirectory(cwd, sessionId);
	if (dir === undefined) return undefined;
	const root = path.dirname(dir);
	await mkdir(dir, { recursive: true });
	try {
		await writeFile(path.join(root, ".gitignore"), GITIGNORE, { flag: "wx" });
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			error.code !== "EEXIST"
		)
			throw error;
	}
	return dir;
}

export function apply(ctx: Context): void {
	const logger = ctx.logger("scratch-dir");
	ctx.on("agent/created", async ({ agent }): Promise<undefined> => {
		let dir: string | undefined;
		try {
			dir = await ensureScratchDirectory(
				ctx.workingDirectory.get(agent.session),
				String(agent.session.id),
			);
		} catch (error) {
			logger.warn(
				`scratch-dir: could not prepare directory for ${agent.id}: ${String(error)}`,
			);
			return undefined;
		}
		if (dir === undefined) {
			logger.warn(
				`scratch-dir: unsafe session id "${agent.id}"; no scratch directory created`,
			);
			return undefined;
		}
		agent.ctx.systemPrompt.section({
			name: SECTION_NAME,
			order: SECTION_ORDER,
			text: `The scratch directory is located at ${dir}.`,
			interpolate: false,
		});
	});
}
