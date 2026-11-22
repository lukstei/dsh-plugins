import assert from "node:assert/strict";
import type { WorkflowState } from "../types.ts";
import type {
	ExpectedEventsAssertion,
	ExpectedStateAssertion,
} from "./types.ts";

export function extractWorkflowState(
	recordedState: unknown,
): WorkflowState | undefined {
	if (recordedState === null || typeof recordedState !== "object") {
		return undefined;
	}
	if (
		"state" in recordedState &&
		typeof (recordedState as { state: unknown }).state === "object"
	) {
		return (recordedState as { state: WorkflowState }).state;
	}
	if ("latestRun" in recordedState) {
		const run = (recordedState as { latestRun: unknown }).latestRun;
		if (run !== null && typeof run === "object" && "state" in run) {
			return (run as { state: WorkflowState }).state;
		}
	}
	if ("completed" in recordedState) {
		const completed = (recordedState as { completed: unknown }).completed;
		if (
			completed !== null &&
			typeof completed === "object" &&
			"state" in completed
		) {
			return (completed as { state: WorkflowState }).state;
		}
	}
	return undefined;
}

export function assertRecordedState(
	recordedState: unknown,
	expected?: ExpectedStateAssertion,
): void {
	const state = extractWorkflowState(recordedState);
	if (state === undefined) {
		if (expected !== undefined && expected.status !== undefined) {
			assert.fail(
				`Expected workflow state with status '${expected.status}', but no state was found`,
			);
		}
		return;
	}

	assert.ok(
		["running", "paused", "completed", "aborted"].includes(state.status),
		`Invalid workflow status: ${state.status}`,
	);
	assert.ok(
		typeof state.stepIndex === "number" && state.stepIndex >= 0,
		`Invalid workflow stepIndex: ${state.stepIndex}`,
	);

	if (expected !== undefined) {
		if (expected.status !== undefined) {
			assert.equal(state.status, expected.status, "Workflow status mismatch");
		}
		if (expected.stepIndex !== undefined) {
			assert.equal(
				state.stepIndex,
				expected.stepIndex,
				"Workflow stepIndex mismatch",
			);
		}
		if (expected.pauseReason !== undefined) {
			assert.equal(
				state.pauseReason,
				expected.pauseReason,
				"Workflow pauseReason mismatch",
			);
		}
		if (expected.outputs !== undefined) {
			assert.ok(
				state.outputs !== undefined,
				"Expected state.outputs to be defined",
			);
			for (const [key, expectedValue] of Object.entries(expected.outputs)) {
				assert.deepEqual(
					state.outputs[key],
					expectedValue,
					`State output mismatch for '${key}'`,
				);
			}
		}
	}
}

export function assertRecordedEvents(
	events: readonly { readonly type: string; readonly data?: unknown }[],
	expected?: ExpectedEventsAssertion,
): void {
	const commandRuns = new Map<string, unknown>();
	const commandDones = new Set<string>();
	const actions: string[] = [];

	for (const event of events) {
		assert.ok(event.type.length > 0, "Event type must not be empty");
		if (event.type === "command/run") {
			const data = event.data as
				| { commandId?: string; name?: string; args?: unknown }
				| undefined;
			if (data !== undefined && data.commandId !== undefined) {
				assert.equal(
					commandRuns.has(data.commandId),
					false,
					`Duplicate commandId in command/run: ${data.commandId}`,
				);
				commandRuns.set(data.commandId, data.args);
				if (typeof data.args === "string") {
					try {
						const parsed = JSON.parse(data.args) as { action?: string };
						if (parsed.action !== undefined) {
							actions.push(parsed.action);
						}
					} catch {
						// Ignored for intentional noise events
					}
				}
			}
		} else if (event.type === "command/done") {
			const data = event.data as
				| { commandId?: string; kind?: string }
				| undefined;
			if (data !== undefined && data.commandId !== undefined) {
				commandDones.add(data.commandId);
				if (expected ? expected.noErrors : false) {
					assert.notEqual(
						data.kind,
						"error",
						`Unexpected command/done error in command ${data.commandId}`,
					);
				}
			}
		}
	}

	for (const commandId of commandRuns.keys()) {
		assert.ok(
			commandDones.has(commandId),
			`Missing command/done for commandId: ${commandId}`,
		);
	}

	if (expected !== undefined) {
		if (expected.commandCount !== undefined) {
			assert.equal(
				commandRuns.size,
				expected.commandCount,
				"Command count mismatch",
			);
		}
		if (expected.actions !== undefined) {
			assert.deepEqual(
				actions,
				expected.actions,
				"Command actions sequence mismatch",
			);
		}
	}
}
