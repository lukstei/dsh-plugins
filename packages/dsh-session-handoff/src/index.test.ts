import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import type { ModelSelection } from "@deepseek-ai/dsh-agent";
import type { SessionCreateRequest } from "@deepseek-ai/dsh-api-session-controller";
import type {
	CommandDefinition,
	CommandInvocation,
} from "@deepseek-ai/dsh-commands";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
	SessionLogSnapshot,
	SessionRecord,
} from "@deepseek-ai/dsh-session-query";
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import {
	handoffInstruction,
	parentSessionId,
	renderHandoff,
} from "./handoff.ts";
import * as plugin from "./index.ts";
import { formatLaunchResult, launchedSessionId } from "./launch.ts";

const CURRENT_ID = "11111111-2222-3333-4444-555555555555";
const TARGET_ID = "06542298-c989-417d-9ed4-fa5877768140";
const LAUNCHED_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const WORKSPACE_ID =
	"99999999-8888-7777-6666-555555555555" as unknown as WorkspaceId;
const CREATED = 1700000000000;
const MODEL = {
	provider: "deepseek",
	model: "V4-flash",
	reasoningEffort: "high",
} as unknown as ModelSelection;

// The events below follow the durable shapes in `SessionEventMap`; the cast skips
// the branded id types that only matter to producers.
const events = [
	{ type: "turn/start", seq: 1, time: CREATED, data: { turn: 1 } },
	{
		type: "user/message",
		seq: 2,
		time: CREATED,
		data: {
			id: "m1",
			role: "user",
			content: [{ type: "text", text: "Build the handoff command plugin" }],
			source: { kind: "user" },
		},
	},
	{
		type: "assistant/message",
		seq: 3,
		time: CREATED,
		data: {
			turn: 1,
			step: 1,
			message: {
				id: "m2",
				role: "assistant",
				content: [{ type: "text", text: "Writing the plugin now." }],
				source: { kind: "model" },
			},
			stream: [],
		},
	},
	{
		type: "tool/call",
		seq: 4,
		time: CREATED,
		data: {
			turn: 1,
			step: 1,
			callId: "c1",
			name: "write",
			arguments:
				'{"path":"/repo/app/packages/dsh-session-handoff/src/index.ts"}',
		},
	},
	{
		type: "tool/result",
		seq: 5,
		time: CREATED,
		data: {
			turn: 1,
			step: 1,
			message: {
				id: "m3",
				role: "tool",
				content: [],
				source: { kind: "tool" },
				toolCallId: "c1",
			},
		},
	},
	{
		type: "turn/end",
		seq: 6,
		time: CREATED,
		data: { turn: 1, reason: { kind: "completed" } },
	},
	{ type: "turn/start", seq: 7, time: CREATED, data: { turn: 2 } },
	{
		type: "user/message",
		seq: 8,
		time: CREATED,
		data: {
			id: "m4",
			role: "user",
			content: [{ type: "text", text: "Now add tests" }],
			source: { kind: "user" },
		},
	},
	{
		type: "assistant/message",
		seq: 9,
		time: CREATED,
		data: {
			turn: 2,
			step: 1,
			message: {
				id: "m5",
				role: "assistant",
				content: [{ type: "text", text: "Tests are in." }],
				source: { kind: "model" },
			},
			stream: [],
		},
	},
	{
		type: "tool/call",
		seq: 10,
		time: CREATED,
		data: {
			turn: 2,
			step: 1,
			callId: "c2",
			name: "bash",
			arguments: '{"command":"npm test"}',
		},
	},
	{
		type: "tool/result",
		seq: 11,
		time: CREATED,
		data: {
			turn: 2,
			step: 1,
			message: {
				id: "m6",
				role: "tool",
				content: [],
				source: { kind: "tool" },
				toolCallId: "c2",
				isError: true,
			},
			error: { name: "Error", code: "EXIT", reason: "command failed: exit 1" },
		},
	},
	{
		type: "turn/end",
		seq: 12,
		time: CREATED,
		data: { turn: 2, reason: { kind: "aborted", reason: "user" } },
	},
] as unknown as SessionEvent[];

const snapshot = {
	session: {
		version: 4,
		id: TARGET_ID,
		createdAt: CREATED,
		cwd: "/repo/app",
		isSeeded: false,
	},
	inheritedEventCount: 0,
	events,
} as unknown as SessionLogSnapshot;

interface Harness {
	readonly definition: CommandDefinition;
	readonly followups: unknown[];
	readonly created: SessionCreateRequest[];
	readonly selections: ModelSelection[];
	/** Calls into the `llm` service, in order. */
	readonly llmCalls: string[];
	readonly read: string[];
	readonly kanban: string[];
	readonly titles: { sessionId: unknown; title: string }[];
}

async function setup(
	cwd: string,
	sessions: readonly SessionRecord[],
	options: {
		readonly resolveError?: string;
		readonly unassigned?: boolean;
		readonly sourceTitle?: string;
		readonly logs?: Readonly<Record<string, SessionLogSnapshot | Error>>;
		readonly listProvidersError?: string;
	} = {},
): Promise<Harness> {
	const definition: CommandDefinition[] = [];
	const followups: unknown[] = [];
	const created: SessionCreateRequest[] = [];
	const selections: ModelSelection[] = [];
	const llmCalls: string[] = [];
	const read: string[] = [];
	const kanban: string[] = [];
	const titles: { sessionId: unknown; title: string }[] = [];
	const launched = {
		session: { id: LAUNCHED_ID, header: { agentPreset: "code" } },
		model: {
			current: () => undefined,
			select: (selection: ModelSelection) => {
				selections.push(selection);
			},
		},
		followup: (message: unknown) => {
			followups.push(message);
		},
	};
	const ctx = new Context();
	ctx.provide("commands", {
		register: (registered: CommandDefinition) => {
			definition.push(registered);
			return () => {};
		},
		execute: (_agent: unknown, line: string) => {
			kanban.push(line);
			return Promise.resolve(undefined);
		},
	});
	ctx.provide("sessionTitle", {
		get: () =>
			options.sourceTitle === undefined
				? undefined
				: { title: options.sourceTitle },
		rename: (session: { id: string }, title: string) => {
			titles.push({ sessionId: session.id, title });
			return { title };
		},
	});
	ctx.provide("llm", {
		listProviders: () => {
			llmCalls.push("listProviders");
			if (options.listProvidersError !== undefined) {
				throw new Error(options.listProvidersError);
			}
			return [{ id: "google" }, { id: "openrouter" }];
		},
		resolveCallConfig: async (route: { model: string }) => {
			llmCalls.push("resolveCallConfig");
			if (route.model === "bogus") throw new Error("Model 'bogus' not found");
		},
	});
	ctx.provide("workingDirectory", { get: () => cwd });
	ctx.provide("sessionQuery", {
		listSessions: async () => sessions,
		readSession: async (sessionId: string) => {
			read.push(sessionId);
			const log =
				options.logs === undefined ? undefined : options.logs[sessionId];
			if (log instanceof Error) throw log;
			return log === undefined ? snapshot : log;
		},
	});
	ctx.provide("workspaceRegistry", {
		list: () => [
			{
				id: WORKSPACE_ID,
				sessionIds: options.unassigned === true ? [] : [CURRENT_ID],
			},
		],
	});
	ctx.provide("sessionController", {
		create: (request: SessionCreateRequest) => {
			created.push(request);
			return Promise.resolve({ sessionId: LAUNCHED_ID, agentPreset: "code" });
		},
		resolveAgent: () =>
			Promise.resolve(
				options.resolveError === undefined
					? { agent: launched }
					: { error: { message: options.resolveError } },
			),
	});
	plugin.apply(ctx);
	return {
		definition: definition[0],
		followups,
		created,
		selections,
		llmCalls,
		read,
		kanban,
		titles,
	};
}

function invocation(
	harness: Harness,
	rawInput: string,
	agentId: string = CURRENT_ID,
): CommandInvocation {
	return {
		commandId: "test",
		agent: {
			session: { id: agentId, header: { agentPreset: "code" } },
			model: {
				current: () => MODEL,
				select: () => {},
			},
			followup: (message: unknown) => harness.followups.push(message),
		},
		rawInput,
		attachments: [],
		signal: new AbortController().signal,
	} as unknown as CommandInvocation;
}

const records = [{ header: { id: TARGET_ID } }] as unknown as SessionRecord[];

test("renderHandoff summarizes goal, turns, failures and artifacts", () => {
	const rendered = renderHandoff([snapshot]);

	assert.equal(rendered.turns, 2);
	assert.equal(
		rendered.markdown,
		`# Handoff — ${TARGET_ID}

- session: \`${TARGET_ID}\`
- cwd: \`/repo/app\`
- created: 2023-11-14T22:13:20.000Z
- events: 12
- turns: 2

## Goal

Build the handoff command plugin

## Turns

### T1 [completed]

Build the handoff command plugin

Writing the plugin now.

### T2 [aborted]

Now add tests

Tests are in.

## Failures

- **T2** tool \`bash\`: command failed: exit 1

## Artifacts

- \`/repo/app/packages/dsh-session-handoff/src/index.ts\`
`,
	);
});

test("renderHandoff degrades every empty section to none", () => {
	const rendered = renderHandoff([
		{
			session: {
				version: 4,
				id: TARGET_ID,
				createdAt: CREATED,
				isSeeded: false,
			},
			inheritedEventCount: 0,
			events: [],
		} as unknown as SessionLogSnapshot,
	]);

	assert.equal(rendered.turns, 0);
	assert.match(rendered.markdown, /^- cwd: `unknown`$/m);
	assert.match(rendered.markdown, /## Goal\n\nnone\n/);
	assert.match(rendered.markdown, /## Turns\n\nnone\n/);
});

test("the last five turns are quoted longer than older ones", () => {
	const long = "y".repeat(400);
	const events: unknown[] = [];
	for (let turn = 1; turn <= 7; turn++) {
		const base = turn * 4;
		const outcome = turn === 1 || turn === 7 ? long : `reply ${turn}`;
		events.push(
			{ type: "turn/start", seq: base, time: CREATED, data: { turn } },
			{
				type: "user/message",
				seq: base + 1,
				time: CREATED,
				data: {
					id: `u${turn}`,
					role: "user",
					content: [{ type: "text", text: `ask ${turn}` }],
					source: { kind: "user" },
				},
			},
			{
				type: "assistant/message",
				seq: base + 2,
				time: CREATED,
				data: {
					turn,
					step: 1,
					message: {
						id: `a${turn}`,
						role: "assistant",
						content: [{ type: "text", text: outcome }],
						source: { kind: "model" },
					},
					stream: [],
				},
			},
			{
				type: "turn/end",
				seq: base + 3,
				time: CREATED,
				data: { turn, reason: { kind: "completed" } },
			},
		);
	}

	const rendered = renderHandoff([
		{
			session: {
				version: 4,
				id: TARGET_ID,
				createdAt: CREATED,
				isSeeded: false,
			},
			inheritedEventCount: 0,
			events: events as SessionEvent[],
		} as unknown as SessionLogSnapshot,
	]);
	const md = rendered.markdown;

	assert.equal(rendered.turns, 7);
	assert.match(md, /### T1 \[completed\]\n\nask 1\n\ny+…/);
	assert.match(md, /### T3 \[completed\]\n\nask 3\n\nreply 3/);
	assert.match(
		md,
		new RegExp(`### T7 \\[completed\\]\\n\\nask 7\\n\\n${long}`),
	);
});

test("a long ask keeps its head and tail in the recent-turn budget", () => {
	const ask = `${"H".repeat(600)}${"M".repeat(1000)}${"E".repeat(400)}`;
	const events = [
		{ type: "turn/start", seq: 1, time: CREATED, data: { turn: 1 } },
		{
			type: "user/message",
			seq: 2,
			time: CREATED,
			data: {
				id: "u1",
				role: "user",
				content: [{ type: "text", text: ask }],
				source: { kind: "user" },
			},
		},
		{
			type: "assistant/message",
			seq: 3,
			time: CREATED,
			data: {
				turn: 1,
				step: 1,
				message: {
					id: "a1",
					role: "assistant",
					content: [{ type: "text", text: "done" }],
					source: { kind: "model" },
				},
				stream: [],
			},
		},
		{
			type: "turn/end",
			seq: 4,
			time: CREATED,
			data: { turn: 1, reason: { kind: "completed" } },
		},
	] as SessionEvent[];

	const rendered = renderHandoff([
		{
			session: {
				version: 4,
				id: TARGET_ID,
				createdAt: CREATED,
				isSeeded: false,
			},
			inheritedEventCount: 0,
			events,
		} as unknown as SessionLogSnapshot,
	]);

	assert.ok(
		rendered.markdown.includes(
			`${"H".repeat(600)}${"M".repeat(600)} … [400 chars omitted] … ${"E".repeat(400)}`,
		),
	);
});

test("handoff launch creates the resumed session beside this one", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records);
	const result = await harness.definition.handler(invocation(harness, ""));
	const file = path.join(cwd, ".agents", "scratch", LAUNCHED_ID, "HANDOFF.md");

	assert.deepEqual(result, {
		kind: "success",
		text: `Handoff launched: ${LAUNCHED_ID}`,
	});
	assert.deepEqual(harness.read, [CURRENT_ID]);
	assert.deepEqual(harness.created, [
		{ workspaceId: WORKSPACE_ID, agentPreset: "code" },
	]);
	assert.deepEqual(harness.selections, [MODEL]);
	assert.deepEqual(harness.titles, [
		{ sessionId: LAUNCHED_ID, title: `Handoff ${CURRENT_ID.slice(0, 8)}` },
	]);
	assert.match(await readFile(file, "utf8"), /^# Handoff — /);
	assert.equal(harness.followups.length, 1);
	assert.match(JSON.stringify(harness.followups[0]), /HANDOFF\.md/);
	assert.match(JSON.stringify(harness.followups[0]), /Goal: /);
	assert.equal(harness.kanban.length, 2);
	assert.deepEqual(JSON.parse(harness.kanban[1].slice("/kanban ".length)), {
		action: "add-link",
		label: `Resumed from ${CURRENT_ID}`,
		url: `dsh://sessions/${CURRENT_ID}`,
		priority: 0,
	});
	const init = JSON.parse(harness.kanban[0].slice("/kanban ".length)) as {
		action: string;
		createdAt: unknown;
	};
	assert.equal(init.action, "init");
	assert.equal(typeof init.createdAt, "number");
});

test("handoff launch copies kanban links from the source session", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const link =
		'{"action":"add-link","label":"PR","url":"https://x.test/1","priority":-1}';
	const original = snapshot.events;
	(snapshot as { events: unknown }).events = [
		...original,
		{
			type: "command/run",
			seq: 99,
			time: CREATED,
			data: { name: "kanban", args: link },
		},
	];
	t.after(() => {
		(snapshot as { events: unknown }).events = original;
	});

	const harness = await setup(cwd, records);
	await harness.definition.handler(invocation(harness, ""));

	assert.equal(harness.kanban.length, 3);
	assert.equal(harness.kanban[1], `/kanban ${link}`);
});

test("handoff launch names the new session after the source title", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records, { sourceTitle: "Fix split panes" });
	await harness.definition.handler(invocation(harness, ""));

	assert.deepEqual(harness.titles, [
		{ sessionId: LAUNCHED_ID, title: "Fix split panes" },
		{ sessionId: CURRENT_ID, title: "Fix split panes (Resumed)" },
	]);
});

test("handoff launch does not stack the (Resumed) suffix on the source title", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records, {
		sourceTitle: "Fix split panes (Resumed)",
	});
	await harness.definition.handler(invocation(harness, ""));

	assert.deepEqual(harness.titles, [
		{ sessionId: LAUNCHED_ID, title: "Fix split panes (Resumed)" },
	]);
});

test("handoff launch falls back to cwd when the session has no workspace", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records, { unassigned: true });
	const result = await harness.definition.handler(invocation(harness, ""));

	assert.deepEqual(result, {
		kind: "success",
		text: `Handoff launched: ${LAUNCHED_ID}`,
	});
	assert.deepEqual(harness.created, [{ cwd, agentPreset: "code" }]);
});

test("handoff launch fails loud when the created agent cannot be resolved", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records, {
		resolveError: "session/not-found",
	});
	const result = await harness.definition.handler(invocation(harness, ""));

	assert.deepEqual(result, {
		kind: "error",
		text: "Handoff failed: session/not-found",
	});
	assert.equal(harness.followups.length, 0);
});

test("launchedSessionId only reads the launch marker", () => {
	const done = (data: unknown): SessionEvent =>
		({
			type: "command/done",
			seq: 1,
			time: CREATED,
			data,
		}) as unknown as SessionEvent;

	assert.equal(
		launchedSessionId(
			done({
				commandId: "handoff",
				kind: "success",
				text: formatLaunchResult(LAUNCHED_ID as SessionId),
			}),
		),
		LAUNCHED_ID,
	);
	assert.equal(
		launchedSessionId(
			done({
				commandId: "handoff",
				kind: "success",
				text: `Handoff for ${TARGET_ID.slice(0, 8)} (2 turns) → /repo/HANDOFF.md`,
			}),
		),
		undefined,
	);
	assert.equal(
		launchedSessionId(
			done({
				commandId: "handoff",
				kind: "error",
				text: formatLaunchResult(LAUNCHED_ID as SessionId),
			}),
		),
		undefined,
	);
	assert.equal(
		launchedSessionId({
			type: "user/message",
			seq: 1,
			time: CREATED,
			data: {},
		} as unknown as SessionEvent),
		undefined,
	);
});

interface TurnSpec {
	readonly ask: string;
	readonly path?: string;
	readonly failure?: string;
}

function sessionLog(
	id: string,
	specs: readonly TurnSpec[],
): SessionLogSnapshot {
	const log: unknown[] = [];
	specs.forEach((spec, i) => {
		const turn = i + 1;
		log.push(
			{ type: "turn/start", seq: 0, time: CREATED, data: { turn } },
			{
				type: "user/message",
				seq: 0,
				time: CREATED,
				data: {
					id: `u${turn}`,
					role: "user",
					content: [{ type: "text", text: spec.ask }],
					source: { kind: "user" },
				},
			},
		);
		if (spec.path !== undefined) {
			log.push({
				type: "tool/call",
				seq: 0,
				time: CREATED,
				data: {
					turn,
					step: 1,
					callId: `c${turn}`,
					name: "read",
					arguments: JSON.stringify({ path: spec.path }),
				},
			});
		}
		if (spec.failure !== undefined) {
			log.push({
				type: "tool/result",
				seq: 0,
				time: CREATED,
				data: {
					turn,
					step: 1,
					message: {
						id: `r${turn}`,
						role: "tool",
						content: [],
						source: { kind: "tool" },
						toolCallId: `c${turn}`,
						isError: true,
					},
					error: { name: "Error", code: "X", reason: spec.failure },
				},
			});
		}
		log.push({
			type: "turn/end",
			seq: 0,
			time: CREATED,
			data: { turn, reason: { kind: "completed" } },
		});
	});
	return {
		session: { version: 4, id, createdAt: CREATED, isSeeded: false },
		inheritedEventCount: 0,
		events: log as SessionEvent[],
	} as unknown as SessionLogSnapshot;
}

const BRIEF = "/scratch/HANDOFF.md";

test("a chained handoff keeps goal, turns, failures and artifacts of every ancestor", () => {
	const a = sessionLog("aaaaaaaa-0000", [
		{ ask: "original goal", path: "/repo/a.ts", failure: "boom" },
	]);
	const b = sessionLog("bbbbbbbb-0000", [
		{ ask: handoffInstruction("aaaaaaaa-0000", BRIEF), path: BRIEF },
		{ ask: "second ask", path: "/repo/b.ts" },
	]);
	const c = sessionLog("cccccccc-0000", [
		{ ask: handoffInstruction("bbbbbbbb-0000", BRIEF), path: BRIEF },
	]);

	assert.equal(parentSessionId(c), "bbbbbbbb-0000");
	assert.equal(parentSessionId(a), undefined);

	const rendered = renderHandoff([a, b, c]);
	assert.equal(rendered.turns, 2);
	assert.match(
		rendered.markdown,
		/- chain: `aaaaaaaa` → `bbbbbbbb` → `cccccccc`/,
	);
	assert.match(rendered.markdown, /## Goal\n\noriginal goal\n/);
	assert.match(rendered.markdown, /### T1 \[completed\]\n\noriginal goal/);
	assert.match(rendered.markdown, /### T2 \[completed\]\n\nsecond ask/);
	assert.match(
		rendered.markdown,
		/- \*\*T1\*\* \(aaaaaaaa\) tool `read`: boom/,
	);
	assert.match(rendered.markdown, /- `\/repo\/a\.ts`\n- `\/repo\/b\.ts`\n$/);
	assert.doesNotMatch(rendered.markdown, /HANDOFF\.md/);
});

test("a ten-link chain stays within the section bounds", () => {
	const chain: SessionLogSnapshot[] = [];
	let previous: string | undefined;
	for (let link = 0; link < 10; link++) {
		const id = `${String(link).padStart(8, "0")}-0000`;
		const specs: TurnSpec[] = [];
		if (previous !== undefined)
			specs.push({ ask: handoffInstruction(previous, BRIEF), path: BRIEF });
		for (let n = 0; n < 20; n++)
			specs.push({
				ask: `ask ${link}.${n}`,
				path: `/repo/f${link}-${n}.ts`,
				failure: `fail ${link}.${n}`,
			});
		chain.push(sessionLog(id, specs));
		previous = id;
	}

	const md = renderHandoff(chain).markdown;
	assert.match(md, /… 165 earlier turns omitted/);
	assert.match(md, /- … 180 older failures omitted/);
	assert.match(md, /- … 100 older paths omitted/);
	assert.match(md, /ask 9\.19/);
	assert.doesNotMatch(md, /### T1 \[/);
	assert.ok(md.length < 50_000, `brief is ${md.length} chars`);
});

function recordsOf(...ids: string[]): SessionRecord[] {
	return ids.map((id) => ({ header: { id } })) as unknown as SessionRecord[];
}

async function handoffOf(
	t: { after: (fn: () => Promise<void>) => void },
	target: string,
	known: string[],
	logs: Record<string, SessionLogSnapshot | Error>,
) {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const harness = await setup(cwd, recordsOf(...known), { logs });
	const result = await harness.definition.handler(
		invocation(harness, "", target),
	);
	return { harness, result };
}

test("a cycle in the parent chain ends it", async (t) => {
	const A = "aaaaaaaa-0000";
	const B = "bbbbbbbb-0000";
	const { harness, result } = await handoffOf(t, A, [A, B], {
		[A]: sessionLog(A, [{ ask: handoffInstruction(B, BRIEF) }, { ask: "a" }]),
		[B]: sessionLog(B, [{ ask: handoffInstruction(A, BRIEF) }, { ask: "b" }]),
	});
	assert.equal(result.kind, "success");
	assert.deepEqual(harness.read, [A, B]);
});

test("a deleted parent ends the chain without an error", async (t) => {
	const A = "aaaaaaaa-0000";
	const { harness, result } = await handoffOf(t, A, [A], {
		[A]: sessionLog(A, [
			{ ask: handoffInstruction("deleted-0000", BRIEF) },
			{ ask: "a" },
		]),
	});
	assert.equal(result.kind, "success");
	assert.deepEqual(harness.read, [A]);
});

test("a failing read of a listed parent surfaces as an error", async (t) => {
	const A = "aaaaaaaa-0000";
	const B = "bbbbbbbb-0000";
	const { result } = await handoffOf(t, A, [A, B], {
		[A]: sessionLog(A, [{ ask: handoffInstruction(B, BRIEF) }, { ask: "a" }]),
		[B]: new Error("corrupt log"),
	});
	assert.equal(result.kind, "error");
	assert.match(JSON.stringify(result), /Handoff failed: corrupt log/);
});

test("an instruction pasted later in a session is an ordinary ask", () => {
	const log = sessionLog("aaaaaaaa-0000", [
		{ ask: "real goal" },
		{ ask: handoffInstruction("bbbbbbbb-0000", BRIEF), path: "/repo/x.ts" },
	]);
	assert.equal(parentSessionId(log), undefined);
	const rendered = renderHandoff([log]);
	assert.equal(rendered.turns, 2);
	assert.match(rendered.markdown, /- `\/repo\/x\.ts`/);
});

test("very long artifact paths and tool names are clipped", () => {
	const longPath = `/repo/${"p".repeat(1000)}.ts`;
	const md = renderHandoff([
		sessionLog("aaaaaaaa-0000", [
			{ ask: "go", path: longPath, failure: "boom" },
		]),
	]).markdown;
	assert.ok(!md.includes(longPath));
	assert.match(md, /- `\/repo\/p+…`/);
});

test("parseModelArg splits at the first slash and keeps slashes in the model id", () => {
	assert.deepEqual(plugin.parseModelArg(" openrouter/baidu/ernie-5.5 "), {
		provider: "openrouter",
		model: "baidu/ernie-5.5",
	});
	for (const bad of ["", "nope", "/model", "provider/", "  "]) {
		assert.equal(plugin.parseModelArg(bad), undefined, bad);
	}
});

test("handoff launches the resumed session on the chosen model", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records);
	const result = await harness.definition.handler(
		invocation(harness, "google/gemini-4"),
	);

	assert.deepEqual(result, {
		kind: "success",
		text: `Handoff launched: ${LAUNCHED_ID}`,
	});
	assert.deepEqual(harness.selections, [
		{ provider: "google", model: "gemini-4" },
	]);
});

test("handoff rejects an argument that is not a registered, resolvable provider/model", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records);
	const errors: unknown[] = [];
	for (const rawInput of [
		"gemini",
		TARGET_ID,
		"nope/gemini-4",
		"google/bogus",
	]) {
		errors.push(
			await harness.definition.handler(invocation(harness, rawInput)),
		);
	}

	assert.deepEqual(errors, [
		{
			kind: "error",
			text: 'Expected "<provider>/<model>", got "gemini"; run bare /handoff to pick one.',
		},
		{
			kind: "error",
			text: `Expected "<provider>/<model>", got "${TARGET_ID}"; run bare /handoff to pick one.`,
		},
		{
			kind: "error",
			text: "LLM provider 'nope' is not registered; available providers: google, openrouter",
		},
		{ kind: "error", text: "Model 'bogus' not found" },
	]);
	assert.deepEqual(harness.created, []);
	assert.deepEqual(harness.selections, []);
});

test("a failing provider listing is a command error, not a thrown one", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records, { listProvidersError: "no llm" });
	const result = await harness.definition.handler(
		invocation(harness, "google/gemini-4"),
	);

	assert.deepEqual(result, { kind: "error", text: "no llm" });
	assert.deepEqual(harness.created, []);
});

test("a blank or whitespace-only line keeps the source model and never asks llm", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records);
	for (const rawInput of ["", "   "]) {
		const result = await harness.definition.handler(
			invocation(harness, rawInput),
		);
		assert.equal(result.kind, "success");
	}

	assert.deepEqual(harness.selections, [MODEL, MODEL]);
	assert.deepEqual(harness.llmCalls, []);
});
