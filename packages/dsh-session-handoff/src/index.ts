import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent, ModelSelection } from "@deepseek-ai/dsh-agent";
import type { SessionCreateValue } from "@deepseek-ai/dsh-api-session-controller";
import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionLogSnapshot } from "@deepseek-ai/dsh-session-query";
import type {} from "@deepseek-ai/dsh-session-title";
import type {} from "@deepseek-ai/dsh-working-directory";
import type { Workspace } from "@deepseek-ai/dsh-workspace";
import Schema from "@deepseek-ai/schemastery";
import { scratchDirectory } from "@lukstei/dsh-scratch-dir";
import {
	handoffInstruction,
	parentSessionId,
	renderHandoff,
} from "./handoff.ts";
import { formatLaunchResult } from "./launch.ts";
import {
	CONFIG_GLOBAL,
	type LimitOverride,
	type LimitsConfig,
} from "./limits.ts";

export const name = "session-handoff";
export const inject = [
	"commands",
	"sessionQuery",
	"workingDirectory",
	"sessionController",
	"sessionTitle",
	"workspaceRegistry",
	"llm",
];

const HANDOFF_FILE = "HANDOFF.md";
const SHORT_ID_LENGTH = 8;
const RESUMED_SUFFIX = " (Resumed)";

const tokens = (what: string) =>
	Schema.natural().description(`${what} (tokens).`);

const limitOverride: Schema<LimitOverride> = Schema.object({
	warmSoft: tokens("Warm cache: context size that shows the amber ring"),
	warmStrong: tokens("Warm cache: context size that shows the red ring"),
	coldSoft: tokens("Cold cache: context size that shows the amber ring"),
	coldStrong: tokens("Cold cache: context size that shows the red ring"),
	cacheTtlMs: Schema.natural().description(
		"Idle milliseconds after which the provider's prompt cache counts as cold.",
	),
});

export const Config: Schema<LimitsConfig> = Schema.object({
	defaults: limitOverride.description("Applies to every model."),
	providers: Schema.dict(limitOverride).description(
		"Per provider id; overrides `defaults`.",
	),
	models: Schema.dict(limitOverride).description(
		'Per "provider/model"; overrides `providers`.',
	),
});

export function apply(ctx: Context, config: LimitsConfig): void {
	ctx.on("webserver/index-inject", (table) => {
		table.push({ kind: "global", name: CONFIG_GLOBAL, value: config });
	});
	ctx.commands.register({
		name: "handoff",
		description:
			"Hand this session off to a new one (bare: pick the model from a list)",
		// edge case: without a declared input the client sends the raw line to the
		// model as a prompt and this handler never runs.
		input: { hint: "[provider/model]" },
		handler: (invocation: CommandInvocation): Promise<CommandResult> =>
			handoff(ctx, invocation),
	});
}

/**
 * Split `provider/model` at the first slash: provider ids have none, model ids may.
 * @internal exported for the unit test only.
 */
export function parseModelArg(raw: string): ModelSelection | undefined {
	const text = raw.trim();
	const slash = text.indexOf("/");
	if (slash <= 0 || slash === text.length - 1) return undefined;
	return { provider: text.slice(0, slash), model: text.slice(slash + 1) };
}

/**
 * Check the route against the registered providers and the provider's own model
 * resolution, the same check subagent routes get, so a typo fails here and not
 * on the new session's first turn.
 * @returns an error text, or `undefined` when the route resolves.
 */
async function modelError(
	ctx: Context,
	model: ModelSelection,
	signal: AbortSignal,
): Promise<string | undefined> {
	try {
		const providers = ctx.llm.listProviders();
		if (!providers.some((provider) => provider.id === model.provider)) {
			const available = providers.map((provider) => provider.id).join(", ");
			return `LLM provider '${model.provider}' is not registered; available providers: ${available || "(none)"}`;
		}
		await ctx.llm.resolveCallConfig(
			{ provider: model.provider, model: model.model },
			signal,
		);
		return undefined;
	} catch (error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}
}

async function handoff(
	ctx: Context,
	invocation: CommandInvocation,
): Promise<CommandResult> {
	const raw = invocation.rawInput.trim();
	// edge case: no argument keeps the source's own model, the ring's path.
	let model: ModelSelection | undefined;
	if (raw !== "") {
		model = parseModelArg(raw);
		if (model === undefined) {
			return {
				kind: "error",
				text: `Expected "<provider>/<model>", got "${raw}"; run bare /handoff to pick one.`,
			};
		}
		const invalid = await modelError(ctx, model, invocation.signal);
		if (invalid !== undefined) return { kind: "error", text: invalid };
	}
	const agent = invocation.agent;
	const targetId = agent.session.id;

	try {
		const snapshot = await ctx.sessionQuery.readSession(targetId);
		const rendered = renderHandoff(
			await readChain(ctx, snapshot, invocation.signal),
		);
		if (rendered.turns === 0) {
			return {
				kind: "error",
				text: "This session has no turns to hand off.",
			};
		}
		const created = await createBeside(
			ctx,
			agent,
			targetId,
			rendered.markdown,
			snapshot,
			invocation.signal,
			model,
		);
		return {
			kind: "success",
			text: formatLaunchResult(created.sessionId),
		};
	} catch (error: unknown) {
		return {
			kind: "error",
			text: `Handoff failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * The handed-off session preceded by every ancestor it was itself handed off from,
 * oldest first, so the brief keeps what earlier briefs summarized.
 */
async function readChain(
	ctx: Context,
	snapshot: SessionLogSnapshot,
	signal: AbortSignal,
): Promise<SessionLogSnapshot[]> {
	const chain = [snapshot];
	const seen = new Set([String(snapshot.session.id)]);
	let parent = parentSessionId(snapshot);
	if (parent === undefined) return chain;
	// `readSession` has no typed not-found error, so deleted parents are found by id.
	const known = new Set(
		(await ctx.sessionQuery.listSessions(signal)).map((session) =>
			String(session.header.id),
		),
	);
	while (parent !== undefined && !seen.has(parent) && known.has(parent)) {
		seen.add(parent);
		// Safe: the id was just matched against the listed session ids.
		const ancestor = await ctx.sessionQuery.readSession(parent as SessionId);
		chain.unshift(ancestor);
		parent = parentSessionId(ancestor);
	}
	return chain;
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
 * Create the resumed session beside this one: same workspace, same preset, the
 * source's model or the given one, the brief in its own scratch directory, and one follow-up turn that
 * tells it to read that brief.
 * @param ctx - Host context.
 * @param source - Session the command runs in.
 * @param targetId - Durable id of the handed-off session.
 * @param markdown - Rendered brief.
 * @param snapshot - Source session log, the origin of the kanban links to copy.
 * @param signal - Cancellation signal of the invoking command.
 * @param model - Model the new session starts on; the source's own when absent.
 * @returns the created session identity.
 */
async function createBeside(
	ctx: Context,
	source: Agent,
	targetId: string,
	markdown: string,
	snapshot: SessionLogSnapshot,
	signal: AbortSignal,
	model: ModelSelection | undefined,
): Promise<SessionCreateValue> {
	const selection = model === undefined ? source.model.current() : model;
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
			: sourceTitle.title,
	);
	if (
		sourceTitle !== undefined &&
		!sourceTitle.title.endsWith(RESUMED_SUFFIX)
	) {
		ctx.sessionTitle.rename(
			source.session,
			`${sourceTitle.title}${RESUMED_SUFFIX}`,
		);
	}

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

	const sourceLink = {
		action: "add-link",
		label: `Resumed from ${targetId}`,
		url: `dsh://sessions/${targetId}`,
		priority: 0,
	};
	await ctx.commands.execute(
		agent,
		`/kanban ${JSON.stringify(sourceLink)}`,
		[],
		signal,
	);

	await deliver(ctx, agent, targetId, markdown);
	return created;
}
