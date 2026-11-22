/**
 * PURPOSE: Unit tests for client workflow store, state synchronization, and resume actions.
 * ALLOWED: In-memory tests, assertion checks.
 */

import assert from "node:assert/strict";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { describe, it } from "vitest";
import { WORKFLOW_EVENT_NAME, type WorkflowRun } from "../types.ts";
import { resolveResumeCommand, sendResumeCommand } from "./actions.ts";
import type { WorkflowClientContext } from "./context.ts";
import {
	clearWorkflowState,
	getWorkflowRunState,
	getWorkflowState,
	registerWorkflowChatNodes,
	setWorkflowState,
	subscribeWorkflowState,
	workflowErrorDefinition,
	workflowPrintDefinition,
	workflowStateDefinition,
	workflowStepDefinition,
} from "./store.ts";

describe("Client Workflow Store", () => {
	it("sets, gets, and clears workflow state", () => {
		const sessionId = "test-session-1" as SessionId;
		assert.equal(getWorkflowState(sessionId), undefined);

		let notified = 0;
		const unsubscribe = subscribeWorkflowState(() => {
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
				runId: "run-1",
			},
			state: { stepIndex: 0, status: "running" },
		};
		setWorkflowState(sessionId, run1, "run-1");
		assert.equal(notified, 1);
		assert.equal(getWorkflowState(sessionId)?.state.status, "running");
		assert.equal(getWorkflowRunState("run-1")?.state.status, "running");
		assert.equal(getWorkflowState(sessionId)?.state.stepIndex, 0);

		const run2: WorkflowRun = {
			workflow: {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "step 1",
						gate: "Approval",
					},
				],
			},
			invocation: {
				targetPath: "flow.yaml",
				resolvedArgs: {},
				runId: "run-2",
			},
			state: { stepIndex: 0, status: "paused" },
		};
		setWorkflowState(sessionId, run2, "run-2");
		assert.equal(notified, 2);
		assert.equal(getWorkflowState(sessionId)?.state.status, "paused");
		assert.equal(getWorkflowRunState("run-2")?.state.status, "paused");

		clearWorkflowState(sessionId);
		assert.equal(notified, 3);
		assert.equal(getWorkflowState(sessionId), undefined);
		assert.equal(getWorkflowRunState("run-2"), undefined);

		unsubscribe();
	});

	it("isolates workflow states between sessions without fallback leakage", () => {
		const sessionA = "session-a" as SessionId;
		const sessionB = "session-b" as SessionId;
		clearWorkflowState(sessionA);
		clearWorkflowState(sessionB);

		const runA: WorkflowRun = {
			workflow: {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "step 1",
						gate: "Waiting",
					},
				],
			},
			invocation: {
				targetPath: "flow.yaml",
				resolvedArgs: {},
				runId: "run-a",
			},
			state: { stepIndex: 0, status: "paused" },
		};
		setWorkflowState(sessionA, runA, "run-a");

		assert.equal(getWorkflowState(sessionA)?.state.status, "paused");
		assert.equal(getWorkflowState(sessionB), undefined);

		clearWorkflowState(sessionA);
	});
});

describe("Workflow Resume Actions", () => {
	it("resolves resume command with and without instructions", () => {
		assert.equal(resolveResumeCommand(), "/wf-resume");
		assert.equal(resolveResumeCommand(""), "/wf-resume");
		assert.equal(resolveResumeCommand("  "), "/wf-resume");
		assert.equal(
			resolveResumeCommand("approved by secops"),
			"/wf-resume approved by secops",
		);
	});

	it("dispatches resume slash command to host via ctx.sessions.binding", async () => {
		const executed: string[] = [];
		const sessionId = "test-session-resume" as SessionId;
		const mockSession = {
			async command(line: string) {
				executed.push(line);
				return { ok: true, value: { matched: true } };
			},
		};
		const mockCtx = {
			sessions: {
				binding(id: SessionId) {
					return id === sessionId ? { session: mockSession } : undefined;
				},
			},
		};

		const run: WorkflowRun = {
			workflow: {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "step 1",
						gate: "Waiting",
					},
				],
			},
			invocation: {
				targetPath: "flow.yaml",
				resolvedArgs: {},
				runId: "run-resume",
			},
			state: { stepIndex: 0, status: "paused" },
		};
		setWorkflowState(sessionId, run, "run-resume");

		await sendResumeCommand(
			mockCtx as unknown as WorkflowClientContext,
			sessionId,
			"/wf-resume proceed",
		);

		assert.deepEqual(executed, ["/wf-resume proceed"]);
		assert.equal(getWorkflowState(sessionId)?.state.status, "running");
	});

	it("throws if session binding is not active", async () => {
		const sessionId = "inactive-session" as SessionId;
		const mockCtx = {
			sessions: {
				binding() {
					return undefined;
				},
			},
		};

		await assert.rejects(
			async () => {
				await sendResumeCommand(
					mockCtx as unknown as WorkflowClientContext,
					sessionId,
				);
			},
			{ message: 'Session "inactive-session" is not active' },
		);
	});

	it("rolls back optimistic running state if sending resume command fails", async () => {
		const sessionId = "failing-session-resume" as SessionId;
		const mockSession = {
			async command() {
				return {
					ok: false,
					error: { code: "internal", message: "simulated dispatch failure" },
				};
			},
		};
		const mockCtx = {
			sessions: {
				binding(id: SessionId) {
					return id === sessionId ? { session: mockSession } : undefined;
				},
			},
		};

		const run: WorkflowRun = {
			workflow: {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "step 1",
						gate: "Waiting",
					},
				],
			},
			invocation: {
				targetPath: "flow.yaml",
				resolvedArgs: {},
				runId: "run-fail",
			},
			state: { stepIndex: 0, status: "paused" },
		};
		setWorkflowState(sessionId, run, "run-fail");

		await assert.rejects(
			async () => {
				await sendResumeCommand(
					mockCtx as unknown as WorkflowClientContext,
					sessionId,
					"/wf-resume",
				);
			},
			{
				message:
					'Command "/wf-resume" failed: internal: simulated dispatch failure',
			},
		);

		assert.equal(getWorkflowState(sessionId)?.state.status, "paused");
	});

	it("rolls back optimistic running state if command is not matched by host", async () => {
		const sessionId = "unmatched-session-resume" as SessionId;
		const mockSession = {
			async command() {
				return {
					ok: true,
					value: { matched: false },
				};
			},
		};
		const mockCtx = {
			sessions: {
				binding(id: SessionId) {
					return id === sessionId ? { session: mockSession } : undefined;
				},
			},
		};

		const run: WorkflowRun = {
			workflow: {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "step 1",
						gate: "Waiting",
					},
				],
			},
			invocation: {
				targetPath: "flow.yaml",
				resolvedArgs: {},
				runId: "run-unmatched",
			},
			state: { stepIndex: 0, status: "paused" },
		};
		setWorkflowState(sessionId, run, "run-unmatched");

		await assert.rejects(
			async () => {
				await sendResumeCommand(
					mockCtx as unknown as WorkflowClientContext,
					sessionId,
					"/wf-resume",
				);
			},
			{
				message: "The host offers no /wf-resume command",
			},
		);

		assert.equal(getWorkflowState(sessionId)?.state.status, "paused");
	});
});

describe("Workflow Chat Nodes Synchronization", () => {
	it("registers wf/state, wf/step, and wf/print event handlers", () => {
		const registeredDefs: unknown[] = [];
		const mockCtx = {
			uiConversation: {
				events: {
					register(def: unknown) {
						registeredDefs.push(def);
						return () => {};
					},
				},
			},
		};

		const cleanup = registerWorkflowChatNodes(
			mockCtx as unknown as ClientContext,
		);
		assert.equal(registeredDefs.length, 6);
		cleanup();
	});

	it("matches, starts, updates, and builds view nodes for wf/state", () => {
		const sessionId = "sync-test-session" as SessionId;
		const runId = "sync-test-run";
		clearWorkflowState(sessionId);

		const workflowDoc = {
			steps: [
				{
					kind: "prompt" as const,
					prompt: "step 1",
					gate: "Hold for input",
				},
			],
		};
		const invocation = {
			targetPath: "build.yaml",
			resolvedArgs: {},
			runId,
		};

		const initEvent = {
			type: "command/run",
			seq: 1,
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "init",
					sessionId,
					runId,
					workflow: workflowDoc,
					invocation,
				}),
			},
		};

		assert.deepEqual(workflowStateDefinition.match(initEvent as never), {
			id: runId,
			role: "start",
		});
		assert.equal(
			workflowStateDefinition.match({ type: "other" } as never),
			null,
		);
		assert.equal(
			workflowStateDefinition.match({
				type: "command/run",
				data: {
					name: WORKFLOW_EVENT_NAME,
					args: JSON.stringify({
						action: "init",
						workflow: workflowDoc,
						invocation,
					}),
				},
			} as never),
			null,
		);

		const startState = workflowStateDefinition.start(
			{ id: runId } as never,
			{ event: initEvent } as never,
			null as never,
		);
		assert.deepEqual(startState, {
			workflow: workflowDoc,
			invocation,
			state: { stepIndex: 0, status: "running" },
		});
		assert.equal(getWorkflowState(sessionId)?.state.status, "running");
		assert.equal(getWorkflowRunState(runId)?.state.status, "running");

		const updateEvent = {
			type: "command/run",
			seq: 2,
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "state",
					sessionId,
					runId,
					stepIndex: 1,
					status: "paused" as const,
				}),
			},
		};

		assert.deepEqual(workflowStateDefinition.match(updateEvent as never), {
			id: runId,
			role: "update",
		});

		const updatedState = workflowStateDefinition.update(
			{
				id: runId,
				state: startState,
				matches: [{ event: initEvent }, { event: updateEvent }],
			} as never,
			{ event: updateEvent } as never,
		);
		assert.equal(updatedState.state.status, "paused");
		assert.equal(updatedState.state.stepIndex, 1);
		assert.equal(getWorkflowState(sessionId)?.state.status, "paused");
		assert.equal(getWorkflowRunState(runId)?.state.status, "paused");

		const viewNode = workflowStateDefinition.buildViewNode?.({
			key: "state-key",
			id: runId,
			kind: "wf-state",
			state: updatedState,
			start: {
				event: { seq: 1 },
				location: { kind: "session" },
			},
		} as never);
		assert.deepEqual(viewNode, {
			key: "state-key",
			kind: "wf-state",
			id: runId,
			target: "chat",
			anchorSeq: 1,
			location: { kind: "session" },
			visibility: "visible",
			groupTree: "process",
			data: updatedState,
		});

		assert.equal(
			workflowStateDefinition.buildViewNode?.({
				state: undefined,
			} as never),
			null,
		);

		clearWorkflowState(sessionId);
	});

	it("matches runtime events where sessionId and runId are inside payload", () => {
		const runtimeSessionId = "runtime-session-prod" as SessionId;
		const runtimeRunId = "runtime-run-prod";
		clearWorkflowState(runtimeSessionId);

		const workflowDoc = {
			steps: [{ kind: "prompt" as const, prompt: "step 1" }],
		};
		const invocation = {
			targetPath: "impl",
			resolvedArgs: { instructions: "touch success for test" },
			runId: runtimeRunId,
		};

		const runtimeInitEvent = {
			type: "command/run",
			seq: 9,
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "init",
					sessionId: runtimeSessionId,
					runId: runtimeRunId,
					workflow: workflowDoc,
					invocation,
				}),
			},
		};

		assert.deepEqual(workflowStateDefinition.match(runtimeInitEvent as never), {
			id: runtimeRunId,
			role: "start",
		});

		workflowStateDefinition.start(
			{ id: runtimeRunId } as never,
			{ event: runtimeInitEvent } as never,
			null as never,
		);

		assert.equal(getWorkflowState(runtimeSessionId)?.state.status, "running");
		assert.equal(getWorkflowRunState(runtimeRunId)?.state.status, "running");
		assert.equal(
			getWorkflowState(runtimeSessionId)?.invocation.resolvedArgs.instructions,
			"touch success for test",
		);
		clearWorkflowState(runtimeSessionId);
	});

	it("matches, starts, and builds view nodes for wf/step", () => {
		const stepSessionId = "test-step-session" as SessionId;
		const stepRunId = "test-step-run";
		const stepEvent = {
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "step",
					id: "step-1",
					sessionId: stepSessionId,
					runId: stepRunId,
					stepIndex: 1,
					label: "Test Step",
					kind: "success",
				}),
			},
		};

		assert.deepEqual(workflowStepDefinition.match(stepEvent as never), {
			id: "step-1",
			role: "start",
		});
		assert.equal(
			workflowStepDefinition.match({ type: "other" } as never),
			null,
		);

		const startState = workflowStepDefinition.start(
			null as never,
			{ event: stepEvent } as never,
			null as never,
		);
		assert.deepEqual(startState, {
			stepIndex: 1,
			label: "Test Step",
			kind: "success",
			sessionId: stepSessionId,
			runId: stepRunId,
		});

		const viewNode = workflowStepDefinition.buildViewNode?.({
			key: "node-key",
			id: "step-1",
			kind: "wf-step",
			state: startState,
			start: {
				event: { seq: 12 },
				location: { kind: "session" },
			},
		} as never);
		assert.deepEqual(viewNode, {
			key: "node-key",
			kind: "wf-step",
			id: "step-1",
			target: "chat",
			anchorSeq: 12,
			location: { kind: "session" },
			visibility: "visible",
			groupTree: "process",
			data: startState,
		});
	});

	it("matches, starts, and builds view nodes for wf/print", () => {
		const printSessionId = "test-print-session" as SessionId;
		const printRunId = "test-print-run";
		const printEvent = {
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "print",
					id: "print-1",
					sessionId: printSessionId,
					runId: printRunId,
					text: "hello world",
				}),
			},
		};

		assert.deepEqual(workflowPrintDefinition.match(printEvent as never), {
			id: "print-1",
			role: "start",
		});
		assert.equal(
			workflowPrintDefinition.match({ type: "other" } as never),
			null,
		);

		const startState = workflowPrintDefinition.start(
			null as never,
			{ event: printEvent } as never,
			null as never,
		);
		assert.deepEqual(startState, {
			id: "print-1",
			text: "hello world",
			sessionId: printSessionId,
			runId: printRunId,
		});

		const viewNode = workflowPrintDefinition.buildViewNode?.({
			key: "node-key-print",
			id: "print-1",
			kind: "wf-print",
			state: startState,
			start: {
				event: { seq: 15 },
				location: { kind: "session" },
			},
		} as never);
		assert.deepEqual(viewNode, {
			key: "node-key-print",
			kind: "wf-print",
			id: "print-1",
			target: "chat",
			anchorSeq: 15,
			location: { kind: "session" },
			visibility: "visible",
			groupTree: "process",
			data: startState,
		});
	});

	it("matches, starts, updates, and builds view nodes for wf-error on failure", () => {
		const cmdId = "cmd-error-123";
		const runEvent = {
			type: "command/run",
			data: {
				commandId: cmdId,
				name: "wf",
				args: " impl test",
			},
		};

		assert.deepEqual(workflowErrorDefinition.match(runEvent as never), {
			id: cmdId,
			role: "start",
		});
		assert.equal(
			workflowErrorDefinition.match({
				type: "command/run",
				data: { commandId: "other-cmd", name: "other" },
			} as never),
			null,
		);

		const startState = workflowErrorDefinition.start(
			null as never,
			{ event: runEvent } as never,
			null as never,
		);
		assert.deepEqual(startState, {
			commandId: cmdId,
			name: "wf",
			args: " impl test",
			outcome: null,
		});

		// While running, buildViewNode returns null
		const runningView = workflowErrorDefinition.buildViewNode?.({
			state: startState,
		} as never);
		assert.equal(runningView, null);

		// If settled with success, buildViewNode returns null
		const successDoneEvent = {
			type: "command/done",
			data: {
				commandId: cmdId,
				kind: "success",
				text: "Workflow completed",
			},
		};
		const successState = workflowErrorDefinition.update(
			{ state: startState } as never,
			{ event: successDoneEvent } as never,
		);
		assert.equal(
			workflowErrorDefinition.buildViewNode?.({ state: successState } as never),
			null,
		);

		// If settled with error, buildViewNode returns wf-error node
		const errorDoneEvent = {
			type: "command/done",
			data: {
				commandId: cmdId,
				kind: "error",
				text: "Failed to load workflow 'impl': file not found",
			},
		};
		const errorState = workflowErrorDefinition.update(
			{ state: startState } as never,
			{ event: errorDoneEvent } as never,
		);
		assert.deepEqual(errorState, {
			commandId: cmdId,
			name: "wf",
			args: " impl test",
			outcome: {
				kind: "error",
				text: "Failed to load workflow 'impl': file not found",
			},
		});

		const viewNode = workflowErrorDefinition.buildViewNode?.({
			key: "error-view-key",
			id: cmdId,
			kind: "wf-error",
			state: errorState,
			start: {
				event: { seq: 42 },
				location: { kind: "session" },
			},
		} as never);
		assert.deepEqual(viewNode, {
			key: "error-view-key",
			kind: "wf-error",
			id: cmdId,
			target: "chat",
			anchorSeq: 42,
			location: { kind: "session" },
			visibility: "visible",
			groupTree: "process",
			data: {
				name: "wf",
				args: " impl test",
				text: "Failed to load workflow 'impl': file not found",
			},
		});
	});
});
