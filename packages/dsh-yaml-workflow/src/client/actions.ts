/**
 * PURPOSE: Pure command formatting and asynchronous Cordis conversation actions.
 * ALLOWED: Command string manipulation, conversation dispatching, store optimism.
 * FORBIDDEN: UI rendering, React state.
 */

import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { WorkflowStatus } from "../types.ts";
import type { WorkflowClientContext } from "./context.ts";
import {
	getWorkflowState,
	setWorkflowRunState,
	setWorkflowState,
} from "./store.ts";

/**
 * Resolves a draft string into an executable /wf-resume command invocation.
 * CONTRACT:
 * - Input: optional draft string.
 * - Output: formatted command string (defaults to '/wf-resume', or '/wf-resume <draft>').
 */
export function resolveResumeCommand(draft?: string): string {
	const trimmedDraft = (draft || "").trim();
	if (trimmedDraft.length === 0) {
		return "/wf-resume";
	}
	if (/^\/wf-resume(\s+.*)?$/.test(trimmedDraft)) {
		return trimmedDraft;
	}
	return `/wf-resume ${trimmedDraft}`;
}

/**
 * Internal helper to dispatch a workflow slash command with optimistic store update and rollback.
 */
async function dispatchWorkflowCommand(
	ctx: WorkflowClientContext,
	sessionId: SessionId,
	command: string,
	optimisticStatus: WorkflowStatus,
): Promise<void> {
	const current = getWorkflowState(sessionId);
	if (current) {
		setWorkflowState(
			sessionId,
			{
				...current,
				state: {
					...current.state,
					status: optimisticStatus,
				},
			},
			current.invocation.runId,
		);
	}

	try {
		const binding = ctx.sessions.binding(sessionId);
		if (!binding) {
			throw new Error(`Session "${sessionId}" is not active`);
		}

		const result = await binding.session.command(command);
		if (!result.ok) {
			throw new Error(
				`Command "${command}" failed: ${result.error.code}: ${result.error.message}`,
			);
		}
		if (!result.value.matched) {
			throw new Error(`The host offers no ${command} command`);
		}
	} catch (err: unknown) {
		if (current) {
			const active = getWorkflowState(sessionId);
			if (active && active.invocation.runId === current.invocation.runId) {
				setWorkflowState(sessionId, current, current.invocation.runId);
			} else {
				setWorkflowRunState(current.invocation.runId, current);
			}
		}
		throw err;
	}
}

/**
 * Purpose: Dispatches a resume slash command to the host and sets optimistic running state.
 * Contract:
 * - Inputs: Cordis WorkflowClientContext, sessionId, and optional command string.
 * - Outputs: Promise resolving when command is admitted and executed by host.
 * - Throws: Error when session is not active or command execution fails.
 */
export async function sendResumeCommand(
	ctx: WorkflowClientContext,
	sessionId: SessionId,
	command = "/wf-resume",
): Promise<void> {
	await dispatchWorkflowCommand(ctx, sessionId, command, "running");
}

/**
 * Purpose: Dispatches an abort slash command to the host and sets optimistic aborted state.
 * Contract:
 * - Inputs: Cordis WorkflowClientContext, sessionId, and optional command string.
 * - Outputs: Promise resolving when command is admitted and executed by host.
 * - Throws: Error when session is not active or command execution fails.
 */
export async function sendDiscardCommand(
	ctx: WorkflowClientContext,
	sessionId: SessionId,
	command = "/wf-abort",
): Promise<void> {
	await dispatchWorkflowCommand(ctx, sessionId, command, "aborted");
}
