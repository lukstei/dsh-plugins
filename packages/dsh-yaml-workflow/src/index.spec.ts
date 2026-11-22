/**
 * PURPOSE: Unit tests for Cordis plugin entrypoint (src/index.ts).
 * CONTRACT: Tests plugin registration, slash commands (/wf, /wf-resume, /wf-abort), and save_output tool.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Context, Logger } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
	CommandDefinition,
	CommandInvocation,
} from "@deepseek-ai/dsh-commands";
import { CommandId } from "@deepseek-ai/dsh-commands";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { expect, test, vi } from "vitest";
import { WorkflowTestRunner } from "./e2e/test-runner.ts";
import {
	foldWorkflowEvent,
	foldWorkflowState,
	initialWorkflowRunSummary,
} from "./fold.ts";
import { apply, inject, name, WORKFLOW_EVENT_NAME } from "./index.ts";
import { executeWorkflow } from "./runner.ts";
import type { WorkflowRunSummary } from "./types.ts";

test("plain Node imports the built JavaScript package entry", () => {
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`
		import assert from "node:assert/strict";
		assert.ok(import.meta.resolve("@lukstei/dsh-yaml-workflow").endsWith("/dist/index.js"));
		const plugin = await import("@lukstei/dsh-yaml-workflow");
		assert.equal(plugin.name, "dsh-workflow-runner");
		assert.equal(typeof plugin.apply, "function");
		assert.deepEqual(plugin.inject, ["commands", "sessionProjections", "subagents", "tools", "skills"]);
	`,
		],
		{
			cwd: fileURLToPath(new URL("../", import.meta.url)),
			env: { ...process.env, NODE_OPTIONS: "" },
		},
	);
});

function createMockContext() {
	const sessionStates = new Map<string, WorkflowRunSummary>();
	const listeners = new Set<(session: Session, event: SessionEvent) => void>();
	const registeredCommands = new Map<string, CommandDefinition>();
	const registeredTools = new Map<string, ToolDefinition>();
	const logs: { warn: string[]; info: string[]; error: string[] } = {
		warn: [],
		info: [],
		error: [],
	};

	const logger: Logger = {
		name: "dsh-workflow-runner",
		info(msg: string) {
			logs.info.push(msg);
		},
		warn(msg: string) {
			logs.warn.push(msg);
		},
		error(msg: string) {
			logs.error.push(msg);
		},
		debug() {},
	} as unknown as Logger;

	let registeredSkill: unknown = null;
	const skills = {
		register(skill: unknown) {
			registeredSkill = skill;
			return () => {
				registeredSkill = null;
			};
		},
	};

	const ctx = {
		effect(fn: () => (() => void) | undefined) {
			return fn();
		},
		logger() {
			return logger;
		},
		skills,
		commands: {
			register(cmd: CommandDefinition) {
				registeredCommands.set(cmd.name, cmd);
			},
		},
		tools: {
			register(
				tool: ToolDefinition,
				opts?: { when?: (ctx: { agent?: unknown }) => boolean },
			) {
				registeredTools.set(tool.name, tool);
				if (opts) registeredToolOpts.set(tool.name, opts);
			},
		},
		sessionProjections: {
			register(def: {
				init: () => WorkflowRunSummary;
				apply: (
					state: WorkflowRunSummary,
					event: SessionEvent,
				) => WorkflowRunSummary;
			}) {
				const handle = {
					stateOf(session: Session) {
						const existingState = sessionStates.get(session.id);
						if (existingState) {
							return existingState;
						}
						if (typeof session.snapshotEvents === "function") {
							const events = session.snapshotEvents();
							return events.reduce(
								(acc: WorkflowRunSummary, ev: SessionEvent) =>
									def.apply(acc, ev),
								def.init(),
							);
						}
						return def.init();
					},
					dispose: async () => {},
				};
				return Promise.resolve(handle);
			},
		},
		emit() {},
		on(
			_event: string,
			listener: (session: Session, event: SessionEvent) => void,
		) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};

	const registeredToolOpts = new Map<
		string,
		{ when?: (ctx: { agent?: unknown }) => boolean }
	>();

	return {
		ctx,
		registeredCommands,
		registeredTools,
		registeredToolOpts,
		sessionStates,
		getRegisteredSkill: () => registeredSkill,
		logs,
		publish(session: Session, event: SessionEvent) {
			const sid = session.id;
			const current = sessionStates.get(sid) ?? initialWorkflowRunSummary();
			sessionStates.set(sid, foldWorkflowEvent(current, event));
			for (const listener of [...listeners]) listener(session, event);
		},
	};
}

test("plugin metadata exports", () => {
	assert.equal(name, "dsh-workflow-runner");
	assert.deepEqual(inject, [
		"commands",
		"sessionProjections",
		"subagents",
		"tools",
		"skills",
	]);
});

test("apply registers commands and tool", async () => {
	const { ctx, registeredCommands, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);

	assert.ok(registeredCommands.has("wf"));
	assert.ok(registeredCommands.has("wf-resume"));
	assert.ok(registeredCommands.has("wf-abort"));
	assert.ok(registeredCommands.has("wf-list"));
	assert.ok(registeredCommands.has("wf-validate"));
	assert.ok(registeredTools.has("save_output"));
	assert.ok(registeredTools.has("wf_validate"));
});

test("apply throws when injected tools service is missing", async () => {
	const { ctx } = createMockContext();
	const ctxNoTools = { ...ctx, tools: undefined };
	await assert.rejects(
		async () => apply(ctxNoTools as unknown as Context),
		TypeError,
	);
});

test("save_output tool: render helper returns formatted text", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);

	const tool = registeredTools.get("save_output");
	assert.ok(tool);
	const rendered = tool.output.render(
		{ name: "token", value: "abc" },
		{ success: true, message: "Saved token" },
	);
	assert.deepEqual(rendered, [{ type: "text", text: "Saved token" }]);
});

test("save_output tool: when admission guard admits only actively running workflows", async () => {
	const { ctx, registeredToolOpts } = createMockContext();
	await apply(ctx as unknown as Context);

	const opts = registeredToolOpts.get("save_output");
	assert.ok(opts?.when);

	// Inactive session: false
	const inactiveSession = { id: "sess-inactive", snapshotEvents: () => [] };
	assert.equal(
		opts.when({
			agent: {
				session: inactiveSession as unknown as Session,
			} as unknown as Agent,
		}),
		false,
	);

	// Active running session: true
	const activeSession = {
		id: "sess-1",
		snapshotEvents: () => [
			{
				type: "command/run",
				data: {
					name: WORKFLOW_EVENT_NAME,
					args: JSON.stringify({
						action: "init",
						sessionId: "sess-1",
						runId: "run-1",
						invocation: {
							targetPath: "wf.yaml",
							resolvedArgs: {},
							runId: "run-1",
						},
						workflow: {
							name: "Test Flow",
							steps: [{ kind: "prompt", prompt: "Step 1" }],
						},
					}),
				},
			},
		],
	};
	assert.equal(
		opts.when({
			agent: {
				session: activeSession as unknown as Session,
			} as unknown as Agent,
		}),
		true,
	);
});

test("plugin registers embedded skill", async () => {
	const { ctx, getRegisteredSkill } = createMockContext();
	await apply(ctx as unknown as Context);

	const skill = getRegisteredSkill() as {
		name: string;
		description: string;
		content: string;
	} | null;
	assert.ok(skill);
	assert.equal(skill.name, "yaml-workflow");
	assert.ok(skill.description.length > 0);
	assert.ok(skill.content.includes("YAML Workflow Skill"));
});

test("wf_validate tool: when admission guard admits on skill invocation or workflow activity", async () => {
	const { ctx, registeredToolOpts } = createMockContext();
	await apply(ctx as unknown as Context);

	const opts = registeredToolOpts.get("wf_validate");
	assert.ok(opts?.when);

	// 1. Inactive session: false
	const inactiveSession = { id: "sess-inactive", snapshotEvents: () => [] };
	assert.equal(
		opts.when({
			agent: {
				session: inactiveSession as unknown as Session,
			} as unknown as Agent,
		}),
		false,
	);

	// 2. Session with skill tool call: true
	const skillSession = {
		id: "sess-skill",
		snapshotEvents: () => [
			{
				type: "tool/call",
				data: {
					name: "skill",
					arguments: JSON.stringify({ name: "yaml-workflow" }),
				},
			},
		],
	};
	assert.equal(
		opts.when({
			agent: {
				session: skillSession as unknown as Session,
			} as unknown as Agent,
		}),
		true,
	);

	// 3. Session with wf slash command: true
	const commandSession = {
		id: "sess-cmd",
		snapshotEvents: () => [
			{
				type: "command/run",
				data: {
					name: "wf",
					args: "deploy.yaml",
				},
			},
		],
	};
	assert.equal(
		opts.when({
			agent: {
				session: commandSession as unknown as Session,
			} as unknown as Agent,
		}),
		true,
	);

	// 4. Session with active running workflow: true
	const runningSession = {
		id: "sess-running",
		snapshotEvents: () => [
			{
				type: "command/run",
				data: {
					name: WORKFLOW_EVENT_NAME,
					args: JSON.stringify({
						action: "init",
						sessionId: "sess-running",
						runId: "run-1",
						invocation: {
							targetPath: "wf.yaml",
							resolvedArgs: {},
							runId: "run-1",
						},
						workflow: {
							name: "Test Flow",
							steps: [{ kind: "prompt", prompt: "Step 1" }],
						},
					}),
				},
			},
		],
	};
	assert.equal(
		opts.when({
			agent: {
				session: runningSession as unknown as Session,
			} as unknown as Agent,
		}),
		true,
	);
});

test("save_output tool execute: fails when agent session is missing", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);

	const tool = registeredTools.get("save_output");
	assert.ok(tool);

	const res = await tool.execute({ name: "token", value: "val" }, {
		agent: undefined,
	} as unknown as Parameters<typeof tool.execute>[1]);

	assert.deepEqual(res, {
		success: false,
		message: "No active agent session",
	});
});

test("save_output tool execute: fails when no active workflow run exists", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);
	const tool = registeredTools.get("save_output");
	assert.ok(tool);

	const mockAgent = {
		id: "sess-1",
		session: {
			snapshotEvents() {
				return [];
			},
		},
	};

	const res = await tool.execute({ name: "token", value: "val" }, {
		agent: mockAgent,
	} as unknown as Parameters<typeof tool.execute>[1]);

	assert.deepEqual(res, {
		success: false,
		message: "No active workflow run found",
	});
});

test("save_output tool execute: fails when workflow is not running", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);
	const tool = registeredTools.get("save_output");
	assert.ok(tool);

	const mockAgent = {
		id: "sess-1",
		session: {
			snapshotEvents() {
				return [
					{
						type: "command/run",
						data: {
							commandId: "wf-init",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "init",
								sessionId: "sess-1",
								runId: "run-1",
								invocation: {
									targetPath: "wf.yaml",
									resolvedArgs: {},
									runId: "run-1",
								},
								workflow: {
									name: "Test Flow",
									steps: [{ kind: "prompt", prompt: "Step 1" }],
								},
							}),
						},
					},
					{
						type: "command/run",
						data: {
							commandId: "wf-state",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "state",
								sessionId: "sess-1",
								runId: "run-1",
								status: "paused",
								stepIndex: 0,
							}),
						},
					},
				];
			},
		},
	};

	const res = await tool.execute({ name: "token", value: "val" }, {
		agent: mockAgent,
	} as unknown as Parameters<typeof tool.execute>[1]);

	assert.deepEqual(res, {
		success: false,
		message: "Workflow is not currently running",
	});
});

test("save_output tool execute: fails when current step declares no outputs", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);
	const tool = registeredTools.get("save_output");
	assert.ok(tool);

	const mockAgent = {
		id: "sess-1",
		session: {
			snapshotEvents() {
				return [
					{
						type: "command/run",
						data: {
							commandId: "wf-init",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "init",
								sessionId: "sess-1",
								runId: "run-1",
								invocation: {
									targetPath: "wf.yaml",
									resolvedArgs: {},
									runId: "run-1",
								},
								workflow: {
									name: "Test Flow",
									steps: [{ kind: "prompt", prompt: "Step 1" }],
								},
							}),
						},
					},
					{
						type: "command/run",
						data: {
							commandId: "wf-state",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "state",
								sessionId: "sess-1",
								runId: "run-1",
								status: "running",
								stepIndex: 0,
							}),
						},
					},
				];
			},
		},
	};

	const res = await tool.execute({ name: "token", value: "val" }, {
		agent: mockAgent,
	} as unknown as Parameters<typeof tool.execute>[1]);

	assert.deepEqual(res, {
		success: false,
		message: "Current step 1 does not declare any outputs",
	});
});

test("save_output tool execute: fails when output name is undeclared or non-string", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);
	const tool = registeredTools.get("save_output");
	assert.ok(tool);

	const mockAgent = {
		id: "sess-1",
		session: {
			snapshotEvents() {
				return [
					{
						type: "command/run",
						data: {
							commandId: "wf-init",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "init",
								sessionId: "sess-1",
								runId: "run-1",
								invocation: {
									targetPath: "wf.yaml",
									resolvedArgs: {},
									runId: "run-1",
								},
								workflow: {
									name: "Test Flow",
									steps: [
										{
											kind: "prompt",
											prompt: "Step 1",
											outputs: {
												report: { type: "file", path: "out.md" },
											},
										},
									],
								},
							}),
						},
					},
					{
						type: "command/run",
						data: {
							commandId: "wf-state",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "state",
								sessionId: "sess-1",
								runId: "run-1",
								status: "running",
								stepIndex: 0,
							}),
						},
					},
				];
			},
		},
	};

	const res = await tool.execute({ name: "report", value: "val" }, {
		agent: mockAgent,
	} as unknown as Parameters<typeof tool.execute>[1]);

	assert.deepEqual(res, {
		success: false,
		message:
			"Current step does not declare a string or list output named 'report'",
	});
});

test("save_output tool execute: successfully saves output and appends events", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);
	const tool = registeredTools.get("save_output");
	assert.ok(tool);

	const appended: { type: string; data: unknown }[] = [];
	const mockAgent = {
		id: "sess-1",
		session: {
			snapshotEvents() {
				return [
					{
						type: "command/run",
						data: {
							commandId: "wf-init",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "init",
								sessionId: "sess-1",
								runId: "run-1",
								invocation: {
									targetPath: "wf.yaml",
									resolvedArgs: {},
									runId: "run-1",
								},
								workflow: {
									name: "Test Flow",
									steps: [
										{
											kind: "prompt",
											prompt: "Step 1",
											outputs: {
												token: { type: "string" },
											},
										},
									],
								},
							}),
						},
					},
					{
						type: "command/run",
						data: {
							commandId: "wf-state",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "state",
								sessionId: "sess-1",
								runId: "run-1",
								status: "running",
							}),
						},
					},
				];
			},
			append(type: string, data: unknown) {
				appended.push({ type, data });
			},
		},
	};

	const res = await tool.execute({ name: "token", value: "secret-xyz" }, {
		agent: mockAgent,
	} as unknown as Parameters<typeof tool.execute>[1]);

	assert.deepEqual(res, {
		success: true,
		message: "Successfully saved output 'token'",
	});
	assert.equal(appended.length, 2);
	assert.equal(appended[0].type, "command/run");
	assert.equal(
		(appended[0].data as { name: string }).name,
		WORKFLOW_EVENT_NAME,
	);
	assert.equal(appended[1].type, "command/done");

	const runPayload = JSON.parse((appended[0].data as { args: string }).args);
	assert.equal(runPayload.action, "output");
	assert.equal(runPayload.name, "token");
	assert.equal(runPayload.value, "secret-xyz");
	assert.equal(runPayload.outputType, "string");
});

test("save_output tool execute: validates and saves list outputs with bounds", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);
	const tool = registeredTools.get("save_output");
	assert.ok(tool);

	const appended: { type: string; data: unknown }[] = [];
	const createMockAgent = (outputDef: Record<string, unknown>) => ({
		id: "sess-list",
		session: {
			snapshotEvents() {
				return [
					{
						type: "command/run",
						data: {
							commandId: "wf-init",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "init",
								sessionId: "sess-list",
								runId: "sess-list-run",
								workflow: {
									steps: [
										{
											kind: "prompt",
											name: "Step 1",
											prompt: "Generate list",
											outputs: outputDef,
										},
									],
								},
								invocation: {
									targetPath: "test.yaml",
									resolvedArgs: {},
									runId: "sess-list-run",
								},
							}),
						},
					},
					{
						type: "command/run",
						data: {
							commandId: "wf-state",
							name: WORKFLOW_EVENT_NAME,
							args: JSON.stringify({
								action: "state",
								sessionId: "sess-list",
								runId: "sess-list-run",
								status: "running",
								stepIndex: 0,
							}),
						},
					},
				];
			},
			append(type: string, data: unknown) {
				appended.push({ type, data });
			},
		},
	});

	// Fails when value is not a valid JSON array
	const failAgent = createMockAgent({
		items: { type: "list", min: 1, max: 3 },
	});
	const nonArrayRes = (await tool.execute(
		{ name: "items", value: "not-json" },
		{ agent: failAgent } as unknown as Parameters<typeof tool.execute>[1],
	)) as { success: boolean; message: string };
	assert.equal(nonArrayRes.success, false);
	assert.match(nonArrayRes.message, /could not parse value as JSON array/);

	// Fails when array contains non-string items
	const nonStringRes = (await tool.execute(
		{ name: "items", value: JSON.stringify(["valid", 123]) },
		{ agent: failAgent } as unknown as Parameters<typeof tool.execute>[1],
	)) as { success: boolean; message: string };
	assert.equal(nonStringRes.success, false);
	assert.match(nonStringRes.message, /contains non-string elements/);

	// Fails when array violates min items
	const minRes = (await tool.execute({ name: "items", value: "[]" }, {
		agent: failAgent,
	} as unknown as Parameters<typeof tool.execute>[1])) as {
		success: boolean;
		message: string;
	};
	assert.equal(minRes.success, false);
	assert.match(minRes.message, /requires at least 1 items/);

	// Fails when array violates max items
	const maxRes = (await tool.execute(
		{ name: "items", value: JSON.stringify(["a", "b", "c", "d"]) },
		{ agent: failAgent } as unknown as Parameters<typeof tool.execute>[1],
	)) as { success: boolean; message: string };
	assert.equal(maxRes.success, false);
	assert.match(maxRes.message, /allows at most 3 items/);

	// Succeeds when valid array within bounds
	const successRes = await tool.execute(
		{ name: "items", value: JSON.stringify(["item-1", "item-2"]) },
		{ agent: failAgent } as unknown as Parameters<typeof tool.execute>[1],
	);
	assert.deepEqual(successRes, {
		success: true,
		message: "Successfully saved output 'items'",
	});
	const lastEvent = appended[appended.length - 2];
	const payload = JSON.parse((lastEvent.data as { args: string }).args);
	assert.equal(payload.action, "output");
	assert.equal(payload.name, "items");
	assert.equal(payload.outputType, "list");
	assert.deepEqual(JSON.parse(payload.value), ["item-1", "item-2"]);

	const results = [];
	for (const { value, bounds } of [
		{ value: "not-json", bounds: { min: 1, max: 3 } },
		{ value: '"text"', bounds: { min: 1, max: 3 } },
		{ value: '["a",1]', bounds: { min: 1, max: 3 } },
		{ value: "[]", bounds: { min: 1, max: 3 } },
		{ value: '["a"]', bounds: { min: 1, max: 3 } },
		{ value: '["a","b","c"]', bounds: { min: 1, max: 3 } },
		{ value: '["a","b","c","d"]', bounds: { min: 1, max: 3 } },
		{ value: "[]", bounds: {} },
		{ value: "[]", bounds: { min: 0, max: 0 } },
	]) {
		const outputs = { items: { type: "list", ...bounds } };
		const agent = createMockAgent(outputs);
		// cast: the local agent implements only the session methods used by save_output.
		const submitted = await tool.execute({ name: "items", value }, {
			agent,
		} as unknown as Parameters<typeof tool.execute>[1]);
		const runner = new WorkflowTestRunner({
			behavior: {
				outputs: [{ stepIndex: 0, list: { name: "items", value } }],
			},
		});
		runner.registerWorkflow(
			"list.yaml",
			JSON.stringify({
				steps: [
					{ prompt: "Generate list", outputs },
					{ print: "Items: {{outputs.items}}" },
				],
			}),
		);
		const verified = await executeWorkflow({
			effects: runner,
			targetPath: "list.yaml",
			runId: "list-validation-run",
		});
		const run = runner.getLatestRun();
		assert.ok(run, JSON.stringify(verified));
		results.push({
			value,
			bounds,
			submitted,
			verified,
			promptCount: runner.dispatchedPrompts.length,
			outputs: run.state.outputs,
		});
	}
	expect(results).toMatchInlineSnapshot(`
		[
		  {
		    "bounds": {
		      "max": 3,
		      "min": 1,
		    },
		    "outputs": undefined,
		    "promptCount": 3,
		    "submitted": {
		      "message": "Output 'items' is declared as type 'list', but could not parse value as JSON array.",
		      "success": false,
		    },
		    "value": "not-json",
		    "verified": {
		      "kind": "error",
		      "text": "Workflow execution failed at step 1/2: Step 1 output verification failed after 3 attempts",
		    },
		  },
		  {
		    "bounds": {
		      "max": 3,
		      "min": 1,
		    },
		    "outputs": {
		      "items": "text",
		    },
		    "promptCount": 3,
		    "submitted": {
		      "message": "Output 'items' is declared as type 'list', but received non-array value. Expected JSON array string.",
		      "success": false,
		    },
		    "value": ""text"",
		    "verified": {
		      "kind": "error",
		      "text": "Workflow execution failed at step 1/2: Step 1 output verification failed after 3 attempts",
		    },
		  },
		  {
		    "bounds": {
		      "max": 3,
		      "min": 1,
		    },
		    "outputs": {
		      "items": [
		        "a",
		        1,
		      ],
		    },
		    "promptCount": 3,
		    "submitted": {
		      "message": "Output 'items' is declared as type 'list', but contains non-string elements. Expected JSON array of strings.",
		      "success": false,
		    },
		    "value": "["a",1]",
		    "verified": {
		      "kind": "error",
		      "text": "Workflow execution failed at step 1/2: Step 1 output verification failed after 3 attempts",
		    },
		  },
		  {
		    "bounds": {
		      "max": 3,
		      "min": 1,
		    },
		    "outputs": {
		      "items": [],
		    },
		    "promptCount": 3,
		    "submitted": {
		      "message": "Output 'items' requires at least 1 items, but received 0.",
		      "success": false,
		    },
		    "value": "[]",
		    "verified": {
		      "kind": "error",
		      "text": "Workflow execution failed at step 1/2: Step 1 output verification failed after 3 attempts",
		    },
		  },
		  {
		    "bounds": {
		      "max": 3,
		      "min": 1,
		    },
		    "outputs": {
		      "items": [
		        "a",
		      ],
		    },
		    "promptCount": 1,
		    "submitted": {
		      "message": "Successfully saved output 'items'",
		      "success": true,
		    },
		    "value": "["a"]",
		    "verified": {
		      "kind": "success",
		      "text": "Completed workflow (2 steps)",
		    },
		  },
		  {
		    "bounds": {
		      "max": 3,
		      "min": 1,
		    },
		    "outputs": {
		      "items": [
		        "a",
		        "b",
		        "c",
		      ],
		    },
		    "promptCount": 1,
		    "submitted": {
		      "message": "Successfully saved output 'items'",
		      "success": true,
		    },
		    "value": "["a","b","c"]",
		    "verified": {
		      "kind": "success",
		      "text": "Completed workflow (2 steps)",
		    },
		  },
		  {
		    "bounds": {
		      "max": 3,
		      "min": 1,
		    },
		    "outputs": {
		      "items": [
		        "a",
		        "b",
		        "c",
		        "d",
		      ],
		    },
		    "promptCount": 3,
		    "submitted": {
		      "message": "Output 'items' allows at most 3 items, but received 4.",
		      "success": false,
		    },
		    "value": "["a","b","c","d"]",
		    "verified": {
		      "kind": "error",
		      "text": "Workflow execution failed at step 1/2: Step 1 output verification failed after 3 attempts",
		    },
		  },
		  {
		    "bounds": {},
		    "outputs": {
		      "items": [],
		    },
		    "promptCount": 1,
		    "submitted": {
		      "message": "Successfully saved output 'items'",
		      "success": true,
		    },
		    "value": "[]",
		    "verified": {
		      "kind": "success",
		      "text": "Completed workflow (2 steps)",
		    },
		  },
		  {
		    "bounds": {
		      "max": 0,
		      "min": 0,
		    },
		    "outputs": {
		      "items": [],
		    },
		    "promptCount": 1,
		    "submitted": {
		      "message": "Successfully saved output 'items'",
		      "success": true,
		    },
		    "value": "[]",
		    "verified": {
		      "kind": "success",
		      "text": "Completed workflow (2 steps)",
		    },
		  },
		]
	`);
});

test("/wf command: returns validation error for missing workflow file", async () => {
	const { ctx, registeredCommands } = createMockContext();
	await apply(ctx as unknown as Context);
	const wfCmd = registeredCommands.get("wf");
	assert.ok(wfCmd);

	const res = await wfCmd.handler({
		rawInput: "missing.yaml",
		agent: {
			id: "test-sess",
			session: {
				header: { cwd: "/tmp" },
				snapshotEvents: () => [],
			},
		},
	} as unknown as CommandInvocation);

	assert.equal(res.kind, "error");
	assert.ok(res.text);
	assert.match(res.text, /not found/);
});

test("/wf command: validates and records a request on success", async () => {
	const { ctx, registeredCommands, publish } = createMockContext();
	await apply(ctx as unknown as Context);
	const wfCmd = registeredCommands.get("wf");
	assert.ok(wfCmd);

	const appended: Array<{ type: string; data: unknown }> = [];
	const testDir = await import("node:fs/promises").then(async (fs) => {
		const os = await import("node:os");
		const path = await import("node:path");
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-wf-cmd-"));
		await fs.writeFile(
			path.join(dir, "flow.yaml"),
			'name: Valid Flow\nsteps:\n  - print: "All good"\n',
			"utf8",
		);
		return dir;
	});

	try {
		// smell: this mock supplies only the Agent surface exercised by the plugin.
		const agent = {
			id: "sess-success",
			session: {
				header: { cwd: testDir },
				snapshotEvents: () => appended,
				append(type: string, data: unknown) {
					appended.push({ type, data });
					// smell: the mock publishes the canonical envelope for its supplied event type.
					publish(agent.session, {
						type,
						data,
						seq: appended.length - 1,
						time: 0,
					} as SessionEvent);
				},
			},
			followup: () => {},
			whenIdle: () => Promise.resolve(),
		} as unknown as Agent;
		const commandId = CommandId("accepted-command");
		agent.session.append("command/run", {
			commandId,
			name: "wf",
			args: "flow.yaml",
			source: { kind: "user" },
		});
		const res = await wfCmd.handler({
			rawInput: "flow.yaml",
			agent,
			commandId,
			attachments: [],
			signal: new AbortController().signal,
		});

		assert.deepEqual(res, { kind: "success", text: "Workflow queued" });
		assert.equal(foldWorkflowState(appended), null);
		agent.session.append("command/done", { commandId, ...res });
		await vi.waitFor(() =>
			assert.equal(foldWorkflowState(appended)?.state.status, "completed"),
		);
	} finally {
		const fs = await import("node:fs/promises");
		await fs.rm(testDir, { recursive: true, force: true });
	}
});

test("/wf-resume and /wf-abort command handlers invoke corresponding workflows", async () => {
	const { ctx, registeredCommands } = createMockContext();
	await apply(ctx as unknown as Context);

	const resumeCmd = registeredCommands.get("wf-resume");
	assert.ok(resumeCmd);
	const abortCmd = registeredCommands.get("wf-abort");
	assert.ok(abortCmd);

	const mockAgent = {
		id: "sess-1",
		session: {
			header: { cwd: "/tmp" },
			snapshotEvents: () => [],
			append: () => {},
		},
		whenIdle: () => Promise.resolve(),
	};

	const resumeRes = await resumeCmd.handler({
		rawInput: "user guidance",
		agent: mockAgent,
	} as unknown as CommandInvocation);
	// No interrupted workflow found
	assert.equal(resumeRes.kind, "error");
	assert.ok(resumeRes.text?.includes("No interrupted workflow found"));

	const abortRes = await abortCmd.handler({
		rawInput: "",
		agent: mockAgent,
	} as unknown as CommandInvocation);
	// Workflow not active
	assert.equal(abortRes.kind, "error");
	assert.ok(abortRes.text?.includes("No active workflow to discard"));

	const validateCmd = registeredCommands.get("wf-validate");
	assert.ok(validateCmd);
	const validateRes = await validateCmd.handler({
		rawInput: "",
		agent: mockAgent,
	} as unknown as CommandInvocation);
	assert.equal(validateRes.kind, "error");
	assert.equal(
		validateRes.text,
		"Usage: /wf-validate <workflow.yaml> [key=value ...]",
	);
});

test.each(["complete", "stop", "fail"] as const)(
	"/wf-resume acknowledges before prompt settlement and survives request cancellation: %s",
	async (outcome) => {
		const { ctx, registeredCommands, publish } = createMockContext();
		await apply(ctx as unknown as Context);
		const resume = registeredCommands.get("wf-resume");
		assert.ok(resume);
		const runner = new WorkflowTestRunner({
			sessionId: `resume-admission-${outcome}`,
		});
		runner.registerWorkflow(
			"resume.yaml",
			"steps:\n  - prompt: work\n  - print: done",
		);
		runner.onPrompt = () => runner.abortController.abort({ kind: "pause" });
		await executeWorkflow({ effects: runner, targetPath: "resume.yaml" });
		assert.equal(foldWorkflowState(runner.events)?.state.status, "paused");

		const prompt = Promise.withResolvers<void>();
		const messages: Parameters<Agent["followup"]>[0][] = [];
		// smell: this agent supplies only the runtime surface used by workflow effects.
		const agent = {
			id: runner.sessionId,
			session: {
				snapshotEvents: () => runner.events,
				append(type: string, data: unknown) {
					runner.events.push({ type, data });
					// smell: the mock publishes canonical envelopes for the supplied event type.
					publish(agent.session, {
						type,
						data,
						seq: runner.events.length - 1,
						time: 0,
					} as SessionEvent);
				},
			},
			followup(message: Parameters<Agent["followup"]>[0]) {
				messages.push(message);
			},
			whenIdle: () =>
				messages.length === 0 ? Promise.resolve() : prompt.promise,
		} as unknown as Agent;
		const request = new AbortController();
		const invocation: CommandInvocation = {
			agent,
			commandId: CommandId("resume-command"),
			rawInput: " skip a2",
			attachments: [],
			signal: request.signal,
		};
		let acknowledgement: Awaited<ReturnType<typeof resume.handler>> | undefined;
		const command = Promise.resolve(resume.handler(invocation)).then(
			(result) => {
				acknowledgement = result;
				return result;
			},
		);
		try {
			await vi.waitFor(
				() =>
					assert.deepEqual(acknowledgement, {
						kind: "success",
						text: "Workflow resume accepted",
					}),
				{ timeout: 200 },
			);
			await vi.waitFor(() => assert.equal(messages.length, 1));
			assert.match(JSON.stringify(messages[0]), /skip a2/);
			assert.match(JSON.stringify(messages[0]), /workflow-resume/);
			assert.equal((await resume.handler(invocation)).kind, "error");
			request.abort();
			if (outcome === "stop") {
				// smell: only the aborted turn fact is relevant to this session observer.
				publish(agent.session, {
					type: "turn/end",
					data: { reason: { kind: "aborted" } },
				} as SessionEvent);
			}
			if (outcome === "fail") prompt.reject(new Error("prompt failed"));
			else prompt.resolve();
			await vi.waitFor(() =>
				assert.equal(
					foldWorkflowState(runner.events)?.state.status,
					outcome === "complete"
						? "completed"
						: outcome === "stop"
							? "paused"
							: "aborted",
				),
			);
		} finally {
			prompt.resolve();
			await command;
		}
	},
);

test("wf_validate tool: render helper returns formatted text", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);

	const tool = registeredTools.get("wf_validate");
	assert.ok(tool);
	const rendered = tool.output.render(
		{ target: "test.yaml" },
		{ success: true, message: "Valid workflow" },
	);
	assert.deepEqual(rendered, [{ type: "text", text: "Valid workflow" }]);
});

test("wf_validate tool execute: fails when agent session is missing", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);

	const tool = registeredTools.get("wf_validate");
	assert.ok(tool);

	const res = await tool.execute({ target: "test.yaml" }, {
		agent: undefined,
	} as unknown as Parameters<typeof tool.execute>[1]);

	assert.deepEqual(res, {
		success: false,
		message: "No active agent session",
	});
});

test("wf_validate tool execute: validates workflow target and returns diagnostics", async () => {
	const { ctx, registeredTools } = createMockContext();
	await apply(ctx as unknown as Context);

	const tool = registeredTools.get("wf_validate");
	assert.ok(tool);

	const mockAgent = {
		id: "sess-1",
		session: {
			header: { cwd: "/tmp" },
			snapshotEvents: () => [],
			append: () => {},
		},
		whenIdle: () => Promise.resolve(),
	};

	// 1. Error case (missing file)
	const errRes = (await tool.execute({ target: "nonexistent.yaml" }, {
		agent: mockAgent,
	} as unknown as Parameters<typeof tool.execute>[1])) as {
		success: boolean;
		message: string;
	};
	assert.equal(errRes.success, false);
	assert.match(errRes.message, /Failed to load workflow/);

	// 2. Error case with args
	const emptyRes = (await tool.execute({ target: "", args: "foo=bar" }, {
		agent: mockAgent,
	} as unknown as Parameters<typeof tool.execute>[1])) as {
		success: boolean;
		message: string;
	};
	assert.equal(emptyRes.success, false);
	assert.equal(emptyRes.message, "Target workflow path is required");

	// 3. Success case with valid workflow file
	const fs = await import("node:fs/promises");
	const os = await import("node:os");
	const path = await import("node:path");
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-wf-validate-tool-"));
	try {
		await fs.writeFile(
			path.join(dir, "valid.yaml"),
			'name: Valid Tool Flow\nsteps:\n  - print: "ok"\n',
			"utf8",
		);
		const validAgent = {
			id: "sess-valid",
			session: {
				header: { cwd: dir },
				snapshotEvents: () => [],
				append: () => {},
			},
			whenIdle: () => Promise.resolve(),
		};
		const successRes = (await tool.execute({ target: "valid.yaml" }, {
			agent: validAgent,
		} as unknown as Parameters<typeof tool.execute>[1])) as {
			success: boolean;
			message: string;
		};
		assert.equal(successRes.success, true);
		assert.match(successRes.message, /Valid Tool Flow/);

		// 4. Success case with path containing whitespace
		await fs.writeFile(
			path.join(dir, "my flow.yaml"),
			'name: Space Flow\nsteps:\n  - print: "ok"\n',
			"utf8",
		);
		const spaceRes = (await tool.execute({ target: "my flow.yaml" }, {
			agent: validAgent,
		} as unknown as Parameters<typeof tool.execute>[1])) as {
			success: boolean;
			message: string;
		};
		assert.equal(spaceRes.success, true);
		assert.match(spaceRes.message, /Space Flow/);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});
