import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionCreateValue } from "@deepseek-ai/dsh-api-session-controller";
import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
	SessionLogSnapshot,
	SessionRecord,
} from "@deepseek-ai/dsh-session-query";
import type {} from "@deepseek-ai/dsh-session-title";
import type {} from "@deepseek-ai/dsh-working-directory";
import type { Workspace } from "@deepseek-ai/dsh-workspace";
import { scratchDirectory } from "@lukstei/dsh-scratch-dir";
import { handoffInstruction, renderHandoff } from "./handoff.ts";
import { formatLaunchResult } from "./launch.ts";

export const name = "session-handoff";
export const inject = [
	"commands",
	"sessionQuery",
	"workingDirectory",
	"sessionController",
	"sessionTitle",
	"workspaceRegistry",
];

const HANDOFF_FILE = "HANDOFF.md";
const RECENT_LIMIT = 5;
const SHORT_ID_LENGTH = 8;

export function apply(ctx: Context): void {
	ctx.commands.register({
		name: "handoff",
		description:
			"Hand this session off to a new one, or write the resume brief for <session-id> into this one",
		// edge case: without a declared input the client sends the raw line to the
		// model as a prompt and this handler never runs.
		input: { hint: "[session-id]" },
		handler: (invocation: CommandInvocation): Promise<CommandResult> =>
			handoff(ctx, invocation),
	});
}

export function resolveHandoffTarget(
	sessions: readonly SessionRecord[],
	query: string,
): readonly SessionRecord[] {
	const exact = sessions.filter(
		(session) => String(session.header.id) === query,
	);
	if (exact.length > 0) return exact;
	return sessions.filter((session) =>
		String(session.header.id).startsWith(query),
	);
}

async function handoff(
	ctx: Context,
	invocation: CommandInvocation,
): Promise<CommandResult> {
	const raw = invocation.rawInput.trim();
	// edge case: no id means "this session", the common case, so it skips the
	// session index entirely and reads the agent's own session.
	const launch = raw === "";
	const agent = invocation.agent;

	let targetId: SessionId;
	if (launch) {
		targetId = agent.session.id;
	} else {
		const sessions = await ctx.sessionQuery.listSessions(invocation.signal);
		const matches = resolveHandoffTarget(sessions, raw);
		if (matches.length === 0) {
			const recent = sessions
				.slice(0, RECENT_LIMIT)
				.map((session) => `- ${String(session.header.id)}`)
				.join("\n");
			return {
				kind: "error",
				text: `No session matches "${raw}". Most recent sessions:\n${recent}`,
			};
		}
		if (matches.length > 1) {
			const candidates = matches
				.map((session) => `- ${String(session.header.id)}`)
				.join("\n");
			return { kind: "error", text: `"${raw}" is ambiguous:\n${candidates}` };
		}
		targetId = matches[0].header.id;
		if (targetId === agent.session.id) {
			return {
				kind: "error",
				text: "That is this session; there is nothing to hand off.",
			};
		}
	}

	try {
		const snapshot = await ctx.sessionQuery.readSession(targetId);
		const rendered = renderHandoff(snapshot);
		if (rendered.turns === 0) {
			return {
				kind: "error",
				text: launch
					? "This session has no turns to hand off."
					: `Session ${shortId(targetId)} has no turns to hand off.`,
			};
		}
		if (launch) {
			const created = await createBeside(
				ctx,
				agent,
				targetId,
				rendered.markdown,
				snapshot,
				invocation.signal,
			);
			return {
				kind: "success",
				text: formatLaunchResult(created.sessionId),
			};
		}

		const file = await deliver(ctx, agent, targetId, rendered.markdown);
		return {
			kind: "success",
			text: `Handoff for ${shortId(targetId)} (${rendered.turns} turns) → ${file}`,
		};
	} catch (error: unknown) {
		return {
			kind: "error",
			text: `Handoff failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Write the brief into the agent's own scratch directory and queue the follow-up
 * turn that tells it to read that file.
 * @param ctx - Host context.
 * @param agent - Agent that receives the brief and the follow-up.
 * @param targetId - Durable id of the handed-off session.
 * @param markdown - Rendered brief.
 * @returns absolute path of the written brief.
 */
async function deliver(
	ctx: Context,
	agent: Agent,
	targetId: string,
	markdown: string,
): Promise<string> {
	const dir = scratchDirectory(
		ctx.workingDirectory.get(agent.session),
		String(agent.session.id),
	);
	if (dir === undefined) {
		throw new Error(
			`Unsafe session id "${String(agent.session.id)}"; no handoff written.`,
		);
	}
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, HANDOFF_FILE);
	await writeFile(file, markdown, "utf8");
	agent.followup(
		createUserMessage({
			content: [
				{
					type: "text",
					text: handoffInstruction(targetId, file),
				},
			],
			source: { kind: "user" },
		}),
	);
	return file;
}

function workspaceOf(
	ctx: Context,
	sessionId: SessionId,
): Workspace | undefined {
	for (const workspace of ctx.workspaceRegistry.list()) {
		if (workspace.sessionIds.includes(sessionId)) return workspace;
	}
	return undefined;
}

function kanbanLinkArgs(snapshot: SessionLogSnapshot): string[] {
	const all: string[] = [];
	for (const event of snapshot.events) {
		if (event.type !== "command/run" || event.data.name !== "kanban") continue;
		const args = event.data.args;
		if (args === undefined) continue;
		try {
			const parsed: unknown = JSON.parse(args);
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				"action" in parsed &&
				parsed.action === "add-link"
			)
				all.push(args);
		} catch {
			// edge case: non-JSON kanban args carry no link
		}
	}
	return all;
}

function shortId(id: string): string {
	return id.slice(0, SHORT_ID_LENGTH);
}

/**
 * Create the resumed session beside this one: same workspace, same preset, same
 * model, the brief in its own scratch directory, and one follow-up turn that
 * tells it to read that brief.
 * @param ctx - Host context.
 * @param source - Session the command runs in.
 * @param targetId - Durable id of the handed-off session.
 * @param markdown - Rendered brief.
 * @param snapshot - Source session log, the origin of the kanban links to copy.
 * @param signal - Cancellation signal of the invoking command.
 * @returns the created session identity.
 */
async function createBeside(
	ctx: Context,
	source: Agent,
	targetId: string,
	markdown: string,
	snapshot: SessionLogSnapshot,
	signal: AbortSignal,
): Promise<SessionCreateValue> {
	const selection = source.model.current();
	const agentPreset = source.session.header.agentPreset;
	// edge case: a session created by cwd alone is attached to no workspace, so it
	// would stay out of the sidebar tree until the next Host start.
	const workspace = workspaceOf(ctx, source.session.id);
	const created = await ctx.sessionController.create(
		workspace === undefined
			? { cwd: ctx.workingDirectory.get(source.session), agentPreset }
			: { workspaceId: workspace.id, agentPreset },
	);
	const resolved = await ctx.sessionController.resolveAgent(created.sessionId);
	if ("error" in resolved) throw new Error(resolved.error.message);

	const agent = resolved.agent;
	// edge case: the fresh agent would otherwise start on the deployment default,
	// so the caller's selection is recorded before its first turn.
	if (selection !== undefined) agent.model.select(selection);

	// edge case: left to itself the session is titled from the first message it
	// receives, which is the handoff instruction, so every handoff reads "Handoff
	// brief"; a user title pins the derived one against automatic generation.
	const sourceTitle = ctx.sessionTitle.get(source.session);
	ctx.sessionTitle.rename(
		agent.session,
		sourceTitle === undefined
			? `Handoff ${shortId(targetId)}`
			: `${sourceTitle.title} - Handoff`,
	);

	// edge case: a session the controller creates carries no kanban marker, so the
	// board would never list it; this is the init kanban's own client sends.
	await ctx.commands.execute(
		agent,
		`/kanban ${JSON.stringify({ action: "init", createdAt: Date.now() })}`,
		[],
		signal,
	);

	// Replaying the source's add-link commands in order reproduces its link set,
	// since the kanban fold dedupes by url.
	for (const args of kanbanLinkArgs(snapshot)) {
		await ctx.commands.execute(agent, `/kanban ${args}`, [], signal);
	}

	await deliver(ctx, agent, targetId, markdown);
	return created;
}
