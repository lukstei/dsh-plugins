/**
 * PURPOSE: Pure session event folding to reconstruct workflow run state.
 * ALLOWED: Pure state derivation from events.
 * FORBIDDEN: No I/O, no filesystem, no external runtime dependencies.
 */

import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { WORKFLOW_SKILL_NAME } from "./skill.ts";
import type {
	WorkflowInitPayloadData,
	WorkflowPayload,
	WorkflowRun,
	WorkflowRunSummary,
	WorkflowState,
} from "./types.ts";

export const WORKFLOW_EVENT_NAME = "wf-event" as const;

function isValidInitPayload(
	payload: WorkflowPayload,
): payload is { readonly action: "init" } & WorkflowInitPayloadData {
	return (
		payload.action === "init" &&
		Boolean(
			payload.workflow &&
				payload.invocation &&
				payload.invocation.runId === payload.runId,
		)
	);
}

/**
 * Purpose: Pure fold over session command/run events to derive the latest workflow run.
 * Contract:
 * - Inputs: events array in chronological log order, optional targetRunId string.
 * - Outputs: latest WorkflowRun if a workflow was initiated, or null.
 * - Throws: None.
 */
export function foldWorkflowState(
	events: readonly { readonly type: string; readonly data?: unknown }[],
	targetRunId?: string,
): WorkflowRun | null {
	let current: WorkflowRun | null = null;

	for (const { type, data } of events) {
		if (type !== "command/run") continue;
		if (!data || typeof data !== "object") continue;

		const cmd = data as {
			readonly name?: string;
			readonly args?: string;
		};
		if (cmd.name !== WORKFLOW_EVENT_NAME || typeof cmd.args !== "string")
			continue;

		try {
			const payload = JSON.parse(cmd.args) as WorkflowPayload;
			if (!payload.runId) {
				continue;
			}
			if (targetRunId && payload.runId !== targetRunId) {
				continue;
			}
			if (isValidInitPayload(payload)) {
				current = {
					workflow: payload.workflow,
					invocation: payload.invocation,
					state: { stepIndex: 0, status: "running" },
				};
			} else if (
				payload.action === "state" &&
				current &&
				payload.runId === current.invocation.runId
			) {
				const {
					action: _,
					sessionId: _sessionId,
					runId: _runId,
					...delta
				} = payload;
				const nextState: WorkflowState = {
					...current.state,
					...delta,
				};
				if (delta.status !== undefined && delta.status !== "aborted") {
					delete nextState.error;
				}
				current = {
					workflow: current.workflow,
					invocation: current.invocation,
					state: nextState,
				};
			} else if (
				payload.action === "output" &&
				current &&
				payload.runId === current.invocation.runId
			) {
				// type-safe: outputType === "list" guarantees payload.value was recorded as JSON array of strings
				const outputValue: string | readonly string[] =
					payload.outputType === "list"
						? (JSON.parse(payload.value) as readonly string[])
						: payload.value;
				const nextOutputs: Record<string, string | readonly string[]> = {
					...(current.state.outputs ?? {}),
					[payload.name]: outputValue,
				};
				const nextState: WorkflowState = {
					...current.state,
					outputs: nextOutputs,
				};
				current = {
					workflow: current.workflow,
					invocation: current.invocation,
					state: nextState,
				};
			}
		} catch {
			// ignore corrupted or non-payload args
		}
	}

	return current;
}

export function initialWorkflowRunSummary(): WorkflowRunSummary {
	return {
		status: "idle",
		skillInvoked: false,
	};
}

export function foldWorkflowEvent(
	state: WorkflowRunSummary,
	event: SessionEvent,
): WorkflowRunSummary {
	if (event.type === "tool/call") {
		if (state.skillInvoked) return state;
		if (event.data.name === "skill") {
			try {
				const parsed = JSON.parse(event.data.arguments);
				if (parsed.name === WORKFLOW_SKILL_NAME) {
					return { ...state, skillInvoked: true };
				}
			} catch {
				// ignore malformed arguments
			}
		}
		return state;
	}

	if (event.type !== "command/run") return state;

	if (event.data.name !== WORKFLOW_EVENT_NAME) {
		if (
			event.data.name === "wf" ||
			event.data.name === "wf-validate" ||
			event.data.name === "wf-resume" ||
			event.data.name === "wf-abort" ||
			event.data.name === "wf-list"
		) {
			if (state.skillInvoked) return state;
			return { ...state, skillInvoked: true };
		}
		return state;
	}
	if (typeof event.data.args !== "string") {
		return state;
	}

	try {
		const payload = JSON.parse(event.data.args) as WorkflowPayload;
		if (!payload.runId) return state;

		if (isValidInitPayload(payload)) {
			return {
				status: "running",
				runId: payload.runId,
				stepIndex: 0,
				skillInvoked: state.skillInvoked,
			};
		}

		if (payload.action === "state" && state.runId === payload.runId) {
			return {
				...state,
				status: payload.status ?? state.status,
				stepIndex: payload.stepIndex ?? state.stepIndex,
			};
		}
	} catch {
		// ignore corrupted or non-payload args
	}

	return state;
}

export function toWorkflowRunSummaryRecord(
	summary: WorkflowRunSummary,
): WorkflowRunSummary | null {
	return summary.status !== "idle" || summary.skillInvoked ? summary : null;
}
