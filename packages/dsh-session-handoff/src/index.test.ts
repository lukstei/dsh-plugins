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
import { renderHandoff } from "./handoff.ts";
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
	} = {},
): Promise<Harness> {
	const definition: CommandDefinition[] = [];
	const followups: unknown[] = [];
	const created: SessionCreateRequest[] = [];
	const selections: ModelSelection[] = [];
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
	ctx.provide("workingDirectory", { get: () => cwd });
	ctx.provide("sessionQuery", {
		listSessions: async () => sessions,
		readSession: async (sessionId: string) => {
			read.push(sessionId);
			return snapshot;
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
	const rendered = renderHandoff(snapshot);

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
	const rendered = renderHandoff({
		session: { version: 4, id: TARGET_ID, createdAt: CREATED, isSeeded: false },
		inheritedEventCount: 0,
		events: [],
	} as unknown as SessionLogSnapshot);

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

	const rendered = renderHandoff({
		session: { version: 4, id: TARGET_ID, createdAt: CREATED, isSeeded: false },
		inheritedEventCount: 0,
		events: events as SessionEvent[],
	} as unknown as SessionLogSnapshot);
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

	const rendered = renderHandoff({
		session: { version: 4, id: TARGET_ID, createdAt: CREATED, isSeeded: false },
		inheritedEventCount: 0,
		events,
	} as unknown as SessionLogSnapshot);

	assert.ok(
		rendered.markdown.includes(
			`${"H".repeat(600)}${"M".repeat(600)} … [400 chars omitted] … ${"E".repeat(400)}`,
		),
	);
});

test("resolveHandoffTarget prefers an exact id and reports ambiguity", () => {
	const known = [
		{ header: { id: TARGET_ID } },
		{ header: { id: "06542298-beef" } },
		{ header: { id: "deadbeef-0000" } },
	] as unknown as SessionRecord[];

	assert.equal(plugin.resolveHandoffTarget(known, TARGET_ID)[0], known[0]);
	assert.equal(plugin.resolveHandoffTarget(known, "deadbeef").length, 1);
	assert.equal(plugin.resolveHandoffTarget(known, "06542298").length, 2);
	assert.equal(plugin.resolveHandoffTarget(known, "nope").length, 0);
});

test("handoff writes the brief to the current scratch dir and follows up", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records);
	const result = await harness.definition.handler(
		invocation(harness, ` ${TARGET_ID.slice(0, 8)} `),
	);
	const file = path.join(cwd, ".agents", "scratch", CURRENT_ID, "HANDOFF.md");

	assert.equal(result.kind, "success");
	assert.match(await readFile(file, "utf8"), /^# Handoff — /);
	assert.equal(harness.followups.length, 1);
	assert.match(JSON.stringify(harness.followups[0]), /HANDOFF\.md/);
	assert.match(JSON.stringify(harness.followups[0]), /Goal: /);
	assert.deepEqual(harness.kanban, []);
});

test("handoff rejects an unknown id and its own session", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records);
	for (const rawInput of ["nope", CURRENT_ID]) {
		const result = await harness.definition.handler(
			invocation(harness, rawInput),
		);
		assert.equal(
			result.kind,
			"error",
			`expected an error for ${JSON.stringify(rawInput)}`,
		);
	}
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
	assert.equal(harness.kanban.length, 1);
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

	assert.equal(harness.kanban.length, 2);
	assert.equal(harness.kanban[1], `/kanban ${link}`);
});

test("handoff launch names the new session after the source title", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records, { sourceTitle: "Fix split panes" });
	await harness.definition.handler(invocation(harness, ""));

	assert.deepEqual(harness.titles, [
		{ sessionId: LAUNCHED_ID, title: "Fix split panes - Handoff" },
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

test("only a blank line launches; any other text is an id query", async (t) => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));

	const harness = await setup(cwd, records);
	for (const rawInput of [`launch ${TARGET_ID}`, "launch nope", "launch"]) {
		const result = await harness.definition.handler(
			invocation(harness, rawInput),
		);
		assert.equal(
			result.kind,
			"error",
			`expected an error for ${JSON.stringify(rawInput)}`,
		);
	}
	assert.deepEqual(harness.created, []);

	const blank = await harness.definition.handler(invocation(harness, "   "));
	assert.deepEqual(blank, {
		kind: "success",
		text: `Handoff launched: ${LAUNCHED_ID}`,
	});
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
