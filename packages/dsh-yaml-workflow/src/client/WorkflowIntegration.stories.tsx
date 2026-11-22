import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { Story } from "@ladle/react";
import { WORKFLOW_EVENT_NAME } from "../fold.ts";
import {
	type DshEvent,
	DshEventReplayer,
} from "./stories/DshEventReplayer.tsx";
import { WorkflowCommandCard } from "./WorkflowCommandCard.tsx";
import { WorkflowPrintStep } from "./WorkflowPrintStep.tsx";
import { WorkflowStepRow } from "./WorkflowStepRow.tsx";

const SECTION_STYLE = {
	display: "flex",
	flexDirection: "column" as const,
	gap: "10px",
	marginBottom: "32px",
};

const TITLE_STYLE = {
	fontSize: "12px",
	fontWeight: 700,
	letterSpacing: "0.08em",
	textTransform: "uppercase" as const,
	opacity: 0.6,
	borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))",
	paddingBottom: "6px",
	margin: "0 0 4px 0",
};

const SUCCESS_EVENTS: readonly DshEvent[] = [
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-1",
			args: JSON.stringify({
				action: "init",
				workflow: {
					steps: [
						{ kind: "prompt", prompt: "step 1" },
						{ kind: "prompt", prompt: "step 2" },
					],
				},
				invocation: {
					targetPath: "deploy.yml --env=production",
					resolvedArgs: {},
				},
			}),
		},
	},
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-1",
			args: JSON.stringify({
				action: "step",
				sessionId: "wf-1",
				id: "step-1",
				stepIndex: 0,
				label: "Validate deployment schema",
				kind: "success",
			}),
		},
	},
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-1",
			args: JSON.stringify({
				action: "print",
				id: "print-1",
				text: "Target cluster: us-east-1a\nActive pods: 4",
			}),
		},
	},
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-1",
			args: JSON.stringify({
				action: "step",
				sessionId: "wf-1",
				id: "step-2",
				stepIndex: 1,
				label: "Deploy container image v1.4.2",
				kind: "success",
			}),
		},
	},
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-1",
			args: JSON.stringify({
				action: "state",
				status: "completed",
			}),
		},
	},
];

const FAILURE_EVENTS: readonly DshEvent[] = [
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-2",
			args: JSON.stringify({
				action: "init",
				workflow: {
					steps: [
						{ kind: "prompt", prompt: "step 1" },
						{ kind: "prompt", prompt: "step 2" },
					],
				},
				invocation: {
					targetPath: "test-and-publish.yml",
					resolvedArgs: {},
				},
			}),
		},
	},
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-2",
			args: JSON.stringify({
				action: "step",
				sessionId: "wf-2",
				id: "step-10",
				stepIndex: 0,
				label: "Run lint and typecheck",
				kind: "success",
			}),
		},
	},
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-2",
			args: JSON.stringify({
				action: "step",
				sessionId: "wf-2",
				id: "step-11",
				stepIndex: 1,
				label: "Run integration tests",
				kind: "success",
			}),
		},
	},
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-2",
			args: JSON.stringify({
				action: "print",
				id: "print-10",
				text: "FAIL test/e2e/auth.spec.ts\n  ✕ database connection pool exhausted after 5000ms",
			}),
		},
	},
	{
		type: "command/run",
		data: {
			name: WORKFLOW_EVENT_NAME,
			sessionId: "wf-2",
			args: JSON.stringify({
				action: "state",
				status: "aborted",
			}),
		},
	},
];
function createMockStateNode(
	status: "running" | "paused" | "aborted" | "completed",
	targetPath = "build.yml --clean",
	gate?: string,
): ChatNode<"wf-state"> {
	const steps = gate
		? [{ kind: "prompt" as const, name: "Step 1", prompt: "gate step", gate }]
		: [{ kind: "prompt" as const, name: "Step 1", prompt: "step 1" }];
	return {
		key: "state-demo",
		kind: "wf-state",
		id: "state-demo",
		target: "chat",
		anchorSeq: 0,
		location: { kind: "unresolved" },
		visibility: "visible",
		groupTree: "process",
		data: {
			workflow: { steps, args: {} },
			invocation: { targetPath, resolvedArgs: {}, runId: "demo-run" },
			state: {
				stepIndex: 0,
				status,
			},
		},
	};
}

function createMockStepNode(
	id: string,
	label: string,
	stepIndex = 0,
	kind: "success" | "error" = "success",
	sessionId: SessionId = "demo-session" as SessionId,
	runId = "demo-run",
): ChatNode<"wf-step"> {
	return {
		key: id,
		kind: "wf-step",
		id,
		target: "chat",
		anchorSeq: 0,
		location: { kind: "unresolved" },
		visibility: "visible",
		groupTree: "process",
		data: {
			stepIndex,
			label,
			kind,
			sessionId,
			runId,
		},
	};
}

function createMockPrintNode(
	id: string,
	text: string,
	sessionId: SessionId = "demo-session" as SessionId,
	runId = "demo-run",
): ChatNode<"wf-print"> {
	return {
		key: id,
		kind: "wf-print",
		id,
		target: "chat",
		anchorSeq: 0,
		location: { kind: "unresolved" },
		visibility: "visible",
		groupTree: "process",
		data: {
			text,
			sessionId,
			runId,
		},
	};
}

export const AllVariants: Story = () => (
	<div style={{ display: "flex", flexDirection: "column" }}>
		{/* Static States */}
		<section style={SECTION_STYLE}>
			<h3 style={TITLE_STYLE}>1. Command Card States</h3>
			<div>
				<div style={{ fontSize: "11px", opacity: 0.5, marginBottom: "4px" }}>
					Running
				</div>
				<WorkflowCommandCard node={createMockStateNode("running")} />
			</div>

			<div>
				<div style={{ fontSize: "11px", opacity: 0.5, marginBottom: "4px" }}>
					Success
				</div>
				<WorkflowCommandCard
					node={createMockStateNode("completed", "build.yml --clean")}
				/>
			</div>

			<div>
				<div style={{ fontSize: "11px", opacity: 0.5, marginBottom: "4px" }}>
					Paused at Gate
				</div>
				<WorkflowCommandCard
					node={createMockStateNode(
						"paused",
						"deploy.yml --env=production",
						"Approval required before rollout",
					)}
				/>
			</div>

			<div>
				<div style={{ fontSize: "11px", opacity: 0.5, marginBottom: "4px" }}>
					Aborted
				</div>
				<WorkflowCommandCard
					node={createMockStateNode("aborted", "deploy.yml --env=production")}
				/>
			</div>
		</section>

		{/* Step and Print Rows */}
		<section style={SECTION_STYLE}>
			<h3 style={TITLE_STYLE}>2. Step Rows & Print Logs</h3>
			<WorkflowStepRow
				node={createMockStepNode("step-demo-1", "Execute database migrations")}
			/>
			<WorkflowStepRow
				node={createMockStepNode(
					"step-demo-2",
					"Pull container image registry.internal/app:latest",
					1,
				)}
			/>
			<WorkflowPrintStep
				node={createMockPrintNode(
					"print-demo-1",
					"Single-line info log: 4 nodes ready, 0 cordoned",
				)}
				renderFactorySlot={(_name, props) => (
					<div data-markdown="">{(props as { text?: string }).text}</div>
				)}
			/>
			<WorkflowPrintStep
				node={createMockPrintNode(
					"print-demo-2",
					`[INFO] Connecting to cluster us-central1...\n[INFO] Cluster state: OK\n[SUCCESS] Pipeline checks completed`,
				)}
				renderFactorySlot={(_name, props) => (
					<div data-markdown="">{(props as { text?: string }).text}</div>
				)}
			/>
		</section>

		{/* Live DSH Event Replay: Success */}
		<section style={SECTION_STYLE}>
			<h3 style={TITLE_STYLE}>3. DSH Event Replay (Success Run)</h3>
			<DshEventReplayer events={SUCCESS_EVENTS} autoPlay={false} />
		</section>

		{/* Live DSH Event Replay: Failure */}
		<section style={SECTION_STYLE}>
			<h3 style={TITLE_STYLE}>4. DSH Event Replay (Failure Run)</h3>
			<DshEventReplayer events={FAILURE_EVENTS} autoPlay={false} />
		</section>
	</div>
);
