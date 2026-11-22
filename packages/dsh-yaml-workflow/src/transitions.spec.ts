/**
 * PURPOSE: Pure unit tests for workflow transitions, templating, and step evaluations.
 * ALLOWED: In-memory tests, assertion checks, zero disk I/O, zero network/timers.
 */

import assert from "node:assert/strict";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { describe, it } from "vitest";
import { parseWorkflowDocument } from "./parser.ts";
import { validateWorkflow } from "./rules.ts";
import {
	applyAbort,
	applyGatePause,
	applyStepPause,
	computeStepTransition,
	foldWorkflowEvent,
	foldWorkflowState,
	initialWorkflowRunSummary,
	toWorkflowRunSummaryRecord,
} from "./transitions.ts";
import {
	WORKFLOW_EVENT_NAME,
	type WorkflowDocument,
	type WorkflowInvocation,
	type WorkflowState,
} from "./types.ts";

describe("Workflow Transitions (Pure)", () => {
	it("evaluates a standard prompt step transition via computeStepTransition", () => {
		const doc = parseWorkflowDocument(`
name: "Test Flow"
steps:
  - kind: prompt
    name: "Step One"
    prompt: "Do something with {{args.item}}"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: { item: "widget" },
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});

		assert.equal(result.nextState.stepIndex, 1);
		assert.equal(result.nextState.status, "running");
		assert.equal(result.effect.type, "prompt");
		if (result.effect.type === "prompt") {
			assert.equal(result.effect.stepLabel, "Step 1 of 1: Step One");
			assert.equal(result.effect.gate, undefined);
			assert(result.effect.promptText.includes("Do something with widget"));
		}
	});

	it("evaluates a subagent step transition with default subagent: true", () => {
		const doc = parseWorkflowDocument(`
name: "Subagent Flow"
steps:
  - kind: prompt
    name: "Subagent Task"
    prompt: "Scan security for {{args.target}}"
    subagent: true
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: { target: "auth" },
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});

		assert.equal(result.nextState.stepIndex, 1);
		assert.equal(result.nextState.status, "running");
		assert.equal(result.effect.type, "subagent");
		if (result.effect.type === "subagent") {
			assert.equal(result.effect.stepLabel, "Step 1 of 1: Subagent Task");
			assert.deepEqual(result.effect.config, { provider: "spawn" });
			assert.equal(result.effect.promptText, "Scan security for auth");
			assert(!result.effect.promptText.includes("<workflow-info>"));
			assert(!result.effect.promptText.includes("<step-instructions>"));
		}
	});

	it("evaluates a subagent step transition with parameterized config and gate", () => {
		const doc = parseWorkflowDocument(`
name: "Parameterized Subagent Flow"
steps:
  - kind: prompt
    name: "Deep Audit"
    prompt: "Audit {{args.target}}"
    gate: "Manual confirmation"
    subagent: "@security/fast"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: { target: "payments" },
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});

		assert.equal(result.nextState.stepIndex, 1);
		assert.equal(result.nextState.status, "running");
		assert.equal(result.effect.type, "subagent");
		if (result.effect.type === "subagent") {
			assert.equal(result.effect.stepLabel, "Step 1 of 1: Deep Audit");
			assert.equal(result.effect.gate, "Manual confirmation");
			assert.deepEqual(result.effect.config, {
				provider: "spawn",
				model: "fast",
				preset: "security",
			});
			assert.equal(result.effect.promptText, "Audit payments");
			assert(!result.effect.promptText.includes("<workflow-info>"));
			assert(!result.effect.promptText.includes("<step-instructions>"));
		}
	});

	it("evaluates a subagent step transition interpolating template variables into subagent config", () => {
		const doc = parseWorkflowDocument(`
name: "Templated Subagent Config Flow"
args:
  backend:
    type: string
  profile:
    type: string
  llm:
    type: string
steps:
  - name: "Dynamic Agent"
    prompt: "Scan"
    subagent: "@{{args.profile}}/{{args.llm}}"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {
				profile: "auditor",
				llm: "deepseek-coder",
			},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});

		assert.equal(result.effect.type, "subagent");
		if (result.effect.type === "subagent") {
			assert.deepEqual(result.effect.config, {
				provider: "spawn",
				preset: "auditor",
				model: "deepseek-coder",
			});
		}
	});

	it("evaluates a subagent step transition interpolating output variables into subagent config", () => {
		const doc = parseWorkflowDocument(`
name: "Output Templated Subagent Config Flow"
steps:
  - name: "Dynamic Agent"
    prompt: "Scan"
    subagent: "@{{outputs.profile}}/{{outputs.llm}}"
    output: scan_out
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
			outputs: {
				profile: "auditor",
				llm: "deepseek-coder",
			},
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});

		assert.equal(result.effect.type, "subagent");
		if (result.effect.type === "subagent") {
			assert.deepEqual(result.effect.config, {
				provider: "spawn",
				preset: "auditor",
				model: "deepseek-coder",
			});
		}
	});

	it("evaluates a subagent step transition interpolating thinking level in subagent config", () => {
		const doc = parseWorkflowDocument(`
name: "Thinking Templated Subagent Config Flow"
args:
  effort:
    type: string
steps:
  - name: "Dynamic Agent"
    prompt: "Scan"
    subagent: "@auditor/deepseek-reasoner:{{args.effort}}"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {
				effort: "high",
			},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});

		assert.equal(result.effect.type, "subagent");
		if (result.effect.type === "subagent") {
			assert.deepEqual(result.effect.config, {
				provider: "spawn",
				preset: "auditor",
				model: "deepseek-reasoner",
				thinking: "high",
			});
		}
	});

	it("evaluates a subagent step transition resolving dynamic shorthand argument with LLM route and thinking", () => {
		const doc = parseWorkflowDocument(`
name: "Effort Subagent Flow"
args:
  effort:
    type: string
steps:
  - name: "Review"
    prompt: "Review code"
    subagent: "{{args.effort}}"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {
				effort: "acp-codex-acp/gpt-6.1-sol:medium",
			},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});

		assert.equal(result.effect.type, "subagent");
		if (result.effect.type === "subagent") {
			assert.deepEqual(result.effect.config, {
				provider: "spawn",
				llmProvider: "acp-codex-acp",
				model: "gpt-6.1-sol",
				thinking: "medium",
			});
		}
	});

	it("evaluates a subagent step transition with declared outputs and compiles outputSchema", () => {
		const doc = parseWorkflowDocument(`
name: "Subagent Scan Flow"
steps:
  - name: "Scan Code"
    prompt: "Scan repo"
    subagent: true
    outputs:
      findings:
        type: string
        description: "Antipattern findings"
      report:
        type: file
        path: "scan.md"
        base: workspace
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};
		const resolvedOutputPaths = {
			report: "/workspace/scan.md",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
			resolvedOutputPaths,
		});

		assert.equal(result.effect.type, "subagent");
		if (result.effect.type === "subagent") {
			assert.ok(result.effect.outputSchema);
			assert.equal(result.effect.outputSchema.type, "object");
			assert.deepEqual(result.effect.outputSchema.required, [
				"findings",
				"report",
			]);
			assert.ok(result.effect.promptText.includes("<output-requirements>"));
			assert.ok(result.effect.promptText.includes("findings"));
			assert.ok(result.effect.promptText.includes("scan.md"));
		}
	});

	it("forwards output name into subagent step transition", () => {
		const doc = parseWorkflowDocument(`
name: "Triage Flow"
steps:
  - prompt: "Review work"
    subagent: true
    output: abc
  - prompt: "Triage results: {{outputs.abc}}"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});

		assert.equal(result.effect.type, "subagent");
		if (result.effect.type === "subagent") {
			assert.equal(result.effect.output, "abc");
		}
	});

	it("evaluates a gate prompt step transition and includes gate rules", () => {
		const doc = parseWorkflowDocument(`
steps:
  - prompt: "Review work"
    gate: "Approval from reviewer"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});
		assert.equal(result.effect.type, "prompt");
		if (result.effect.type === "prompt") {
			assert.equal(result.effect.gate, "Approval from reviewer");
			assert(result.effect.promptText.includes("Review work"));
			assert(!result.effect.promptText.includes("[GATE CRITERIA]"));
			assert(!result.effect.promptText.includes("Approval from reviewer"));
			assert(!result.effect.promptText.includes("/wf-resume"));
		}
	});

	it("includes resume notice when step was resumed from interruption", () => {
		const doc = parseWorkflowDocument(`
steps:
  - prompt: "Second task"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "aborted",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});
		assert.equal(result.effect.type, "prompt");
		if (result.effect.type === "prompt") {
			assert(result.effect.promptText.includes("<workflow-resume>"));
		}
	});

	it("evaluates a print step transition", () => {
		const doc = parseWorkflowDocument(`
steps:
  - kind: print
    name: "Banner"
    text: "Building {{args.target}}..."
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: { target: "production" },
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});
		assert.equal(result.effect.type, "print");
		if (result.effect.type === "print") {
			assert.equal(result.effect.text, "Building production...");
			assert.equal(result.effect.stepLabel, "Step 1 of 1: Banner");
			assert.equal(result.nextState.stepIndex, 1);
		}
	});

	it("returns complete action when stepIndex is at or past end", () => {
		const doc = parseWorkflowDocument(`
steps:
  - "Only step"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const state: WorkflowState = {
			stepIndex: 1,
			status: "running",
		};

		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});
		assert.equal(result.effect.type, "complete");
		assert.equal(result.nextState.status, "completed");
		if (result.effect.type === "complete") {
			assert.equal(result.effect.totalSteps, 1);
		}
	});

	it("applies gate pause purely", () => {
		const state: WorkflowState = {
			stepIndex: 1,
			status: "running",
		};

		const result = applyGatePause(state, "Approval needed", "Step 1 of 2");
		assert.equal(result.nextState.status, "paused");
		assert.equal(result.nextState.pauseReason, "gate");
		assert.equal(result.nextState.stepIndex, 1);
		assert.equal(result.effect.type, "gate_pause");
		if (result.effect.type === "gate_pause") {
			assert.equal(result.effect.gate, "Approval needed");
		}
	});

	it("applies step pause purely on interruption", () => {
		const state: WorkflowState = {
			stepIndex: 1,
			status: "running",
		};

		const result = applyStepPause(state, "Step 2 of 3: Build");
		assert.equal(result.nextState.status, "paused");
		assert.equal(result.nextState.pauseReason, "interrupted");
		assert.equal(result.nextState.stepIndex, 1);
		assert.equal(result.effect.type, "step_pause");
		if (result.effect.type === "step_pause") {
			assert.equal(result.effect.stepIndex, 1);
			assert.equal(result.effect.stepLabel, "Step 2 of 3: Build");
		}
	});

	it("applies abort purely", () => {
		const state: WorkflowState = {
			stepIndex: 1,
			status: "running",
		};

		const result = applyAbort(state, 3, false);
		assert.equal(result.nextState.status, "aborted");
		assert.equal(result.nextState.stepIndex, 1);
		assert.equal(result.effect.type, "abort");
		if (result.effect.type === "abort") {
			assert.equal(result.effect.stepIndex, 1);
			assert.equal(result.effect.totalSteps, 3);
			assert.equal(result.effect.isAfter, false);
		}
	});

	it("validates template variables across workflow and steps", () => {
		const doc = parseWorkflowDocument(`
name: "Deploy {{args.env}}"
steps:
  - prompt: "Deploy to {{args.env}}"
    gate: "Verify {{args.missing}}"
`);
		const missingErrors = validateWorkflow({ doc, args: { env: "prod" } });
		assert.ok(
			missingErrors.some((e) => e.message.includes("{{args.missing}}")),
		);

		const validErrors = validateWorkflow({
			doc,
			args: { env: "prod", missing: "ok" },
		});
		assert.equal(validErrors.length, 0);
	});

	it("defaults resolvedOutputPaths when omitted for subagent outputs", () => {
		const doc: WorkflowDocument = {
			args: {},
			steps: [
				{
					kind: "subagent",
					name: "Sub",
					prompt: "Do",
					config: { provider: "spawn" },
					outputs: { findings: { type: "string" } },
				},
			],
		};
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};
		const result = computeStepTransition({
			doc,
			invocation,
			state,
		});
		assert.equal(result.effect.type, "subagent");
	});

	it("skips step when step if condition evaluates to false", () => {
		const doc = parseWorkflowDocument(`
args:
  mode:
    type: choice
    choices: ["smell", "review"]
    default: "review"
steps:
  - name: "Smell Scan"
    if: '{{args.mode}} == "smell"'
    prompt: "Scan smells"
  - name: "Review Code"
    if: '{{args.mode}} != "smell"'
    prompt: "Review code"
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: { mode: "review" },
		};
		const state: WorkflowState = {
			stepIndex: 0,
			status: "running",
		};

		// Step 0 has condition 'review == smell' (false) -> should skip
		const result0 = computeStepTransition({
			doc,
			invocation,
			state,
		});
		assert.equal(result0.effect.type, "skip");
		if (result0.effect.type === "skip") {
			assert.equal(result0.effect.stepIndex, 0);
			assert.equal(result0.effect.stepLabel, "Step 1 of 2: Smell Scan");
		}
		assert.equal(result0.nextState.stepIndex, 1);

		// Step 1 has condition 'review != smell' (true) -> should execute
		const result1 = computeStepTransition({
			doc,
			invocation,
			state: result0.nextState,
		});
		assert.equal(result1.effect.type, "prompt");
		assert.equal(result1.nextState.stepIndex, 2);
	});

	it("skips solo gate step when gate resolves to inactive/undefined", () => {
		const doc = parseWorkflowDocument(`
args:
  wait:
    type: bool
    default: false
steps:
  - name: "Literal Inactive Gate"
    gate: false
  - name: "Templated Inactive Gate"
    gate: "{{args.wait}}"
  - name: "Templated Active Gate"
    gate: "{{args.active_wait}}"
  - name: "Explicit Prompt Inactive Gate"
    prompt: "Prompt work"
    gate: false
`);
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: { wait: "false", active_wait: "true" },
		};

		// Step 0: solo gate with gate: false -> skips
		const res0 = computeStepTransition({
			doc,
			invocation,
			state: { stepIndex: 0, status: "running" },
		});
		assert.equal(res0.effect.type, "skip");
		if (res0.effect.type === "skip") {
			assert.equal(res0.effect.stepIndex, 0);
			assert.equal(res0.effect.stepLabel, "Step 1 of 4: Literal Inactive Gate");
		}
		assert.equal(res0.nextState.stepIndex, 1);

		// Step 1: solo gate with gate: "{{args.wait}}" (false) -> skips
		const res1 = computeStepTransition({
			doc,
			invocation,
			state: { stepIndex: 1, status: "running" },
		});
		assert.equal(res1.effect.type, "skip");
		if (res1.effect.type === "skip") {
			assert.equal(res1.effect.stepIndex, 1);
			assert.equal(
				res1.effect.stepLabel,
				"Step 2 of 4: Templated Inactive Gate",
			);
		}
		assert.equal(res1.nextState.stepIndex, 2);

		// Step 2: solo gate with gate: "{{args.active_wait}}" (true) -> does NOT skip
		const res2 = computeStepTransition({
			doc,
			invocation,
			state: { stepIndex: 2, status: "running" },
		});
		assert.equal(res2.effect.type, "prompt");
		if (res2.effect.type === "prompt") {
			assert.equal(res2.effect.gate, "Templated Active Gate");
		}
		assert.equal(res2.nextState.stepIndex, 3);

		// Step 3: explicit prompt step with gate: false -> dispatches prompt without gate, not skipped
		const res3 = computeStepTransition({
			doc,
			invocation,
			state: { stepIndex: 3, status: "running" },
		});
		assert.equal(res3.effect.type, "prompt");
		if (res3.effect.type === "prompt") {
			assert.equal(res3.effect.gate, undefined);
			assert.ok(res3.effect.promptText.includes("Prompt work"));
		}
		assert.equal(res3.nextState.stepIndex, 4);
	});

	it("returns complete effect when stepIndex is past steps length", () => {
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const completeRes = computeStepTransition({
			doc: { args: {}, steps: [{ kind: "prompt", name: "S1", prompt: "P1" }] },
			invocation,
			state: { stepIndex: 1, status: "running" },
		});
		assert.equal(completeRes.effect.type, "complete");
		assert.equal(completeRes.nextState.status, "completed");
	});

	it("throws for unhandled step kind", () => {
		const invocation: WorkflowInvocation = {
			targetPath: "flow.yaml",
			runId: "test-run",
			resolvedArgs: {},
		};
		const invalidDoc = {
			name: "Invalid",
			args: {},
			steps: [{ kind: "unknown-step-kind" as unknown, name: "Invalid Step" }],
		} as unknown as WorkflowDocument;
		assert.throws(
			() =>
				computeStepTransition({
					doc: invalidDoc,
					invocation,
					state: { stepIndex: 0, status: "running" },
				}),
			/Unhandled workflow step/,
		);
	});

	it("resolves dynamic and shorthand subagent config transitions", () => {
		const shorthandDoc = parseWorkflowDocument(`
steps:
  - prompt: "Review"
    subagent: "@reviewer/acp-codex-acp/gpt-6.1-sol:high"
  - prompt: "Review Dynamic"
    subagent: "{{args.effort}}"
  - prompt: "Review Dynamic Thinking"
    subagent: "{{args.thinking_effort}}"
  - prompt: "Review Dynamic Preset"
    subagent: "{{args.preset_effort}}"
`);
		const shorthandTransition = computeStepTransition({
			doc: shorthandDoc,
			invocation: {
				targetPath: "shorthand.yaml",
				runId: "test-run",
				resolvedArgs: {
					effort: "acp-codex-acp/gpt-6.1-sol:high",
					thinking_effort: ":high",
				},
			},
			state: { stepIndex: 0, status: "running" },
		});
		assert.equal(shorthandTransition.effect.type, "subagent");
		if (shorthandTransition.effect.type === "subagent") {
			assert.equal(
				shorthandTransition.effect.config.llmProvider,
				"acp-codex-acp",
			);
			assert.equal(shorthandTransition.effect.config.model, "gpt-6.1-sol");
			assert.equal(shorthandTransition.effect.config.thinking, "high");
			assert.equal(shorthandTransition.effect.config.preset, "reviewer");
		}

		const dynamicShorthandTransition = computeStepTransition({
			doc: shorthandDoc,
			invocation: {
				targetPath: "shorthand.yaml",
				runId: "test-run",
				resolvedArgs: {
					effort: "acp-codex-acp/gpt-6.1-sol:high",
					thinking_effort: ":high",
				},
			},
			state: { stepIndex: 1, status: "running" },
		});
		assert.equal(dynamicShorthandTransition.effect.type, "subagent");
		if (dynamicShorthandTransition.effect.type === "subagent") {
			assert.equal(
				dynamicShorthandTransition.effect.config.llmProvider,
				"acp-codex-acp",
			);
			assert.equal(
				dynamicShorthandTransition.effect.config.model,
				"gpt-6.1-sol",
			);
			assert.equal(dynamicShorthandTransition.effect.config.thinking, "high");
		}

		const dynamicThinkingTransition = computeStepTransition({
			doc: shorthandDoc,
			invocation: {
				targetPath: "shorthand.yaml",
				runId: "test-run",
				resolvedArgs: {
					effort: "acp-codex-acp/gpt-6.1-sol:high",
					thinking_effort: ":high",
				},
			},
			state: { stepIndex: 2, status: "running" },
		});
		assert.equal(dynamicThinkingTransition.effect.type, "subagent");
		if (dynamicThinkingTransition.effect.type === "subagent") {
			assert.equal(dynamicThinkingTransition.effect.config.provider, "spawn");
			assert.equal(
				dynamicThinkingTransition.effect.config.llmProvider,
				undefined,
			);
			assert.equal(dynamicThinkingTransition.effect.config.preset, undefined);
			assert.equal(dynamicThinkingTransition.effect.config.model, undefined);
			assert.equal(dynamicThinkingTransition.effect.config.thinking, "high");
		}

		const dynamicPresetTransition = computeStepTransition({
			doc: shorthandDoc,
			invocation: {
				targetPath: "shorthand.yaml",
				runId: "test-run",
				resolvedArgs: {
					effort: "acp-codex-acp/gpt-6.1-sol:high",
					thinking_effort: ":high",
					preset_effort: "@custom-preset/fast",
				},
			},
			state: { stepIndex: 3, status: "running" },
		});
		assert.equal(dynamicPresetTransition.effect.type, "subagent");
		if (dynamicPresetTransition.effect.type === "subagent") {
			assert.equal(
				dynamicPresetTransition.effect.config.preset,
				"custom-preset",
			);
			assert.equal(dynamicPresetTransition.effect.config.model, "fast");
		}
	});

	describe("foldWorkflowState", () => {
		const doc = parseWorkflowDocument(`
name: "Fold Flow"
steps:
  - prompt: "Step 1"
    gate: "Approve deployment"
  - prompt: "Step 2"
`);

		const cmdInit = (data: {
			workflow: unknown;
			invocation: unknown;
			runId?: string;
			sessionId?: string;
		}) => ({
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "init",
					sessionId: "test-sess",
					runId: (data.invocation as { runId?: string })?.runId ?? "test-run",
					...data,
				}),
			},
		});

		const cmdState = (data: {
			stepIndex?: number;
			status: string;
			runId?: string;
			sessionId?: string;
		}) => ({
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "state",
					sessionId: "test-sess",
					runId: "test-run",
					...data,
				}),
			},
		});

		const cmdStep = (data: {
			id: string;
			stepIndex: number;
			label: string;
			kind: "success" | "error";
			runId?: string;
			sessionId?: string;
		}) => ({
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "step",
					sessionId: "test-sess",
					runId: "test-run",
					...data,
				}),
			},
		});

		it("accumulates state across decoupled lightweight events without losing initial args or targetPath", () => {
			const invocation: WorkflowInvocation = {
				targetPath: "deep/flow.yaml",
				runId: "test-run",
				resolvedArgs: { env: "prod", cluster: "us-east" },
			};
			const events = [
				cmdInit({ workflow: doc, invocation }),
				cmdStep({ id: "s1", stepIndex: 0, label: "Step 1", kind: "success" }),
				// Lightweight transient event: only contains stepIndex, status
				cmdState({ stepIndex: 1, status: "paused" }),
			];

			const result = foldWorkflowState(events);
			assert.ok(result);
			if (result) {
				assert.equal(result.invocation.targetPath, "deep/flow.yaml");
				assert.deepEqual(result.invocation.resolvedArgs, {
					env: "prod",
					cluster: "us-east",
				});
				assert.equal(result.state.stepIndex, 1);
				assert.equal(result.state.status, "paused");
				// Gate is derived from doc.steps[stepIndex - 1]?.gate
				const step = result.workflow.steps[result.state.stepIndex - 1];
				const activeGate = step?.kind === "prompt" ? step.gate : undefined;
				assert.equal(activeGate, "Approve deployment");
				assert.equal(result.workflow.name, "Fold Flow");
			}
		});

		it("safely skips malformed events with missing or non-object data", () => {
			const invocation: WorkflowInvocation = {
				targetPath: "flow.yaml",
				runId: "test-run",
				resolvedArgs: {},
			};
			const events = [
				{ type: "command/run" },
				{ type: "command/run", data: null },
				{ type: "command/run", data: "malformed" },
				{ type: "command/run", data: { name: "other", args: "{}" } },
				{
					type: "command/run",
					data: { name: WORKFLOW_EVENT_NAME, args: "not-json" },
				},
				cmdInit({ workflow: doc, invocation }),
			];

			const result = foldWorkflowState(events);
			assert.ok(result);
			if (result) {
				assert.equal(result.invocation.targetPath, "flow.yaml");
				assert.equal(result.state.status, "running");
			}
		});

		it("returns null for empty events or unrelated events", () => {
			assert.equal(foldWorkflowState([]), null);
			assert.equal(
				foldWorkflowState([
					{ type: "turn/start", data: {} },
					{ type: "user/message", data: {} },
					{ type: "command/run", data: { name: "other", args: "deploy.yaml" } },
				]),
				null,
			);
		});

		it("safely ignores malformed JSON or CLI invocation in command args without error", () => {
			const result = foldWorkflowState([
				{ type: "command/run", data: { name: "wf", args: " review" } },
				{
					type: "command/run",
					data: { name: WORKFLOW_EVENT_NAME, args: "not-json" },
				},
			]);
			assert.equal(result, null);
		});

		it("returns active state for a paused workflow with gate derived from document", () => {
			const invocation: WorkflowInvocation = {
				targetPath: "flow.yaml",
				runId: "test-run",
				resolvedArgs: {},
			};
			const events = [
				cmdInit({ workflow: doc, invocation }),
				cmdStep({ id: "s1", stepIndex: 0, label: "Step 1", kind: "success" }),
				cmdState({ stepIndex: 1, status: "paused" }),
			];

			const result = foldWorkflowState(events);
			assert.ok(result);
			if (result) {
				assert.equal(result.state.status, "paused");
				assert.equal(result.state.stepIndex, 1);
				const step = result.workflow.steps[result.state.stepIndex - 1];
				const activeGate = step?.kind === "prompt" ? step.gate : undefined;
				assert.equal(activeGate, "Approve deployment");
				assert.equal(result.workflow.name, "Fold Flow");
			}
		});

		it("returns completed status when latest status is completed", () => {
			const invocation: WorkflowInvocation = {
				targetPath: "flow.yaml",
				runId: "test-run",
				resolvedArgs: {},
			};
			const events = [
				cmdInit({ workflow: doc, invocation }),
				cmdState({ status: "completed" }),
			];

			const result = foldWorkflowState(events);
			assert.ok(result);
			if (result) {
				assert.equal(result.state.status, "completed");
			}
		});

		it("returns active state for an aborted workflow", () => {
			const invocation: WorkflowInvocation = {
				targetPath: "flow.yaml",
				runId: "test-run",
				resolvedArgs: {},
			};
			const events = [
				cmdInit({ workflow: doc, invocation }),
				cmdState({ stepIndex: 1, status: "aborted" }),
			];

			const result = foldWorkflowState(events);
			assert.ok(result);
			if (result) {
				assert.equal(result.state.status, "aborted");
				assert.equal(result.state.stepIndex, 1);
				assert.equal(result.workflow.name, "Fold Flow");
			}
		});

		it("correctly identifies latest workflow across multiple sequential runs", () => {
			const doc2 = parseWorkflowDocument(`
name: "Second Flow"
steps:
  - prompt: "Step 1 in second"
    gate: "Second gate"
`);
			const events = [
				// First workflow run and completion
				cmdInit({
					workflow: doc,
					invocation: {
						targetPath: "flow1.yaml",
						resolvedArgs: {},
						runId: "run-1",
					},
				}),
				cmdState({ status: "completed", runId: "run-1" }),
				// Second workflow run paused
				cmdInit({
					workflow: doc2,
					invocation: {
						targetPath: "flow2.yaml",
						resolvedArgs: {},
						runId: "run-2",
					},
				}),
				cmdState({ stepIndex: 1, status: "paused", runId: "run-2" }),
			];

			const result = foldWorkflowState(events);
			assert.ok(result);
			if (result) {
				assert.equal(result.workflow.name, "Second Flow");
				assert.equal(result.invocation.targetPath, "flow2.yaml");
				const step = result.workflow.steps[result.state.stepIndex - 1];
				const activeGate = step?.kind === "prompt" ? step.gate : undefined;
				assert.equal(activeGate, "Second gate");
			}
		});

		it("replaces an abandoned workflow when a new workflow starts in the same session", () => {
			const doc2 = parseWorkflowDocument(`
name: "Second Flow"
steps:
  - prompt: "Step 1 in second"
    gate: "Active gate"
`);
			const events = [
				// First workflow run started and paused (never completed)
				cmdInit({
					workflow: doc,
					invocation: {
						targetPath: "flow1.yaml",
						runId: "run-1",
						resolvedArgs: { env: "dev" },
					},
				}),
				cmdState({ stepIndex: 1, status: "paused", runId: "run-1" }),
				// Second workflow starts in the same session
				cmdInit({
					workflow: doc2,
					invocation: {
						targetPath: "flow2.yaml",
						runId: "run-2",
						resolvedArgs: { env: "prod" },
					},
				}),
				cmdState({ stepIndex: 1, status: "paused", runId: "run-2" }),
			];

			const result = foldWorkflowState(events);
			assert.ok(result);
			if (result) {
				assert.equal(result.workflow.name, "Second Flow");
				assert.equal(result.invocation.targetPath, "flow2.yaml");
				assert.deepEqual(result.invocation.resolvedArgs, { env: "prod" });
				const step = result.workflow.steps[result.state.stepIndex - 1];
				const activeGate = step?.kind === "prompt" ? step.gate : undefined;
				assert.equal(activeGate, "Active gate");
			}
		});

		it("correctly marks completed when a second workflow completes after the first", () => {
			const doc2 = parseWorkflowDocument(`
name: "Second Flow"
steps:
  - prompt: "Step 1 in second"
`);
			const events = [
				// First workflow run and completion
				cmdInit({
					workflow: doc,
					invocation: {
						targetPath: "flow1.yaml",
						resolvedArgs: {},
						runId: "run-1",
					},
				}),
				cmdState({ status: "completed", runId: "run-1" }),
				// Second workflow run and completion
				cmdInit({
					workflow: doc2,
					invocation: {
						targetPath: "flow2.yaml",
						resolvedArgs: {},
						runId: "run-2",
					},
				}),
				cmdState({ status: "completed", runId: "run-2" }),
			];

			const result = foldWorkflowState(events);
			assert.ok(result);
			if (result) {
				assert.equal(result.state.status, "completed");
			}
		});

		it("evaluates step transitions with boolean and templated gate conditions", () => {
			const gatedDoc = parseWorkflowDocument(`
args:
  wait:
    type: bool
    default: false
steps:
  - name: "Plan step"
    prompt: "Make a plan"
    gate: "{{args.wait}}"
  - name: "Subagent step"
    prompt: "Run scan"
    subagent: true
    output: scan_out
    gate: "{{args.wait}}"
  - name: "Literal true"
    prompt: "Literal prompt"
    gate: true
  - name: "Literal false"
    prompt: "Literal false prompt"
    gate: false
`);

			// 1. Prompt step with wait=true -> gate pauses with step name
			const transPromptTrue = computeStepTransition({
				doc: gatedDoc,
				invocation: {
					targetPath: "test.yaml",
					resolvedArgs: { wait: "true" },
					runId: "run-1",
				},
				state: { stepIndex: 0, status: "running" },
			});
			assert.equal(transPromptTrue.effect.type, "prompt");
			if (transPromptTrue.effect.type === "prompt") {
				assert.equal(transPromptTrue.effect.gate, "Plan step");
			}

			// 2. Prompt step with wait=false -> gate is inactive (undefined)
			const transPromptFalse = computeStepTransition({
				doc: gatedDoc,
				invocation: {
					targetPath: "test.yaml",
					resolvedArgs: { wait: "false" },
					runId: "run-1",
				},
				state: { stepIndex: 0, status: "running" },
			});
			assert.equal(transPromptFalse.effect.type, "prompt");
			if (transPromptFalse.effect.type === "prompt") {
				assert.equal(transPromptFalse.effect.gate, undefined);
			}

			// 3. Subagent step with wait=true -> gate pauses with step name
			const transSubTrue = computeStepTransition({
				doc: gatedDoc,
				invocation: {
					targetPath: "test.yaml",
					resolvedArgs: { wait: "true" },
					runId: "run-1",
				},
				state: { stepIndex: 1, status: "running" },
			});
			assert.equal(transSubTrue.effect.type, "subagent");
			if (transSubTrue.effect.type === "subagent") {
				assert.equal(transSubTrue.effect.gate, "Subagent step");
			}

			// 4. Subagent step with wait=false -> gate is inactive (undefined)
			const transSubFalse = computeStepTransition({
				doc: gatedDoc,
				invocation: {
					targetPath: "test.yaml",
					resolvedArgs: { wait: "false" },
					runId: "run-1",
				},
				state: { stepIndex: 1, status: "running" },
			});
			assert.equal(transSubFalse.effect.type, "subagent");
			if (transSubFalse.effect.type === "subagent") {
				assert.equal(transSubFalse.effect.gate, undefined);
			}

			// 5. Literal true gate -> step name
			const transLitTrue = computeStepTransition({
				doc: gatedDoc,
				invocation: {
					targetPath: "test.yaml",
					resolvedArgs: { wait: "false" },
					runId: "run-1",
				},
				state: { stepIndex: 2, status: "running" },
			});
			assert.equal(transLitTrue.effect.type, "prompt");
			if (transLitTrue.effect.type === "prompt") {
				assert.equal(transLitTrue.effect.gate, "Literal true");
			}

			// 6. Literal false gate -> undefined
			const transLitFalse = computeStepTransition({
				doc: gatedDoc,
				invocation: {
					targetPath: "test.yaml",
					resolvedArgs: { wait: "true" },
					runId: "run-1",
				},
				state: { stepIndex: 3, status: "running" },
			});
			assert.equal(transLitFalse.effect.type, "prompt");
			if (transLitFalse.effect.type === "prompt") {
				assert.equal(transLitFalse.effect.gate, undefined);
			}
		});
	});

	describe("foldWorkflowEvent", () => {
		it("initializes idle state and serializes to null", () => {
			const initial = initialWorkflowRunSummary();
			assert.equal(initial.status, "idle");
			assert.equal(toWorkflowRunSummaryRecord(initial), null);
		});

		it("ignores non command/run events", () => {
			const initial = initialWorkflowRunSummary();
			assert.equal(
				foldWorkflowEvent(
					initial,
					// type-safe: testing unrecognized event type handling
					{ type: "other" } as unknown as SessionEvent,
				),
				initial,
			);
		});

		it("ignores unrelated commands or invalid args", () => {
			const initial = initialWorkflowRunSummary();
			assert.equal(
				foldWorkflowEvent(initial, {
					type: "command/run",
					data: { name: "other-cmd", args: "{}" },
				} as unknown as SessionEvent),
				initial,
			);
			assert.equal(
				foldWorkflowEvent(initial, {
					type: "command/run",
					data: { name: WORKFLOW_EVENT_NAME, args: 123 },
				} as unknown as SessionEvent),
				initial,
			);
			assert.equal(
				foldWorkflowEvent(initial, {
					type: "command/run",
					data: { name: WORKFLOW_EVENT_NAME, args: "bad-json" },
				} as unknown as SessionEvent),
				initial,
			);
			assert.equal(
				foldWorkflowEvent(initial, {
					type: "command/run",
					data: {
						name: WORKFLOW_EVENT_NAME,
						args: JSON.stringify({ action: "init" }),
					},
				} as unknown as SessionEvent),
				initial,
			);
			assert.equal(
				foldWorkflowEvent(initial, {
					type: "command/run",
					data: {
						name: WORKFLOW_EVENT_NAME,
						args: JSON.stringify({
							action: "init",
							runId: "r-1",
							workflow: { steps: [] },
							invocation: { runId: "r-mismatched" },
						}),
					},
				} as unknown as SessionEvent),
				initial,
			);
		});

		it("handles init and matching state transitions", () => {
			const initial = initialWorkflowRunSummary();
			const running = foldWorkflowEvent(initial, {
				type: "command/run",
				data: {
					name: WORKFLOW_EVENT_NAME,
					args: JSON.stringify({
						action: "init",
						runId: "r-1",
						workflow: { steps: [] },
						invocation: { runId: "r-1" },
					}),
				},
			} as unknown as SessionEvent);
			assert.deepEqual(running, {
				status: "running",
				runId: "r-1",
				stepIndex: 0,
				skillInvoked: false,
			});
			assert.deepEqual(toWorkflowRunSummaryRecord(running), running);

			// Mismatched runId is ignored
			const mismatched = foldWorkflowEvent(running, {
				type: "command/run",
				data: {
					name: WORKFLOW_EVENT_NAME,
					args: JSON.stringify({
						action: "state",
						runId: "r-other",
						status: "completed",
					}),
				},
			} as unknown as SessionEvent);
			assert.equal(mismatched, running);

			// Matching runId updates state
			const completed = foldWorkflowEvent(running, {
				type: "command/run",
				data: {
					name: WORKFLOW_EVENT_NAME,
					args: JSON.stringify({
						action: "state",
						runId: "r-1",
						status: "completed",
						stepIndex: 2,
					}),
				},
			} as unknown as SessionEvent);
			assert.deepEqual(completed, {
				status: "completed",
				runId: "r-1",
				stepIndex: 2,
				skillInvoked: false,
			});
		});

		it("handles skill tool call and wf slash commands", () => {
			const initial = initialWorkflowRunSummary();

			// 1. Unrelated tool call: no change
			const unrelatedTool = foldWorkflowEvent(initial, {
				type: "tool/call",
				data: { name: "other", arguments: "{}" },
			} as unknown as SessionEvent);
			assert.equal(unrelatedTool, initial);

			// 2. Skill tool call with yaml-workflow: sets skillInvoked
			const skillInvoked = foldWorkflowEvent(initial, {
				type: "tool/call",
				data: {
					name: "skill",
					arguments: JSON.stringify({ name: "yaml-workflow" }),
				},
			} as unknown as SessionEvent);
			assert.deepEqual(skillInvoked, {
				status: "idle",
				skillInvoked: true,
			});
			assert.deepEqual(toWorkflowRunSummaryRecord(skillInvoked), skillInvoked);

			// 3. Skill tool call with other name: does not set skillInvoked
			const aliasInvoked = foldWorkflowEvent(initial, {
				type: "tool/call",
				data: {
					name: "skill",
					arguments: JSON.stringify({ name: "workflow" }),
				},
			} as unknown as SessionEvent);
			assert.equal(aliasInvoked, initial);

			// 4. Slash command /wf: sets skillInvoked
			const wfCmd = foldWorkflowEvent(initial, {
				type: "command/run",
				data: { name: "wf", args: "flow.yaml" },
			} as unknown as SessionEvent);
			assert.deepEqual(wfCmd, {
				status: "idle",
				skillInvoked: true,
			});

			// 4b. Idempotency: repeated skill tool call or slash command returns same reference
			assert.equal(
				foldWorkflowEvent(skillInvoked, {
					type: "tool/call",
					data: {
						name: "skill",
						arguments: JSON.stringify({ name: "yaml-workflow" }),
					},
				} as unknown as SessionEvent),
				skillInvoked,
			);
			assert.equal(
				foldWorkflowEvent(wfCmd, {
					type: "command/run",
					data: { name: "wf", args: "flow.yaml" },
				} as unknown as SessionEvent),
				wfCmd,
			);

			// 5. Unrelated command: no change
			const otherCmd = foldWorkflowEvent(initial, {
				type: "command/run",
				data: { name: "other-cmd", args: "" },
			} as unknown as SessionEvent);
			assert.equal(otherCmd, initial);
		});
	});
});
