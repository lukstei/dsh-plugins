/**
 * PURPOSE: React composer toolbar button for resuming paused or interrupted workflows.
 * ALLOWED: React rendering, event callbacks, context consumption.
 * FORBIDDEN: Direct DOM manipulation, inline store state.
 */

import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type React from "react";
import type { WorkflowRun } from "../types.ts";
import {
	resolveResumeCommand,
	sendDiscardCommand,
	sendResumeCommand,
} from "./actions.ts";
import { useWorkflowClientContext } from "./context.ts";
import { DiscardIcon, ResumePlayIcon } from "./icons.tsx";
import { useWorkflowState } from "./store.ts";
import { getPausedGateDetails } from "./WorkflowCommandCard.tsx";
import { WorkflowStyles } from "./WorkflowStyles.tsx";

export type WorkflowResumeButtonProps = Pick<
	PropsRuntime<"conversation.input.right">,
	"sessionId" | "useInput" | "inputActions"
>;

export interface ResumeButtonDetails {
	readonly label: string;
	readonly tooltip: string;
}

/**
 * Derives contextual button label and tooltip for the resume button.
 * CONTRACT:
 * - Inputs: WorkflowRun (or undefined), and optional draft string.
 * - Outputs: ResumeButtonDetails with label and tooltip, or undefined if not resumable.
 */
export function getResumeButtonDetails(
	run: WorkflowRun | undefined,
	draft = "",
): ResumeButtonDetails | undefined {
	if (!run) {
		return undefined;
	}
	const details = getPausedGateDetails(run);
	if (!details) {
		return undefined;
	}

	const { gate, isInterrupted, targetName } = details;
	const hasDraft = draft.trim().length > 0;

	const label = targetName
		? hasDraft
			? `Resume with feedback: ${targetName}`
			: `Resume: ${targetName}`
		: hasDraft
			? "Resume with feedback (Complete)"
			: "Resume (Complete)";

	const tooltip = isInterrupted
		? `Resume workflow at current step: ${targetName ?? "Step"}${hasDraft ? ". Feedback will be sent as user instructions." : ""}`
		: `Resume workflow${gate ? ` (Gate: ${gate})` : ""} → Next: ${targetName ?? "Complete"}${hasDraft ? ". Feedback will be sent as user instructions." : ""}`;

	return { label, tooltip };
}

/**
 * Purpose: Resume and discard controls in the session composer toolbar.
 * Contract:
 * - Inputs: Canonical session input props.
 * - Outputs: Toolbar controls while the workflow is paused, otherwise null.
 * - Errors: Reports dispatch failures without consuming unadmitted drafts.
 */
export function WorkflowResumeButton({
	sessionId,
	useInput,
	inputActions,
}: WorkflowResumeButtonProps): React.JSX.Element | null {
	const ctx = useWorkflowClientContext();
	const draft = useInput((state) => state.draft);
	const run = useWorkflowState(sessionId);

	const details = getResumeButtonDetails(run, draft);
	if (!details) {
		return null;
	}

	const handleResume = async () => {
		try {
			const commandToSend = resolveResumeCommand(draft);
			const binding = ctx.sessions.binding(sessionId);
			if (!binding) throw new Error(`Session "${sessionId}" is not active`);
			const draftRev = inputActions.captureInsertion().draftRev;
			const clearDraft = () => {
				if (inputActions.captureInsertion().draftRev === draftRev) {
					inputActions.setDraft("");
				}
			};
			const unsubscribe = binding.eventSource.subscribe(() => {
				const { change } = binding.eventSource.getSnapshot();
				if (change.kind !== "append") return;
				const admitted = change.entries.some(
					({ event }) =>
						event.type === "command/run" &&
						event.data.name === "wf-resume" &&
						event.data.args === commandToSend.slice("/wf-resume".length),
				);
				if (!admitted) return;
				unsubscribe();
				clearDraft();
			});
			try {
				await sendResumeCommand(ctx, sessionId, commandToSend);
				clearDraft();
			} finally {
				unsubscribe();
			}
		} catch (err: unknown) {
			console.error("Failed to resume workflow:", err);
		}
	};

	const handleDiscard = async () => {
		try {
			await sendDiscardCommand(ctx, sessionId);
		} catch (err: unknown) {
			console.error("Failed to discard workflow:", err);
		}
	};

	return (
		<>
			<WorkflowStyles />
			<div className="dsh-wf-toolbar-group">
				<button
					type="button"
					className="dsh-wf-resume-btn"
					onClick={handleResume}
					title={details.tooltip}
					aria-label={details.tooltip}
				>
					<ResumePlayIcon />
					<span className="dsh-wf-resume-btn-label">{details.label}</span>
				</button>
				<button
					type="button"
					className="dsh-wf-discard-btn"
					onClick={handleDiscard}
					title="Discard workflow"
					aria-label="Discard workflow"
				>
					<DiscardIcon />
					<span className="dsh-wf-discard-btn-label">Discard</span>
				</button>
			</div>
		</>
	);
}
