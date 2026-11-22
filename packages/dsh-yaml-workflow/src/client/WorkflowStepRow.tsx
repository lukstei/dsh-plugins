/**
 * PURPOSE: Progress row component for wf-step chat nodes in chat feed.
 * ALLOWED: React rendering.
 * FORBIDDEN: State, network, direct DOM manipulation.
 */

import type { ChatNodeViewProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type React from "react";
import type { WorkflowRun } from "../types.ts";
import { CheckIcon } from "./icons.tsx";
import { useWorkflowRunState } from "./store.ts";
import { WorkflowStyles } from "./WorkflowStyles.tsx";

export interface WorkflowStepChatData {
	readonly stepIndex: number;
	readonly label: string;
	readonly kind: "success" | "error";
	readonly sessionId: SessionId;
	readonly runId: string;
}

export type StepStatus = "running" | "done" | "paused" | "aborted" | "error";

export type WorkflowStepRowProps = Pick<ChatNodeViewProps<"wf-step">, "node">;

/**
 * Purpose: Derives step execution status from workflow run state and node data.
 * Contract:
 * - Inputs: stepData object containing stepIndex and kind, optional WorkflowRun.
 * - Outputs: StepStatus enum representing current execution lifecycle.
 * - Throws: None.
 */
export function deriveStepStatus(
	stepData: WorkflowStepChatData,
	run?: WorkflowRun,
): StepStatus {
	if (run) {
		const { status, stepIndex: activeStepIndex, error } = run.state;
		if (status === "completed" || stepData.stepIndex < activeStepIndex) {
			return "done";
		}
		if (status === "aborted") {
			return error ? "error" : "aborted";
		}
		if (status === "paused") {
			return "paused";
		}
		if (stepData.kind === "error") {
			return error ? "error" : "aborted";
		}
		return "running";
	}
	if (stepData.kind === "error") {
		return "error";
	}
	return "done";
}

/**
 * Step progress row mounted in conversation.chat.node slot.
 * CONTRACT:
 * - Input: ChatNodeViewProps with node containing WorkflowStepChatData.
 * - Output: formatted row with step status icon, label, and lifecycle badge.
 */
export function WorkflowStepRow({
	node,
}: WorkflowStepRowProps): React.JSX.Element {
	const run = useWorkflowRunState(node.data.runId);
	const status = deriveStepStatus(node.data, run);
	const errorMessage =
		status === "error" && run?.state.error ? run.state.error : undefined;

	return (
		<>
			<WorkflowStyles />
			<div className="dsh-wf-step-row" data-kind="step" data-status={status}>
				<span
					className="dsh-wf-step-icon"
					data-status={status}
					aria-hidden="true"
				>
					{status === "running" && <span className="dsh-wf-pulse-dot" />}
					{status === "done" && <CheckIcon />}
					{status === "paused" && "\u275a\u275a"}
					{status === "aborted" && "\u2715"}
					{status === "error" && "\u2715"}
				</span>
				<span className="dsh-wf-step-label">{node.data.label}</span>
				{status === "running" && (
					<span className="dsh-wf-badge-running">Running...</span>
				)}
				{status === "paused" && (
					<span className="dsh-wf-badge-paused">Paused</span>
				)}
				{status === "aborted" && (
					<span className="dsh-wf-badge-aborted">Discarded</span>
				)}
				{status === "error" && (
					<span className="dsh-wf-badge-aborted">✕ Failed</span>
				)}
			</div>
			{errorMessage && <div className="dsh-wf-step-error">{errorMessage}</div>}
		</>
	);
}
