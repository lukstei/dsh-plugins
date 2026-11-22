/**
 * PURPOSE: Reactive client-side store and synchronization for session workflow states.
 * ALLOWED: Reactive state, useSyncExternalStore, Cordis uiConversation event registration.
 * FORBIDDEN: Direct DOM manipulation, UI rendering.
 */

import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SessionEventLike } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { useSyncExternalStore } from "react";
import { foldWorkflowState, WORKFLOW_EVENT_NAME } from "../fold.ts";
import type { WorkflowPayload, WorkflowRun } from "../types.ts";
import type { WorkflowPrintChatData } from "./WorkflowPrintStep.tsx";
import type { WorkflowStepChatData } from "./WorkflowStepRow.tsx";

const workflowRuns = new Map<string, WorkflowRun>();
const activeSessionRuns = new Map<SessionId, string>();
const activeSessionSeq = new Map<SessionId, number>();
const listeners = new Set<() => void>();

/**
 * Purpose: Retrieves the cached workflow run for a given run ID.
 * Contract:
 * - Inputs: runId string.
 * - Outputs: WorkflowRun if present in store, or undefined.
 * - Throws: None.
 */
export function getWorkflowRunState(runId: string): WorkflowRun | undefined {
	return workflowRuns.get(runId);
}

/**
 * Purpose: Retrieves the cached active workflow run for a given session.
 * Contract:
 * - Inputs: non-null sessionId of type SessionId.
 * - Outputs: WorkflowRun if present in store, or undefined.
 * - Throws: None.
 */
export function getWorkflowState(
	sessionId: SessionId,
): WorkflowRun | undefined {
	const activeRunId = activeSessionRuns.get(sessionId);
	if (activeRunId) {
		return workflowRuns.get(activeRunId);
	}
	return undefined;
}

/**
 * Purpose: Updates or sets workflow run for a session and runId, notifying subscribers.
 * Contract:
 * - Inputs: non-null sessionId of type SessionId, WorkflowRun object, runId string, optional seq.
 * - Outputs: void.
 * - Throws: None.
 */
export function setWorkflowState(
	sessionId: SessionId,
	run: WorkflowRun,
	runId: string,
	seq?: number,
): void {
	workflowRuns.set(runId, run);

	const lastSeq = activeSessionSeq.get(sessionId);
	if (seq === undefined || lastSeq === undefined || seq >= lastSeq) {
		activeSessionRuns.set(sessionId, runId);
		if (seq !== undefined) {
			activeSessionSeq.set(sessionId, seq);
		}
	}

	for (const listener of listeners) {
		listener();
	}
}

/**
 * Purpose: Updates or sets cached workflow run without modifying active session run, notifying subscribers.
 * Contract:
 * - Inputs: runId string, WorkflowRun object.
 * - Outputs: void.
 * - Throws: None.
 */
export function setWorkflowRunState(runId: string, run: WorkflowRun): void {
	workflowRuns.set(runId, run);
	for (const listener of listeners) {
		listener();
	}
}

/**
 * Purpose: Clears workflow run for a session and notifies subscribers.
 * Contract:
 * - Inputs: non-null sessionId of type SessionId.
 * - Outputs: void.
 * - Throws: None.
 */
export function clearWorkflowState(sessionId: SessionId): void {
	const activeRunId = activeSessionRuns.get(sessionId);
	if (activeRunId) {
		workflowRuns.delete(activeRunId);
		activeSessionRuns.delete(sessionId);
	}
	activeSessionSeq.delete(sessionId);
	for (const listener of listeners) {
		listener();
	}
}

/**
 * Purpose: Subscribes a listener callback to workflow store modifications.
 * Contract:
 * - Inputs: listener callback function.
 * - Outputs: Cleanup unregister function.
 * - Throws: None.
 */
export function subscribeWorkflowState(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Purpose: React hook subscribing to reactive workflow run for a specific run ID.
 * Contract:
 * - Inputs: runId string.
 * - Outputs: WorkflowRun or undefined.
 * - Throws: None.
 */
export function useWorkflowRunState(runId: string): WorkflowRun | undefined {
	return useSyncExternalStore(
		subscribeWorkflowState,
		() => getWorkflowRunState(runId),
		() => getWorkflowRunState(runId),
	);
}

/**
 * Purpose: React hook subscribing to reactive workflow run for a given session.
 * Contract:
 * - Inputs: non-null sessionId of type SessionId.
 * - Outputs: WorkflowRun or undefined.
 * - Throws: None.
 */
export function useWorkflowState(
	sessionId: SessionId,
): WorkflowRun | undefined {
	return useSyncExternalStore(
		subscribeWorkflowState,
		() => getWorkflowState(sessionId),
		() => getWorkflowState(sessionId),
	);
}

export const workflowStateDefinition: ConversationNodeDefinition<WorkflowRun> =
	{
		kind: "wf-state",
		target: "chat",
		match(event) {
			if (event.type === "command/run") {
				const data = event.data as
					| { readonly name?: string; readonly args?: string }
					| undefined;
				if (
					data?.name === WORKFLOW_EVENT_NAME &&
					typeof data.args === "string"
				) {
					try {
						const payload = JSON.parse(data.args) as WorkflowPayload;
						if (
							payload.action === "init" &&
							typeof payload.runId === "string"
						) {
							return { id: payload.runId, role: "start" };
						}
						if (
							(payload.action === "state" || payload.action === "output") &&
							typeof payload.runId === "string"
						) {
							return { id: payload.runId, role: "update" };
						}
					} catch {
						return null;
					}
				}
			}
			return null;
		},
		start(context, match) {
			const run = foldWorkflowState([match.event], context.id);
			if (!run) {
				// type-safe: match guarantees event is a valid init event folding into WorkflowRun
				throw new Error(
					`Failed to fold workflow state for event ${match.event.seq}`,
				);
			}
			const data = match.event.data as { readonly args: string };
			const payload = JSON.parse(data.args) as WorkflowPayload;
			setWorkflowState(payload.sessionId, run, context.id, match.event.seq);
			return run;
		},
		update(context, match) {
			const events = context.matches.map((m) => m.event);
			const run = foldWorkflowState(events, context.id);
			if (run) {
				const data = match.event.data as { readonly args: string };
				const payload = JSON.parse(data.args) as WorkflowPayload;
				setWorkflowState(payload.sessionId, run, context.id, match.event.seq);
				return run;
			}
			return context.state;
		},
		buildViewNode(context) {
			if (!context.state) return null;
			const startMatch = context.start;
			return {
				key: context.key,
				kind: "wf-state",
				id: context.id,
				target: "chat",
				anchorSeq: startMatch ? startMatch.event.seq : 0,
				location: startMatch ? startMatch.location : { kind: "unresolved" },
				visibility: "visible",
				groupTree: "process",
				data: context.state,
			};
		},
	};

export const workflowStepDefinition: ConversationNodeDefinition<WorkflowStepChatData> =
	{
		kind: "wf-step",
		target: "chat",
		match(event) {
			if (event.type === "command/run") {
				const data = event.data as
					| { readonly name?: string; readonly args?: string }
					| undefined;
				if (
					data?.name === WORKFLOW_EVENT_NAME &&
					typeof data.args === "string"
				) {
					try {
						const payload = JSON.parse(data.args) as WorkflowPayload;
						if (
							payload.action === "step" &&
							typeof payload.runId === "string"
						) {
							return { id: payload.id, role: "start" };
						}
					} catch {
						return null;
					}
				}
			}
			return null;
		},
		start(_context, match) {
			const data = match.event.data as {
				readonly args: string;
			};
			const payload = JSON.parse(data.args) as Extract<
				WorkflowPayload,
				{ action: "step" }
			>;
			return {
				stepIndex: payload.stepIndex,
				label: payload.label,
				kind: payload.kind,
				sessionId: payload.sessionId,
				runId: payload.runId,
			};
		},
		update(context, match) {
			const data = match.event.data as {
				readonly args?: string;
			};
			if (data?.args && typeof data.args === "string") {
				try {
					const payload = JSON.parse(data.args) as Extract<
						WorkflowPayload,
						{ action: "step" }
					>;
					return {
						stepIndex: payload.stepIndex,
						label: payload.label,
						kind: payload.kind,
						sessionId: payload.sessionId,
						runId: payload.runId,
					};
				} catch {
					// retain state on parse failure
				}
			}
			return context.state;
		},
		buildViewNode(context) {
			if (context.state === undefined) return null;
			const startMatch = context.start;
			return {
				key: context.key,
				kind: "wf-step",
				id: context.id,
				target: "chat",
				anchorSeq: startMatch ? startMatch.event.seq : 0,
				location: startMatch ? startMatch.location : { kind: "unresolved" },
				visibility: "visible",
				groupTree: "process",
				data: context.state,
			};
		},
	};

export const workflowPrintDefinition: ConversationNodeDefinition<WorkflowPrintChatData> =
	{
		kind: "wf-print",
		target: "chat",
		match(event) {
			if (event.type === "command/run") {
				const data = event.data as
					| { readonly name?: string; readonly args?: string }
					| undefined;
				if (
					data?.name === WORKFLOW_EVENT_NAME &&
					typeof data.args === "string"
				) {
					try {
						const payload = JSON.parse(data.args) as WorkflowPayload;
						if (
							payload.action === "print" &&
							typeof payload.runId === "string"
						) {
							return { id: payload.id, role: "start" };
						}
					} catch {
						return null;
					}
				}
			}
			return null;
		},
		start(_context, match) {
			const data = match.event.data as { readonly args: string };
			const payload = JSON.parse(data.args) as Extract<
				WorkflowPayload,
				{ action: "print" }
			>;
			return {
				id: payload.id,
				text: payload.text,
				runId: payload.runId,
				sessionId: payload.sessionId,
			};
		},
		update(context) {
			return context.state;
		},
		buildViewNode(context) {
			if (context.state === undefined) return null;
			const startMatch = context.start;
			return {
				key: context.key,
				kind: "wf-print",
				id: context.id,
				target: "chat",
				anchorSeq: startMatch ? startMatch.event.seq : 0,
				location: startMatch ? startMatch.location : { kind: "unresolved" },
				visibility: "visible",
				groupTree: "process",
				data: context.state,
			};
		},
	};

export interface WorkflowErrorState {
	readonly commandId: string;
	readonly name: string;
	readonly args?: string | null;
	readonly outcome?: { readonly kind: string; readonly text?: string } | null;
}

const trackedWfCommandIds = new Set<string>();

export const workflowErrorDefinition: ConversationNodeDefinition<WorkflowErrorState> =
	{
		kind: "wf-error",
		target: "chat",
		match(event) {
			if (event.type === "command/run") {
				const data = event.data as
					| {
							readonly name?: string;
							readonly commandId?: string;
							readonly args?: string;
					  }
					| undefined;
				if (
					(data?.name === "wf" ||
						data?.name === "wf-resume" ||
						data?.name === "wf-abort") &&
					data.commandId
				) {
					const id = String(data.commandId);
					trackedWfCommandIds.add(id);
					return { id, role: "start" };
				}
			}
			if (event.type === "command/done") {
				const data = event.data as { readonly commandId?: string } | undefined;
				if (
					data?.commandId &&
					trackedWfCommandIds.has(String(data.commandId))
				) {
					const id = String(data.commandId);
					trackedWfCommandIds.delete(id);
					return { id, role: "update" };
				}
			}
			return null;
		},
		start(_context, match) {
			const data = match.event.data as {
				readonly commandId: string;
				readonly name: string;
				readonly args?: string;
			};
			return {
				commandId: String(data.commandId),
				name: data.name,
				args: data.args,
				outcome: null,
			};
		},
		update(context, match) {
			const data = match.event.data as {
				readonly kind: string;
				readonly text?: string;
			};
			return {
				...context.state,
				outcome: {
					kind: data.kind,
					text: data.text,
				},
			};
		},
		buildViewNode(context) {
			if (context.state?.outcome?.kind !== "error") return null;
			const startMatch = context.start;
			return {
				key: context.key,
				kind: "wf-error",
				id: context.id,
				target: "chat",
				anchorSeq: startMatch ? startMatch.event.seq : 0,
				location: startMatch ? startMatch.location : { kind: "unresolved" },
				visibility: "visible",
				groupTree: "process",
				data: {
					name: context.state.name,
					args: context.state.args,
					text: context.state.outcome.text ?? "Command failed",
				},
			};
		},
	};

function workflowRequestEvent(event: SessionEventLike):
	| {
			readonly kind: "request";
			readonly runId: string;
			readonly rawInput: string;
			readonly sessionId: SessionId;
	  }
	| { readonly kind: "settled"; readonly runId: string }
	| undefined {
	if (event.type === "command/done" && event.data.kind === "error") {
		return { kind: "settled", runId: event.data.commandId };
	}
	if (
		event.type !== "command/run" ||
		event.data.name !== WORKFLOW_EVENT_NAME ||
		event.data.args === undefined
	)
		return undefined;
	let payload: unknown;
	try {
		payload = JSON.parse(event.data.args);
	} catch {
		return undefined;
	}
	if (
		typeof payload !== "object" ||
		payload === null ||
		!("action" in payload) ||
		!("runId" in payload) ||
		typeof payload.runId !== "string"
	)
		return undefined;
	if (payload.action === "init" || payload.action === "request-failed") {
		return { kind: "settled", runId: payload.runId };
	}
	if (
		payload.action !== "request" ||
		!("rawInput" in payload) ||
		typeof payload.rawInput !== "string" ||
		!("sessionId" in payload) ||
		typeof payload.sessionId !== "string"
	)
		return undefined;
	return {
		kind: "request",
		runId: payload.runId,
		rawInput: payload.rawInput,
		sessionId: SessionId(payload.sessionId),
	};
}

const workflowRequestDefinition: ConversationNodeDefinition<{
	readonly output: WorkflowPrintChatData;
	readonly status: "queued" | "settled";
}> = {
	kind: "wf-request",
	target: "chat",
	match(event) {
		const request = workflowRequestEvent(event);
		if (request === undefined) return null;
		return {
			id: request.runId,
			role: request.kind === "request" ? "start" : "update",
		};
	},
	start(_context, { event }) {
		const request = workflowRequestEvent(event);
		if (request === undefined || request.kind !== "request")
			throw new Error("wf-request requires a request event to start");
		return {
			status: "queued",
			output: {
				text: `Workflow queued:\n\n    /wf ${request.rawInput.trim().replaceAll("\n", "\n    ")}`,
				runId: request.runId,
				sessionId: request.sessionId,
			},
		};
	},
	update(context, match) {
		return match.role === "start"
			? context.state
			: { ...context.state, status: "settled" };
	},
	buildViewNode(context) {
		if (context.state === undefined) return null;
		const first = context.matches[0];
		return {
			key: context.key,
			kind: "wf-print",
			id: context.id,
			target: "chat",
			anchorSeq: first.event.seq,
			location: first.location,
			visibility: context.state.status === "queued" ? "visible" : "hidden",
			groupTree: "process",
			data: context.state.output,
		} satisfies ChatNode<"wf-print">;
	},
};

const workflowListDefinition: ConversationNodeDefinition<
	ChatNode<"wf-list">["data"]
> = {
	kind: "wf-list",
	target: "chat",
	match(event) {
		if (event.type === "command/run" && event.data.name === "wf-list") {
			return { id: event.data.commandId, role: "start" };
		}
		// edge case: command/done has no name; the assembler pairs it with a matching start by commandId.
		if (event.type === "command/done") {
			return { id: event.data.commandId, role: "update" };
		}
		return null;
	},
	start(_context, { event }) {
		if (event.type !== "command/run") {
			throw new Error("wf-list requires command/run to start");
		}
		return {
			name: event.data.name,
			args: event.data.args === undefined ? null : event.data.args,
			outcome: null,
		};
	},
	update(context, { event }) {
		if (event.type !== "command/done") return context.state;
		return {
			...context.state,
			outcome: { kind: event.data.kind, text: event.data.text },
		};
	},
	buildViewNode(context) {
		// edge case: Paged history can load settlement before command/run; no result exists until its start loads.
		if (context.state === undefined) return null;
		const first = context.matches[0];
		return {
			key: context.key,
			kind: "wf-list",
			id: context.id,
			target: "chat",
			anchorSeq: first.event.seq,
			location: first.location,
			visibility: "visible",
			groupTree: "process",
			data: context.state,
		} satisfies ChatNode<"wf-list">;
	},
};

/**
 * Purpose: Registers workflow request, state, step, print, error, and list conversation nodes on Cordis uiConversation service.
 * Contract:
 * - Inputs: ClientContext with uiConversation service.
 * - Outputs: Cleanup unregister function.
 * - Throws: None.
 */
export function registerWorkflowChatNodes(ctx: ClientContext): () => void {
	const unregisterRequest = ctx.uiConversation.events.register(
		workflowRequestDefinition,
	);
	const unregisterState = ctx.uiConversation.events.register(
		workflowStateDefinition,
	);
	const unregisterStep = ctx.uiConversation.events.register(
		workflowStepDefinition,
	);
	const unregisterPrint = ctx.uiConversation.events.register(
		workflowPrintDefinition,
	);
	const unregisterError = ctx.uiConversation.events.register(
		workflowErrorDefinition,
	);
	const unregisterList = ctx.uiConversation.events.register(
		workflowListDefinition,
	);
	return () => {
		unregisterRequest();
		unregisterState();
		unregisterStep();
		unregisterPrint();
		unregisterError();
		unregisterList();
	};
}
