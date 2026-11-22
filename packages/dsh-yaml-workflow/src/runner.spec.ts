/**
 * PURPOSE: Integration tests for workflow runner, persistence, Cordis commands, and agent execution.
 * ALLOWED: Async tests, WorkflowTestRunner in-memory execution, mock DSH contexts.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
	CommandDefinition,
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { expect, test } from "vitest";
import { resolveResumeCommand, sendResumeCommand } from "./client/actions.ts";
import {
	clearWorkflowState,
	getWorkflowState,
	registerWorkflowChatNodes,
	setWorkflowState,
	subscribeWorkflowState,
	workflowStateDefinition,
} from "./client/store.ts";
import { WorkflowTestRunner } from "./e2e/test-runner.ts";
import { DshWorkflowEffectContext } from "./effects.ts";
import {
	apply,
	discardWorkflow,
	executeValidatedWorkflow,
	executeWorkflow,
	formatStepPrompt,
	inject,
	interpolateTemplate,
	listWorkflows,
	name,
	parseInvocationInput,
	resolveWorkflowArgs,
	resumeWorkflow,
	validateWorkflowInvocation,
	validateWorkflowTarget,
	WORKFLOW_EVENT_NAME,
	WorkflowArgSchema,
	type WorkflowPayload,
	type WorkflowRun,
} from "./index.ts";
import type {
	SubagentDispatchResult,
	WorkflowDocument,
	WorkflowEffect,
} from "./types.ts";

function parseCmdPayload(event: {
	readonly type: string;
	readonly data?: unknown;
}): WorkflowPayload | null {
	if (event.type !== "command/run") return null;
	const record = event.data as
		| { readonly name?: string; readonly args?: string }
		| undefined;
	if (typeof record?.args !== "string") return null;
	try {
		return JSON.parse(record.args) as WorkflowPayload;
	} catch {
		return null;
	}
}

test("resume and discard preserve diagnostics from arbitrary idle failures", async () => {
	const results = [];
	for (const thrown of [new Error("Agent busy"), "Idle service failed", null]) {
		const runner = new WorkflowTestRunner();
		runner.whenIdle = () => Promise.reject(thrown);
		results.push({
			resume: await resumeWorkflow({ effects: runner }),
			discard: await discardWorkflow({ effects: runner }),
		});
	}
	expect(results).toMatchInlineSnapshot(`
		[
		  {
		    "discard": {
		      "kind": "error",
		      "text": "Workflow discard failed: Agent busy",
		    },
		    "resume": {
		      "kind": "error",
		      "text": "Workflow resume failed: Agent busy",
		    },
		  },
		  {
		    "discard": {
		      "kind": "error",
		      "text": "Workflow discard failed: Idle service failed",
		    },
		    "resume": {
		      "kind": "error",
		      "text": "Workflow resume failed: Idle service failed",
		    },
		  },
		  {
		    "discard": {
		      "kind": "error",
		      "text": "Workflow discard failed: null",
		    },
		    "resume": {
		      "kind": "error",
		      "text": "Workflow resume failed: null",
		    },
		  },
		]
	`);
});

test("filesystem verification errors stop execution without output retries", async () => {
	const runner = new WorkflowTestRunner();
	runner.registerWorkflow(
		"file.yaml",
		`steps:
  - prompt: Write a report
    outputs:
      report:
        type: file
        path: report.md
        base: workspace
  - print: "Report: {{outputs.report}}"`,
	);
	runner.checkFileWritten = () =>
		Promise.reject(
			Object.assign(new Error("Permission denied"), { code: "EACCES" }),
		);
	const result = await executeWorkflow({
		effects: runner,
		targetPath: "file.yaml",
		runId: "file-error-run",
	});
	expect({
		result,
		promptCount: runner.dispatchedPrompts.length,
	}).toMatchInlineSnapshot(`
		{
		  "promptCount": 1,
		  "result": {
		    "kind": "error",
		    "text": "Workflow execution failed at step 1/2: Permission denied",
		  },
		}
	`);
});

function createMockRunnerContext(options?: {
	registered?: Map<string, CommandDefinition>;
	registeredTools?: Map<string, unknown>;
	loggedWarns?: string[];
}) {
	return {
		effect() {},
		on() {
			return () => {};
		},
		commands: {
			register(cmd: CommandDefinition) {
				options?.registered?.set(cmd.name, cmd);
			},
		},
		tools: {
			register(tool: { name: string }) {
				options?.registeredTools?.set(tool.name, tool);
			},
		},
		sessionProjections: {
			register: () => {
				const handle = {
					stateOf: () => ({ status: "idle" as const }),
					dispose: async () => {},
				};
				return Promise.resolve(handle);
			},
		},
		skills: {
			register: () => () => {},
		},
		logger() {
			return {
				info() {},
				error() {},
				warn(msg: string) {
					options?.loggedWarns?.push(msg);
				},
				debug() {},
			};
		},
	};
}

test("dsh-workflow-runner metadata and registration", async () => {
	assert.equal(name, "dsh-workflow-runner");
	assert.deepEqual(inject, [
		"commands",
		"sessionProjections",
		"subagents",
		"tools",
		"skills",
	]);

	const registered = new Map<string, CommandDefinition>();
	const registeredTools = new Map<string, unknown>();
	const mockCtx = createMockRunnerContext({ registered, registeredTools });

	await apply(mockCtx as unknown as Context); // cast: partial mock Context for unit test
	const wfCmd = registered.get("wf");
	assert.ok(wfCmd, "wf command should be registered");
	assert.equal(wfCmd.name, "wf");
	assert.equal(wfCmd.description, "Execute prompt workflow from YAML");
	assert.equal(wfCmd.input?.hint, "<workflow.yaml>");

	const resumeCmd = registered.get("wf-resume");
	assert.ok(resumeCmd, "wf-resume command should be registered");
	assert.equal(resumeCmd.name, "wf-resume");
	assert.equal(resumeCmd.description, "Resume an interrupted workflow");
	assert.equal(resumeCmd.input?.hint, "[instructions]");

	const saveOutputTool = registeredTools.get("save_output");
	assert.ok(saveOutputTool, "save_output tool should be registered");
});

test("/wf returns error when invoked with invalid workflow path", async () => {
	const registered = new Map<string, CommandDefinition>();
	const loggedWarns: string[] = [];
	const mockCtx = createMockRunnerContext({ registered, loggedWarns });

	await apply(mockCtx as unknown as Context);
	const wfCmd = registered.get("wf");
	assert.ok(wfCmd);

	const mockAgent = {
		id: "sess-1",
		session: {
			header: { cwd: "/mock/cwd" },
			append() {},
			snapshotEvents() {
				return [];
			},
		},
		followup() {},
		whenIdle: async () => {},
	};

	const result = await wfCmd.handler({
		name: "wf",
		rawInput: "{ invalid json",
		agent: mockAgent as unknown as Agent,
	} as unknown as CommandInvocation);

	assert.equal(result.kind, "error");
});

test("formatStepPrompt wraps prompts with step boundaries, rules, and conditional resume notice", () => {
	const standardPrompt = formatStepPrompt({
		stepIndex: 0,
		totalSteps: 3,
		stepName: "Step 1",
		prompt: "Run static analysis",
		isResumedStep: false,
	});
	assert.equal(
		standardPrompt,
		[
			"[STEP 1 OF 3: Step 1]",
			"<workflow-info>\nStep: 1 of 3\n</workflow-info>",
			"<step-instructions>\nRun static analysis\n</step-instructions>",
			"<rules>\n- Perform ONLY the instructions in <step-instructions>.\n- Conclude when complete.\n- Do NOT anticipate or execute any future steps.\n</rules>",
		].join("\n\n"),
	);

	const stepNamedPrompt = formatStepPrompt({
		stepIndex: 1,
		totalSteps: 4,
		stepName: "Run Typecheck",
		workflowName: "CI Pipeline",
		prompt: "npm run typecheck",
		isResumedStep: false,
	});
	assert.equal(
		stepNamedPrompt,
		[
			"[STEP 2 OF 4: Run Typecheck]",
			'<workflow-info>\nWorkflow: "CI Pipeline"\nStep: 2 of 4\n</workflow-info>',
			"<step-instructions>\nnpm run typecheck\n</step-instructions>",
			"<rules>\n- Perform ONLY the instructions in <step-instructions>.\n- Conclude when complete.\n- Do NOT anticipate or execute any future steps.\n</rules>",
		].join("\n\n"),
	);

	const resumedPrompt = formatStepPrompt({
		stepIndex: 1,
		totalSteps: 3,
		stepName: "Step 2",
		prompt: "Deploy service",
		isResumedStep: true,
	});
	assert.ok(
		resumedPrompt.includes("<workflow-resume>"),
		"resumed step must include resumption notice block",
	);

	const instructionsResumedPrompt = formatStepPrompt({
		stepIndex: 1,
		totalSteps: 2,
		stepName: "Step 2",
		prompt: "Deploy to cluster",
		isResumedStep: true,
		instructions: "Skip canary validation",
	});
	assert.ok(
		instructionsResumedPrompt.includes(
			"<user-instructions>\nSkip canary validation\n</user-instructions>",
		),
	);
});

test("parseInvocationInput parses path, explicit key=value arguments, and implicit instructions", () => {
	const parsed1 = parseInvocationInput("deploy.yaml");
	assert.equal(parsed1.targetPath, "deploy.yaml");
	assert.deepEqual(parsed1.explicitArgs, {});
	assert.equal(parsed1.implicitInstructions, "");

	const parsed2 = parseInvocationInput(
		"deploy.yaml env=production tag=v1.2.3 and run smoke tests",
	);
	assert.equal(parsed2.targetPath, "deploy.yaml");
	assert.deepEqual(parsed2.explicitArgs, {
		env: "production",
		tag: "v1.2.3",
	});
	assert.equal(parsed2.implicitInstructions, "and run smoke tests");

	const parsedQuoted = parseInvocationInput(
		'pipeline.yaml message="release notes here" debug=true',
	);
	assert.equal(parsedQuoted.targetPath, "pipeline.yaml");
	assert.deepEqual(parsedQuoted.explicitArgs, {
		message: "release notes here",
		debug: "true",
	});

	const parsedTrailingImplicit = parseInvocationInput(
		'flow.yaml foo=bar "just do this"',
	);
	assert.equal(parsedTrailingImplicit.targetPath, "flow.yaml");
	assert.deepEqual(parsedTrailingImplicit.explicitArgs, { foo: "bar" });
	assert.equal(parsedTrailingImplicit.implicitInstructions, "just do this");
});

test("resolveWorkflowArgs resolves defaults, validates choices and required args", () => {
	const declarations = {
		env: WorkflowArgSchema.parse({
			type: "choice",
			choices: ["staging", "production"],
			default: "staging",
		}),
		version: WorkflowArgSchema.parse({
			type: "string",
		}),
		instructions: WorkflowArgSchema.parse({
			type: "string",
			default: "none",
		}),
	};

	// Successful resolution with implicit text
	const resolved = resolveWorkflowArgs({
		declarations,
		explicitArgs: { version: "1.0.0" },
		implicitInstructions: "run smoke tests",
	});
	assert.deepEqual(resolved, {
		env: "staging",
		version: "1.0.0",
		instructions: "run smoke tests",
	});

	// Fails when required argument is missing
	assert.throws(
		() =>
			resolveWorkflowArgs({
				declarations,
				explicitArgs: {},
				implicitInstructions: "",
			}),
		/Missing required argument 'version'/,
	);

	// Fails when choice argument receives invalid value
	assert.throws(
		() =>
			resolveWorkflowArgs({
				declarations,
				explicitArgs: { version: "1.0.0", env: "dev" },
				implicitInstructions: "",
			}),
		/Invalid value 'dev' for argument 'env'/,
	);

	// Fails when unexpected argument is passed
	assert.throws(
		() =>
			resolveWorkflowArgs({
				declarations,
				explicitArgs: { version: "1.0.0", extra: "val" },
				implicitInstructions: "",
			}),
		/Unknown argument 'extra'/,
	);

	// Fails when implicit text is provided but no instructions arg declared
	assert.throws(
		() =>
			resolveWorkflowArgs({
				declarations: {
					env: WorkflowArgSchema.parse({
						type: "string",
					}),
				},
				explicitArgs: { env: "staging" },
				implicitInstructions: "run smoke tests",
			}),
		/Unexpected implicit instructions/,
	);
});

test("interpolateTemplate replaces {{args.xyz}} and throws on unresolved variables", () => {
	const template =
		"Deploy {{args.version}} to {{args.env}}: {{args.instructions}}";
	const result = interpolateTemplate(template, {
		version: "v1.2",
		env: "prod",
		instructions: "be fast",
	});
	assert.equal(result, "Deploy v1.2 to prod: be fast");

	// Throws when an undeclared variable is referenced
	assert.throws(
		() => interpolateTemplate("Deploy to {{args.cluster}}", {}),
		/Unresolved workflow argument: {{args.cluster}}/,
	);
});

test("executeWorkflow full orchestration: arguments, steps, lifecycle, and abortion via WorkflowTestRunner", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "test-sess" });
	runner.registerWorkflow(
		"test-workflow.yaml",
		`
name: "Workflow {{args.tag}} [{{args.env}}]"
args:
  tag:
    type: string
  env:
    type: choice
    choices: ["staging", "production"]
    default: "staging"
  instructions:
    type: string
    default: "standard rollout"
steps:
  - print: "Deploying {{args.tag}} to {{args.env}}"
  - prompt: "Execute deployment with note: {{args.instructions}}"
`,
	);

	// 1. Missing target path
	const emptyRes = await executeWorkflow({
		effects: runner,
		targetPath: "   ",
	});
	assert.equal(emptyRes.kind, "error");
	assert.match(emptyRes.text, /Usage: \/wf/);

	// 2. Non-existent file
	const nonExistentRes = await executeWorkflow({
		effects: runner,
		targetPath: "missing.yaml",
	});
	assert.equal(nonExistentRes.kind, "error");
	assert.match(nonExistentRes.text, /Failed to load workflow/);

	// 3. Fails when required argument is missing
	const missingArgRes = await executeWorkflow({
		effects: runner,
		targetPath: "test-workflow.yaml env=staging",
	});
	assert.equal(missingArgRes.kind, "error");
	assert.match(missingArgRes.text, /Missing required argument 'tag'/);

	// 4. Successful execution with explicit args and trailing implicit instructions
	const successRes = await executeWorkflow({
		effects: runner,
		targetPath:
			"test-workflow.yaml tag=v1.2.3 env=production verify DB connections first",
	});

	assert.equal(successRes.kind, "success");
	assert.equal(successRes.text, "Completed workflow (2 steps)");

	// Verifies initial command/run init contained workflow document and invocation
	const initialInitEvent = runner.events.find((e) => {
		const payload = parseCmdPayload(e);
		return payload?.action === "init";
	});
	assert.ok(initialInitEvent, "initial init command should be emitted");
	const initPayload = parseCmdPayload(initialInitEvent);
	assert.ok(
		initPayload && initPayload.action === "init" && initPayload.workflow,
		"initial init must include workflow document",
	);
	assert.ok(
		initPayload && initPayload.action === "init" && initPayload.invocation,
		"initial init must include invocation",
	);

	// Verifies final state completed event derived via foldWorkflowState
	const latestRun = runner.getLatestRun();
	assert.ok(latestRun, "workflow run must be derived from event store");
	assert.equal(latestRun.state.status, "completed");
	assert.equal(latestRun.state.stepIndex, 2);

	// Verifies each workflow command/run is settled with a corresponding command/done
	const wfCommandRuns = runner.events.filter(
		(e) =>
			e.type === "command/run" &&
			(e.data as { readonly name?: string })?.name === WORKFLOW_EVENT_NAME,
	);
	assert.ok(
		wfCommandRuns.length > 0,
		"should emit at least one wf command/run",
	);
	for (const run of wfCommandRuns) {
		const runCmdId = (run.data as { readonly commandId?: string }).commandId;
		const matchingDone = runner.events.find(
			(e) =>
				e.type === "command/done" &&
				(e.data as { readonly commandId?: string })?.commandId === runCmdId &&
				(e.data as { readonly kind?: string })?.kind === "success",
		);
		assert.ok(
			matchingDone,
			`every wf command/run (${runCmdId}) must have matching command/done`,
		);
	}

	// Verifies session title event emission with interpolated workflow name
	const titleEvent = runner.events.find((e) => e.type === "session/title");
	assert.ok(titleEvent, "session/title event should be emitted");
	assert.deepEqual(titleEvent.data, {
		title: "Workflow v1.2.3 [production]",
		messageSeqs: [],
		source: { kind: "user" },
	});

	// Step 1 was print: "Deploying v1.2.3 to production"
	assert.deepEqual(runner.printedTexts, ["Deploying v1.2.3 to production"]);

	// Step 2 was prompt: "Execute deployment with note: verify DB connections first"
	assert.equal(runner.dispatchedPrompts.length, 1);
	assert.equal(
		runner.dispatchedPrompts[0].promptText,
		formatStepPrompt({
			stepIndex: 1,
			totalSteps: 2,
			stepName: "Step 2",
			workflowName: "Workflow v1.2.3 [production]",
			prompt: "Execute deployment with note: verify DB connections first",
			isResumedStep: false,
		}),
	);

	// 5. Aborted before start
	const abortController = new AbortController();
	abortController.abort();

	const abortedRes = await executeWorkflow({
		effects: runner,
		targetPath: "test-workflow.yaml tag=v1.0.0",
		signal: abortController.signal,
	});

	assert.equal(abortedRes.kind, "error");
	assert.match(abortedRes.text, /Workflow aborted at step 1\/2/);

	// Verify state abort event
	const abortStateEvent = runner.events.find((e) => {
		const payload = parseCmdPayload(e);
		return payload?.action === "state" && payload.status === "aborted";
	});
	assert.ok(abortStateEvent, "state aborted event should be emitted");
});

test("executeWorkflow preserves pre-existing session title and does not emit session/title", async () => {
	const runner = new WorkflowTestRunner();
	runner.setTitle("Original Existing Title");

	runner.registerWorkflow(
		"titled-wf.yaml",
		`
name: "Overwriting Workflow"
steps:
  - name: "Step 1"
    print: "Done"
`,
	);

	assert.equal(runner.hasTitle(), true);
	const res = await executeWorkflow({
		effects: runner,
		targetPath: "titled-wf.yaml",
	});

	assert.equal(res.kind, "success");
	const titleEvents = runner.events.filter((e) => e.type === "session/title");
	assert.equal(titleEvents.length, 1);
	assert.deepEqual(titleEvents[0].data, {
		title: "Original Existing Title",
		messageSeqs: [],
		source: { kind: "user" },
	});
});

test("executeWorkflow sets session title using title property with interpolated input params", async () => {
	const runner = new WorkflowTestRunner();

	runner.registerWorkflow(
		"param-title-wf.yaml",
		`
name: "deploy-pipeline"
title: "Deploy {{args.env}} v{{args.version}}"
args:
  env:
    type: string
  version:
    type: string
steps:
  - name: "Step 1"
    print: "Done"
`,
	);

	const res = await executeWorkflow({
		effects: runner,
		targetPath: "param-title-wf.yaml env=staging version=2.0.0",
	});

	assert.equal(res.kind, "success");
	const titleEvent = runner.events.find((e) => e.type === "session/title");
	assert.ok(titleEvent, "session/title event should be emitted");
	assert.deepEqual(titleEvent.data, {
		title: "Deploy staging v2.0.0",
		messageSeqs: [],
		source: { kind: "user" },
	});
});

test("resumeWorkflow resumes an interrupted workflow and finishes remaining steps via WorkflowTestRunner", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "resume-session-1" });
	runner.registerWorkflow(
		"multi-step.yaml",
		`
name: "Three-step Workflow"
steps:
  - print: "Step 1 executed"
  - prompt: "Prompt step 2"
  - prompt: "Prompt step 3"
`,
	);

	const abortController = new AbortController();
	let callCount = 0;
	runner.onPrompt = () => {
		callCount++;
		if (callCount === 1) {
			// Abort right after step 2 (the first prompt step)
			abortController.abort();
		}
	};

	// 1. Initial run: step 1 (print) finishes, step 2 (prompt) runs then aborts
	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "multi-step.yaml",
		signal: abortController.signal,
	});
	assert.equal(runResult.kind, "error");
	assert.match(runResult.text, /Workflow aborted at step 2\/3/);

	// Verify state abort event emitted with stepIndex = 1
	const abortState = runner.getLatestRun()?.state;
	assert.equal(abortState?.status, "aborted");
	assert.equal(abortState?.stepIndex, 1);
	assert.equal(runner.dispatchedPrompts.length, 1);

	// 2. Resume workflow: should pick up from step 2 (index 1) and complete step 3
	runner.onPrompt = undefined;
	const resumeResult = await resumeWorkflow({
		effects: runner,
	});
	assert.equal(resumeResult.kind, "success");
	assert.equal(resumeResult.text, "Completed workflow (3 steps)");

	// Prompt 2 was re-executed upon resume, and prompt 3 was executed
	assert.equal(runner.dispatchedPrompts.length, 3);

	// Initial prompt step 2 (not resumed)
	assert.equal(
		runner.dispatchedPrompts[0].promptText,
		formatStepPrompt({
			stepIndex: 1,
			totalSteps: 3,
			stepName: "Step 2",
			workflowName: "Three-step Workflow",
			prompt: "Prompt step 2",
			isResumedStep: false,
		}),
	);
	assert.equal(
		runner.dispatchedPrompts[0].promptText.includes("<workflow-resume>"),
		false,
	);

	// Resumed prompt step 2
	assert.equal(
		runner.dispatchedPrompts[1].promptText,
		formatStepPrompt({
			stepIndex: 1,
			totalSteps: 3,
			stepName: "Step 2",
			workflowName: "Three-step Workflow",
			prompt: "Prompt step 2",
			isResumedStep: true,
		}),
	);
	assert.equal(
		runner.dispatchedPrompts[1].promptText.includes("<workflow-resume>"),
		true,
	);

	// Prompt step 3
	assert.equal(
		runner.dispatchedPrompts[2].promptText,
		formatStepPrompt({
			stepIndex: 2,
			totalSteps: 3,
			stepName: "Step 3",
			workflowName: "Three-step Workflow",
			prompt: "Prompt step 3",
			isResumedStep: false,
		}),
	);
	assert.equal(
		runner.dispatchedPrompts[2].promptText.includes("<workflow-resume>"),
		false,
	);

	// 3. Calling resume again reports that workflow has already completed
	const secondResume = await resumeWorkflow({
		effects: runner,
	});
	assert.equal(secondResume.kind, "error");
	assert.equal(secondResume.text, "Workflow has already completed");
});

test("executeWorkflow pauses at gate step, records paused state, and resumeWorkflow completes", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "gate-session-1" });
	runner.registerWorkflow(
		"gated-workflow.yaml",
		`
name: "Gated Workflow"
steps:
  - prompt: "Step 1: run tests"
    gate: "Review test results before continuing"
  - prompt: "Step 2: deploy application"
`,
	);

	// 1. Initial run: step 1 runs and pauses at gate
	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "gated-workflow.yaml",
	});
	assert.equal(runResult.kind, "success");
	assert.equal(
		runResult.text,
		'Workflow paused at gate: "Review test results before continuing". Resume with /wf-resume',
	);

	// Verify state event was emitted on pause with status = "paused" and stepIndex = 0
	const pausedState = runner.getLatestRun()?.state;
	assert.equal(pausedState?.status, "paused");
	assert.equal(pausedState?.stepIndex, 0);

	// Step 1 prompt does NOT contain gate criteria or resume instructions
	assert.equal(runner.dispatchedPrompts.length, 1);
	const prompt1Text = runner.dispatchedPrompts[0].promptText;
	assert.ok(prompt1Text.includes("Step 1: run tests"));
	assert.ok(!prompt1Text.includes("[GATE CRITERIA]"));
	assert.ok(!prompt1Text.includes("Review test results before continuing"));
	assert.ok(!prompt1Text.includes("/wf-resume"));

	// 2. Resume workflow: picks up step 2 and completes
	const resumeResult = await resumeWorkflow({
		effects: runner,
	});
	assert.equal(resumeResult.kind, "success");
	assert.equal(resumeResult.text, "Completed workflow (2 steps)");

	assert.equal(runner.dispatchedPrompts.length, 2);
	const prompt2Text = runner.dispatchedPrompts[1].promptText;
	assert.ok(prompt2Text.includes("Step 2: deploy application"));
	assert.ok(!prompt2Text.includes("<workflow-resume>"));

	// Verify state event was emitted on completion
	assert.equal(runner.getLatestRun()?.state.status, "completed");
});

test("gate on final step pauses execution and subsequent /wf-resume completes workflow", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "gate-final-sess" });
	runner.registerWorkflow(
		"final-gated.yaml",
		`
name: "Final Gated Workflow"
steps:
  - prompt: "Final prompt"
    gate: "Verify before closing"
`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "final-gated.yaml",
	});
	assert.equal(runResult.kind, "success");
	assert.equal(
		runResult.text,
		'Workflow paused at gate: "Verify before closing". Resume with /wf-resume',
	);
	assert.equal(runner.getLatestRun()?.state.status, "paused");

	// Resuming final step finishes cleanly
	const resumeResult = await resumeWorkflow({
		effects: runner,
	});
	assert.equal(resumeResult.kind, "success");
	assert.equal(resumeResult.text, "Completed workflow (1 steps)");
	assert.equal(runner.getLatestRun()?.state.status, "completed");
});

test("executeWorkflow supports gate: true/false injected via args (/wf xxx wait=true plan)", async () => {
	const workflowContent = `
name: "Deploy Planner"
args:
  wait:
    type: bool
    default: false
  instructions:
    type: string
steps:
  - name: plan
    prompt: "Create plan: {{args.instructions}}"
    gate: "{{args.wait}}"
  - name: execute
    prompt: "Execute plan"
`;

	// 1. Invoked with wait=true -> pauses at gate for step 'plan'
	const runnerWaitTrue = new WorkflowTestRunner({
		sessionId: "wait-true-sess",
	});
	runnerWaitTrue.registerWorkflow("deploy-planner.yaml", workflowContent);

	const resWaitTrue = await executeWorkflow({
		effects: runnerWaitTrue,
		targetPath: "deploy-planner.yaml wait=true plan",
	});
	assert.equal(resWaitTrue.kind, "success");
	assert.equal(
		resWaitTrue.text,
		'Workflow paused at gate: "plan". Resume with /wf-resume',
	);
	assert.equal(runnerWaitTrue.getLatestRun()?.state.status, "paused");
	assert.equal(runnerWaitTrue.dispatchedPrompts.length, 1);
	assert.ok(
		runnerWaitTrue.dispatchedPrompts[0].promptText.includes(
			"Create plan: plan",
		),
	);

	// Resume completes the second step
	const resumeWaitTrue = await resumeWorkflow({ effects: runnerWaitTrue });
	assert.equal(resumeWaitTrue.kind, "success");
	assert.equal(resumeWaitTrue.text, "Completed workflow (2 steps)");
	assert.equal(runnerWaitTrue.getLatestRun()?.state.status, "completed");
	assert.equal(runnerWaitTrue.dispatchedPrompts.length, 2);

	// 2. Invoked with wait=false -> does not pause at gate; completes both steps directly
	const runnerWaitFalse = new WorkflowTestRunner({
		sessionId: "wait-false-sess",
	});
	runnerWaitFalse.registerWorkflow("deploy-planner.yaml", workflowContent);

	const resWaitFalse = await executeWorkflow({
		effects: runnerWaitFalse,
		targetPath: "deploy-planner.yaml wait=false plan",
	});
	assert.equal(resWaitFalse.kind, "success");
	assert.equal(resWaitFalse.text, "Completed workflow (2 steps)");
	assert.equal(runnerWaitFalse.getLatestRun()?.state.status, "completed");
	assert.equal(runnerWaitFalse.dispatchedPrompts.length, 2);

	// 3. Invoked with default (no wait arg) -> default is false, does not pause at gate
	const runnerDefault = new WorkflowTestRunner({
		sessionId: "wait-default-sess",
	});
	runnerDefault.registerWorkflow("deploy-planner.yaml", workflowContent);

	const resDefault = await executeWorkflow({
		effects: runnerDefault,
		targetPath: "deploy-planner.yaml plan",
	});
	assert.equal(resDefault.kind, "success");
	assert.equal(resDefault.text, "Completed workflow (2 steps)");
	assert.equal(runnerDefault.getLatestRun()?.state.status, "completed");
	assert.equal(runnerDefault.dispatchedPrompts.length, 2);
});

test("WorkflowResumeButton state store, sync registration, and resume dispatch", async () => {
	const sessId = "test-store-session" as SessionId;

	// Initial state is undefined
	assert.equal(getWorkflowState(sessId), undefined);

	// Set to running -> getWorkflowState returns running
	let notified = 0;
	const unsub = subscribeWorkflowState(() => {
		notified++;
	});

	const run1: WorkflowRun = {
		workflow: {
			args: {},
			steps: [{ kind: "prompt", name: "Step 1", prompt: "step 1" }],
		},
		invocation: {
			targetPath: "flow.yaml",
			resolvedArgs: {},
			runId: "test-run-1",
		},
		state: { stepIndex: 0, status: "running" },
	};
	setWorkflowState(sessId, run1, "test-run-1");
	assert.equal(notified, 1);
	assert.equal(getWorkflowState(sessId)?.state.status, "running");

	// Update to paused
	const run2: WorkflowRun = {
		workflow: {
			args: {},
			steps: [
				{
					kind: "prompt",
					name: "Step 1",
					prompt: "step 1",
					gate: "Test Gate",
				},
			],
		},
		invocation: {
			targetPath: "flow.yaml",
			resolvedArgs: {},
			runId: "test-run-2",
		},
		state: { stepIndex: 0, status: "paused" },
	};
	setWorkflowState(sessId, run2, "test-run-2");
	assert.equal(notified, 2);
	assert.equal(getWorkflowState(sessId)?.state.status, "paused");
	const step = getWorkflowState(sessId)?.workflow.steps[0];
	assert.equal(step?.kind === "prompt" ? step.gate : undefined, "Test Gate");

	// Clear state
	clearWorkflowState(sessId);
	assert.equal(notified, 3);
	assert.equal(getWorkflowState(sessId), undefined);

	unsub();

	// resolveResumeCommand formatting
	assert.equal(resolveResumeCommand(), "/wf-resume");
	assert.equal(
		resolveResumeCommand("extra instructions"),
		"/wf-resume extra instructions",
	);

	// sendResumeCommand dispatches to session command handler
	const sentMessages: string[] = [];
	const registeredKinds: string[] = [];
	const mockSession = {
		async command(text: string) {
			sentMessages.push(text);
			return { ok: true, value: { matched: true } };
		},
	};
	const mockClientCtx = {
		sessions: {
			binding() {
				return { session: mockSession };
			},
		},
		uiConversation: {
			events: {
				register(def: { kind: string }) {
					registeredKinds.push(def.kind);
					return () => {};
				},
			},
		},
	};
	await sendResumeCommand(
		mockClientCtx as unknown as Parameters<typeof sendResumeCommand>[0],
		sessId,
	);
	assert.deepEqual(sentMessages, ["/wf-resume"]);

	await sendResumeCommand(
		mockClientCtx as unknown as Parameters<typeof sendResumeCommand>[0],
		sessId,
		"/wf-resume apply fix",
	);
	assert.deepEqual(sentMessages, ["/wf-resume", "/wf-resume apply fix"]);

	// registerWorkflowChatNodes registers workflow state, step, print, error, and list nodes.
	registerWorkflowChatNodes(
		mockClientCtx as unknown as Parameters<typeof registerWorkflowChatNodes>[0],
	);
	assert.deepEqual(registeredKinds, [
		"wf-request",
		"wf-state",
		"wf-step",
		"wf-print",
		"wf-error",
		"wf-list",
	]);

	// workflowStateDefinition matches command/run state events
	const matchRes = workflowStateDefinition.match({
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify({
				action: "state",
				status: "running",
				sessionId: "sess-match",
				runId: "sess-match",
			}),
		},
	} as unknown as Parameters<typeof workflowStateDefinition.match>[0]);
	assert.deepEqual(matchRes, { id: "sess-match", role: "update" });

	const nonMatchRes = workflowStateDefinition.match({
		type: "command/run",
		data: { name: "other", args: "{}" },
	} as unknown as Parameters<typeof workflowStateDefinition.match>[0]);
	assert.equal(nonMatchRes, null);
});

test("executeWorkflow with subagent steps: subagent: true and parameterized", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-agent-session-subagent",
	});
	runner.registerWorkflow(
		"subagent-flow.yaml",
		`
name: "Subagent Test Workflow"
steps:
  - name: "Simple Subagent"
    prompt: "Scan security"
    subagent: true
    output: sec_out
  - name: "Configured Subagent"
    prompt: "Audit database"
    subagent: "@db-auditor/fast-model"
    output: db_out
  - name: "Final Local Print"
    print: "All subagent tasks complete: {{outputs.sec_out}} {{outputs.db_out}}"
`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "subagent-flow.yaml",
	});

	assert.equal(runResult.kind, "success");
	assert.equal(runResult.text, "Completed workflow (3 steps)");

	// Verifies two subagents were activated
	assert.equal(runner.dispatchedSubagents.length, 2);

	// First subagent: default provider (undefined in config) and prompt
	assert.equal(
		runner.dispatchedSubagents[0].effect.stepLabel,
		"Step 1 of 3: Simple Subagent",
	);
	assert.equal(
		runner.dispatchedSubagents[0].effect.promptText,
		"Scan security",
	);
	assert.equal(runner.dispatchedSubagents[0].effect.config.preset, undefined);
	assert.equal(runner.dispatchedSubagents[0].effect.config.model, undefined);

	// Second subagent: explicit provider, preset, and model
	assert.equal(
		runner.dispatchedSubagents[1].effect.stepLabel,
		"Step 2 of 3: Configured Subagent",
	);
	assert.equal(
		runner.dispatchedSubagents[1].effect.promptText,
		"Audit database",
	);
	assert.equal(runner.dispatchedSubagents[1].effect.config.provider, "spawn");
	assert.equal(
		runner.dispatchedSubagents[1].effect.config.preset,
		"db-auditor",
	);
	assert.equal(runner.dispatchedSubagents[1].effect.config.model, "fast-model");
});

test("executeWorkflow controls subagent model via workflow input parameter shorthand", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-subagent-model-param",
	});
	runner.registerWorkflow(
		"model-param.yaml",
		`
name: "Param Flow"
args:
  llm:
    type: string
    default: "deepseek-coder"
steps:
  - name: "Audit"
    prompt: "Run check"
    subagent: "@reviewer/{{args.llm}}"
    output: audit_out
  - print: "Done: {{outputs.audit_out}}"
`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "model-param.yaml llm=deepseek-reasoner",
	});

	assert.equal(runResult.kind, "success");
	assert.equal(runner.dispatchedSubagents.length, 1);
	assert.equal(runner.dispatchedSubagents[0].effect.config.provider, "spawn");
	assert.equal(runner.dispatchedSubagents[0].effect.config.preset, "reviewer");
	assert.equal(
		runner.dispatchedSubagents[0].effect.config.model,
		"deepseek-reasoner",
	);
});

test("executeWorkflow controls subagent thinking level via shorthand and workflow argument", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-subagent-thinking-param",
	});
	runner.registerWorkflow(
		"thinking-param.yaml",
		`
name: "Thinking Flow"
args:
  effort:
    type: string
    default: "high"
steps:
  - name: "Audit"
    prompt: "Run check"
    subagent: "@reviewer/deepseek-reasoner:{{args.effort}}"
    output: audit_out
  - print: "Done: {{outputs.audit_out}}"
`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "thinking-param.yaml effort=max",
	});

	assert.equal(runResult.kind, "success");
	assert.equal(runner.dispatchedSubagents.length, 1);
	assert.equal(runner.dispatchedSubagents[0].effect.config.provider, "spawn");
	assert.equal(runner.dispatchedSubagents[0].effect.config.preset, "reviewer");
	assert.equal(
		runner.dispatchedSubagents[0].effect.config.model,
		"deepseek-reasoner",
	);
	assert.equal(runner.dispatchedSubagents[0].effect.config.thinking, "max");
});

test("executeWorkflow resolves the inherit model sentinel to the parent route", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-subagent-inherit-param",
	});
	runner.registerWorkflow(
		"inherit-param.yaml",
		`
name: "Inherit Flow"
args:
  model:
    type: string
    default: "inherit"
steps:
  - name: "Audit"
    prompt: "Run check"
    subagent: "{{args.model}}"
    output: audit_out
  - print: "Done: {{outputs.audit_out}}"
`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "inherit-param.yaml",
	});

	assert.equal(runResult.kind, "success");
	assert.equal(runner.dispatchedSubagents.length, 1);
	assert.deepEqual(runner.dispatchedSubagents[0].effect.config, {
		provider: "spawn",
	});
});

test("executeWorkflow captures subagent output into variable and interpolates in subsequent step", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-review-triage-sess",
	});
	runner.onSubagent = () =>
		"Review finding: potential race condition in auth token refresh";

	runner.registerWorkflow(
		"review-triage.yaml",
		`
name: "Code Review and Triage"
steps:
  - name: "Review"
    prompt: "/ponytail-review - scan for bugs"
    subagent: true
    output: review_result
  - name: "Triage"
    prompt: "Triage the findings: {{outputs.review_result}}"
    gate: "Review and approve the fix plan before proceeding."
`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "review-triage.yaml",
	});

	assert.equal(runResult.kind, "success");
	assert.equal(
		runResult.text,
		'Workflow paused at gate: "Review and approve the fix plan before proceeding.". Resume with /wf-resume',
	);
	assert.equal(runner.getLatestRun()?.state.status, "paused");

	// Step 1: Subagent ran and recorded output
	assert.equal(runner.dispatchedSubagents.length, 1);
	assert.equal(
		runner.dispatchedSubagents[0].effect.stepLabel,
		"Step 1 of 2: Review",
	);
	assert.equal(
		runner.getLatestRun()?.state.outputs?.review_result,
		"Review finding: potential race condition in auth token refresh",
	);

	// Step 2: Prompt received yanked subagent output via {{outputs.review_result}}
	assert.equal(runner.dispatchedPrompts.length, 1);
	const promptText = runner.dispatchedPrompts[0].promptText;
	assert.ok(!promptText.includes("<subagent-results>"));
	assert.ok(
		promptText.includes(
			"Review finding: potential race condition in auth token refresh",
		),
	);
	assert.ok(
		promptText.includes(
			"<step-instructions>\nTriage the findings: Review finding: potential race condition in auth token refresh\n</step-instructions>",
		),
	);
});

test("executeWorkflow preserves subagent output across gate on subagent step", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-gated-subagent-sess",
	});
	runner.onSubagent = () =>
		"Subagent finding: unhandled promise rejection in stream handler";

	runner.registerWorkflow(
		"gated-subagent.yaml",
		`
name: "Gated Subagent Flow"
steps:
  - name: "Gated Review"
    prompt: "Scan stream handler"
    subagent: true
    output: scan_notes
    gate: "Confirm review results before proceeding"
  - name: "Triage"
    prompt: "Triage the review findings: {{outputs.scan_notes}}"
`,
	);

	// 1. Initial run: runs subagent and pauses at gate
	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "gated-subagent.yaml",
	});

	assert.equal(runResult.kind, "success");
	assert.equal(
		runResult.text,
		'Workflow paused at gate: "Confirm review results before proceeding". Resume with /wf-resume',
	);
	assert.equal(runner.getLatestRun()?.state.status, "paused");
	assert.equal(runner.dispatchedSubagents.length, 1);
	assert.equal(runner.dispatchedPrompts.length, 0);
	assert.equal(
		runner.getLatestRun()?.state.outputs?.scan_notes,
		"Subagent finding: unhandled promise rejection in stream handler",
	);

	// 2. Resume workflow: resumes to Triage step with findings intact
	const resumeResult = await resumeWorkflow({
		effects: runner,
	});

	assert.equal(resumeResult.kind, "success");
	assert.equal(resumeResult.text, "Completed workflow (2 steps)");
	assert.equal(runner.dispatchedPrompts.length, 1);
	const promptText = runner.dispatchedPrompts[0].promptText;
	assert.ok(!promptText.includes("<subagent-results>"));
	assert.ok(
		promptText.includes(
			"Subagent finding: unhandled promise rejection in stream handler",
		),
	);
	assert.ok(
		promptText.includes(
			"<step-instructions>\nTriage the review findings: Subagent finding: unhandled promise rejection in stream handler\n</step-instructions>",
		),
	);
});

test("executeWorkflow rejects subagent steps when neither output nor outputs is declared", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-no-output-subagent",
	});
	runner.onSubagent = () => "Ignored finding";

	runner.registerWorkflow(
		"no-output.yaml",
		`
name: "No Output Flow"
steps:
  - name: "Background Scan"
    prompt: "Scan files"
    subagent: true
  - name: "Next Step"
    prompt: "Continue next action"
`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "no-output.yaml",
	});

	assert.equal(runResult.kind, "error");
	assert.match(
		runResult.text,
		/Subagent step 1 \('Background Scan'\) must declare at least one output via 'output' or 'outputs'/,
	);
	assert.equal(runner.dispatchedSubagents.length, 0);
});

test("executeWorkflow rejects workflow ending on subagent step without output", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-terminal-subagent-sess",
	});
	runner.onSubagent = () => "Terminal audit finding";

	runner.registerWorkflow(
		"terminal-subagent.yaml",
		`
name: "Terminal Subagent Workflow"
steps:
  - name: "Standalone Subagent"
    prompt: "Audit repository"
    subagent: true
`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "terminal-subagent.yaml",
	});

	assert.equal(runResult.kind, "error");
	assert.match(
		runResult.text,
		/Subagent step 1 \('Standalone Subagent'\) must declare at least one output via 'output' or 'outputs'/,
	);
	assert.equal(runner.dispatchedSubagents.length, 0);
});

test("DshWorkflowEffectContext runtime integration and service delegation", async () => {
	const appendedEvents: Array<{ type: string; data: Record<string, unknown> }> =
		[];
	const dispatchedMessages: UserMessage[] = [];
	const activatedSubagents: Array<Record<string, unknown>> = [];
	const emittedStatuses: Array<{ agent: Agent; status: string }> = [];

	let whenIdleCalled = false;
	const agentStatus: "idle" | "running" = "idle";
	const mockAgent = {
		id: "dsh-sess-42",
		get status() {
			return agentStatus;
		},
		session: {
			header: { cwd: "/mock/cwd" },
			append(type: string, data: Record<string, unknown>) {
				appendedEvents.push({ type, data });
			},
			snapshotEvents() {
				return appendedEvents;
			},
		},
		followup(msg: UserMessage) {
			dispatchedMessages.push(msg);
		},
		whenIdle: async () => {
			whenIdleCalled = true;
		},
	};

	const mockCtx = {
		subagents: {
			list: () => ["spawn-provider"],
			startActivation: async (spec: Record<string, unknown>) => {
				activatedSubagents.push(spec);
				return {
					childId: "child-1",
					name: "worker",
					result: Promise.resolve({ output: [], stopReason: "completed" }),
				};
			},
		},
		emit(event: string, payload: { agent: Agent; status: string }) {
			if (event === "agent/status") {
				emittedStatuses.push(payload);
			}
		},
	};

	const effects = new DshWorkflowEffectContext({
		ctx: mockCtx as unknown as Context,
		agent: mockAgent as unknown as Agent,
	});

	assert.equal(effects.sessionId, "dsh-sess-42");

	// whenIdle delegation
	await effects.whenIdle();
	assert.equal(whenIdleCalled, true);

	// Status setting
	effects.setStatus("running");
	assert.deepEqual(emittedStatuses, [
		{ agent: mockAgent as unknown as Agent, status: "running" },
	]);

	// Title setting
	assert.equal(effects.hasTitle(), false);
	effects.setTitle("New Session Title");
	assert.equal(effects.hasTitle(), true);
	assert.equal(appendedEvents.length, 1);
	assert.equal(appendedEvents[0].type, "session/title");

	// Prompt dispatching
	await effects.dispatchPrompt({
		type: "prompt",
		promptText: "Do something",
		stepLabel: "Step 2",
	});
	assert.equal(dispatchedMessages.length, 1);
	assert.equal(dispatchedMessages[0].source.kind, "workflow");

	// Subagent dispatching
	await effects.dispatchSubagent({
		type: "subagent",
		promptText: "Analyze repo",
		stepLabel: "Step 3",
		config: { preset: "reviewer" },
	});
	assert.equal(activatedSubagents.length, 1);
	assert.equal(activatedSubagents[0].provider, "spawn");
	assert.equal(activatedSubagents[0].delivery, "caller");

	await effects.dispatchSubagent({
		type: "subagent",
		promptText: "Analyze repo with explicit provider",
		stepLabel: "Step 4",
		config: { provider: "custom-provider", preset: "reviewer" },
	});
	assert.equal(activatedSubagents.length, 2);
	assert.equal(activatedSubagents[1].provider, "custom-provider");
	assert.equal(activatedSubagents[1].delivery, "caller");

	// Event emission and snapshotting
	effects.emit({
		action: "state",
		status: "running",
		stepIndex: 1,
		runId: "test-run",
	});
	const snapshots = effects.snapshotEvents();
	assert.equal(snapshots.length, 3); // session/title + command/run + command/done
});

test("WorkflowTestRunner resolves workflow files across well-known search paths and extensions", async () => {
	const runner = new WorkflowTestRunner();
	runner.registerWorkflow("direct.yaml", "steps: []");
	runner.registerWorkflow(".agents/wf/project.yaml", "steps: []");
	runner.registerWorkflow(".agents/wf/alt.yml", "steps: []");
	runner.registerWorkflow("~/.agents/wf/global.yaml", "steps: []");

	// 1. Direct path
	assert.equal(await runner.resolveWorkflowFile("direct.yaml"), "direct.yaml");

	// 2. Project well-known with auto-extension
	assert.equal(
		await runner.resolveWorkflowFile("project"),
		".agents/wf/project.yaml",
	);
	assert.equal(
		await runner.resolveWorkflowFile("project.yaml"),
		".agents/wf/project.yaml",
	);
	assert.equal(await runner.resolveWorkflowFile("alt"), ".agents/wf/alt.yml");

	// 3. User-global well-known with auto-extension
	assert.equal(
		await runner.resolveWorkflowFile("global"),
		"~/.agents/wf/global.yaml",
	);
	assert.equal(
		await runner.resolveWorkflowFile("global.yaml"),
		"~/.agents/wf/global.yaml",
	);

	// 4. Precedence: direct > .agents/wf/ > ~/.agents/wf/
	runner.registerWorkflow("shadow.yaml", "steps: [] # direct");
	runner.registerWorkflow(".agents/wf/shadow.yaml", "steps: [] # project");
	runner.registerWorkflow("~/.agents/wf/shadow.yaml", "steps: [] # global");

	assert.equal(await runner.resolveWorkflowFile("shadow"), "shadow.yaml");

	runner.registerWorkflow(".agents/wf/precedence.yaml", "steps: [] # project");
	runner.registerWorkflow("~/.agents/wf/precedence.yaml", "steps: [] # global");
	assert.equal(
		await runner.resolveWorkflowFile("precedence"),
		".agents/wf/precedence.yaml",
	);

	// 5. Non-existent workflow throws descriptive error
	await assert.rejects(
		() => runner.resolveWorkflowFile("missing"),
		/File not found: 'missing'/,
	);

	// 6. executeWorkflow integration with well-known resolution
	runner.registerWorkflow(
		".agents/wf/runme.yaml",
		`name: Test Well-Known
steps:
  - print: "resolved and executed"`,
	);
	const result = await executeWorkflow({
		targetPath: "runme",
		effects: runner,
	});
	assert.equal(result.kind, "success");
	assert.deepEqual(runner.printedTexts, ["resolved and executed"]);

	const failResult = await executeWorkflow({
		targetPath: "notfound",
		effects: runner,
	});
	assert.equal(failResult.kind, "error");
	assert.ok(failResult.text.includes("Failed to load workflow 'notfound'"));
});

test("DshWorkflowEffectContext resolves workflow files from filesystem locations", async () => {
	const tempDir = await mkdtemp(path.join(tmpdir(), "dsh-wf-test-"));
	try {
		const projectWfDir = path.join(tempDir, ".agents", "wf");
		await mkdir(projectWfDir, { recursive: true });

		const directPath = path.join(tempDir, "direct-wf.yaml");
		await writeFile(directPath, "steps: []", "utf8");

		const projectWfPath = path.join(projectWfDir, "project-wf.yaml");
		await writeFile(projectWfPath, "steps: []", "utf8");

		const ymlPath = path.join(projectWfDir, "yml-wf.yml");
		await writeFile(ymlPath, "steps: []", "utf8");

		const mockAgent = {
			id: "sess-test",
			session: {
				header: { cwd: tempDir },
				append() {},
				snapshotEvents() {
					return [];
				},
			},
			followup() {},
			whenIdle: async () => {},
		};

		const effects = new DshWorkflowEffectContext({
			ctx: {} as unknown as Context,
			agent: mockAgent as unknown as Agent,
		});

		// Direct resolution
		assert.equal(
			await effects.resolveWorkflowFile("direct-wf.yaml"),
			directPath,
		);

		// Project-local resolution with extension auto-detection
		assert.equal(
			await effects.resolveWorkflowFile("project-wf"),
			projectWfPath,
		);
		assert.equal(
			await effects.resolveWorkflowFile("project-wf.yaml"),
			projectWfPath,
		);
		assert.equal(await effects.resolveWorkflowFile("yml-wf"), ymlPath);

		// Non-existent error
		await assert.rejects(
			() => effects.resolveWorkflowFile("nonexistent"),
			/Workflow file not found for target 'nonexistent'/,
		);

		// Missing cwd error
		const agentNoCwd = {
			...mockAgent,
			session: {
				...mockAgent.session,
				header: {},
			},
		};
		const effectsNoCwd = new DshWorkflowEffectContext({
			ctx: {} as unknown as Context,
			agent: agentNoCwd as unknown as Agent,
		});
		await assert.rejects(
			() => effectsNoCwd.resolveWorkflowFile("direct-wf.yaml"),
			/Session working directory \(agent\.session\.header\.cwd\) is missing/,
		);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("validateWorkflowInvocation and executeValidatedWorkflow execution and error handling", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "val-test-session" });
	runner.registerWorkflow(
		"valid-flow.yaml",
		`name: Valid Workflow
steps:
  - print: "Step 1 done"
  - prompt: "Step 2 done"`,
	);

	// 1. Validation error on missing target
	const missingRes = await validateWorkflowInvocation("missing.yaml", runner);
	assert.equal(missingRes.kind, "error");
	assert.ok(missingRes.text.includes("Failed to load workflow"));

	// 2. Validation success returns ValidatedWorkflow
	const validRes = await validateWorkflowInvocation("valid-flow.yaml", runner);
	assert.equal(validRes.kind, "valid");
	if (validRes.kind !== "valid") return;
	assert.equal(validRes.doc.name, "Valid Workflow");
	assert.equal(validRes.state.stepIndex, 0);

	// 3. executeValidatedWorkflow runs steps to completion
	const execRes = await executeValidatedWorkflow(validRes, runner);
	assert.equal(execRes.kind, "success");
	assert.equal(execRes.text, "Completed workflow (2 steps)");

	// 4. Background error handling emits aborted state
	const errorRunner = new WorkflowTestRunner({ sessionId: "err-test-session" });
	errorRunner.registerWorkflow(
		"failing-flow.yaml",
		`name: Failing Workflow
steps:
  - prompt: "Trigger error"`,
	);
	errorRunner.onPrompt = () => {
		throw new Error("Simulated prompt failure");
	};

	const failVal = await validateWorkflowInvocation(
		"failing-flow.yaml",
		errorRunner,
	);
	assert.equal(failVal.kind, "valid");
	if (failVal.kind !== "valid") return;

	const failExecRes = await executeValidatedWorkflow(failVal, errorRunner);
	assert.equal(failExecRes.kind, "error");
	assert.match(failExecRes.text, /Simulated prompt failure/);

	const latestRun = errorRunner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "aborted");
});

test("/wf command clears prompt immediately on valid invocation and executes in background", async () => {
	const registered = new Map<string, CommandDefinition>();
	const mockCtx = createMockRunnerContext({ registered });

	await apply(mockCtx as unknown as Context);
	const wfCmd = registered.get("wf");
	assert.ok(wfCmd);

	const runner = new WorkflowTestRunner({ sessionId: "handler-bg-session" });
	runner.registerWorkflow(
		"bg-handler-flow.yaml",
		`name: Background Handler Workflow
steps:
  - print: "Instant print"`,
	);

	const mockAgent = {
		id: "handler-bg-session",
		session: {
			header: { cwd: "/mock/cwd" },
			append() {},
			snapshotEvents() {
				return [];
			},
		},
		followup() {},
		whenIdle: async () => {},
	};

	// 1. Invalid input returns error with message
	const invalidResult = await wfCmd.handler({
		name: "wf",
		rawInput: "missing.yaml",
		agent: mockAgent as unknown as Agent,
	} as unknown as CommandInvocation);
	assert.equal(invalidResult.kind, "error");
	assert.ok(invalidResult.text !== undefined);

	// 2. Direct validateWorkflowInvocation + executeValidatedWorkflow background check
	const validated = await validateWorkflowInvocation(
		"bg-handler-flow.yaml",
		runner,
	);
	assert.equal(validated.kind, "valid");
	if (validated.kind !== "valid") return;

	// Settle outer command handler immediately with clean success (no text)
	const handlerSettled: CommandResult = { kind: "success" };
	assert.equal(handlerSettled.kind, "success");
	assert.equal(handlerSettled.text, undefined);

	// Background execution completes
	await executeValidatedWorkflow(validated, runner);
	assert.deepEqual(runner.printedTexts, ["Instant print"]);
	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "completed");
});

test("executeValidatedWorkflow and resumeWorkflow queue and wait when agent is busy", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "busy-wait-session" });
	runner.registerWorkflow(
		"wait-flow.yaml",
		`name: Busy Wait Workflow
steps:
  - prompt: "Step executed after idle"
    gate: "Pause gate"
  - print: "Step executed after resume idle"`,
	);

	const validated = await validateWorkflowInvocation("wait-flow.yaml", runner);
	assert.equal(validated.kind, "valid");
	if (validated.kind !== "valid") return;

	// 1. Agent is currently busy
	runner.busy = true;

	let executed = false;
	const runPromise = executeValidatedWorkflow(validated, runner).then((res) => {
		executed = true;
		return res;
	});

	// Yield event loop deterministically; workflow must NOT start while busy
	// but init event is emitted immediately so UI card is rendered
	await new Promise((r) => setImmediate(r));
	assert.equal(executed, false);
	assert.deepEqual(runner.printedTexts, []);
	assert.equal(runner.getLatestRun()?.state.status, "running");

	// 2. Agent becomes idle -> execution begins
	runner.resolveIdle();
	const execResult = await runPromise;
	assert.equal(executed, true);
	assert.equal(execResult.kind, "success");
	assert.equal(runner.dispatchedPrompts.length, 1);
	assert.deepEqual(runner.printedTexts, []);
	assert.equal(runner.getLatestRun()?.state.status, "paused");

	// 3. Concurrent whenIdle callers resolve together
	runner.busy = true;
	let c1 = false;
	let c2 = false;
	void runner.whenIdle().then(() => {
		c1 = true;
	});
	void runner.whenIdle().then(() => {
		c2 = true;
	});
	assert.equal(c1, false);
	assert.equal(c2, false);
	runner.resolveIdle();
	await new Promise((r) => setImmediate(r));
	assert.equal(c1, true);
	assert.equal(c2, true);

	// 4. Resume when busy waits and observes events committed before idle
	runner.busy = true;
	let resumeExecuted = false;
	const resumePromise = resumeWorkflow({ effects: runner }).then((res) => {
		resumeExecuted = true;
		return res;
	});

	// Yield event loop; resume must NOT start while busy
	await new Promise((r) => setImmediate(r));
	assert.equal(resumeExecuted, false);
	assert.deepEqual(runner.printedTexts, []);
	assert.equal(runner.getLatestRun()?.state.status, "paused");

	// Agent finishes and becomes idle -> resume completes with fresh event snapshot
	runner.resolveIdle();
	const resumeResult = await resumePromise;
	assert.equal(resumeExecuted, true);
	assert.equal(resumeResult.kind, "success");
	assert.deepEqual(runner.printedTexts, ["Step executed after resume idle"]);
	assert.equal(runner.getLatestRun()?.state.status, "completed");

	// 5. Aborted signal during busy wait returns error before initializing
	runner.busy = true;
	const abortCtrl = new AbortController();
	const abortPromise = executeValidatedWorkflow(
		validated,
		runner,
		abortCtrl.signal,
	);
	abortCtrl.abort();
	runner.resolveIdle();
	const abortRes = await abortPromise;
	assert.equal(abortRes.kind, "error");
	assert.match(abortRes.text, /Workflow aborted/);
});

test("discardWorkflow marks active or paused workflow as aborted", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "discard-test-session" });
	runner.registerWorkflow(
		"gate-flow.yaml",
		`name: Gate Flow
steps:
  - name: Step 1
    prompt: "First step"
    gate: "Check gate"
  - name: Step 2
    prompt: "Second step"`,
	);

	// 1. Discard when no workflow exists returns error
	const noWfRes = await discardWorkflow({ effects: runner });
	assert.equal(noWfRes.kind, "error");
	assert.match(noWfRes.text, /No active workflow to discard/);

	// 2. Start workflow and pause at gate
	const execRes = await executeWorkflow({
		effects: runner,
		targetPath: "gate-flow.yaml",
		runId: "test-run",
	});
	assert.equal(execRes.kind, "success");
	assert.equal(runner.getLatestRun()?.state.status, "paused");

	// 3. Discard paused workflow
	const discardRes = await discardWorkflow({ effects: runner });
	assert.equal(discardRes.kind, "success");
	assert.ok(discardRes.text);
	assert.match(discardRes.text, /Workflow discarded at step 1\/2/);
	assert.equal(runner.getLatestRun()?.state.status, "aborted");

	// 4. Discard already aborted workflow returns error
	const secondDiscard = await discardWorkflow({ effects: runner });
	assert.equal(secondDiscard.kind, "error");
	assert.match(
		secondDiscard.text,
		/Workflow is not active or has already ended/,
	);

	// 5. Discard actively running workflow returns error
	runner.emit({
		action: "state",
		status: "running",
		stepIndex: 0,
		runId: "test-run",
	});
	const runningDiscard = await discardWorkflow({ effects: runner });
	assert.equal(runningDiscard.kind, "error");
	assert.match(
		runningDiscard.text,
		/Cannot discard an actively running workflow/,
	);
});

test("/wf-abort command executes discardWorkflow through registered handler", async () => {
	const registered = new Map<string, CommandDefinition>();
	const mockCtx = createMockRunnerContext({ registered });

	await apply(mockCtx as unknown as Context);
	const abortCmd = registered.get("wf-abort");
	assert.ok(abortCmd);

	const mockAgent = {
		id: "sess-abort-test",
		session: {
			header: { cwd: "/mock/cwd" },
			append() {},
			snapshotEvents() {
				return [];
			},
		},
		followup() {},
		whenIdle: async () => {},
	};

	const result = await abortCmd.handler({
		name: "wf-abort",
		rawInput: "",
		agent: mockAgent as unknown as Agent,
	} as unknown as CommandInvocation);

	assert.equal(result.kind, "error");
	assert.match(result.text, /No active workflow to discard/);
});

test("executeWorkflow pauses on interruption, records pauseReason interrupted, and resume re-runs current step with hint", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "pause-session-1" });
	runner.registerWorkflow(
		"interrupted-flow.yaml",
		`name: Interrupted Flow
steps:
  - name: Step 1
    print: "Step 1 done"
  - name: Step 2
    prompt: "Prompt step 2"
  - name: Step 3
    prompt: "Prompt step 3"`,
	);

	const abortController = new AbortController();
	runner.onPrompt = () => {
		abortController.abort({ kind: "pause" });
	};

	// 1. Initial run: Step 1 prints, Step 2 runs and gets paused
	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "interrupted-flow.yaml",
		signal: abortController.signal,
	});

	assert.equal(runResult.kind, "success");
	assert.ok(runResult.text);
	assert.match(
		runResult.text,
		/Workflow paused at step 2\/3\. Resume with \/wf-resume/,
	);

	// Verify state pause event emitted with stepIndex = 1 and pauseReason = "interrupted"
	const pausedState = runner.getLatestRun()?.state;
	assert.equal(pausedState?.status, "paused");
	assert.equal(pausedState?.pauseReason, "interrupted");
	assert.equal(pausedState?.stepIndex, 1);
	assert.equal(runner.dispatchedPrompts.length, 1);

	// 2. Resume workflow: should pick up from CURRENT step 2 (index 1), NOT skip to step 3!
	runner.onPrompt = undefined;
	const resumeResult = await resumeWorkflow({
		effects: runner,
	});
	assert.equal(resumeResult.kind, "success");
	assert.equal(resumeResult.text, "Completed workflow (3 steps)");

	// Total prompts: 1 initial (step 2) + 1 resumed (step 2) + 1 (step 3) = 3 prompts
	assert.equal(runner.dispatchedPrompts.length, 3);

	// Initial prompt step 2 did NOT have <workflow-resume>
	assert.equal(
		runner.dispatchedPrompts[0].promptText.includes("<workflow-resume>"),
		false,
	);

	// Resumed prompt step 2 MUST include <workflow-resume> hint
	assert.equal(
		runner.dispatchedPrompts[1].promptText.includes("<workflow-resume>"),
		true,
	);
	assert.equal(
		runner.dispatchedPrompts[1].promptText,
		formatStepPrompt({
			stepIndex: 1,
			totalSteps: 3,
			stepName: "Step 2",
			workflowName: "Interrupted Flow",
			prompt: "Prompt step 2",
			isResumedStep: true,
		}),
	);

	// Step 3 was executed as stepIndex 2, NOT resumed
	assert.equal(
		runner.dispatchedPrompts[2].promptText.includes("<workflow-resume>"),
		false,
	);
});

test("executeWorkflow pauses when interrupted during output verification retry", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "output-retry-pause" });
	runner.registerWorkflow(
		"output-flow.yaml",
		`name: Output Flow
steps:
  - name: Step 1
    prompt: "Generate output"
    outputs:
      result:
        type: file
        path: missing.txt
        base: scratch
  - name: Step 2
    print: "Result: {{outputs.result}}"`,
	);

	const abortController = new AbortController();
	let promptCount = 0;
	runner.onPrompt = () => {
		promptCount++;
		if (promptCount === 2) {
			abortController.abort({ kind: "pause" });
		}
	};

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "output-flow.yaml",
		signal: abortController.signal,
	});

	assert.equal(runResult.kind, "success");
	assert.ok(runResult.text);
	assert.match(
		runResult.text,
		/Workflow paused at step 1\/2\. Resume with \/wf-resume/,
	);
	const state = runner.getLatestRun()?.state;
	assert.equal(state?.status, "paused");
	assert.equal(state?.pauseReason, "interrupted");
	assert.equal(state?.stepIndex, 0);
});

test("DshWorkflowEffectContext watchAbort aborts controller with kind 'pause' on turn/end aborted", () => {
	const mockAgent = {
		id: "sess-watch",
		session: "mock-session-obj",
	};
	let sessionEventHandler:
		| ((
				session: unknown,
				event: { type: string; data?: { reason?: { kind?: string } } },
		  ) => void)
		| undefined;
	const mockCtx = {
		on(
			evt: string,
			fn: (
				session: unknown,
				event: { type: string; data?: { reason?: { kind?: string } } },
			) => void,
		) {
			if (evt === "session/event") {
				sessionEventHandler = fn;
			}
			return () => {
				sessionEventHandler = undefined;
			};
		},
	};

	const effects = new DshWorkflowEffectContext({
		ctx: mockCtx as unknown as Context,
		agent: mockAgent as unknown as Agent,
	});

	const abortCtrl = new AbortController();
	const cleanup = effects.watchAbort(abortCtrl);

	assert.ok(sessionEventHandler);
	assert.equal(abortCtrl.signal.aborted, false);

	// Irrelevant session event ignored
	sessionEventHandler?.("other-session", {
		type: "turn/end",
		data: { reason: { kind: "aborted" } },
	});
	assert.equal(abortCtrl.signal.aborted, false);

	// Matching session event aborts with { kind: "pause" }
	sessionEventHandler?.("mock-session-obj", {
		type: "turn/end",
		data: { reason: { kind: "aborted" } },
	});
	assert.equal(abortCtrl.signal.aborted, true);
	assert.deepEqual(abortCtrl.signal.reason, { kind: "pause" });

	cleanup();
	assert.equal(sessionEventHandler, undefined);
});

test("executeWorkflow pauses when subagent execution is aborted with pause", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "subagent-pause",
		behavior: {
			subagent: {
				pauseAtStepIndex: 0,
			},
		},
	});
	runner.registerWorkflow(
		"subagent-flow.yaml",
		`name: Subagent Flow
steps:
  - name: Subagent Step
    prompt: "Subagent task"
    subagent: true
    output: sub_pause
  - print: "Resume {{outputs.sub_pause}}"`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "subagent-flow.yaml",
	});

	assert.equal(runResult.kind, "success");
	assert.ok(runResult.text);
	assert.match(
		runResult.text,
		/Workflow paused at step 1\/2\. Resume with \/wf-resume/,
	);
	const state = runner.getLatestRun()?.state;
	assert.equal(state?.status, "paused");
	assert.equal(state?.pauseReason, "interrupted");
	assert.equal(state?.stepIndex, 0);
});

test("executeValidatedWorkflow pauses if signal aborted with pause before steps start", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "early-pause" });
	runner.registerWorkflow(
		"early-flow.yaml",
		`name: Early Flow
steps:
  - print: "Never printed"`,
	);

	const validated = await validateWorkflowInvocation("early-flow.yaml", runner);
	assert.equal(validated.kind, "valid");
	if (validated.kind !== "valid") return;

	runner.busy = true;
	const abortCtrl = new AbortController();
	const promise = executeValidatedWorkflow(validated, runner, abortCtrl.signal);
	abortCtrl.abort({ kind: "pause" });
	runner.resolveIdle();

	const res = await promise;
	assert.equal(res.kind, "success");
	assert.ok(res.text);
	assert.match(res.text, /Workflow paused at step 1\/1/);
	assert.equal(runner.getLatestRun()?.state.status, "paused");
	assert.equal(runner.getLatestRun()?.state.pauseReason, "interrupted");
});

test("resumeWorkflow pauses if signal aborted with pause before steps start", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "resume-early-pause" });
	runner.registerWorkflow(
		"early-resume-flow.yaml",
		`name: Early Resume Flow
steps:
  - prompt: "Step 1"
    gate: "Gate 1"
  - print: "Step 2"`,
	);

	await executeWorkflow({
		effects: runner,
		targetPath: "early-resume-flow.yaml",
	});

	assert.equal(runner.getLatestRun()?.state.status, "paused");

	runner.busy = true;
	const abortCtrl = new AbortController();
	const promise = resumeWorkflow({
		effects: runner,
		signal: abortCtrl.signal,
	});
	abortCtrl.abort({ kind: "pause" });
	runner.resolveIdle();

	const res = await promise;
	assert.equal(res.kind, "success");
	assert.ok(res.text);
	assert.match(res.text, /Workflow paused at step 2\/2/);
	const pausedState = runner.getLatestRun()?.state;
	assert.equal(pausedState?.status, "paused");
	assert.equal(pausedState?.pauseReason, "interrupted");
	assert.equal(pausedState?.stepIndex, 1);
});

test("executeValidatedWorkflow failure on step 2 preserves step 1 outputs and records error", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "step-failure-sess" });
	runner.registerWorkflow(
		"multi-step-failure.yaml",
		`name: Multi Step Failure Flow
steps:
  - name: Step 1
    prompt: "First step"
    outputs:
      plan:
        type: string
  - name: Step 2
    prompt: "Second step"
  - name: Step 3
    print: "Done: {{outputs.plan}}"`,
	);

	runner.onPrompt = (effect) => {
		if (effect.stepLabel.includes("Step 1")) {
			runner.recordOutput(
				0,
				"plan",
				"review plan content",
				"string",
				undefined,
				runner.getLatestRun()?.invocation.runId ?? "test-run",
			);
		} else if (effect.stepLabel.includes("Step 2")) {
			throw new Error("Subagent activation failed: UNAUTHORIZED");
		}
	};

	const validated = await validateWorkflowInvocation(
		"multi-step-failure.yaml",
		runner,
	);
	assert.equal(validated.kind, "valid");
	if (validated.kind !== "valid") return;

	const res = await executeValidatedWorkflow(validated, runner);
	assert.equal(res.kind, "error");
	assert.match(res.text, /Subagent activation failed: UNAUTHORIZED/);

	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "aborted");
	assert.equal(latestRun.state.stepIndex, 1);
	assert.equal(
		latestRun.state.error,
		"Subagent activation failed: UNAUTHORIZED",
	);
	assert.deepEqual(latestRun.state.outputs, { plan: "review plan content" });
});

test("handleExecutionFailure safely handles non-Error throw and clamps out-of-bounds step index", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "non-error-sess" });
	runner.registerWorkflow(
		"two-step.yaml",
		`name: Two Step Flow
steps:
  - name: Step 1
    prompt: "First"
  - name: Step 2
    prompt: "Second"`,
	);

	runner.onPrompt = () => {
		throw "Custom string error failure";
	};

	const validated = await validateWorkflowInvocation("two-step.yaml", runner);
	assert.equal(validated.kind, "valid");
	if (validated.kind !== "valid") return;

	const res = await executeValidatedWorkflow(validated, runner);
	assert.equal(res.kind, "error");
	assert.match(res.text, /Custom string error failure/);

	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "aborted");
	assert.equal(latestRun.state.error, "Custom string error failure");
	assert.equal(latestRun.state.stepIndex, 0);
});

test("resumeWorkflow strips stale error from previous aborted state", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "resume-error-sess" });
	runner.registerWorkflow(
		"error-resume.yaml",
		`name: Error Resume Flow
steps:
  - name: Step 1
    prompt: "First step"
  - name: Step 2
    prompt: "Second step"`,
	);

	let failFirst = true;
	runner.onPrompt = () => {
		if (failFirst) {
			failFirst = false;
			throw new Error("Temporary network glitch");
		}
	};

	const validated = await validateWorkflowInvocation(
		"error-resume.yaml",
		runner,
	);
	assert.equal(validated.kind, "valid");
	if (validated.kind !== "valid") return;

	const failRes = await executeValidatedWorkflow(validated, runner);
	assert.equal(failRes.kind, "error");
	assert.equal(runner.getLatestRun()?.state.error, "Temporary network glitch");

	// Resume workflow: error must be stripped when resumed and completed
	const resumeRes = await resumeWorkflow({ effects: runner });
	assert.equal(resumeRes.kind, "success");
	const finalRun = runner.getLatestRun();
	assert.ok(finalRun);
	assert.equal(finalRun.state.status, "completed");
	assert.equal(finalRun.state.error, undefined);
});

test("validateWorkflowInvocation validates while a workflow is already running in session", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "already-running-sess" });
	runner.registerWorkflow(
		"new-flow.yaml",
		`name: New Workflow
steps:
  - print: "Will not run"`,
	);

	// 1. Simulate an active running workflow
	runner.events.push({
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify({
				action: "init",
				workflow: { name: "Active Flow", steps: [] },
				invocation: {
					targetPath: "active.yaml",
					resolvedArgs: {},
					runId: "active-run",
				},
				runId: "active-run",
				sessionId: "already-running-sess",
			}),
		},
	});
	runner.events.push({
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify({
				action: "state",
				status: "running",
				stepIndex: 0,
				runId: "active-run",
				sessionId: "already-running-sess",
			}),
		},
	});

	const runningResult = await validateWorkflowInvocation(
		"new-flow.yaml",
		runner,
	);
	assert.equal(runningResult.kind, "valid");

	// 2. When previous workflow is paused, starting a new workflow is allowed
	runner.events.push({
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify({
				action: "state",
				status: "paused",
				stepIndex: 0,
				runId: "active-run",
				sessionId: "already-running-sess",
			}),
		},
	});
	const allowPausedRes = await validateWorkflowInvocation(
		"new-flow.yaml",
		runner,
	);
	assert.equal(allowPausedRes.kind, "valid");

	// 3. When previous workflow is completed, starting a new workflow is allowed
	runner.events.push({
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify({
				action: "state",
				status: "completed",
				stepIndex: 1,
				runId: "active-run",
				sessionId: "already-running-sess",
			}),
		},
	});
	const allowCompletedRes = await validateWorkflowInvocation(
		"new-flow.yaml",
		runner,
	);
	assert.equal(allowCompletedRes.kind, "valid");

	// 4. When previous workflow is aborted, starting a new workflow is allowed
	runner.events.push({
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify({
				action: "state",
				status: "aborted",
				stepIndex: 0,
				runId: "active-run",
				sessionId: "already-running-sess",
			}),
		},
	});
	const allowAbortedRes = await validateWorkflowInvocation(
		"new-flow.yaml",
		runner,
	);
	assert.equal(allowAbortedRes.kind, "valid");
});

test("/wf slash command handler validates missing files while a workflow is running", async () => {
	const registered = new Map<string, CommandDefinition>();
	const mockCtx = createMockRunnerContext({ registered });

	await apply(mockCtx as unknown as Context);
	const wfCmd = registered.get("wf");
	assert.ok(wfCmd);

	let followupCalled = false;
	const runningEvents = [
		{
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "init",
					workflow: { name: "Existing Workflow", steps: [] },
					invocation: {
						targetPath: "existing.yaml",
						resolvedArgs: {},
						runId: "existing-run",
					},
					runId: "existing-run",
					sessionId: "active-running-agent",
				}),
			},
		},
		{
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "state",
					status: "running",
					stepIndex: 0,
					runId: "existing-run",
					sessionId: "active-running-agent",
				}),
			},
		},
	];

	const mockAgent = {
		id: "active-running-agent",
		session: {
			header: { cwd: "/mock/cwd" },
			append() {},
			snapshotEvents() {
				return runningEvents;
			},
		},
		followup() {
			followupCalled = true;
		},
		whenIdle: async () => {},
	};

	const result = await wfCmd.handler({
		name: "wf",
		rawInput: "other.yaml",
		agent: mockAgent as unknown as Agent,
	} as unknown as CommandInvocation);

	assert.equal(result.kind, "error");
	assert.match(result.text, /Workflow file not found/);
	assert.equal(followupCalled, false);
});

test("listWorkflows lists workflows across local and common directories", async () => {
	const runner = new WorkflowTestRunner();

	runner.registerWorkflow(
		".agents/wf/local-deploy.yaml",
		`name: "Local Deploy"
description: "Deploys to environment"
args:
  env:
    type: choice
    choices: ["dev", "prod"]
    description: "Target env"
steps:
  - "echo local"`,
	);

	runner.registerWorkflow(
		"~/.agents/wf/common-review.yml",
		`name: "Common Review"
description: "Reviews code"
args:
  branch:
    type: string
    default: "main"
    description: "Branch to review"
steps:
  - "echo review"`,
	);

	// Invalid YAML should be skipped
	runner.registerWorkflow(".agents/wf/broken.yaml", "not: [valid");

	const result = await listWorkflows(runner);
	assert.equal(result.kind, "success");
	assert.ok(result.text);

	assert.ok(result.text.includes("### Local Workflows (.agents/wf)"));
	assert.ok(
		result.text.includes(
			"**Local Deploy** (`local-deploy.yaml`): Deploys to environment",
		),
	);
	assert.ok(
		result.text.includes(
			"- `env` (choice, choices: dev, prod, required): Target env",
		),
	);
	assert.ok(!result.text.includes("broken.yaml"));

	assert.ok(result.text.includes("### Common Workflows (~/.agents/wf)"));
	assert.ok(
		result.text.includes(
			"**Common Review** (`common-review.yml`): Reviews code",
		),
	);
	assert.ok(
		result.text.includes(
			'- `branch` (string, default: "main"): Branch to review',
		),
	);
});

test("DshWorkflowEffectContext listWorkflowFiles reads from local and common directories", async () => {
	const tempDir = await mkdtemp(path.join(tmpdir(), "dsh-wf-list-test-"));
	try {
		const projectWfDir = path.join(tempDir, ".agents", "wf");
		await mkdir(projectWfDir, { recursive: true });

		const wfPath = path.join(projectWfDir, "hello.yaml");
		await writeFile(wfPath, "name: Hello\nsteps:\n  - print: hi", "utf8");

		const mockAgent = {
			id: "sess-list-test",
			session: {
				header: { cwd: tempDir },
				append() {},
				snapshotEvents() {
					return [];
				},
			},
			followup() {},
			whenIdle: async () => {},
		};

		const effects = new DshWorkflowEffectContext({
			ctx: {} as unknown as Context,
			agent: mockAgent as unknown as Agent,
		});

		const localFiles = await effects.listWorkflowFiles("local");
		assert.equal(localFiles.length, 1);
		assert.equal(localFiles[0].target, "hello.yaml");
		assert.ok(localFiles[0].content.includes("name: Hello"));
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("/wf-list command returns list of workflows through registered handler", async () => {
	const registered = new Map<string, CommandDefinition>();
	const mockCtx = createMockRunnerContext({ registered });

	await apply(mockCtx as unknown as Context);
	const listCmd = registered.get("wf-list");
	assert.ok(listCmd);
	assert.equal(listCmd.name, "wf-list");

	const tempDir = await mkdtemp(path.join(tmpdir(), "dsh-cmd-list-test-"));
	try {
		const mockAgent = {
			id: "sess-cmd-list",
			session: {
				header: { cwd: tempDir },
				append() {},
				snapshotEvents() {
					return [];
				},
			},
			followup() {},
			whenIdle: async () => {},
		};

		const res = await listCmd.handler({
			name: "wf-list",
			rawInput: "",
			agent: mockAgent as unknown as Agent,
		} as unknown as CommandInvocation);

		assert.equal(res.kind, "success");
		assert.ok(res.text);
		assert.ok(res.text.includes("### Local Workflows (.agents/wf)"));
		assert.ok(res.text.includes("*(No workflows found)*"));
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("executes workflow skipping steps with false if condition and passing instructions to first active step", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "conditional-sess" });
	runner.registerWorkflow(
		"conditional.yaml",
		`name: "Conditional Flow"
args:
  run_step1:
    type: bool
    default: false
  run_step2:
    type: bool
    default: true
  mode:
    type: choice
    choices: ["a", "b"]
    default: "b"
  instructions:
    type: string
    default: ""
steps:
  - name: "Step 1"
    if: "{{args.run_step1}}"
    prompt: "Prompt 1"
  - name: "Step 2"
    if: "{{args.run_step2}}"
    prompt: "Prompt 2: {{args.instructions}}"
  - name: "Step 3"
    if: '{{args.mode}} == "a"'
    prompt: "Prompt 3"
  - name: "Step 4"
    if: '{{args.mode}} != "a"'
    prompt: "Prompt 4"`,
	);

	const dispatchedPrompts: Array<{ label: string; text: string }> = [];
	runner.onPrompt = (effect) => {
		dispatchedPrompts.push({
			label: effect.stepLabel,
			text: effect.promptText,
		});
	};

	const validated = await validateWorkflowInvocation(
		"conditional.yaml user instructions here",
		runner,
	);
	assert.equal(validated.kind, "valid");
	if (validated.kind !== "valid") return;

	const res = await executeValidatedWorkflow(validated, runner);
	assert.equal(res.kind, "success");
	assert.equal(res.text, "Completed workflow (4 steps)");

	// Only Step 2 and Step 4 should have executed
	assert.deepEqual(
		dispatchedPrompts.map((p) => p.label),
		["Step 2 of 4: Step 2", "Step 4 of 4: Step 4"],
	);

	// Instructions should have interpolated in Step 2 (first executed step)
	assert.ok(
		dispatchedPrompts[0].text.includes("Prompt 2: user instructions here"),
	);

	const finalRun = runner.getLatestRun();
	assert.ok(finalRun);
	assert.equal(finalRun.state.status, "completed");
	assert.equal(finalRun.state.stepIndex, 4);
});

test("executeWorkflow runs contiguous subagents concurrently in parallel", async () => {
	let activeCount = 0;
	let maxConcurrent = 0;

	class ConcurrencyTestRunner extends WorkflowTestRunner {
		override async dispatchSubagent(
			effect: Extract<WorkflowEffect, { type: "subagent" }>,
			signal?: AbortSignal,
		) {
			activeCount++;
			if (activeCount > maxConcurrent) {
				maxConcurrent = activeCount;
			}
			await new Promise((resolve) => setTimeout(resolve, 30));
			activeCount--;
			return super.dispatchSubagent(effect, signal);
		}
	}

	const runner = new ConcurrencyTestRunner({
		sessionId: "test-parallel-subagents",
	});
	runner.registerWorkflow(
		"parallel-subagents.yaml",
		`name: Parallel Subagents Flow
steps:
  - name: Sub 1
    prompt: Scan 1
    subagent: true
    output: out1
  - name: Sub 2
    prompt: Scan 2
    subagent: true
    output: out2
  - name: Sub 3
    prompt: Scan 3
    subagent: true
    output: out3
  - name: Summary
    print: "Done: {{outputs.out1}}, {{outputs.out2}}, {{outputs.out3}}"`,
	);

	const result = await executeWorkflow({
		effects: runner,
		targetPath: "parallel-subagents.yaml",
	});

	assert.equal(result.kind, "success");
	assert.equal(maxConcurrent, 3);
	assert.equal(runner.dispatchedSubagents.length, 3);
	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "completed");
	assert.equal(latestRun.state.stepIndex, 4);
});

test("executeWorkflow pauses at gate on last subagent in parallel wave and resumes", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-gated-wave",
	});
	runner.registerWorkflow(
		"gated-wave.yaml",
		`name: Gated Wave Flow
steps:
  - name: Sub 1
    prompt: Audit lint
    subagent: true
    output: lint_out
  - name: Sub 2
    prompt: Audit sec
    subagent: true
    output: sec_out
    gate: Review parallel audits
  - name: Final Step
    print: "Combined: {{outputs.lint_out}} & {{outputs.sec_out}}"`,
	);

	const runResult = await executeWorkflow({
		effects: runner,
		targetPath: "gated-wave.yaml",
	});

	assert.equal(runResult.kind, "success");
	assert.match(
		runResult.text ?? "",
		/paused at gate: "Review parallel audits"/i,
	);

	const pausedRun = runner.getLatestRun();
	assert.ok(pausedRun);
	assert.equal(pausedRun.state.status, "paused");
	assert.equal(pausedRun.state.stepIndex, 1);
	assert.deepEqual(Object.keys(pausedRun.state.outputs ?? {}), [
		"lint_out",
		"sec_out",
	]);

	// Resuming should finish the workflow
	const resumeResult = await resumeWorkflow({ effects: runner });
	assert.equal(resumeResult.kind, "success");
	const finalRun = runner.getLatestRun();
	assert.ok(finalRun);
	assert.equal(finalRun.state.status, "completed");
	assert.equal(finalRun.state.stepIndex, 3);
});

test("executeWorkflow cancels sibling subagents when one fails in parallel wave", async () => {
	let siblingAborted = false;

	class AbortCheckRunner extends WorkflowTestRunner {
		override async dispatchSubagent(
			effect: Extract<WorkflowEffect, { type: "subagent" }>,
			signal?: AbortSignal,
		) {
			if (effect.stepLabel.includes("Sub 1")) {
				await new Promise((resolve) => setTimeout(resolve, 10));
				throw new Error("Subagent 1 crash");
			} else {
				signal?.addEventListener("abort", () => {
					siblingAborted = true;
				});
				await new Promise((resolve) => setTimeout(resolve, 60));
				return super.dispatchSubagent(effect, signal);
			}
		}
	}

	const runner = new AbortCheckRunner({
		sessionId: "test-abort-cascade",
	});
	runner.registerWorkflow(
		"fail-wave.yaml",
		`name: Fail Wave Flow
steps:
  - name: Sub 1
    prompt: Fail task
    subagent: true
    output: fail_out
  - name: Sub 2
    prompt: Long task
    subagent: true
    output: long_out
  - name: Final
    print: "{{outputs.fail_out}} {{outputs.long_out}}"`,
	);

	const result = await executeWorkflow({
		effects: runner,
		targetPath: "fail-wave.yaml",
	});

	assert.equal(result.kind, "error");
	assert.match(result.text, /Subagent 1 crash/);
	assert.equal(siblingAborted, true);
	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "aborted");
	assert.equal(latestRun.state.stepIndex, 0);
});

test("executeWorkflow attributes failure to the specific failing step in a parallel subagent wave", async () => {
	class SpecificFailRunner extends WorkflowTestRunner {
		override async dispatchSubagent(
			effect: Extract<WorkflowEffect, { type: "subagent" }>,
			signal?: AbortSignal,
		) {
			if (effect.stepLabel.includes("Sub 2")) {
				await new Promise((resolve) => setTimeout(resolve, 10));
				throw new Error("Subagent 2 crash");
			}
			await new Promise((resolve) => setTimeout(resolve, 60));
			return super.dispatchSubagent(effect, signal);
		}
	}

	const runner = new SpecificFailRunner({
		sessionId: "test-specific-fail-wave",
	});
	runner.registerWorkflow(
		"fail-step2-wave.yaml",
		`name: Fail Step 2 Wave
steps:
  - name: Sub 1
    prompt: Task 1
    subagent: true
    output: out1
  - name: Sub 2
    prompt: Task 2
    subagent: true
    output: out2
  - name: Final
    print: "{{outputs.out1}} {{outputs.out2}}"`,
	);

	const result = await executeWorkflow({
		effects: runner,
		targetPath: "fail-step2-wave.yaml",
	});

	assert.equal(result.kind, "error");
	assert.match(result.text, /Subagent 2 crash/);
	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "aborted");
	assert.equal(latestRun.state.stepIndex, 1);
});

test("executeWorkflow preserves root failing step index when sibling subagent rejects during abort cascade", async () => {
	class AbortRejectRunner extends WorkflowTestRunner {
		override async dispatchSubagent(
			effect: Extract<WorkflowEffect, { type: "subagent" }>,
			signal?: AbortSignal,
		) {
			if (effect.stepLabel.includes("Sub 2")) {
				await new Promise((resolve) => setTimeout(resolve, 10));
				throw new Error("Subagent 2 crash");
			}
			return new Promise<SubagentDispatchResult>((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					reject(new Error("Subagent 1 aborted"));
				});
			});
		}
	}

	const runner = new AbortRejectRunner({
		sessionId: "test-abort-reject-wave",
	});
	runner.registerWorkflow(
		"fail-step2-abort-cascade.yaml",
		`name: Fail Step 2 Abort Cascade
steps:
  - name: Sub 1
    prompt: Task 1
    subagent: true
    output: out1
  - name: Sub 2
    prompt: Task 2
    subagent: true
    output: out2
  - name: Final
    print: "{{outputs.out1}} {{outputs.out2}}"`,
	);

	const result = await executeWorkflow({
		effects: runner,
		targetPath: "fail-step2-abort-cascade.yaml",
	});

	assert.equal(result.kind, "error");
	assert.match(result.text, /Subagent 2 crash/);
	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "aborted");
	assert.equal(latestRun.state.stepIndex, 1);
});

test("executeWorkflow handles skipped subagents in wave", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-skip-wave",
	});
	runner.registerWorkflow(
		"skip-wave.yaml",
		`name: Skip Wave Flow
args:
  flag:
    type: bool
    default: false
steps:
  - name: Sub 1
    prompt: Skipped task
    if: "{{args.flag}}"
    subagent: true
    output: out1
  - name: Sub 2
    prompt: Active task
    subagent: true
    output: out2
  - name: Final
    print: "Active: {{outputs.out1}} {{outputs.out2}}"`,
	);

	const result = await executeWorkflow({
		effects: runner,
		targetPath: "skip-wave.yaml",
	});

	assert.equal(result.kind, "success");
	assert.equal(runner.dispatchedSubagents.length, 1);
	assert.equal(
		runner.dispatchedSubagents[0].effect.stepLabel,
		"Step 2 of 3: Sub 2",
	);
	const finalRun = runner.getLatestRun();
	assert.ok(finalRun);
	assert.equal(finalRun.state.status, "completed");
	assert.equal(finalRun.state.stepIndex, 3);
});

test("executeWorkflow handles terminal subagent wave without emitting intermediate running event", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-terminal-wave",
	});
	const doc: WorkflowDocument = {
		args: {},
		steps: [
			{
				kind: "subagent",
				name: "Sub 1",
				prompt: "Task 1",
				config: { provider: "spawn" },
				output: "out1",
			},
			{
				kind: "subagent",
				name: "Sub 2",
				prompt: "Task 2",
				config: { provider: "spawn" },
				output: "out2",
			},
		],
	};
	const result = await executeValidatedWorkflow(
		{
			kind: "valid",
			doc,
			invocation: {
				targetPath: "terminal.yaml",
				resolvedArgs: {},
				runId: "term-run",
			},
			state: { stepIndex: 0, status: "running" },
		},
		runner,
	);
	assert.equal(result.kind, "success");
	const finalRun = runner.getLatestRun();
	assert.ok(finalRun);
	assert.equal(finalRun.state.status, "completed");
	assert.equal(finalRun.state.stepIndex, 2);
});

test("executeWorkflow handles terminal skipped wave without intermediate running state", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-terminal-skip-wave",
	});
	const doc: WorkflowDocument = {
		args: {},
		steps: [
			{
				kind: "subagent",
				name: "Sub 1",
				prompt: "Task 1",
				if: "false",
				config: { provider: "spawn" },
				output: "out1",
			},
		],
	};
	const result = await executeValidatedWorkflow(
		{
			kind: "valid",
			doc,
			invocation: {
				targetPath: "terminal-skip.yaml",
				resolvedArgs: {},
				runId: "term-skip-run",
			},
			state: { stepIndex: 0, status: "running" },
		},
		runner,
	);
	assert.equal(result.kind, "success");
	const finalRun = runner.getLatestRun();
	assert.ok(finalRun);
	assert.equal(finalRun.state.status, "completed");
});

test("executeWorkflow handles subagent wave with empty outputs map", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-empty-outputs-wave",
	});
	const doc: WorkflowDocument = {
		args: {},
		steps: [
			{
				kind: "subagent",
				name: "Sub Empty",
				prompt: "Task Empty",
				config: { provider: "spawn" },
				outputs: {},
			},
			{
				kind: "print",
				name: "Print",
				text: "done",
			},
		],
	};
	const result = await executeValidatedWorkflow(
		{
			kind: "valid",
			doc,
			invocation: {
				targetPath: "empty-map.yaml",
				resolvedArgs: {},
				runId: "empty-map-run",
			},
			state: { stepIndex: 0, status: "running" },
		},
		runner,
	);
	assert.equal(result.kind, "success");
});

test("executeWorkflow handles inactive context error in subagent wave", async () => {
	class InactiveRunner extends WorkflowTestRunner {
		override async dispatchSubagent(): Promise<never> {
			throw new Error("inactive context occurred");
		}
	}
	const runner = new InactiveRunner({ sessionId: "test-inactive-wave" });
	runner.registerWorkflow(
		"inactive.yaml",
		`steps:
  - name: Sub 1
    prompt: Task
    subagent: true
    output: out1
  - name: Print
    print: "{{outputs.out1}}"`,
	);
	const result = await executeWorkflow({
		effects: runner,
		targetPath: "inactive.yaml",
	});
	assert.equal(result.kind, "success");
	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "paused");
});

test("executeWorkflow reports correct failed stepIndex and preserves atomic outputs on file check failure", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "test-file-fail-wave",
		behavior: {
			subagent: {
				structured: {
					text_out: "hello",
					file_out: "missing.txt",
				},
			},
		},
	});
	runner.registerWorkflow(
		"file-fail.yaml",
		`steps:
  - name: Sub 1
    prompt: Task 1
    subagent: true
    output: out1
  - name: Sub 2
    prompt: Task 2
    subagent: true
    outputs:
      text_out:
        type: string
      file_out:
        type: file
        path: missing.txt
        base: workspace
  - name: Print
    print: "{{outputs.out1}} {{outputs.text_out}} {{outputs.file_out}}"`,
	);
	const result = await executeWorkflow({
		effects: runner,
		targetPath: "file-fail.yaml",
	});
	assert.equal(result.kind, "error");
	assert.match(result.text, /Step 2 subagent output verification failed/);
	const latestRun = runner.getLatestRun();
	assert.ok(latestRun);
	assert.equal(latestRun.state.status, "aborted");
	assert.equal(latestRun.state.stepIndex, 1);
	assert.equal(latestRun.state.outputs?.text_out, undefined);
});

test("resumeWorkflow preserves user instructions across subagent waves to subsequent prompt", async () => {
	let capturedPromptText = "";
	class InstructionRunner extends WorkflowTestRunner {
		override async dispatchPrompt(
			effect: Extract<WorkflowEffect, { type: "prompt" }>,
		) {
			capturedPromptText = effect.promptText;
			return super.dispatchPrompt(effect);
		}
	}
	const runner = new InstructionRunner({
		sessionId: "test-instruction-wave",
	});
	runner.registerWorkflow(
		"instructions.yaml",
		`steps:
  - name: Initial Gate
    prompt: Start
    gate: Approve start
  - name: Sub 1
    prompt: Task 1
    subagent: true
    output: out1
  - name: Prompt 2
    prompt: Process {{outputs.out1}}`,
	);
	await executeWorkflow({
		effects: runner,
		targetPath: "instructions.yaml",
	});
	assert.equal(runner.getLatestRun()?.state.status, "paused");

	const resumeRes = await resumeWorkflow({
		effects: runner,
		instructions: "Please make it extra concise",
	});
	assert.equal(resumeRes.kind, "success");
	assert.match(capturedPromptText, /Please make it extra concise/);
});

test("validateWorkflowTarget validates workflow targets without executing or mutating state", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "test-validate" });

	// 1. Empty target returns usage error
	const emptyRes = await validateWorkflowTarget("", runner);
	assert.equal(emptyRes.kind, "error");
	assert.equal(
		emptyRes.text,
		"Usage: /wf-validate <workflow.yaml> [key=value ...]",
	);

	// 2. Missing file returns load error
	const missingRes = await validateWorkflowTarget("missing.yaml", runner);
	assert.equal(missingRes.kind, "error");
	assert.match(missingRes.text, /Failed to load workflow 'missing\.yaml'/);

	// 3. Invalid YAML returns parse error
	runner.registerWorkflow("broken.yaml", "steps: [not-closed");
	const brokenRes = await validateWorkflowTarget("broken.yaml", runner);
	assert.equal(brokenRes.kind, "error");
	assert.match(brokenRes.text, /Failed to parse workflow 'broken\.yaml'/);

	// 4. Schema violation returns schema error
	runner.registerWorkflow(
		"schema-invalid.yaml",
		`steps:
  - prompt: "Step 1"
    output: invalid_direct_output`,
	);
	const schemaRes = await validateWorkflowTarget("schema-invalid.yaml", runner);
	assert.equal(schemaRes.kind, "error");
	assert.match(schemaRes.text, /'output' is only allowed on subagent steps/);

	// 5. Valid workflow without runtime args succeeds
	runner.registerWorkflow(
		"valid-flow.yaml",
		`name: "Valid Workflow"
description: "Checks system status"
args:
  env:
    type: choice
    choices: [dev, prod]
    default: dev
  tag:
    type: string
steps:
  - name: "Status Print"
    print: "Checking {{args.env}}"
  - name: "Run Check"
    prompt: "Scan {{args.tag}}"
    subagent: true
    output: result
  - name: "Summary"
    prompt: "Summary: {{outputs.result}}"`,
	);
	const validNoArgs = await validateWorkflowTarget("valid-flow.yaml", runner);
	assert.equal(validNoArgs.kind, "success");
	assert.ok(validNoArgs.text);
	assert.ok(
		validNoArgs.text.includes("### Workflow Validation: `valid-flow.yaml`"),
	);
	assert.ok(validNoArgs.text.includes("- **Status:** Valid"));
	assert.ok(validNoArgs.text.includes("- **Steps:** 3"));
	assert.ok(validNoArgs.text.includes("1. [print] Status Print"));
	assert.ok(validNoArgs.text.includes("2. [subagent] Run Check"));
	assert.ok(validNoArgs.text.includes("3. [prompt] Summary"));
	assert.ok(
		validNoArgs.text.includes(
			'`env` (choice, choices: dev, prod, default: "dev")',
		),
	);
	assert.ok(validNoArgs.text.includes("`tag` (string, required)"));

	// 6. Valid workflow with explicit args succeeds and shows resolved args
	const validWithArgs = await validateWorkflowTarget(
		'valid-flow.yaml env=prod tag="v2.0.0"',
		runner,
	);
	assert.equal(validWithArgs.kind, "success");
	assert.ok(validWithArgs.text);
	assert.ok(validWithArgs.text.includes("- **Resolved Arguments:**"));
	assert.ok(validWithArgs.text.includes('`env`: "prod"'));
	assert.ok(validWithArgs.text.includes('`tag`: "v2.0.0"'));

	// 7. Invalid args returns argument error
	const invalidChoice = await validateWorkflowTarget(
		"valid-flow.yaml env=staging tag=v1",
		runner,
	);
	assert.equal(invalidChoice.kind, "error");
	assert.match(
		invalidChoice.text,
		/Invalid value 'staging' for argument 'env'/,
	);

	// 8. Undeclared argument in template returns error during static validation
	runner.registerWorkflow(
		"undeclared-arg.yaml",
		`steps:
  - prompt: "Hello {{args.unregistered}}"`,
	);
	const undeclaredRes = await validateWorkflowTarget(
		"undeclared-arg.yaml",
		runner,
	);
	assert.equal(undeclaredRes.kind, "error");
	assert.match(
		undeclaredRes.text,
		/Unresolved workflow argument: \{\{args\.unregistered\}\} \(not declared in workflow 'args'\)/,
	);

	// 9. Validates successfully even when another workflow is currently 'running'
	runner.events.push({
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify({
				action: "state",
				status: "running",
				stepIndex: 1,
				runId: "validate-run",
				sessionId: "test-validate",
			}),
		},
	});
	const whileRunning = await validateWorkflowTarget("valid-flow.yaml", runner);
	assert.equal(whileRunning.kind, "success");
	// No new execution events emitted
	assert.equal(runner.dispatchedPrompts.length, 0);
	assert.equal(runner.dispatchedSubagents.length, 0);

	// Non-Error rejection during workflow read
	const nonErrorRunner = {
		...runner,
		readWorkflow: () => Promise.reject("Disk read failure (string)"),
	};
	const valNonError = await validateWorkflowTarget(
		"non-error.yaml",
		nonErrorRunner as unknown as Parameters<typeof validateWorkflowTarget>[1],
	);
	assert.equal(valNonError.kind, "error");
	assert.match(valNonError.text, /Disk read failure \(string\)/);
});

test("validateWorkflowTarget and validateWorkflowInvocation validate subagent routes and models", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "val-subagent-routes" });

	runner.registerWorkflow(
		"invalid-model.yaml",
		`name: Invalid Model Flow
steps:
  - name: Audit Step
    prompt: "Scan repo"
    subagent: "@reviewer/invalid-model"
    output: result
  - print: "{{outputs.result}}"`,
	);

	// 1. validateWorkflowTarget detects invalid model in subagent step
	const valTargetRes = await validateWorkflowTarget(
		"invalid-model.yaml",
		runner,
	);
	assert.equal(valTargetRes.kind, "error");
	assert.match(
		valTargetRes.text,
		/Validation error in workflow 'invalid-model\.yaml': Subagent step 1 \('Audit Step'\): Model 'invalid-model' is not valid/,
	);

	// 2. validateWorkflowInvocation detects invalid model in subagent step
	const valInvocRes = await validateWorkflowInvocation(
		"invalid-model.yaml",
		runner,
	);
	assert.equal(valInvocRes.kind, "error");
	assert.match(
		valInvocRes.text,
		/Validation error in workflow 'invalid-model\.yaml': Subagent step 1 \('Audit Step'\): Model 'invalid-model' is not valid/,
	);

	// 3. Dynamic subagent shorthand with argument interpolation validated correctly
	runner.registerWorkflow(
		"dynamic-subagent.yaml",
		`name: Dynamic Subagent Flow
args:
  chosen_model:
    type: string
    default: "valid-model"
steps:
  - name: Dynamic Step
    prompt: "Analyze"
    subagent: "@reviewer/{{args.chosen_model}}"
    output: result
  - print: "{{outputs.result}}"`,
	);

	// Default arg is "valid-model", passes validation
	const validDefaultRes = await validateWorkflowTarget(
		"dynamic-subagent.yaml",
		runner,
	);
	assert.equal(validDefaultRes.kind, "success");

	// Passing chosen_model=invalid-model fails validation
	const invalidArgRes = await validateWorkflowTarget(
		"dynamic-subagent.yaml chosen_model=invalid-model",
		runner,
	);
	assert.equal(invalidArgRes.kind, "error");
	assert.match(
		invalidArgRes.text,
		/Validation error in workflow 'dynamic-subagent\.yaml': Subagent step 1 \('Dynamic Step'\): Model 'invalid-model' is not valid/,
	);

	// 4. Object subagent config with invalid provider fails validation
	runner.registerWorkflow(
		"invalid-provider.yaml",
		`name: Invalid Provider Flow
steps:
  - name: Custom Step
    prompt: "Run custom"
    subagent:
      provider: "invalid-provider"
      model: "valid-model"
    output: out
  - print: "{{outputs.out}}"`,
	);
	const valProviderRes = await validateWorkflowTarget(
		"invalid-provider.yaml",
		runner,
	);
	assert.equal(valProviderRes.kind, "error");
	assert.match(
		valProviderRes.text,
		/Subagent step 1 \('Custom Step'\): Subagent provider 'invalid-provider' is not registered/,
	);

	// 5. Object subagent config with unresolved template without default is deferred during static validation
	runner.registerWorkflow(
		"dynamic-object-subagent.yaml",
		`name: Dynamic Object Flow
args:
  dyn_prov:
    type: string
steps:
  - name: Dynamic Obj Step
    prompt: "Run check"
    subagent:
      provider: "{{args.dyn_prov}}"
      model: "valid-model"
    output: out
  - print: "{{outputs.out}}"`,
	);
	const deferredTargetRes = await validateWorkflowTarget(
		"dynamic-object-subagent.yaml",
		runner,
	);
	assert.equal(deferredTargetRes.kind, "success");

	// 6. AbortSignal propagates to validateWorkflowInvocation and validateSubagentRoute
	const abortCtrl = new AbortController();
	abortCtrl.abort();
	const abortedRunner = new WorkflowTestRunner({
		sessionId: "abort-val-session",
		behavior: {
			subagentRouteValidation: (_config, signal) => {
				if (signal?.aborted) {
					return "Preflight validation aborted by signal";
				}
				return undefined;
			},
		},
	});
	abortedRunner.registerWorkflow(
		"abort-val.yaml",
		`name: Abort Val Flow
steps:
  - name: Sub Step
    prompt: "Run task"
    subagent: true
    output: out
  - print: "{{outputs.out}}"`,
	);
	const abortedValRes = await validateWorkflowInvocation(
		"abort-val.yaml",
		abortedRunner,
		undefined,
		abortCtrl.signal,
	);
	assert.equal(abortedValRes.kind, "error");
	assert.match(abortedValRes.text, /Preflight validation aborted by signal/);
});
