import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { foldWorkflowState } from "../fold.ts";
import { executeWorkflow, requestWorkflowResume } from "../runner.ts";
import { WorkflowTestRunner } from "./test-runner.ts";

// edge case: admission races require controlled promises beyond the fixture action schema.
test("concurrent resume admissions reserve one execution after the agent becomes idle", async () => {
	const runner = new WorkflowTestRunner({ sessionId: "concurrent-resume" });
	runner.registerWorkflow(
		"gate.yaml",
		"steps:\n  - gate: review\n  - prompt: work",
	);
	await executeWorkflow({ effects: runner, targetPath: "gate.yaml" });
	const initialPromptCount = runner.dispatchedPrompts.length;
	runner.busy = true;
	const prompt = Promise.withResolvers<void>();
	runner.onPrompt = () => prompt.promise;
	const first = requestWorkflowResume(
		runner,
		"first",
		new AbortController().signal,
	);
	const second = requestWorkflowResume(
		runner,
		"second",
		new AbortController().signal,
	);
	runner.resolveIdle();
	try {
		assert.deepEqual(await Promise.all([first, second]), [
			{ kind: "success", text: "Workflow resume accepted" },
			{
				kind: "error",
				text: "A workflow is already executing in this session",
			},
		]);
		await vi.waitFor(() =>
			assert.equal(runner.dispatchedPrompts.length, initialPromptCount + 1),
		);
	} finally {
		prompt.resolve();
		await vi.waitFor(() =>
			assert.equal(foldWorkflowState(runner.events)?.state.status, "completed"),
		);
	}
});

test("request cancellation before resume admission leaves the workflow paused", async () => {
	const runner = new WorkflowTestRunner({
		sessionId: "cancel-resume-admission",
	});
	runner.registerWorkflow(
		"gate.yaml",
		"steps:\n  - gate: review\n  - prompt: work",
	);
	await executeWorkflow({ effects: runner, targetPath: "gate.yaml" });
	const initialPromptCount = runner.dispatchedPrompts.length;
	runner.busy = true;
	const request = new AbortController();
	const admission = requestWorkflowResume(runner, "feedback", request.signal);
	request.abort();
	runner.resolveIdle();
	await assert.rejects(admission, { name: "AbortError" });
	assert.equal(foldWorkflowState(runner.events)?.state.status, "paused");
	assert.equal(runner.dispatchedPrompts.length, initialPromptCount);
	assert.equal(
		(await requestWorkflowResume(runner, "retry", new AbortController().signal))
			.kind,
		"success",
	);
	await vi.waitFor(() =>
		assert.equal(foldWorkflowState(runner.events)?.state.status, "completed"),
	);
});
