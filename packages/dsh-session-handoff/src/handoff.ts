import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { TurnEndReason } from "@deepseek-ai/dsh-session";
import type { SessionLogSnapshot } from "@deepseek-ai/dsh-session-query";

/**
 * Bounds on quoted text. The Goal and older turns quote a head and a tail of the user's
 * ask; the last RECENT_TURNS use a larger budget so the receiving agent still reads the
 * actual words.
 */
const ASK_HEAD = 500;
const ASK_TAIL = 300;
const OUTCOME_LIMIT = 240;
const FAILURE_LIMIT = 200;
const ARTIFACT_LIMIT = 12;
const RECENT_TURNS = 5;
const RECENT_HEAD = 1200;
const RECENT_TAIL = 400;

/** Tool argument keys that carry a durable file path. */
const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"];

export interface RenderedHandoff {
	readonly markdown: string;
	readonly turns: number;
}

interface TurnArc {
	readonly turn: number;
	ask: string;
	outcome: string;
	reason: TurnEndReason | undefined;
}

export function renderHandoff(snapshot: SessionLogSnapshot): RenderedHandoff {
	const turns: TurnArc[] = [];
	const byId = new Map<number, TurnArc>();
	const failures: string[] = [];
	const artifacts: string[] = [];
	const callNames = new Map<string, string>();
	const seenArtifacts = new Set<string>();
	let open: TurnArc | undefined;
	let goal = "";

	for (const event of snapshot.events) {
		switch (event.type) {
			case "turn/start": {
				const opened: TurnArc = {
					turn: event.data.turn,
					ask: "",
					outcome: "",
					reason: undefined,
				};
				turns.push(opened);
				byId.set(event.data.turn, opened);
				// edge case: `user/message` carries no turn number, so it is attributed
				// to the most recently opened turn.
				open = opened;
				break;
			}
			case "user/message": {
				if (event.data.source.kind !== "user") break;
				const text = blockText(event.data.content);
				if (text === "") break;
				if (goal === "") goal = elide(flatten(text), ASK_HEAD, ASK_TAIL);
				if (open !== undefined && open.ask === "") open.ask = text;
				break;
			}
			case "assistant/message": {
				const arc = byId.get(event.data.turn);
				if (arc === undefined) break;
				// The last text-bearing step of a turn is the answer the user saw.
				arc.outcome = blockText(event.data.message.content);
				break;
			}
			case "turn/end": {
				const arc = byId.get(event.data.turn);
				if (arc === undefined) break;
				arc.reason = event.data.reason;
				break;
			}
			case "tool/call": {
				const arc = byId.get(event.data.turn);
				callNames.set(event.data.callId, event.data.name);
				if (arc === undefined) break;
				collectArtifacts(event.data.arguments, artifacts, seenArtifacts);
				break;
			}
			case "tool/result": {
				const arc = byId.get(event.data.turn);
				if (event.data.message.isError !== true || arc === undefined) break;
				const callId = event.data.message.toolCallId;
				const name = callNames.get(callId);
				failures.push(
					`- **T${arc.turn}** tool \`${name === undefined ? callId : name}\`: ${clip(errorReason(event.data.error), FAILURE_LIMIT)}`,
				);
				break;
			}
			default:
				break;
		}
	}

	const id = String(snapshot.session.id);
	const cwd = snapshot.session.cwd;
	const lines = [
		`# Handoff — ${id}`,
		"",
		`- session: \`${id}\``,
		`- cwd: \`${cwd === undefined ? "unknown" : cwd}\``,
		`- created: ${new Date(snapshot.session.createdAt).toISOString()}`,
		`- events: ${snapshot.events.length}`,
		`- turns: ${turns.length}`,
		"",
		"## Goal",
		"",
		goal === "" ? "none" : goal,
		"",
		"## Turns",
		"",
		turns.length === 0
			? "none"
			: turns
					.map((turn, index) =>
						turnBlock(turn, index >= turns.length - RECENT_TURNS),
					)
					.join("\n\n"),
		"",
		"## Failures",
		"",
		failures.length === 0 ? "none" : failures.join("\n"),
		"",
		"## Artifacts",
		"",
		artifacts.length === 0
			? "none"
			: artifacts.map((file) => `- \`${file}\``).join("\n"),
	];

	return { markdown: `${lines.join("\n")}\n`, turns: turns.length };
}

export function handoffInstruction(sessionId: string, file: string): string {
	return [
		`The handoff brief for session ${sessionId} is at ${file}.`,
		"",
		"Read that file now, then reply with three lines and stop:",
		"Goal: <one line>",
		"State: <one line>",
		"Next: <one line>",
		"",
		"Do not start the work until the user confirms the next action.",
	].join("\n");
}

/** Recent turns quote the ask and reply at length; older turns are flattened and short. */
function turnBlock(turn: TurnArc, recent: boolean): string {
	const kind = turn.reason === undefined ? "unfinished" : turn.reason.kind;
	const body = (
		recent
			? [
					elide(turn.ask, RECENT_HEAD, RECENT_TAIL),
					elide(turn.outcome, RECENT_HEAD, RECENT_TAIL),
				]
			: [
					elide(flatten(turn.ask), ASK_HEAD, ASK_TAIL),
					clip(turn.outcome, OUTCOME_LIMIT),
				]
	)
		.filter((part) => part !== "")
		.join("\n\n");
	return `### T${turn.turn} [${kind}]\n\n${body === "" ? "(no content)" : body}`;
}

function blockText(blocks: readonly ContentBlock[]): string {
	const parts: string[] = [];
	for (const block of blocks) {
		if (block.type === "text") parts.push(block.text);
	}
	return parts.join("\n");
}

/** Collapses whitespace so a quote fits on one line, then cuts it. */
function clip(value: string, limit: number): string {
	const flat = flatten(value);
	if (flat.length <= limit) return flat;
	return `${flat.slice(0, limit - 1)}…`;
}

function flatten(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

/**
 * Keeps `head` chars from the start and `tail` chars from the end, naming how much was
 * dropped. Raw text is preserved so the Tail keeps the shape of code blocks and tables.
 */
function elide(value: string, head: number, tail: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= head + tail) return trimmed;
	const omitted = trimmed.length - head - tail;
	return `${trimmed.slice(0, head)} … [${omitted} chars omitted] … ${trimmed.slice(-tail)}`;
}

function errorReason(
	error: { name: string; code: string; reason?: string } | undefined,
): string {
	if (error === undefined) return "failed";
	if (error.reason === undefined) return error.code;
	return error.reason;
}

function collectArtifacts(
	args: string,
	into: string[],
	seen: Set<string>,
): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(args);
	} catch {
		// edge case: tool arguments are model-produced JSON; a non-JSON payload names no path
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		return;
	// Safe: the guard above admits only non-null, non-array objects.
	const record = parsed as Record<string, unknown>;
	for (const key of PATH_KEYS) {
		const value = record[key];
		if (typeof value !== "string" || value === "" || seen.has(value)) continue;
		seen.add(value);
		into.push(value);
		if (into.length >= ARTIFACT_LIMIT) return;
	}
}
