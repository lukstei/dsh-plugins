/**
 * PURPOSE: End-to-end multi-run workflow execution and fold isolation test.
 * ALLOWED: WorkflowTestRunner, executeWorkflow with runId, foldWorkflowState with targetRunId.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { executeWorkflow, foldWorkflowState } from "../index.ts";
import { WorkflowTestRunner } from "./test-runner.ts";

test("executes multiple sequential workflow runs in the same session with distinct runIds", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "multi-run-e2e-session" });

	runner.registerWorkflow(
		"flow1.yaml",
		`name: Flow 1
steps:
  - kind: print
    name: Step 1
    text: "Flow 1 Done"
`,
	);

	runner.registerWorkflow(
		"flow2.yaml",
		`name: Flow 2
steps:
  - kind: print
    name: Step 1
    text: "Flow 2 Done"
`,
	);

	const res1 = await executeWorkflow({
		effects: runner,
		targetPath: "flow1.yaml",
		runId: "run-alpha-1",
	});
	assert.equal(res1.kind, "success");

	const res2 = await executeWorkflow({
		effects: runner,
		targetPath: "flow2.yaml",
		runId: "run-beta-2",
	});
	assert.equal(res2.kind, "success");

	const run1State = foldWorkflowState(runner.events, "run-alpha-1");
	const run2State = foldWorkflowState(runner.events, "run-beta-2");

	assert.ok(run1State);
	assert.ok(run2State);
	assert.equal(run1State.workflow.name, "Flow 1");
	assert.equal(run2State.workflow.name, "Flow 2");
	assert.equal(run1State.state.status, "completed");
	assert.equal(run2State.state.status, "completed");
	assert.equal(run1State.invocation.runId, "run-alpha-1");
	assert.equal(run2State.invocation.runId, "run-beta-2");

	// Step IDs in events should use runId
	const step1Event = runner.events.find((e) => {
		if (e.type !== "command/run") return false;
		const data = e.data as { name?: string; args?: string };
		if (data?.name !== "wf-event" || typeof data.args !== "string")
			return false;
		try {
			const payload = JSON.parse(data.args) as { action?: string; id?: string };
			return (
				payload.action === "print" && payload.id === "wf-print-run-alpha-1-0"
			);
		} catch {
			return false;
		}
	});
	const step2Event = runner.events.find((e) => {
		if (e.type !== "command/run") return false;
		const data = e.data as { name?: string; args?: string };
		if (data?.name !== "wf-event" || typeof data.args !== "string")
			return false;
		try {
			const payload = JSON.parse(data.args) as { action?: string; id?: string };
			return (
				payload.action === "print" && payload.id === "wf-print-run-beta-2-0"
			);
		} catch {
			return false;
		}
	});
	assert.ok(step1Event);
	assert.ok(step2Event);
});
