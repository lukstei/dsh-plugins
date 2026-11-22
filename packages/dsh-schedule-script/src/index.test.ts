import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ProjectionHandle } from "@deepseek-ai/dsh-session-projection";
import type {
	ToolActivationContext,
	ToolDefinition,
	ToolRegistrationOptions,
	ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import { test } from "vitest";
import { z } from "zod";
import { formatDuration, shouldRenderPill } from "./client.tsx";
import {
	apply,
	executeScript,
	foldScheduleScriptEvent,
	formatScriptPrompt,
	initialScheduleScriptSummary,
	type ScheduleCreateRequest,
	type ScheduleEditRequest,
	toScheduleScriptRecord,
} from "./index.ts";
import {
	SCHEDULE_SCRIPT_EVENT_NAME,
	type ScheduleScriptSummary,
} from "./types.ts";

// smell: partial framework fixtures omit fields the plugin does not read.
declare const eventTypes: Context;
type PreStep = Parameters<
	Parameters<typeof eventTypes.on<"agent/pre-step">>[1]
>[0];

const toolResultSchema = z.object({
	success: z.boolean(),
	message: z.string(),
	state: z.unknown().optional(),
	prompt: z.string().optional(),
});

function makeBatchText(prompt: string, scheduleId = "sch-test"): string {
	return `[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: ${JSON.stringify(
		[{ schedule_id: scheduleId, reminder_prompt: prompt }],
	)}`;
}

function setupMockServices(
	ctx: Context,
	overrides?: {
		scheduleList?: Array<{
			id: string;
			prompt: string;
			target: { kind: string; sessionId: string };
		}>;
		onScheduleEdit?: (req: ScheduleEditRequest) => unknown;
	},
) {
	ctx.skills = { register: () => () => {} };
	ctx.schedule = {
		list: async ({ limit = 100, offset = 0 } = {}) => {
			const entries = overrides?.scheduleList ?? [];
			const items = entries.slice(offset, offset + limit).map((entry) => ({
				...entry,
				title: "Test Task",
				status: "active" as const,
			}));
			return {
				items,
				shown: items.length,
				total: entries.length,
				limit,
				offset,
			};
		},
		create: async () => {},
		edit: async (req) => {
			if (overrides?.onScheduleEdit) return overrides.onScheduleEdit(req);
			return { id: req.id, deleted: true };
		},
	};
	const sessionStates = new Map<string, ScheduleScriptSummary>();
	ctx.on("session/event", (session: Session, event: SessionEvent) => {
		const sid = session.id;
		const current = sessionStates.get(sid) ?? initialScheduleScriptSummary();
		sessionStates.set(sid, foldScheduleScriptEvent(current, event));
	});
	(
		ctx as unknown as {
			sessionProjections: {
				register: () => Promise<ProjectionHandle<ScheduleScriptSummary>>;
			};
		}
	).sessionProjections = {
		register: async () => {
			const handle: ProjectionHandle<ScheduleScriptSummary> = {
				stateOf: (session: Session) =>
					sessionStates.get(session.id) ?? initialScheduleScriptSummary(),
				readerFor: (session: Session) => () =>
					sessionStates.get(session.id) ?? initialScheduleScriptSummary(),
				dispose: async () => {},
			};
			return handle;
		},
	};
	ctx.provide("tools", { register: () => {} });
}

test.for([true, false])(
	"foldScheduleScriptEvent folds error severity: %s",
	(fatal) => {
		const initial = initialScheduleScriptSummary();
		assert.equal(initial.scriptStatus, "idle");
		assert.equal(initial.totalRuns, 0);
		assert.equal(toScheduleScriptRecord(initial), null);

		// Non-matching events ignored
		const ignored = foldScheduleScriptEvent(initial, {
			type: "user/message",
			data: { message: "hello" },
		} as unknown as SessionEvent);
		assert.equal(ignored, initial);

		// Iteration event
		const afterIter = foldScheduleScriptEvent(initial, {
			type: "command/run",
			data: {
				name: SCHEDULE_SCRIPT_EVENT_NAME,
				args: JSON.stringify({
					action: "iteration",
					scriptPath: "sync.ts",
					iteration: 1,
					state: { count: 5 },
					durationMs: 42,
					timestamp: 1000,
					prompt: "Woke agent",
				}),
			},
		} as SessionEvent);

		assert.equal(afterIter.scriptStatus, "idle");
		assert.equal(afterIter.totalRuns, 1);
		assert.equal(afterIter.scriptPath, "sync.ts");
		assert.deepEqual(afterIter.state, { count: 5 });
		assert.equal(afterIter.lastDurationMs, 42);
		assert.deepEqual(afterIter.lastPrompt, {
			message: "Woke agent",
			timestamp: 1000,
		});

		// Error event (fatal error stops the script)
		const afterErr = foldScheduleScriptEvent(afterIter, {
			type: "command/run",
			data: {
				name: SCHEDULE_SCRIPT_EVENT_NAME,
				args: JSON.stringify({
					action: "error",
					scriptPath: "sync.ts",
					iteration: 2,
					error: "Failed to connect",
					timestamp: 2000,
					fatal,
				}),
			},
		} as SessionEvent);

		assert.equal(afterErr.scriptStatus, fatal ? "error" : "warning");
		assert.equal(afterErr.totalRuns, 1);
		assert.deepEqual(afterErr.lastError, {
			message: "Failed to connect",
			timestamp: 2000,
			fatal,
		});

		// Stop event
		const afterStop = foldScheduleScriptEvent(afterErr, {
			type: "command/run",
			data: {
				name: SCHEDULE_SCRIPT_EVENT_NAME,
				args: JSON.stringify({
					action: "stop",
					reason: "done",
					timestamp: 3000,
				}),
			},
		} as SessionEvent);

		assert.equal(afterStop.scriptStatus, fatal ? "error" : "stopped");
	},
);

test("executeScript executes a TypeScript script in a subprocess and passes state", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-test-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "counter.ts");
	await writeFile(
		scriptPath,
		`
export async function main(ctx) {
  const current = (ctx.state && ctx.state.count) || 0;
  return {
    state: { count: current + 1 },
    prompt: "incremented"
  };
}
`,
		"utf8",
	);

	const res1 = await executeScript(
		scriptPath,
		{
			state: null,
			sessionId: "test-sess",
		},
		5000,
		dir,
	);

	assert.deepEqual(res1.state, { count: 1 });
	assert.equal(res1.prompt, "incremented");
	assert.equal(res1.stop, undefined);

	// Second iteration passing state from res1
	const res2 = await executeScript(
		scriptPath,
		{
			state: res1.state,
			sessionId: "test-sess",
		},
		5000,
		dir,
	);

	assert.deepEqual(res2.state, { count: 2 });
});

test("executeScript catches errors thrown inside user script", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-err-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "failing.ts");
	await writeFile(
		scriptPath,
		`
export function main() {
  throw new Error("Simulated failure in script");
}
`,
		"utf8",
	);

	await assert.rejects(
		async () => {
			await executeScript(
				scriptPath,
				{
					state: null,
					sessionId: "test-sess",
				},
				5000,
				dir,
			);
		},
		(err: Error) => {
			assert.match(err.message, /Simulated failure in script/);
			return true;
		},
	);
});

test("executeScript honors timeoutMs", async ({ onTestFinished }) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-timeout-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "hanging.ts");
	await writeFile(
		scriptPath,
		`
export async function main() {
  await new Promise(resolve => setTimeout(resolve, 5000));
  return { state: {} };
}
`,
		"utf8",
	);

	await assert.rejects(async () => {
		await executeScript(
			scriptPath,
			{
				state: null,
				sessionId: "test-sess",
			},
			300, // 300ms timeout
			dir,
		);
	});
});

test("agent/pre-step intercepts [SCHEDULE REMINDER BATCH] prompts and prevents LLM calls", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-hook-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "worker.ts");
	await writeFile(
		scriptPath,
		`
export function main(ctx) {
  return {
    state: { runs: (ctx.state?.runs || 0) + 1 },
    message: "done"
  };
}
`,
		"utf8",
	);

	const ctx = new Context();
	const appendedEvents: Array<{ name: string; args: string }> = [];

	const mockSession = {
		id: "sess-123",
		header: { cwd: dir },
		append(type: string, data: { name: string; args: string }) {
			if (type === "command/run") {
				appendedEvents.push(data);
			}
		},
	};

	const mockAgent = {
		id: "agent-123",
		session: mockSession,
	} as unknown as Agent;

	setupMockServices(ctx, {
		scheduleList: [
			{
				id: "sch-test",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: "sess-123" },
			},
		],
	});

	await apply(ctx);

	// 1. Regular prompt without [SCHEDULE REMINDER BATCH] should pass through next()
	let nextCalled = false;
	const passThrough = await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			signal: new AbortController().signal,
			messages: [{ content: [{ type: "text", text: "Regular message" }] }],
		} as unknown as PreStep,
		async () => {
			nextCalled = true;
			return { kind: "enter", messages: [] };
		},
	);

	assert.equal(nextCalled, true);
	assert.deepEqual(passThrough, { kind: "enter", messages: [] });
	assert.equal(appendedEvents.length, 0);

	// 2. Batch with dsh-schedule-script should be intercepted (silent poll)
	let bgNextCalled = false;
	const intercepted = await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			signal: new AbortController().signal,
			messages: [
				{
					content: [
						{
							type: "text",
							text: makeBatchText(
								formatScriptPrompt({ scriptPath, state: {} }),
							),
						},
					],
				},
			],
		} as unknown as PreStep,
		async () => {
			bgNextCalled = true;
			return { kind: "enter", messages: [] };
		},
	);

	assert.equal(bgNextCalled, false); // next was NOT called
	assert.deepEqual(intercepted, { kind: "reject" }); // 0 LLM tokens, turn closed cleanly
	assert.equal(appendedEvents.length, 1);
	assert.equal(appendedEvents[0].name, SCHEDULE_SCRIPT_EVENT_NAME);

	const parsed = JSON.parse(appendedEvents[0].args);
	assert.equal(parsed.action, "iteration");
	assert.deepEqual(parsed.state, { runs: 1 });
});

test("agent/pre-step wakes agent when script returns prompt", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-prompt-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "notifier.ts");
	await writeFile(
		scriptPath,
		`
export function main() {
  return {
    state: { checked: true },
    prompt: "Detected 3 pending notifications. Please review them."
  };
}
`,
		"utf8",
	);

	const ctx = new Context();
	const mockSession = {
		id: "sess-prompt",
		header: { cwd: dir },
		append() {},
	};
	const mockAgent = {
		id: "agent-prompt",
		session: mockSession,
	} as unknown as Agent;

	setupMockServices(ctx, {
		scheduleList: [
			{
				id: "sch-test",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: "sess-prompt" },
			},
		],
	});

	await apply(ctx);

	const messages = [
		{
			content: [
				{
					type: "text",
					text: makeBatchText(formatScriptPrompt({ scriptPath, state: {} })),
				},
			],
		},
	];

	let nextCalled = false;
	const result = await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			messages,
			signal: new AbortController().signal,
		} as unknown as PreStep,
		async () => {
			nextCalled = true;
			return { kind: "enter", messages: [] };
		},
	);

	assert.equal(nextCalled, true);
	assert.deepEqual(result, { kind: "enter", messages: [] });
	assert.match(messages[0].content[0].text, /Detected 3 pending notifications/);
});

test("agent/pre-step stops on critical unhandled errors without LLM prompt", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-crit-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "crash.ts");
	await writeFile(
		scriptPath,
		`
export function main() {
  throw new Error("Fatal database failure");
}
`,
		"utf8",
	);

	const ctx = new Context();
	const appendedEvents: Array<{ name: string; args: string }> = [];
	const mockSession = {
		id: "sess-crit",
		header: { cwd: dir },
		append(type: string, data: { name: string; args: string }) {
			if (type === "command/run") {
				appendedEvents.push(data);
			}
		},
	};
	const mockAgent = {
		id: "agent-crit",
		session: mockSession,
	} as unknown as Agent;

	setupMockServices(ctx, {
		scheduleList: [
			{
				id: "sch-test",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: "sess-crit" },
			},
		],
	});

	await apply(ctx);

	let nextCalled = false;
	const result = await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			signal: new AbortController().signal,
			messages: [
				{
					content: [
						{
							type: "text",
							text: makeBatchText(
								formatScriptPrompt({ scriptPath, state: {} }),
							),
						},
					],
				},
			],
		} as unknown as PreStep,
		async () => {
			nextCalled = true;
			return { kind: "enter", messages: [] };
		},
	);

	assert.equal(nextCalled, false);
	assert.deepEqual(result, { kind: "reject" });
	assert.equal(appendedEvents.length, 3);

	const errPayload = JSON.parse(appendedEvents[0].args);
	assert.equal(errPayload.action, "error");
	assert.equal(errPayload.fatal, true);
	assert.match(errPayload.error, /Fatal database failure/);

	const stopPayload = JSON.parse(appendedEvents[1].args);
	assert.equal(stopPayload.action, "stop");
	assert.match(stopPayload.reason, /critical_error/);
});

test("test_schedule_script tool runs script and returns execution details", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-test-tool-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "testable.ts");
	await writeFile(
		scriptPath,
		`
export function main(ctx) {
  return {
    state: { tested: true, val: ctx.state.val },
    prompt: "Ready to proceed"
  };
}
`,
		"utf8",
	);

	const ctx = new Context();
	const registeredTools = new Map<
		string,
		{ def: ToolDefinition; opts: ToolRegistrationOptions }
	>();

	ctx.provide("skills", { register: () => () => {} });
	ctx.schedule = {
		list: async () => ({
			items: [],
			shown: 0,
			total: 0,
			limit: 100,
			offset: 0,
		}),
		create: async () => {},
		edit: async () => {},
	};
	ctx.provide("tools", {
		register: (def: ToolDefinition, opts: ToolRegistrationOptions) => {
			registeredTools.set(def.name, { def, opts });
		},
	});
	ctx.provide("sessionProjections", {
		register: async () => ({
			stateOf: () => initialScheduleScriptSummary(),
			dispose: async () => {},
		}),
	});

	await apply(ctx);

	const testTool = registeredTools.get("test_schedule_script");
	assert.ok(testTool);

	const mockAgent = {
		id: "agent-tool",
		session: { id: "sess-tool", header: { cwd: dir } },
	};

	// 1. Successful execution
	const successOutput = toolResultSchema.parse(
		await testTool.def.execute(
			{ script_path: scriptPath, state: { val: 42 } },
			{ agent: mockAgent } as ToolRunContext,
		),
	);

	assert.equal(successOutput.success, true);
	assert.deepEqual(successOutput.state, { tested: true, val: 42 });
	assert.equal(successOutput.prompt, "Ready to proceed");
	assert.match(successOutput.message, /Test execution succeeded/);

	// 2. Failing execution with critical error
	const failOutput = toolResultSchema.parse(
		await testTool.def.execute(
			{ script_path: path.join(dir, "non-existent.ts"), state: {} },
			{ agent: mockAgent } as ToolRunContext,
		),
	);

	assert.equal(failOutput.success, false);
	assert.match(failOutput.message, /Test execution failed/);
});

test("plugin registers embedded skill and conditionally admits tools", async () => {
	const ctx = new Context();
	setupMockServices(ctx);
	const registeredSkills: Array<Parameters<Context["skills"]["register"]>[0]> =
		[];
	const registeredTools = new Map<
		string,
		{ def: ToolDefinition; opts: ToolRegistrationOptions }
	>();

	ctx.skills = {
		register: (skill) => {
			registeredSkills.push(skill);
			return () => {};
		},
	};

	ctx.tools.register = (def, opts = {}) => {
		registeredTools.set(def.name, { def, opts });
		return () => {};
	};

	await apply(ctx);

	assert.equal(registeredSkills[0].name, "schedule-script");

	assert.ok(registeredTools.has("test_schedule_script"));
	assert.ok(registeredTools.has("schedule_script"));

	for (const name of ["schedule_script", "test_schedule_script"]) {
		const registered = registeredTools.get(name);
		assert.ok(registered);
		assert.ok(registered.opts.when);
		assert.equal(
			registered.opts.when({
				agent: { session: { id: "inactive-sess" } },
			} as ToolActivationContext),
			false,
		);
	}
});

test.for([false, true])(
	"agent/pre-step silent poll handles cancellation: %s",
	async (cancel, { onTestFinished }) => {
		const dir = await mkdtemp(
			path.join(tmpdir(), "schedule-script-batch-silent-"),
		);
		onTestFinished(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		const scriptPath = path.join(dir, "silent.ts");
		await writeFile(
			scriptPath,
			`
export async function main(ctx) {
  ${cancel ? "await new Promise(resolve => setTimeout(resolve, 5000));" : ""}
  const count = (ctx.state?.count ?? 0) + 1;
  return { state: { count } };
}
`,
			"utf8",
		);

		const ctx = new Context();
		const appendedEvents: Array<{ name: string; args: string }> = [];
		const mockSession = {
			id: "sess-batch-silent",
			header: { cwd: dir },
			append(type: string, data: { name: string; args: string }) {
				if (type === "command/run") {
					appendedEvents.push(data);
				}
			},
		};
		const mockAgent = {
			id: "agent-batch-silent",
			session: mockSession,
		} as unknown as Agent;

		let deletions = 0;
		setupMockServices(ctx, {
			onScheduleEdit: () => {
				deletions++;
			},
			scheduleList: [
				{
					id: "sch-123",
					prompt: formatScriptPrompt({ scriptPath, state: {} }),
					target: { kind: "session", sessionId: "sess-batch-silent" },
				},
			],
		});

		await apply(ctx);

		const reminders = [
			{
				schedule_id: "sch-123",
				occurrence_at: "2026-11-10T21:35:00.000Z",
				reminder_prompt: formatScriptPrompt({ scriptPath, state: {} }),
			},
		];
		const batchText = `[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: ${JSON.stringify(reminders)}\nTime sampled while preparing turn 38, step 1: 2026-11-10T22:42:49+01:00[Europe/Vienna]\nBrowser time zone: unavailable\nElapsed: 3s.`;

		const messages = [
			{
				content: [Object.freeze({ type: "text", text: batchText })],
			},
		];

		const controller = new AbortController();
		const timer = cancel
			? setTimeout(() => controller.abort(), 100)
			: undefined;
		onTestFinished(() => clearTimeout(timer));
		let nextCalled = false;
		const run = ctx.waterfall(
			"agent/pre-step",
			{
				agent: mockAgent,
				messages,
				signal: controller.signal,
			} as unknown as PreStep,
			async () => {
				nextCalled = true;
				return { kind: "enter", messages: [] };
			},
		);

		if (cancel) {
			await assert.rejects(run);
			assert.equal(deletions, 0);
			assert.deepEqual(appendedEvents, []);
			assert.equal(nextCalled, false);
			return;
		}
		const result = await run;

		assert.equal(nextCalled, false);
		assert.deepEqual(result, { kind: "reject" });
		assert.equal(appendedEvents.length, 1);
		const iterPayload = JSON.parse(appendedEvents[0].args);
		assert.equal(iterPayload.action, "iteration");
		assert.deepEqual(iterPayload.state, { count: 1 });
	},
);

test("agent/pre-step intercepts [SCHEDULE REMINDER BATCH] and wakes agent when script returns prompt", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-batch-wake-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "wake.ts");
	await writeFile(
		scriptPath,
		`
export function main() {
  return {
    state: { done: true },
    prompt: "Alert: Recurring check detected threshold exceeded!"
  };
}
`,
		"utf8",
	);

	const ctx = new Context();
	const appendedEvents: Array<{ name: string; args: string }> = [];
	const mockSession = {
		id: "sess-batch-wake",
		header: { cwd: dir },
		append(type: string, data: { name: string; args: string }) {
			if (type === "command/run") {
				appendedEvents.push(data);
			}
		},
	};
	const mockAgent = {
		id: "agent-batch-wake",
		session: mockSession,
	} as unknown as Agent;

	setupMockServices(ctx, {
		scheduleList: [
			{
				id: "sch-wake",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: "sess-batch-wake" },
			},
		],
	});

	await apply(ctx);

	const reminders = [
		{
			schedule_id: "sch-wake",
			occurrence_at: "2026-11-10T21:35:00.000Z",
			reminder_prompt: formatScriptPrompt({ scriptPath, state: {} }),
		},
	];
	const batchText = `[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: ${JSON.stringify(reminders)}`;

	const messages = [
		{
			content: [Object.freeze({ type: "text", text: batchText })],
		},
	];

	let nextCalled = false;
	const result = await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			messages,
			signal: new AbortController().signal,
		} as unknown as PreStep,
		async () => {
			nextCalled = true;
			return { kind: "enter", messages: [] };
		},
	);

	assert.equal(nextCalled, true);
	assert.deepEqual(result, { kind: "enter", messages: [] });
	assert.match(
		messages[0].content[0].text,
		/Alert: Recurring check detected threshold exceeded!/,
	);
});

test("agent/pre-step retains non-script reminders when mixed with silent script", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(
		path.join(tmpdir(), "schedule-script-batch-mixed-"),
	);
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "silent.ts");
	await writeFile(
		scriptPath,
		`
export function main() {
  return { state: { ok: true } };
}
`,
		"utf8",
	);

	const ctx = new Context();
	let iterations = 0;
	const mockSession = {
		id: "sess-batch-mixed",
		header: { cwd: dir },
		append(type: string, data: { args: string }) {
			if (
				type === "command/run" &&
				JSON.parse(data.args).action === "iteration"
			)
				iterations++;
		},
	};
	const mockAgent = {
		id: "agent-batch-mixed",
		session: mockSession,
	} as unknown as Agent;

	setupMockServices(ctx, {
		scheduleList: [
			...Array.from({ length: 100 }, (_, i) => ({
				id: `other-${i}`,
				prompt: "Other task",
				target: { kind: "session", sessionId: "other-session" },
			})),
			{
				id: "sch-script",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: mockSession.id },
			},
		],
	});

	await apply(ctx);

	const reminders = [
		{
			schedule_id: "sch-script",
			reminder_prompt: formatScriptPrompt({ scriptPath, state: {} }),
		},
		{
			schedule_id: "sch-other",
			reminder_prompt: "Remind Alex about lunch",
		},
	];
	const batchText = `[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: ${JSON.stringify(reminders)}`;

	const messages = [
		{
			content: [Object.freeze({ type: "text", text: batchText })],
		},
	];

	let nextCalled = false;
	const result = await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			messages,
			signal: new AbortController().signal,
		} as unknown as PreStep,
		async () => {
			nextCalled = true;
			return { kind: "enter", messages: [] };
		},
	);

	assert.equal(nextCalled, true);
	assert.deepEqual(result, { kind: "enter", messages: [] });
	assert.match(messages[0].content[0].text, /Remind Alex about lunch/);
	assert.doesNotMatch(messages[0].content[0].text, /sch-script/);
	assert.equal(iterations, 1);
});

test.for([
	"inactive",
	"path",
	"state",
	"timeout",
	"non-script",
	"other-session",
	"unbound",
])(
	"agent/pre-step rejects unauthorized reminder: %s",
	async (scenario, { onTestFinished }) => {
		const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-inactive-"));
		onTestFinished(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		const scriptPath = path.join(dir, "unverified.ts");
		await writeFile(
			scriptPath,
			`
export function main() {
  return { state: { ran: true } };
}
`,
			"utf8",
		);

		const ctx = new Context();
		const appendedEvents: Array<{ name: string; args: string }> = [];
		const mockSession = {
			id: "sess-inactive-check",
			header: { cwd: dir },
			append(
				type: string,
				data: {
					name: string;
					args: string;
					source: { kind: string };
					kind: string;
				},
			) {
				if (type === "command/run") {
					appendedEvents.push(data);
				}
			},
		};
		const mockAgent = {
			id: "agent-inactive",
			session: mockSession,
		} as unknown as Agent;

		const stored = { scriptPath, state: {}, timeoutMs: 5000 };
		setupMockServices(ctx, {
			scheduleList: [
				{
					id: scenario === "inactive" ? "sch-other-active" : "sch-unauthorized",
					prompt:
						scenario === "non-script"
							? "Ordinary reminder"
							: formatScriptPrompt(stored),
					target: {
						kind: scenario === "unbound" ? "new" : "session",
						sessionId: scenario === "other-session" ? "other" : mockSession.id,
					},
				},
			],
		});

		await apply(ctx);

		const reminders = [
			{
				schedule_id: "sch-unauthorized",
				reminder_prompt: formatScriptPrompt({
					...stored,
					...(scenario === "path"
						? { scriptPath: path.join(dir, "substituted.ts") }
						: {}),
					...(scenario === "state" ? { state: { substituted: true } } : {}),
					...(scenario === "timeout" ? { timeoutMs: 10 } : {}),
				}),
			},
		];
		const batchText = `[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: ${JSON.stringify(reminders)}`;

		let nextCalled = false;
		const result = await ctx.waterfall(
			"agent/pre-step",
			{
				agent: mockAgent,
				signal: new AbortController().signal,
				messages: [
					{ content: [Object.freeze({ type: "text", text: batchText })] },
				],
			} as unknown as PreStep,
			async () => {
				nextCalled = true;
				return { kind: "enter", messages: [] };
			},
		);

		// Mismatched or unbound reminders pass through without execution.
		assert.equal(nextCalled, true);
		assert.deepEqual(result, { kind: "enter", messages: [] });
		assert.equal(appendedEvents.length, 0); // No execution happened!
	},
);

test("A1: tool admission activates session on tool/call with arguments property", async () => {
	const ctx = new Context();
	const registeredTools = new Map<
		string,
		{ def: ToolDefinition; opts: ToolRegistrationOptions }
	>();

	setupMockServices(ctx);
	ctx.tools.register = (def, opts = {}) => {
		registeredTools.set(def.name, { def, opts });
		return () => {};
	};

	await apply(ctx);

	const mockSession = { id: "sess-arguments" };
	const mockAgent = { id: "agent-arguments", session: mockSession };

	const scheduleTool = registeredTools.get("schedule_script");
	assert.ok(scheduleTool);
	assert.ok(scheduleTool.opts.when);
	// Initially gated
	assert.equal(
		scheduleTool.opts.when({ agent: mockAgent } as ToolActivationContext),
		false,
	);

	// Emit tool/call with arguments (canonical DSH event shape)
	ctx.emit(
		"session/event",
		mockSession as unknown as Session,
		{
			type: "tool/call",
			data: {
				callId: "call-1",
				name: "skill",
				arguments: JSON.stringify({ name: "schedule-script" }),
			},
		} as SessionEvent,
	);

	// Now admitted!
	assert.equal(
		scheduleTool.opts.when({ agent: mockAgent } as ToolActivationContext),
		true,
	);
});

test.for(["deleted", "missing", "rejected", "retry", "fatal-retry"])(
	"stop plus prompt handles task deletion: %s",
	async (outcome, { onTestFinished }) => {
		const dir = await mkdtemp(
			path.join(tmpdir(), "schedule-script-stop-test-"),
		);
		onTestFinished(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		const scriptPath = path.join(dir, "stopper.ts");
		await writeFile(
			scriptPath,
			`
export function main() {
  ${outcome === "fatal-retry" ? 'throw new Error("Original fatal error");' : 'return { state: {}, stop: true, prompt: "Task finished" };'}
}
`,
			"utf8",
		);

		const ctx = new Context();
		const appendedEvents: Array<{
			type: string;
			data: {
				name: string;
				args: string;
				source: { kind: string };
				kind: string;
			};
		}> = [];
		const deletedScheduleIds: string[] = [];

		const mockSession = {
			id: "sess-stop",
			header: { cwd: dir },
			append(
				type: string,
				data: {
					name: string;
					args: string;
					source: { kind: string };
					kind: string;
				},
			) {
				appendedEvents.push({ type, data });
				if (type === "command/run")
					ctx.emit("session/event", mockAgent.session, {
						type,
						data: { name: data.name, args: data.args },
					} as SessionEvent);
			},
		};
		const mockAgent = {
			id: "agent-stop",
			session: mockSession,
		} as unknown as Agent;

		setupMockServices(ctx, {
			scheduleList: [
				{
					id: "sch-stopper",
					prompt: formatScriptPrompt({ scriptPath, state: {} }),
					target: { kind: "session", sessionId: "sess-stop" },
				},
			],
			onScheduleEdit: (req) => {
				deletedScheduleIds.push(req.id);
				if (
					outcome === "rejected" ||
					((outcome === "retry" || outcome === "fatal-retry") &&
						deletedScheduleIds.length === 1)
				)
					throw new Error("Storage unavailable");
				return outcome === "missing"
					? { id: req.id, code: "schedule_not_found" }
					: { id: req.id, deleted: true };
			},
		});

		await apply(ctx);

		const messages = [
			{
				content: [
					{
						type: "text",
						text: makeBatchText(
							formatScriptPrompt({ scriptPath, state: {} }),
							"sch-stopper",
						),
					},
				],
			},
		];

		const deliver = () =>
			ctx.waterfall(
				"agent/pre-step",
				{
					agent: mockAgent,
					messages,
					signal: new AbortController().signal,
				} as unknown as PreStep,
				async () => ({ kind: "enter", messages: [] }),
			);
		await deliver();

		if (outcome !== "fatal-retry")
			assert.match(messages[0].content[0].text, /Task finished/);
		if (
			outcome === "rejected" ||
			outcome === "retry" ||
			outcome === "fatal-retry"
		) {
			messages[0].content[0].text = makeBatchText(
				formatScriptPrompt({ scriptPath, state: {} }),
				"sch-stopper",
			);
			assert.deepEqual(await deliver(), { kind: "reject" });
			assert.equal(
				appendedEvents.filter(
					(e) =>
						e.type === "command/run" &&
						JSON.parse(e.data.args).action === "iteration",
				).length,
				outcome === "fatal-retry" ? 0 : 1,
			);
		}
		const payloads = appendedEvents
			.filter((e) => e.type === "command/run")
			.map((e) => JSON.parse(e.data.args));
		assert.deepEqual(
			payloads.map((p) => p.action),
			outcome === "fatal-retry"
				? ["error", "stop", "cleanup", "cleanup"]
				: outcome === "rejected" || outcome === "retry"
					? ["iteration", "stop", "cleanup", "cleanup"]
					: ["iteration", "stop", "cleanup"],
		);
		if (
			outcome === "rejected" ||
			outcome === "retry" ||
			outcome === "fatal-retry"
		) {
			assert.equal(payloads[2].action, "cleanup");
			assert.match(payloads[2].error, /schedule.*Storage unavailable/);
		}
		let replay = initialScheduleScriptSummary();
		for (const event of appendedEvents) {
			if (event.type === "command/run")
				replay = foldScheduleScriptEvent(replay, {
					type: "command/run",
					data: { name: event.data.name, args: event.data.args },
				} as SessionEvent);
		}
		assert.equal(replay.cleanupPending, outcome === "rejected");
		if (outcome === "fatal-retry")
			assert.equal(replay.lastError?.message, "Original fatal error");
		// Verified schedule cancellation
		assert.deepEqual(
			deletedScheduleIds,
			outcome === "rejected" || outcome === "retry" || outcome === "fatal-retry"
				? ["sch-stopper", "sch-stopper"]
				: ["sch-stopper"],
		);

		// Verified command/run has source: { kind: "user" } and is paired with command/done
		const runEvents = appendedEvents.filter((e) => e.type === "command/run");
		const doneEvents = appendedEvents.filter((e) => e.type === "command/done");
		assert.ok(runEvents.length >= 2); // iteration + stop
		assert.equal(runEvents.length, doneEvents.length);
		for (const run of runEvents) {
			assert.deepEqual(run.data.source, { kind: "user" });
		}
		for (const done of doneEvents) {
			assert.equal(
				done.data.kind,
				outcome === "fatal-retry" && done === doneEvents[0]
					? "error"
					: "success",
			);
		}
	},
);

test("A3: agent/pre-step locates [SCHEDULE REMINDER BATCH] even when it is not messages[0]", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-multi-msg-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "worker.ts");
	await writeFile(
		scriptPath,
		`
export function main() {
  return { state: {}, prompt: "Awake from message 1" };
}
`,
		"utf8",
	);

	const ctx = new Context();
	const mockSession = {
		id: "sess-multi",
		header: { cwd: dir },
		append() {},
	};
	const mockAgent = {
		id: "agent-multi",
		session: mockSession,
	} as unknown as Agent;

	setupMockServices(ctx, {
		scheduleList: [
			{
				id: "sch-multi",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: "sess-multi" },
			},
		],
	});

	await apply(ctx);

	const messages = [
		{ content: [{ type: "text", text: "User sent some text earlier" }] },
		{
			content: [
				{
					type: "text",
					text: makeBatchText(
						formatScriptPrompt({ scriptPath, state: {} }),
						"sch-multi",
					),
				},
			],
		},
	];

	let nextCalled = false;
	await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			messages,
			signal: new AbortController().signal,
		} as unknown as PreStep,
		async () => {
			nextCalled = true;
			return { kind: "enter", messages: [] };
		},
	);

	assert.equal(nextCalled, true);
	// Message at index 1 was updated with waking prompt
	assert.match(messages[1].content[0].text, /Awake from message 1/);
});

test("A4: runner-cli preserves prompt and stop with explicit state", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(
		path.join(tmpdir(), "schedule-script-omitted-state-"),
	);
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "pure-signal.ts");
	await writeFile(
		scriptPath,
		`
export function main() {
  return { state: {}, prompt: "Task finished!", stop: true };
}
`,
		"utf8",
	);

	const res = await executeScript(
		scriptPath,
		{ state: null, sessionId: "test-omitted" },
		5000,
		dir,
	);

	assert.equal(res.prompt, "Task finished!");
	assert.equal(res.stop, true);
});

test("A1: ScheduleService.list paged result filters out tasks targeted to other sessions", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(
		path.join(tmpdir(), "schedule-script-session-filter-"),
	);
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "filter.ts");
	await writeFile(
		scriptPath,
		"export function main() { return { state: {}, prompt: 'Filtered run' }; }",
		"utf8",
	);

	const ctx = new Context();
	const mockSession = {
		id: "sess-matching",
		header: { cwd: dir },
		append() {},
	};
	const mockAgent = {
		id: "agent-filter",
		session: mockSession,
	} as unknown as Agent;

	setupMockServices(ctx, {
		scheduleList: [
			{
				id: "sch-other",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: "sess-other" },
			},
			{
				id: "sch-matching",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: "sess-matching" },
			},
		],
	});

	await apply(ctx);

	// Batch containing only sch-other should not execute
	const otherMessages = [
		{
			content: [
				{
					type: "text",
					text: makeBatchText(
						formatScriptPrompt({ scriptPath, state: {} }),
						"sch-other",
					),
				},
			],
		},
	];
	let otherExecuted = false;
	await ctx.waterfall(
		"agent/pre-step",
		{ agent: mockAgent, messages: otherMessages } as unknown as PreStep,
		async () => {
			otherExecuted = true;
			return { kind: "enter", messages: [] };
		},
	);
	assert.equal(otherExecuted, true);
	assert.equal(
		otherMessages[0].content[0].text.startsWith("[SCHEDULE REMINDER BATCH]"),
		true,
	);

	// Batch containing sch-matching executes and replaces text
	const matchingMessages = [
		{
			content: [
				{
					type: "text",
					text: makeBatchText(
						formatScriptPrompt({ scriptPath, state: {} }),
						"sch-matching",
					),
				},
			],
		},
	];
	await ctx.waterfall(
		"agent/pre-step",
		{ agent: mockAgent, messages: matchingMessages } as unknown as PreStep,
		async () => ({ kind: "enter", messages: [] }),
	);
	assert.match(matchingMessages[0].content[0].text, /Filtered run/);
});

test.for(["same", "different"])(
	"one active schedule at creation and delivery: %s",
	async (scenario, { onTestFinished }) => {
		const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-reinit-"));
		onTestFinished(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		const script1 = path.join(dir, "task1.ts");
		const script2 = path.join(dir, "task2.ts");
		await writeFile(
			script1,
			"export function main() { return { state: {}, stop: true }; }",
			"utf8",
		);
		await writeFile(
			script2,
			"export function main() { return { state: {}, prompt: 'Task 2 running' }; }",
			"utf8",
		);

		const ctx = new Context();
		let currentSummaryState: ScheduleScriptSummary = {
			...initialScheduleScriptSummary(),
			scriptStatus: "stopped" as const,
			scriptPath: script1,
		};
		ctx.provide("sessionProjections", {
			register: async () => ({
				stateOf: () => currentSummaryState,
				dispose: async () => {},
			}),
		});

		const registeredTools = new Map<
			string,
			{ def: ToolDefinition; opts: ToolRegistrationOptions }
		>();
		ctx.provide("tools", {
			register: (def: ToolDefinition, opts: ToolRegistrationOptions) => {
				registeredTools.set(def.name, { def, opts });
			},
		});

		const createdSchedules: ScheduleCreateRequest[] = [];
		ctx.schedule = {
			list: async () => ({
				items:
					createdSchedules.length === 0
						? []
						: [
								{
									id: "sch-new",
									title: "Task 2",
									prompt: formatScriptPrompt({
										scriptPath: script2,
										state: { initialized: true },
									}),
									status: "active" as const,
									target: { kind: "session", sessionId: "sess-reinit" },
								},
							],
				shown: 1,
				total: 1,
				limit: 100,
				offset: 0,
			}),
			create: async (req) => {
				createdSchedules.push(req);
			},
			edit: async () => {},
		};
		ctx.skills = { register: () => () => {} };

		await apply(ctx);

		const mockSession = {
			id: "sess-reinit",
			header: { cwd: dir },
			append(
				type: string,
				data: {
					name: string;
					args: string;
					source: { kind: string };
					kind: string;
				},
			) {
				if (type === "command/run") {
					currentSummaryState = foldScheduleScriptEvent(currentSummaryState, {
						type: "command/run",
						data: { name: SCHEDULE_SCRIPT_EVENT_NAME, args: data.args },
					} as SessionEvent);
				}
			},
		};
		const mockAgent = {
			id: "agent-reinit",
			session: mockSession,
		} as unknown as Agent;

		const toolContext = { agent: mockAgent } as ToolRunContext;
		// Execute schedule_script tool for task2
		const scheduleTool = registeredTools.get("schedule_script");
		assert.ok(scheduleTool);
		const schedResult = toolResultSchema.parse(
			await scheduleTool.def.execute(
				{
					script_path: script2,
					title: "Task 2",
					interval_seconds: 60,
					state: { initialized: true },
				},
				toolContext,
			),
		);
		assert.equal(schedResult.success, true);
		assert.equal(createdSchedules.length, 1);
		assert.equal(currentSummaryState.scriptStatus, "idle");
		const duplicate = toolResultSchema.parse(
			await scheduleTool.def.execute(
				{
					script_path: scenario === "same" ? script2 : script1,
					title: "Duplicate",
					interval_seconds: 60,
					state: {},
				},
				toolContext,
			),
		);
		assert.equal(duplicate.success, false);
		assert.equal(createdSchedules.length, 1);

		// Pre-step should now execute task2 without being blocked by prior stopped status
		const messages = [
			{
				content: [
					{
						type: "text",
						text: makeBatchText(
							formatScriptPrompt({
								scriptPath: script2,
								state: { initialized: true },
							}),
							"sch-new",
						),
					},
				],
			},
		];
		const deliver = () =>
			ctx.waterfall(
				"agent/pre-step",
				{
					agent: mockAgent,
					messages,
					signal: new AbortController().signal,
				} as unknown as PreStep,
				async () => ({ kind: "enter", messages: [] }),
			);
		await deliver();
		assert.match(messages[0].content[0].text, /Task 2 running/);
		const before = currentSummaryState;
		const list = ctx.schedule.list;
		ctx.schedule.list = async (request) => {
			const page = await list(request);
			return {
				...page,
				items: [
					...page.items,
					{
						...page.items[0],
						id: "second",
						prompt: formatScriptPrompt({
							scriptPath: scenario === "same" ? script2 : script1,
							state: {},
						}),
					},
				],
				total: 2,
			};
		};
		messages[0].content[0].text = makeBatchText(
			createdSchedules[0].prompt,
			"sch-new",
		);
		await deliver();
		assert.match(messages[0].content[0].text, /Multiple active/);
		assert.equal(currentSummaryState, before);
	},
);

test("A3: executeScript terminates subprocess on AbortSignal", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-abort-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "sleep.ts");
	await writeFile(
		scriptPath,
		`
export async function main() {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return { state: {}, prompt: "Finished sleep" };
}
`,
		"utf8",
	);

	const controller = new AbortController();
	setTimeout(() => controller.abort(), 100);

	await assert.rejects(
		async () => {
			await executeScript(
				scriptPath,
				{ state: null, sessionId: "test-abort" },
				5000,
				dir,
				controller.signal,
			);
		},
		(err: Error) => {
			assert.ok(
				err.name === "AbortError" ||
					(err.cause instanceof Error && err.cause.name === "AbortError"),
			);
			return true;
		},
	);
});

test("A4: ScheduleScriptPill renders on first-run fatal error when totalRuns is 0", () => {
	// 1. Idle with 0 runs should return false
	assert.equal(
		shouldRenderPill({
			scriptStatus: "idle",
			totalRuns: 0,
		}),
		false,
	);

	// 2. Fatal error with 0 runs should return true
	assert.equal(
		shouldRenderPill({
			scriptStatus: "error",
			totalRuns: 0,
			lastError: {
				message: "Fatal script compile failure",
				timestamp: 12345,
				fatal: true,
			},
		}),
		true,
	);
});

test("A10: runner-cli and executeScript preserve original script error stack", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-stack-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "throw-stack.ts");
	await writeFile(
		scriptPath,
		`
export function main() {
  throw new Error("Explicit script error with stack");
}
`,
		"utf8",
	);

	await assert.rejects(
		async () => {
			await executeScript(
				scriptPath,
				{ state: null, sessionId: "test-stack" },
				5000,
				dir,
			);
		},
		(err: Error) => {
			assert.match(err.message, /Explicit script error with stack/);
			assert.ok(
				err.stack && err.stack.includes("throw-stack.ts"),
				"Stack must reference original user script file",
			);
			return true;
		},
	);
});

test("foldScheduleScriptEvent handles action: skill and shouldRenderPill renders for active scheduled state", () => {
	const initial = initialScheduleScriptSummary();
	assert.equal(initial.skillInvoked, false);
	assert.equal(shouldRenderPill(initial), false);

	const afterSkill = foldScheduleScriptEvent(initial, {
		type: "command/run",
		data: {
			name: SCHEDULE_SCRIPT_EVENT_NAME,
			args: JSON.stringify({
				action: "skill",
				timestamp: 1000,
			}),
		},
	} as SessionEvent);

	assert.equal(afterSkill.skillInvoked, true);
	assert.ok(toScheduleScriptRecord(afterSkill) !== null);

	// When started even with 0 runs, pill must be visible
	const activeStarted: ScheduleScriptSummary = {
		scriptStatus: "idle",
		totalRuns: 0,
		scriptPath: "test.ts",
	};
	assert.equal(shouldRenderPill(activeStarted), true);
});

test("foldScheduleScriptEvent satisfies the plain-JSON contract across all actions", () => {
	let state = initialScheduleScriptSummary();
	assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

	// start must not produce own properties with undefined values (e.g. lastError: undefined)
	state = foldScheduleScriptEvent(state, {
		type: "command/run",
		data: {
			name: SCHEDULE_SCRIPT_EVENT_NAME,
			args: JSON.stringify({
				action: "start",
				scriptPath: "test.ts",
				state: { count: 0 },
				timestamp: 1000,
			}),
		},
	} as SessionEvent);
	assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

	// iteration without prompt and error must not produce lastError/lastPrompt: undefined
	state = foldScheduleScriptEvent(state, {
		type: "command/run",
		data: {
			name: SCHEDULE_SCRIPT_EVENT_NAME,
			args: JSON.stringify({
				action: "iteration",
				scriptPath: "test.ts",
				iteration: 1,
				durationMs: 15,
				timestamp: 2000,
				prompt: "",
				error: "",
			}),
		},
	} as SessionEvent);
	assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

	// iteration without state must not produce state: undefined
	state = foldScheduleScriptEvent(state, {
		type: "command/run",
		data: {
			name: SCHEDULE_SCRIPT_EVENT_NAME,
			args: JSON.stringify({
				action: "iteration",
				scriptPath: "test.ts",
				iteration: 2,
				durationMs: 15,
				timestamp: 3000,
			}),
		},
	} as SessionEvent);
	assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

	// stop must preserve plain-JSON contract
	state = foldScheduleScriptEvent(state, {
		type: "command/run",
		data: {
			name: SCHEDULE_SCRIPT_EVENT_NAME,
			args: JSON.stringify({
				action: "stop",
				reason: "done",
				timestamp: 4000,
			}),
		},
	} as SessionEvent);
	assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test("schedule_script seeds initial mandatory state which folds into summary and reaches script", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(
		path.join(tmpdir(), "schedule-script-mandatory-state-"),
	);
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "seed.ts");
	await writeFile(
		scriptPath,
		`
export function main(ctx) {
  return {
    state: { ...ctx.state, run: true, count: ctx.state.count + 1 },
    prompt: "seeded successfully"
  };
}
`,
		"utf8",
	);

	const ctx = new Context();
	let currentSummaryState = initialScheduleScriptSummary();
	const registeredTools = new Map<
		string,
		{ def: ToolDefinition; opts: ToolRegistrationOptions }
	>();
	ctx.provide("tools", {
		register: (def: ToolDefinition, opts: ToolRegistrationOptions) => {
			registeredTools.set(def.name, { def, opts });
		},
	});
	ctx.provide("sessionProjections", {
		register: async () => ({
			stateOf: () => currentSummaryState,
			dispose: async () => {},
		}),
	});

	const createdSchedules: ScheduleCreateRequest[] = [];
	ctx.schedule = {
		list: async () => ({
			items:
				createdSchedules.length === 0
					? []
					: [
							{
								id: "sch-seed",
								title: "Seed Task",
								prompt: createdSchedules[0].prompt,
								status: "active" as const,
								target: { kind: "session", sessionId: "sess-seed" },
							},
						],
			shown: 1,
			total: 1,
			limit: 100,
			offset: 0,
		}),
		create: async (req) => {
			createdSchedules.push(req);
		},
		edit: async () => {},
	};
	ctx.skills = { register: () => () => {} };

	await apply(ctx);

	const mockSession = {
		id: "sess-seed",
		header: { cwd: dir },
		append(
			type: string,
			data: {
				name: string;
				args: string;
				source: { kind: string };
				kind: string;
			},
		) {
			if (type === "command/run") {
				currentSummaryState = foldScheduleScriptEvent(currentSummaryState, {
					type: "command/run",
					data: { name: SCHEDULE_SCRIPT_EVENT_NAME, args: data.args },
				} as SessionEvent);
			}
		},
	};
	const mockAgent = {
		id: "agent-seed",
		session: mockSession,
	} as unknown as Agent;

	const scheduleTool = registeredTools.get("schedule_script");
	assert.ok(scheduleTool);

	// Schedule with mandatory initial state
	const schedResult = toolResultSchema.parse(
		await scheduleTool.def.execute(
			{
				script_path: scriptPath,
				title: "Seed Task",
				interval_seconds: 60,
				state: { count: 10, endpoint: "https://example.com" },
			},
			{ agent: mockAgent } as ToolRunContext,
		),
	);
	assert.equal(schedResult.success, true);
	// Start event folded initial state into summary!
	assert.deepEqual(currentSummaryState.state, {
		count: 10,
		endpoint: "https://example.com",
	});

	// Trigger execution via pre-step reminder batch
	const messages = [
		{
			content: [
				{
					type: "text",
					text: makeBatchText(createdSchedules[0].prompt, "sch-seed"),
				},
			],
		},
	];

	await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			messages,
			signal: new AbortController().signal,
		} as unknown as PreStep,
		async () => ({ kind: "enter", messages: [] }),
	);

	// Script ran and accumulated state
	assert.deepEqual(currentSummaryState.state, {
		count: 11,
		endpoint: "https://example.com",
		run: true,
	});
	assert.match(messages[0].content[0].text, /seeded successfully/);
});

test("agent/pre-step waterfall suppresses outer context middleware on silent poll by returning kind: reject", async ({
	onTestFinished,
}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "schedule-script-reject-"));
	onTestFinished(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const scriptPath = path.join(dir, "silent.ts");
	await writeFile(
		scriptPath,
		`
export function main(ctx) {
  return { state: { runs: (ctx.state?.runs ?? 0) + 1 } };
}
`,
		"utf8",
	);

	const ctx = new Context();
	setupMockServices(ctx, {
		scheduleList: [
			{
				id: "sch-test",
				prompt: formatScriptPrompt({ scriptPath, state: {} }),
				target: { kind: "session", sessionId: "sess-waterfall-reject" },
			},
		],
	});

	await apply(ctx);

	let contextInjected = false;
	ctx.on(
		"agent/pre-step",
		async (_payload, next) => {
			const decision = await next();
			if (decision.kind === "reject") return decision;
			contextInjected = true;
			const timeMessage = {
				...decision.messages[0],
				content: [{ type: "text" as const, text: "Time sampled: 2026-11-11" }],
				source: { kind: "user" as const },
			};
			return {
				...decision,
				messages: [...decision.messages, timeMessage],
			};
		},
		{ prepend: true },
	);

	const mockSession = {
		id: "sess-waterfall-reject",
		header: { cwd: dir },
		append() {},
	};
	const mockAgent = {
		id: "agent-waterfall-reject",
		session: mockSession,
	} as unknown as Agent;

	const messages = [
		{
			content: [
				{
					type: "text",
					text: makeBatchText(formatScriptPrompt({ scriptPath, state: {} })),
				},
			],
		},
	];

	const decision = await ctx.waterfall(
		"agent/pre-step",
		{
			agent: mockAgent,
			signal: new AbortController().signal,
			messages,
			turn: 1,
			step: 1,
			modelSelection: { provider: "mock", model: "mock" },
		} as unknown as Parameters<
			Parameters<typeof ctx.on<"agent/pre-step">>[1]
		>[0],
		async () => ({ kind: "enter", messages: [] }),
	);

	assert.deepEqual(decision, { kind: "reject" });
	assert.equal(contextInjected, false);
});

test("formatDuration formats milliseconds to seconds with one decimal", () => {
	assert.equal(formatDuration(undefined), "0.0s");
	assert.equal(formatDuration(0), "0.0s");
	assert.equal(formatDuration(104), "0.1s");
	assert.equal(formatDuration(1234), "1.2s");
	assert.equal(formatDuration(95), "0.1s");
	assert.equal(formatDuration(2500), "2.5s");
});

test("shouldRenderPill respects paused, stopped, and deleted lifecycle states", () => {
	// Idle with runs (active schedule)
	assert.equal(
		shouldRenderPill({
			scriptStatus: "idle",
			totalRuns: 2,
			scriptPath: "watcher.ts",
		}),
		true,
	);

	// Idle with paused schedule status
	assert.equal(
		shouldRenderPill(
			{
				scriptStatus: "idle",
				totalRuns: 2,
				scriptPath: "watcher.ts",
			},
			"paused",
		),
		true,
	);

	// Active with scriptPath (even with 0 runs) when schedule is paused
	assert.equal(
		shouldRenderPill(
			{ scriptStatus: "idle", totalRuns: 0, scriptPath: "watcher.ts" },
			"paused",
		),
		true,
	);

	// Deleted with runs remains visible in stopped state
	assert.equal(
		shouldRenderPill(
			{ scriptStatus: "idle", totalRuns: 2, scriptPath: "watcher.ts" },
			"deleted",
		),
		true,
	);

	// Deleted with 0 runs is hidden (no zombie button)
	assert.equal(
		shouldRenderPill(
			{ scriptStatus: "idle", totalRuns: 0, scriptPath: "watcher.ts" },
			"deleted",
		),
		false,
	);

	// Ended with 0 runs is hidden
	assert.equal(
		shouldRenderPill(
			{ scriptStatus: "idle", totalRuns: 0, scriptPath: "watcher.ts" },
			"ended",
		),
		false,
	);

	// Stopped with 0 runs is hidden
	assert.equal(
		shouldRenderPill({
			scriptStatus: "stopped",
			totalRuns: 0,
			scriptPath: "watcher.ts",
		}),
		false,
	);

	// Stopped with 0 runs but with fatal error remains visible to inspect crash
	assert.equal(
		shouldRenderPill({
			scriptStatus: "stopped",
			totalRuns: 0,
			scriptPath: "watcher.ts",
			lastError: {
				message: "Fatal bootstrap failure",
				fatal: true,
				timestamp: Date.now(),
			},
		}),
		true,
	);

	// Error with 0 runs remains visible
	assert.equal(
		shouldRenderPill({
			scriptStatus: "error",
			totalRuns: 0,
			scriptPath: "watcher.ts",
			lastError: {
				message: "Script failed on first run",
				fatal: false,
				timestamp: Date.now(),
			},
		}),
		true,
	);

	// Ended/deleted with 0 runs but with lastError remains visible
	assert.equal(
		shouldRenderPill(
			{
				scriptStatus: "idle",
				totalRuns: 0,
				scriptPath: "watcher.ts",
				lastError: {
					message: "Failed before delete",
					fatal: false,
					timestamp: Date.now(),
				},
			},
			"deleted",
		),
		true,
	);
});

test.for([
	"{ count: 1 }",
	"{ prompt: 'done', stop: true }",
	"{ state: undefined }",
	"{ state: {}, prompt: 1 }",
	"{ state: {}, error: false }",
	"{ state: {}, stop: 'true' }",
])("runner rejects invalid result envelope: %s", async (expression) => {
	await using dir = await import("node:fs/promises").then((fs) =>
		fs.mkdtempDisposable(path.join(tmpdir(), "schedule-result-")),
	);
	const script = path.join(dir.path, "result.ts");
	await writeFile(script, `export function main() { return ${expression}; }`);
	await assert.rejects(
		executeScript(script, { state: {}, sessionId: "result" }, 5000, dir.path),
		/Invalid script result/i,
	);
});

test("runner preserves reserved state keys and explicit null state", async () => {
	await using dir = await import("node:fs/promises").then((fs) =>
		fs.mkdtempDisposable(path.join(tmpdir(), "schedule-result-")),
	);
	const script = path.join(dir.path, "result.ts");
	await writeFile(
		script,
		"export function main({state}) { return { state }; }",
	);
	for (const state of [
		null,
		{ prompt: "data", error: "data", stop: true, state: "data" },
	]) {
		assert.deepEqual(
			await executeScript(
				script,
				{ state, sessionId: "result" },
				5000,
				dir.path,
			),
			{ state },
		);
	}
});
