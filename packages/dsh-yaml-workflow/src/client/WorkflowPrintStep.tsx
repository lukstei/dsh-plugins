/**
 * PURPOSE: Output row component for wf-print chat nodes in chat feed.
 * ALLOWED: React rendering.
 * FORBIDDEN: State, network, direct DOM manipulation.
 */

import type { ChatNodeViewProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { PropsRenderFactories } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type React from "react";
import { WorkflowMarkdown } from "./WorkflowMarkdown.tsx";
import { WorkflowStyles } from "./WorkflowStyles.tsx";

export interface WorkflowPrintChatData {
	readonly text: string;
	readonly runId: string;
	readonly sessionId: SessionId;
}

export type WorkflowPrintStepProps = Pick<
	ChatNodeViewProps<"wf-print">,
	"node"
> &
	PropsRenderFactories;

/**
 * Markdown-rendered print output row mounted in conversation.chat.node slot.
 * CONTRACT:
 * - Input: ChatNodeViewProps with node containing WorkflowPrintChatData and factory renderer.
 * - Output: Markdown-rendered text block.
 */
export function WorkflowPrintStep({
	node,
	renderFactorySlot,
}: WorkflowPrintStepProps): React.JSX.Element {
	return (
		<>
			<WorkflowStyles />
			<WorkflowMarkdown
				className="dsh-wf-print-step"
				text={node.data.text}
				renderFactorySlot={renderFactorySlot}
			/>
		</>
	);
}
