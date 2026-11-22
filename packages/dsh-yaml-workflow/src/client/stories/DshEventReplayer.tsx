import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type React from "react";
import { useEffect, useState } from "react";
import { WORKFLOW_EVENT_NAME } from "../../fold.ts";
import type { WorkflowPayload } from "../../types.ts";
import { WorkflowCommandCard } from "../WorkflowCommandCard.tsx";
import { WorkflowPrintStep } from "../WorkflowPrintStep.tsx";
import { WorkflowStepRow } from "../WorkflowStepRow.tsx";

export type DshEvent = {
	readonly type: "command/run";
	readonly data: {
		readonly commandId?: string;
		readonly name?: string;
		readonly args: string;
		readonly sessionId?: string;
	};
};

export interface DshEventReplayerProps {
	readonly events: readonly DshEvent[];
	readonly autoPlay?: boolean;
	readonly intervalMs?: number;
}

interface ReplayerState {
	card: ChatNode<"wf-state"> | undefined;
	entries: Array<
		| { kind: "step"; node: ChatNode<"wf-step">; id: string }
		| { kind: "print"; node: ChatNode<"wf-print">; id: string }
	>;
}

function reduceDshEvents(events: readonly DshEvent[]): ReplayerState {
	let card: ChatNode<"wf-state"> | undefined;
	const entries: ReplayerState["entries"] = [];

	for (const event of events) {
		const data = event.data;
		if (data.name !== WORKFLOW_EVENT_NAME) continue;
		// cast: local story fixtures encode workflow payloads as JSON strings.
		const payload = JSON.parse(data.args) as WorkflowPayload;
		const runId = payload.runId;
		if (payload.action === "init") {
			card = {
				key: runId,
				kind: "wf-state",
				id: runId,
				target: "chat",
				anchorSeq: 0,
				location: { kind: "unresolved" },
				visibility: "visible",
				groupTree: "process",
				data: {
					workflow: payload.workflow,
					invocation: payload.invocation,
					state: {
						stepIndex: 0,
						status: "running",
					},
				},
			};
		} else if (payload.action === "state") {
			if (card) {
				const { action: _, ...delta } = payload;
				card = {
					...card,
					data: {
						...card.data,
						state: {
							...card.data.state,
							...delta,
						},
					},
				};
			}
		} else if (payload.action === "step") {
			entries.push({
				kind: "step",
				id: payload.id,
				node: {
					key: payload.id,
					kind: "wf-step",
					id: payload.id,
					target: "chat",
					anchorSeq: 0,
					location: { kind: "unresolved" },
					visibility: "visible",
					groupTree: "process",
					data: {
						stepIndex: payload.stepIndex,
						label: payload.label,
						kind: payload.kind,
						sessionId: payload.sessionId,
						runId: payload.runId,
					},
				},
			});
		} else if (payload.action === "print") {
			entries.push({
				kind: "print",
				id: payload.id,
				node: {
					key: payload.id,
					kind: "wf-print",
					id: payload.id,
					target: "chat",
					anchorSeq: 0,
					location: { kind: "unresolved" },
					visibility: "visible",
					groupTree: "process",
					data: {
						text: payload.text,
						runId: payload.runId,
						sessionId: payload.sessionId,
					},
				},
			});
		}
	}

	return { card, entries };
}

const mockRenderFactorySlot = (_name: string, props: object) => (
	<div data-markdown="">{(props as { text?: string }).text}</div>
);

export function DshEventReplayer({
	events,
	autoPlay = true,
	intervalMs = 400,
}: DshEventReplayerProps): React.JSX.Element {
	const [index, setIndex] = useState(autoPlay ? 1 : events.length);

	useEffect(() => {
		if (!autoPlay || index >= events.length) return;
		const timer = setTimeout(() => {
			setIndex((prev) => Math.min(prev + 1, events.length));
		}, intervalMs);
		return () => clearTimeout(timer);
	}, [autoPlay, index, events.length, intervalMs]);

	const { card, entries } = reduceDshEvents(events.slice(0, index));

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				padding: "16px",
				maxWidth: "700px",
				margin: "0 auto",
			}}
		>
			{card && <WorkflowCommandCard node={card} />}
			{entries.map((entry) =>
				entry.kind === "step" ? (
					<WorkflowStepRow key={entry.id} node={entry.node} />
				) : (
					<WorkflowPrintStep
						key={entry.id}
						node={entry.node}
						renderFactorySlot={mockRenderFactorySlot}
					/>
				),
			)}
		</div>
	);
}
