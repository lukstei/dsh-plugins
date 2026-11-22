import assert from "node:assert/strict";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { test } from "vitest";
import {
	foldWorkflowEvent,
	initialWorkflowRunSummary,
	toWorkflowRunSummaryRecord,
	WORKFLOW_EVENT_NAME,
} from "../fold.ts";
import { assertRecordedEvents, assertRecordedState } from "./assertions.ts";

test("initialWorkflowRunSummary, foldWorkflowEvent and toWorkflowRunSummaryRecord validation", () => {
	const initial = initialWorkflowRunSummary();
	assert.equal(initial.status, "idle");
	assert.equal(toWorkflowRunSummaryRecord(initial), null);

	// Ignore non command/run
	assert.equal(
		foldWorkflowEvent(
			initial,
			// type-safe: testing unrecognized event type handling
			{ type: "other" } as unknown as SessionEvent,
		),
		initial,
	);

	// Ignore wrong command name or missing args
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

	// Corrupted JSON
	assert.equal(
		foldWorkflowEvent(initial, {
			type: "command/run",
			data: { name: WORKFLOW_EVENT_NAME, args: "invalid json" },
		} as unknown as SessionEvent),
		initial,
	);

	// Missing runId
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

	// Missing workflow or mismatched invocation in init is ignored
	assert.equal(
		foldWorkflowEvent(initial, {
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "init",
					runId: "r-1",
					workflow: { steps: [] },
					invocation: { runId: "r-2" },
				}),
			},
		} as unknown as SessionEvent),
		initial,
	);

	// Init action transitions to running
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

	// State action with mismatching runId is ignored
	assert.equal(
		foldWorkflowEvent(running, {
			type: "command/run",
			data: {
				name: WORKFLOW_EVENT_NAME,
				args: JSON.stringify({
					action: "state",
					runId: "other-run",
					status: "completed",
				}),
			},
		} as unknown as SessionEvent),
		running,
	);

	// State action with matching runId updates status and stepIndex
	const completed = foldWorkflowEvent(running, {
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			args: JSON.stringify({
				action: "state",
				runId: "r-1",
				status: "completed",
				stepIndex: 3,
			}),
		},
	} as unknown as SessionEvent);
	assert.deepEqual(completed, {
		status: "completed",
		runId: "r-1",
		stepIndex: 3,
		skillInvoked: false,
	});
});

test("assertRecordedState and assertRecordedEvents validation", () => {
	// Valid state match
	assertRecordedState(
		{ state: { status: "completed", stepIndex: 2, outputs: { out: "val" } } },
		{ status: "completed", stepIndex: 2, outputs: { out: "val" } },
	);

	// Missing state when expected throws
	assert.throws(
		() => assertRecordedState(null, { status: "completed" }),
		/Expected workflow state with status 'completed'/,
	);

	// Invalid status throws
	assert.throws(
		() =>
			assertRecordedState({
				state: { status: "invalid-status" as unknown, stepIndex: 0 },
			}),
		/Invalid workflow status/,
	);

	// Invalid stepIndex throws
	assert.throws(
		() =>
			assertRecordedState({
				state: { status: "running", stepIndex: -1 },
			}),
		/Invalid workflow stepIndex/,
	);

	// Status mismatch throws
	assert.throws(
		() =>
			assertRecordedState(
				{ state: { status: "running", stepIndex: 1 } },
				{ status: "completed" },
			),
		/Workflow status mismatch/,
	);

	// StepIndex mismatch throws
	assert.throws(
		() =>
			assertRecordedState(
				{ state: { status: "completed", stepIndex: 1 } },
				{ stepIndex: 2 },
			),
		/Workflow stepIndex mismatch/,
	);

	// Outputs mismatch throws
	assert.throws(
		() =>
			assertRecordedState(
				{ state: { status: "completed", stepIndex: 1 } },
				{ outputs: { file: "test.md" } },
			),
		/Expected state.outputs to be defined/,
	);
	assert.throws(
		() =>
			assertRecordedState(
				{
					state: {
						status: "completed",
						stepIndex: 1,
						outputs: { file: "other.md" },
					},
				},
				{ outputs: { file: "test.md" } },
			),
		/State output mismatch for 'file'/,
	);

	// Valid events match
	const validEvents = [
		{
			type: "command/run",
			data: { commandId: "cmd-1", args: JSON.stringify({ action: "init" }) },
		},
		{ type: "command/done", data: { commandId: "cmd-1", kind: "success" } },
	];
	assertRecordedEvents(validEvents, {
		commandCount: 1,
		actions: ["init"],
		noErrors: true,
	});

	// Duplicate commandId throws
	assert.throws(
		() =>
			assertRecordedEvents([
				{ type: "command/run", data: { commandId: "dup" } },
				{ type: "command/run", data: { commandId: "dup" } },
			]),
		/Duplicate commandId/,
	);

	// Missing command/done throws
	assert.throws(
		() =>
			assertRecordedEvents([
				{ type: "command/run", data: { commandId: "missing-done" } },
			]),
		/Missing command\/done/,
	);

	// Unexpected command error throws
	assert.throws(
		() =>
			assertRecordedEvents(
				[
					{ type: "command/run", data: { commandId: "err-cmd" } },
					{
						type: "command/done",
						data: { commandId: "err-cmd", kind: "error" },
					},
				],
				{ noErrors: true },
			),
		/Unexpected command\/done error/,
	);

	// Command count mismatch throws
	assert.throws(
		() => assertRecordedEvents(validEvents, { commandCount: 5 }),
		/Command count mismatch/,
	);

	// Actions sequence mismatch throws
	assert.throws(
		() => assertRecordedEvents(validEvents, { actions: ["step"] }),
		/Command actions sequence mismatch/,
	);
});
