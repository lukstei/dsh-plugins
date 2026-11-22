/**
 * PURPOSE: Interactive workflow card view for wf-state chat nodes in conversation feed.
 * ALLOWED: React rendering, clipboard actions, status badge derivations.
 * FORBIDDEN: Direct agent manipulation, inline filesystem operations.
 */

import type { ChatNodeViewProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type React from "react";
import { useState } from "react";
import { resolveGate } from "../boolean.ts";
import type { WorkflowInvocation, WorkflowRun } from "../types.ts";
import { CheckIcon, CopyIcon } from "./icons.tsx";
import { WorkflowStyles } from "./WorkflowStyles.tsx";

export type WorkflowCommandCardProps = Pick<
	ChatNodeViewProps<"wf-state">,
	"node"
>;

export interface PausedGateDetails {
	readonly gate?: string;
	readonly nextStepLabel: string;
	readonly isInterrupted?: boolean;
	readonly targetName?: string;
}

/**
 * Derives paused gate criteria and next step preview from a workflow run.
 * CONTRACT:
 * - Inputs: WorkflowRun object.
 * - Outputs: PausedGateDetails with gate and nextStepLabel, or undefined if not paused.
 */
export function getPausedGateDetails(
	run: WorkflowRun,
): PausedGateDetails | undefined {
	if (run.state.status !== "paused") {
		return undefined;
	}
	const isInterrupted = run.state.pauseReason === "interrupted";
	const currentStep = run.workflow.steps[run.state.stepIndex];
	const rawGate =
		!isInterrupted &&
		(currentStep?.kind === "prompt" || currentStep?.kind === "subagent")
			? currentStep.gate
			: undefined;

	const gate = resolveGate(
		rawGate,
		run.invocation.resolvedArgs,
		run.state.outputs,
		currentStep?.name,
	);

	const targetIndex = isInterrupted
		? run.state.stepIndex
		: run.state.stepIndex + 1;
	const targetStep =
		targetIndex < run.workflow.steps.length
			? run.workflow.steps[targetIndex]
			: undefined;
	const targetName = targetStep?.name;
	const nextStepLabel = targetStep
		? `Step ${targetIndex + 1} of ${run.workflow.steps.length}: ${targetName}`
		: "Workflow complete on resume";

	return { gate, nextStepLabel, isInterrupted, targetName };
}

/**
 * Purpose: Recover the copyable command from recorded invocation input.
 * Contract:
 * - Inputs: A workflow invocation, including historical records without rawInput.
 * - Outputs: Original /wf command, or undefined when its input was not recorded.
 * - Throws: None.
 * @internal Exported for direct regression testing.
 */
export function resolveWorkflowCommand(
	invocation: WorkflowInvocation,
): string | undefined {
	// edge case: resolved arguments cannot reconstruct historical mapped choices.
	if (invocation.rawInput === undefined) return undefined;
	return `/wf ${invocation.rawInput.trim()}`;
}

/**
 * Purpose: Workflow status card component mounted in conversation.chat.node slot.
 * Contract:
 * - Inputs: WorkflowCommandCardProps containing 'wf-state' chat node.
 * - Outputs: React JSX element rendering status badges, command string, and gate details.
 * - Throws: None.
 */
export function WorkflowCommandCard({
	node,
}: WorkflowCommandCardProps): React.JSX.Element {
	const run = node.data;
	const { invocation, state } = run;
	const status = state.status;
	const targetPath = invocation.targetPath;

	const isPaused = status === "paused";
	const isAborted = status === "aborted";
	const isRunning = status === "running";
	const isSuccess = status === "completed";
	const [copied, setCopied] = useState(false);

	const pausedDetails = isPaused ? getPausedGateDetails(run) : undefined;

	const formattedArgs = Object.entries(invocation.resolvedArgs)
		.map(([k, v]) => (v.includes(" ") ? `${k}="${v}"` : `${k}=${v}`))
		.join(" ");

	const rawCommand = resolveWorkflowCommand(invocation);

	const handleCopy = () => {
		if (rawCommand === undefined) return;
		navigator.clipboard
			.writeText(rawCommand)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			})
			.catch(() => {});
	};

	const cardState = isRunning
		? "running"
		: isPaused
			? "paused"
			: isAborted
				? "aborted"
				: isSuccess
					? "completed"
					: "idle";

	return (
		<>
			<WorkflowStyles />
			<div className="dsh-wf-card" data-state={cardState}>
				<div className="dsh-wf-header">
					<div className="dsh-wf-title-group">
						<span className="dsh-wf-command-badge">/wf</span>
						{targetPath && (
							<span className="dsh-wf-args" title={targetPath}>
								{targetPath}
							</span>
						)}
						<button
							type="button"
							className="dsh-wf-copy-btn"
							data-copied={copied}
							onClick={handleCopy}
							disabled={rawCommand === undefined}
							title={
								rawCommand === undefined
									? "Original command was not recorded"
									: copied
										? "Copied"
										: "Copy command"
							}
							aria-label={copied ? "Copied" : "Copy command"}
						>
							{copied ? <CheckIcon /> : <CopyIcon />}
						</button>
					</div>

					<div className="dsh-wf-status">
						{isRunning && (
							<span className="dsh-wf-badge-running">
								<span className="dsh-wf-pulse-dot" />
								Running...
							</span>
						)}
						{isPaused && <span className="dsh-wf-badge-paused">❚❚ Paused</span>}
						{isAborted && (
							<span className="dsh-wf-badge-aborted">
								{state.error ? "✕ Failed" : "✕ Aborted"}
							</span>
						)}
						{isSuccess && <span className="dsh-wf-badge-success">✓ Done</span>}
					</div>
				</div>

				{formattedArgs && (
					<div className="dsh-wf-body" data-input="true">
						{formattedArgs}
					</div>
				)}

				{pausedDetails && (
					<div className="dsh-wf-body" data-paused="true">
						{pausedDetails.gate && (
							<div className="dsh-wf-gate-line">
								Paused at gate: {pausedDetails.gate}
							</div>
						)}
						<div className="dsh-wf-next-line">
							{pausedDetails.isInterrupted ? "Resume: " : "Next: "}
							{pausedDetails.nextStepLabel}
						</div>
						<div className="dsh-wf-hint-line">
							Press Resume to proceed, or enter feedback in the prompt input to
							pass instructions.
						</div>
					</div>
				)}

				{isAborted && (
					<div className="dsh-wf-body" data-error="true">
						{state.error
							? `Workflow failed at step ${state.stepIndex + 1} of ${run.workflow.steps.length}: ${state.error}`
							: `Workflow discarded at step ${state.stepIndex + 1} of ${run.workflow.steps.length}`}
					</div>
				)}
			</div>
		</>
	);
}
