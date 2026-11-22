/**
 * PURPOSE: Unit tests for WorkflowResumeButton and WorkflowCommandCard paused detail helpers.
 * ALLOWED: In-memory tests, assertion checks.
 */

import assert from "node:assert/strict";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { describe, it } from "vitest";
import { preprocessWorkflow } from "../parser.ts";
import type { WorkflowRun } from "../types.ts";
import { sendDiscardCommand } from "./actions.ts";
import type { WorkflowClientContext } from "./context.ts";
import { getWorkflowState, setWorkflowState } from "./store.ts";
import { getPausedGateDetails } from "./WorkflowCommandCard.tsx";
import { getResumeButtonDetails } from "./WorkflowResumeButton.tsx";

describe("WorkflowResumeButton & Paused Gate Details", () => {
	const multiStepRun: WorkflowRun = {
		workflow: {
			name: "Implementation Workflow",
			args: {},
			steps: [
				{
					kind: "prompt",
					name: "Plan",
					prompt: "Create plan",
					gate: "Review and approve plan",
				},
				{
					kind: "prompt",
					name: "Implement",
					prompt: "Implement plan",
				},
				{
					kind: "subagent",
					name: "Review",
					prompt: "Review diff",
					config: { provider: "spawn" },
				},
				{
					kind: "prompt",
					name: "Fix",
					prompt: "Fix issues",
				},
				{
					kind: "prompt",
					name: "Summary",
					prompt: "Show summary",
					gate: "Review summary before completing",
				},
			],
		},
		invocation: {
			targetPath: "workflow.yaml",
			resolvedArgs: {},
			runId: "resume-run",
		},
		state: { stepIndex: 0, status: "paused" },
	};

	describe("getResumeButtonDetails", () => {
		it("returns undefined when run is missing or not in a resumable status", () => {
			assert.equal(getResumeButtonDetails(undefined), undefined);

			const runningRun: WorkflowRun = {
				...multiStepRun,
				state: { stepIndex: 0, status: "running" },
			};
			assert.equal(getResumeButtonDetails(runningRun), undefined);

			const completedRun: WorkflowRun = {
				...multiStepRun,
				state: { stepIndex: 5, status: "completed" },
			};
			assert.equal(getResumeButtonDetails(completedRun), undefined);
		});

		it("returns contextual step name when paused at a gate without draft", () => {
			const details = getResumeButtonDetails(multiStepRun, "");
			assert.ok(details);
			assert.equal(details.label, "Resume: Implement");
			assert.equal(
				details.tooltip,
				"Resume workflow (Gate: Review and approve plan) → Next: Implement",
			);
		});

		it("returns contextual feedback label when paused with draft input", () => {
			const details = getResumeButtonDetails(
				multiStepRun,
				"make sure tests pass",
			);
			assert.ok(details);
			assert.equal(details.label, "Resume with feedback: Implement");
			assert.equal(
				details.tooltip,
				"Resume workflow (Gate: Review and approve plan) → Next: Implement. Feedback will be sent as user instructions.",
			);
		});

		it("falls back to generic Step number when next step has no name", () => {
			const runWithoutStepName: WorkflowRun = {
				workflow: preprocessWorkflow({
					steps: [
						{ kind: "prompt", prompt: "first", gate: "Check gate" },
						{ kind: "prompt", prompt: "second" },
					],
				}),
				invocation: {
					targetPath: "workflow.yaml",
					resolvedArgs: {},
					runId: "resume-run",
				},
				state: { stepIndex: 0, status: "paused" },
			};
			const details = getResumeButtonDetails(runWithoutStepName);
			assert.ok(details);
			assert.equal(details.label, "Resume: Step 2");
			assert.equal(
				details.tooltip,
				"Resume workflow (Gate: Check gate) → Next: Step 2",
			);
		});

		it("indicates completion when paused at the final workflow step", () => {
			const finalStepPausedRun: WorkflowRun = {
				...multiStepRun,
				state: { stepIndex: 4, status: "paused" },
			};
			const detailsWithoutDraft = getResumeButtonDetails(finalStepPausedRun);
			assert.ok(detailsWithoutDraft);
			assert.equal(detailsWithoutDraft.label, "Resume (Complete)");
			assert.equal(
				detailsWithoutDraft.tooltip,
				"Resume workflow (Gate: Review summary before completing) → Next: Complete",
			);

			const detailsWithDraft = getResumeButtonDetails(
				finalStepPausedRun,
				"final remark",
			);
			assert.ok(detailsWithDraft);
			assert.equal(detailsWithDraft.label, "Resume with feedback (Complete)");
			assert.equal(
				detailsWithDraft.tooltip,
				"Resume workflow (Gate: Review summary before completing) → Next: Complete. Feedback will be sent as user instructions.",
			);
		});

		it("returns undefined for aborted status so toolbar stays clean", () => {
			const abortedRun: WorkflowRun = {
				...multiStepRun,
				state: { stepIndex: 2, status: "aborted" },
			};
			const details = getResumeButtonDetails(abortedRun);
			assert.equal(details, undefined);
		});

		it("targets current step when paused due to interruption", () => {
			const interruptedRun: WorkflowRun = {
				...multiStepRun,
				state: { stepIndex: 1, status: "paused", pauseReason: "interrupted" },
			};
			const details = getResumeButtonDetails(interruptedRun, "");
			assert.ok(details);
			assert.equal(details.label, "Resume: Implement");
			assert.equal(
				details.tooltip,
				"Resume workflow at current step: Implement",
			);

			const detailsWithDraft = getResumeButtonDetails(
				interruptedRun,
				"retry with verbose logging",
			);
			assert.ok(detailsWithDraft);
			assert.equal(detailsWithDraft.label, "Resume with feedback: Implement");
			assert.equal(
				detailsWithDraft.tooltip,
				"Resume workflow at current step: Implement. Feedback will be sent as user instructions.",
			);
		});
	});

	describe("getPausedGateDetails", () => {
		it("returns undefined when status is not paused", () => {
			const runningRun: WorkflowRun = {
				...multiStepRun,
				state: { stepIndex: 0, status: "running" },
			};
			assert.equal(getPausedGateDetails(runningRun), undefined);
		});

		it("derives gate criteria and next step preview when paused", () => {
			const details = getPausedGateDetails(multiStepRun);
			assert.ok(details);
			assert.equal(details.gate, "Review and approve plan");
			assert.equal(details.nextStepLabel, "Step 2 of 5: Implement");
		});

		it("derives next step preview when paused without a named step", () => {
			const unnamedRun: WorkflowRun = {
				workflow: preprocessWorkflow({
					steps: [
						{ kind: "prompt", prompt: "step 1", gate: "Waiting" },
						{ kind: "prompt", prompt: "step 2" },
					],
				}),
				invocation: {
					targetPath: "workflow.yaml",
					resolvedArgs: {},
					runId: "resume-run",
				},
				state: { stepIndex: 0, status: "paused" },
			};
			const details = getPausedGateDetails(unnamedRun);
			assert.ok(details);
			assert.equal(details.gate, "Waiting");
			assert.equal(details.nextStepLabel, "Step 2 of 2: Step 2");
		});

		it("indicates completion when paused at final step", () => {
			const finalStepRun: WorkflowRun = {
				...multiStepRun,
				state: { stepIndex: 4, status: "paused" },
			};
			const details = getPausedGateDetails(finalStepRun);
			assert.ok(details);
			assert.equal(details.gate, "Review summary before completing");
			assert.equal(details.nextStepLabel, "Workflow complete on resume");
		});

		it("targets current step when paused due to interruption", () => {
			const interruptedRun: WorkflowRun = {
				...multiStepRun,
				state: { stepIndex: 1, status: "paused", pauseReason: "interrupted" },
			};
			const details = getPausedGateDetails(interruptedRun);
			assert.ok(details);
			assert.equal(details.gate, undefined);
			assert.equal(details.nextStepLabel, "Step 2 of 5: Implement");
			assert.equal(details.isInterrupted, true);
		});

		it("resolves templated and boolean gate values against invocation args", () => {
			const templatedRun: WorkflowRun = {
				workflow: preprocessWorkflow({
					steps: [
						{
							name: "Plan step",
							prompt: "plan",
							gate: "{{args.wait}}",
						},
						{ prompt: "step 2" },
					],
				}),
				invocation: {
					targetPath: "workflow.yaml",
					resolvedArgs: { wait: "true" },
					runId: "resume-run",
				},
				state: { stepIndex: 0, status: "paused" },
			};
			const details = getPausedGateDetails(templatedRun);
			assert.ok(details);
			assert.equal(details.gate, "Plan step");

			const booleanRun: WorkflowRun = {
				workflow: preprocessWorkflow({
					steps: [
						{
							name: "Review step",
							prompt: "review",
							gate: true,
						},
					],
				}),
				invocation: {
					targetPath: "workflow.yaml",
					resolvedArgs: {},
					runId: "resume-run",
				},
				state: { stepIndex: 0, status: "paused" },
			};
			const boolDetails = getPausedGateDetails(booleanRun);
			assert.ok(boolDetails);
			assert.equal(boolDetails.gate, "Review step");
		});
	});

	describe("sendDiscardCommand", () => {
		it("dispatches /wf-abort and sets state to aborted optimistically", async () => {
			let executedCommand = "";
			const mockBinding = {
				session: {
					command: async (cmd: string) => {
						executedCommand = cmd;
						return { ok: true, value: { matched: true } };
					},
				},
			};
			const mockCtx = {
				sessions: {
					binding: () => mockBinding,
				},
			} as unknown as WorkflowClientContext;

			const testSessionId = "test-session-discard" as SessionId;
			setWorkflowState(testSessionId, multiStepRun, "resume-run");

			await sendDiscardCommand(mockCtx, testSessionId);
			assert.equal(executedCommand, "/wf-abort");
			assert.equal(getWorkflowState(testSessionId)?.state.status, "aborted");
		});

		it("rolls back state to paused when command dispatch fails", async () => {
			const mockBinding = {
				session: {
					command: async () => {
						return {
							ok: false,
							error: { code: "UNAVAILABLE", message: "Failed to dispatch" },
						};
					},
				},
			};
			const mockCtx = {
				sessions: {
					binding: () => mockBinding,
				},
			} as unknown as WorkflowClientContext;

			const testSessionId = "test-session-rollback" as SessionId;
			setWorkflowState(testSessionId, multiStepRun, "resume-run");

			await assert.rejects(
				() => sendDiscardCommand(mockCtx, testSessionId),
				/Command "\/wf-abort" failed/,
			);
			assert.equal(getWorkflowState(testSessionId)?.state.status, "paused");
		});
	});
});
