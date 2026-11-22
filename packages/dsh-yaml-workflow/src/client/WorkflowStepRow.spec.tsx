/**
 * PURPOSE: Unit tests for WorkflowStepRow component and step status derivation.
 * ALLOWED: In-memory tests, assertion checks.
 */

import assert from "node:assert/strict";
import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
// @ts-expect-error react-dom lacks bundled type declarations in devDependencies
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it } from "vitest";
import type { WorkflowRun } from "../types.ts";
import { clearWorkflowState, setWorkflowState } from "./store.ts";
import {
	deriveStepStatus,
	type WorkflowStepChatData,
	WorkflowStepRow,
} from "./WorkflowStepRow.tsx";

const testSessionId = "sess-1" as SessionId;
const testRunId = "run-step-1";

function createMockRun(
	stepIndex: number,
	status: "running" | "paused" | "aborted" | "completed",
	error?: string,
): WorkflowRun {
	return {
		workflow: {
			name: "Test Workflow",
			args: {},
			steps: [
				{ kind: "prompt", name: "Step 1", prompt: "first" },
				{ kind: "prompt", name: "Step 2", prompt: "second" },
			],
		},
		invocation: {
			targetPath: "test.yaml",
			resolvedArgs: {},
			runId: testRunId,
		},
		state: {
			stepIndex,
			status,
			...(error ? { error } : {}),
		},
	};
}

function createStepNode(
	overrides?: Partial<WorkflowStepChatData>,
	nodeId = "wf-step-sess-1-0",
): ChatNode<"wf-step"> {
	return {
		key: "step-node-1",
		kind: "wf-step",
		id: nodeId,
		target: "chat",
		anchorSeq: 1,
		location: { kind: "unresolved" },
		visibility: "visible",
		data: {
			stepIndex: 0,
			label: "Step 1 of 2: Setup",
			kind: "success",
			sessionId: testSessionId,
			runId: testRunId,
			...overrides,
		},
	};
}

describe("deriveStepStatus", () => {
	it("derives running status when step matches active stepIndex and workflow is running", () => {
		const run = createMockRun(0, "running");
		const status = deriveStepStatus(
			{
				stepIndex: 0,
				label: "Step 1",
				kind: "success",
				sessionId: testSessionId,
				runId: testRunId,
			},
			run,
		);
		assert.equal(status, "running");
	});

	it("derives done status when stepIndex is prior to active stepIndex", () => {
		const run = createMockRun(1, "running");
		const status = deriveStepStatus(
			{
				stepIndex: 0,
				label: "Step 1",
				kind: "success",
				sessionId: testSessionId,
				runId: testRunId,
			},
			run,
		);
		assert.equal(status, "done");
	});

	it("derives done status when workflow is completed", () => {
		const run = createMockRun(2, "completed");
		const status = deriveStepStatus(
			{
				stepIndex: 1,
				label: "Step 2",
				kind: "success",
				sessionId: testSessionId,
				runId: testRunId,
			},
			run,
		);
		assert.equal(status, "done");
	});

	it("derives paused status when step matches active index and workflow is paused", () => {
		const run = createMockRun(0, "paused");
		const status = deriveStepStatus(
			{
				stepIndex: 0,
				label: "Step 1",
				kind: "success",
				sessionId: testSessionId,
				runId: testRunId,
			},
			run,
		);
		assert.equal(status, "paused");
	});

	it("derives aborted status when step matches active index and workflow is aborted", () => {
		const run = createMockRun(1, "aborted");
		const status = deriveStepStatus(
			{
				stepIndex: 1,
				label: "Step 2",
				kind: "success",
				sessionId: testSessionId,
				runId: testRunId,
			},
			run,
		);
		assert.equal(status, "aborted");
	});

	it("derives done status for prior steps even when workflow is aborted", () => {
		const run = createMockRun(1, "aborted", "Step 2 failed");
		const status = deriveStepStatus(
			{
				stepIndex: 0,
				label: "Step 1",
				kind: "success",
				sessionId: testSessionId,
				runId: testRunId,
			},
			run,
		);
		assert.equal(status, "done");
	});

	it("derives error status when kind is error", () => {
		const status = deriveStepStatus({
			stepIndex: 0,
			label: "Step 1",
			kind: "error",
			sessionId: testSessionId,
			runId: testRunId,
		});
		assert.equal(status, "error");
	});

	it("defaults to done when no active workflow run is present in store", () => {
		const status = deriveStepStatus({
			stepIndex: 0,
			label: "Step 1",
			kind: "success",
			sessionId: testSessionId,
			runId: testRunId,
		});
		assert.equal(status, "done");
	});
});

describe("WorkflowStepRow", () => {
	const sessionId = "sess-1" as SessionId;

	afterEach(() => {
		clearWorkflowState(sessionId);
	});

	it("renders running state with pulse dot and Running badge", () => {
		setWorkflowState(sessionId, createMockRun(0, "running"), testRunId);
		const node = createStepNode({ stepIndex: 0 });
		const html = renderToStaticMarkup(<WorkflowStepRow node={node} />);

		assert.match(html, /class="dsh-wf-step-row"/);
		assert.match(html, /data-status="running"/);
		assert.match(html, /class="dsh-wf-pulse-dot"/);
		assert.match(html, /Running\.\.\./);
	});

	it("renders done state with CheckIcon when step is finished", () => {
		setWorkflowState(sessionId, createMockRun(1, "running"), testRunId);
		const node = createStepNode({ stepIndex: 0 });
		const html = renderToStaticMarkup(<WorkflowStepRow node={node} />);

		assert.match(html, /class="dsh-wf-step-row"/);
		assert.match(html, /data-status="done"/);
		assert.match(html, /<svg/);
	});

	it("renders discarded/aborted state with Discarded badge", () => {
		setWorkflowState(sessionId, createMockRun(0, "aborted"), testRunId);
		const node = createStepNode({ stepIndex: 0 });
		const html = renderToStaticMarkup(<WorkflowStepRow node={node} />);

		assert.match(html, /class="dsh-wf-step-row"/);
		assert.match(html, /data-status="aborted"/);
		assert.match(html, /class="dsh-wf-badge-aborted"/);
		assert.match(html, /Discarded/);
	});

	it("renders discarded error node with Discarded badge", () => {
		setWorkflowState(sessionId, createMockRun(0, "aborted"), testRunId);
		const node = createStepNode({
			stepIndex: 0,
			kind: "error",
			label: "Workflow discarded at step 1 of 2: Setup",
		});
		const html = renderToStaticMarkup(<WorkflowStepRow node={node} />);

		assert.match(html, /class="dsh-wf-step-row"/);
		assert.match(html, /data-status="aborted"/);
		assert.match(html, /class="dsh-wf-badge-aborted"/);
		assert.match(html, /Discarded/);
		assert.match(html, /Workflow discarded at step 1 of 2: Setup/);
	});

	it("renders error state with Failed badge and error message", () => {
		setWorkflowState(
			sessionId,
			createMockRun(0, "aborted", "Execution exploded"),
			testRunId,
		);
		const node = createStepNode({
			stepIndex: 0,
			kind: "error",
			label: "Workflow execution failed at step 1 of 2: Execution exploded",
		});
		const html = renderToStaticMarkup(<WorkflowStepRow node={node} />);

		assert.match(html, /class="dsh-wf-step-row"/);
		assert.match(html, /data-status="error"/);
		assert.match(html, /class="dsh-wf-badge-aborted"/);
		assert.match(html, /Failed/);
		assert.match(html, /Execution exploded/);
	});
});
