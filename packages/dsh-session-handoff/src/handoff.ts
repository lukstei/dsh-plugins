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
const PATH_LIMIT = 300;
const TOOL_NAME_LIMIT = 80;
const RECENT_TURNS = 5;
const RECENT_HEAD = 1200;
const RECENT_TAIL = 400;
/** The last turn is quoted in full up to this cap, split head/tail like the others. */
const LAST_HEAD = 15000;
const LAST_TAIL = 5000;
/**
 * Bounds that keep a brief small however long the handoff chain is: each section
 * keeps only its newest entries and names how many it dropped.
 */
const OLDER_TURNS = 30;
const FAILURE_MAX = 20;
const ARTIFACT_MAX = 100;
const SHORT_ID_LENGTH = 8;

/** Tool argument keys that carry a durable file path. */
const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"];

/** The first line of every handoff follow-up; names the parent session and its brief. */
const INSTRUCTION_LINE = /^The handoff brief for session (\S+) is at (.+)\.$/;

export interface RenderedHandoff {
	readonly markdown: string;
	readonly turns: number;
}

interface TurnArc {
	readonly turn: number;
	readonly sessionId: string;
	/** Running number across the whole chain; assigned after collection. */
	index: number;
	/** Every user message of the turn, in order. */
	asks: string[];
	outcome: string;
	reason: TurnEndReason | undefined;
	/** The turn only read a parent brief; it carries no work of its own. */
	isHandoff: boolean;
}

interface Failure {
	readonly arc: TurnArc;
	readonly text: string;
}

/**
 * Id of the session whose brief this session was started from, read from the
 * handoff follow-up it received.
 */
export function parentSessionId(
	snapshot: SessionLogSnapshot,
): string | undefined {
	for (const event of snapshot.events) {
		if (event.type !== "user/message" || event.data.source.kind !== "user")
			continue;
		const text = blockText(event.data.content);
		if (text === "") continue;
		// Only the session's first user message can be the handoff follow-up.
		const match = INSTRUCTION_LINE.exec(text.split("\n", 1)[0]);
		return match === null ? undefined : match[1];
	}
	return undefined;
}

/**
 * Renders one brief for a handoff chain.
 * @param snapshots - Session logs, oldest ancestor first, the handed-off session last.
 */
export function renderHandoff(
	snapshots: readonly SessionLogSnapshot[],
): RenderedHandoff {
	const turns: TurnArc[] = [];
	const failures: Failure[] = [];
	// A Map keeps insertion order; re-inserting moves a repeated path to its newest use.
	const artifacts = new Map<string, true>();
	const briefFiles = new Set<string>();
	let goal = "";
	let eventCount = 0;

	for (const snapshot of snapshots) {
		const sessionId = String(snapshot.session.id);
		const byId = new Map<number, TurnArc>();
		const callNames = new Map<string, string>();
		let open: TurnArc | undefined;
		let sawUserMessage = false;
		eventCount += snapshot.events.length;

		for (const event of snapshot.events) {
			switch (event.type) {
				case "turn/start": {
					const opened: TurnArc = {
						turn: event.data.turn,
						sessionId,
						index: 0,
						asks: [],
						outcome: "",
						reason: undefined,
						isHandoff: false,
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
					const instruction = sawUserMessage
						? null
						: INSTRUCTION_LINE.exec(text.split("\n", 1)[0]);
					sawUserMessage = true;
					if (instruction !== null) {
						briefFiles.add(instruction[2]);
						if (open !== undefined) open.isHandoff = true;
						break;
					}
					if (goal === "") goal = elide(flatten(text), ASK_HEAD, ASK_TAIL);
					if (open !== undefined) open.asks.push(text);
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
					if (arc === undefined || arc.isHandoff) break;
					collectArtifacts(event.data.arguments, artifacts, briefFiles);
					break;
				}
				case "tool/result": {
					const arc = byId.get(event.data.turn);
					if (event.data.message.isError !== true || arc === undefined) break;
					if (arc.isHandoff) break;
					const callId = event.data.message.toolCallId;
					const name = callNames.get(callId);
					failures.push({
						arc,
						text: `tool \`${clip(name === undefined ? callId : name, TOOL_NAME_LIMIT)}\`: ${clip(errorReason(event.data.error), FAILURE_LIMIT)}`,
					});
					break;
				}
				default:
					break;
			}
		}
	}

	const work = turns.filter((turn) => !turn.isHandoff);
	work.forEach((turn, index) => {
		turn.index = index + 1;
	});

	const current = snapshots[snapshots.length - 1];
	const id = String(current.session.id);
	const cwd = current.session.cwd;
	const lines = [
		`# Handoff — ${id}`,
		"",
		`- session: \`${id}\``,
		...(snapshots.length > 1
			? [
					`- chain: ${snapshots.map((snapshot) => `\`${shortId(String(snapshot.session.id))}\``).join(" → ")}`,
				]
			: []),
		`- cwd: \`${cwd === undefined ? "unknown" : cwd}\``,
		`- created: ${new Date(current.session.createdAt).toISOString()}`,
		`- events: ${eventCount}`,
		`- turns: ${work.length}`,
		"",
		"## Goal",
		"",
		goal === "" ? "none" : goal,
		"",
		"## Turns",
		"",
		work.length === 0 ? "none" : turnList(work),
		"",
		"## Failures",
		"",
		failures.length === 0
			? "none"
			: bounded(
					failures.map(
						({ arc, text }) =>
							`- **T${arc.index}**${arc.sessionId === id ? "" : ` (${shortId(arc.sessionId)})`} ${text}`,
					),
					FAILURE_MAX,
					"older failures",
				),
		"",
		"## Artifacts",
		"",
		artifacts.size === 0
			? "none"
			: bounded(
					[...artifacts.keys()].map((file) => `- \`${file}\``),
					ARTIFACT_MAX,
					"older paths",
				),
	];

	return { markdown: `${lines.join("\n")}\n`, turns: work.length };
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

/** The last turn in full, RECENT_TURNS before it at length, OLDER_TURNS before those flattened, the rest counted. */
function turnList(work: readonly TurnArc[]): string {
	const kept = work.slice(-(RECENT_TURNS + OLDER_TURNS));
	const dropped = work.length - kept.length;
	const blocks = kept.map((turn, index) =>
		turnBlock(
			turn,
			index === kept.length - 1
				? "last"
				: index >= kept.length - RECENT_TURNS
					? "recent"
					: "older",
		),
	);
	if (dropped > 0) blocks.unshift(`… ${dropped} earlier turns omitted`);
	return blocks.join("\n\n");
}

/** Keeps the newest `max` lines, naming how many older ones were dropped. */
function bounded(lines: string[], max: number, noun: string): string {
	const dropped = lines.length - max;
	if (dropped <= 0) return lines.join("\n");
	return [`- … ${dropped} ${noun} omitted`, ...lines.slice(-max)].join("\n");
}

function shortId(id: string): string {
	return id.slice(0, SHORT_ID_LENGTH);
}

/**
 * The last turn quotes every user message and the reply in full, recent turns quote the first
 * ask and the reply at length, older turns are flattened and short. Roles are labelled so an
 * unanswered ask is never mistaken for a reply.
 */
function turnBlock(turn: TurnArc, tier: "last" | "recent" | "older"): string {
	const kind = turn.reason === undefined ? "unfinished" : turn.reason.kind;
	const quote = (text: string): string =>
		tier === "last"
			? elide(text, LAST_HEAD, LAST_TAIL)
			: elide(text, RECENT_HEAD, RECENT_TAIL);
	const asks = tier === "last" ? turn.asks : turn.asks.slice(0, 1);
	const user = asks.map((ask) =>
		tier === "older"
			? `**User:** ${elide(flatten(ask), ASK_HEAD, ASK_TAIL)}`
			: `**User:**\n\n${quote(ask)}`,
	);
	const reply =
		turn.outcome.trim() === ""
			? "**Assistant:** (no reply)"
			: tier === "older"
				? `**Assistant:** ${clip(turn.outcome, OUTCOME_LIMIT)}`
				: `**Assistant:**\n\n${quote(turn.outcome)}`;
	return `### T${turn.index} [${kind}]\n\n${[...user, reply].join("\n\n")}`;
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
	return `${flat.slice(0, limit)} … [${flat.length - limit} chars omitted]`;
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
	into: Map<string, true>,
	briefFiles: ReadonlySet<string>,
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
		if (typeof value !== "string" || value === "" || briefFiles.has(value))
			continue;
		const path = clip(value, PATH_LIMIT);
		into.delete(path);
		into.set(path, true);
	}
}
