import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { PropsRenderFactories } from "@deepseek-ai/dsh-client-ui-slots";
import { SessionId } from "@deepseek-ai/dsh-session/types";
// @ts-expect-error react-dom lacks bundled type declarations in devDependencies
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { WorkflowPrintStep } from "./WorkflowPrintStep.tsx";

vi.mock("./WorkflowStyles.tsx", () => ({ WorkflowStyles: () => null }));

const cases = [
	{
		label: "queued workflow invocation",
		node: {
			key: "queue-first",
			kind: "wf-print",
			id: "first",
			target: "chat",
			anchorSeq: 1,
			location: { kind: "session" },
			visibility: "visible",
			groupTree: "process",
			data: {
				text: "Workflow queued:\n\n    /wf first.yaml env=prod",
				runId: "first",
				sessionId: SessionId("demo-session"),
			},
		} satisfies ChatNode<"wf-print">,
	},
	{
		label: "single line print",
		node: {
			key: "print-1",
			kind: "wf-print" as const,
			id: "print-1",
			target: "chat" as const,
			anchorSeq: 0,
			location: { kind: "unresolved" as const },
			visibility: "visible" as const,
			groupTree: "process" as const,
			data: {
				text: "Starting deployment",
				sessionId: "demo-session" as SessionId,
				runId: "demo-run",
			},
		},
	},
	{
		label: "markdown bullet list and inline code",
		node: {
			key: "print-2",
			kind: "wf-print" as const,
			id: "print-2",
			target: "chat" as const,
			anchorSeq: 0,
			location: { kind: "unresolved" as const },
			visibility: "visible" as const,
			groupTree: "process" as const,
			data: {
				text: "Selected services:\n- `auth-service`: v1.2\n- `billing`: v2.0",
				sessionId: "demo-session" as SessionId,
				runId: "demo-run",
			},
		},
	},
	{
		label: "fenced markdown code block",
		node: {
			key: "print-3",
			kind: "wf-print" as const,
			id: "print-3",
			target: "chat" as const,
			anchorSeq: 0,
			location: { kind: "unresolved" as const },
			visibility: "visible" as const,
			groupTree: "process" as const,
			data: {
				text: "```yaml\nversion: 1\nenv: production\n```",
				sessionId: "demo-session" as SessionId,
				runId: "demo-run",
			},
		},
	},
];

test.each(cases)(
	"renders print step with markdown factory: $label",
	({ node }) => {
		const renderFactorySlot = vi.fn((_name: string, _props: object) => (
			<div data-markdown="" />
		)) satisfies PropsRenderFactories["renderFactorySlot"];

		const html = renderToStaticMarkup(
			<WorkflowPrintStep node={node} renderFactorySlot={renderFactorySlot} />,
		);

		expect({ html, markdown: renderFactorySlot.mock.calls }).toMatchSnapshot();
		expect(renderFactorySlot).toHaveBeenCalledWith(
			"conversation.chat.reasoning.content",
			{
				text: node.data.text,
				running: false,
			},
		);
	},
);
