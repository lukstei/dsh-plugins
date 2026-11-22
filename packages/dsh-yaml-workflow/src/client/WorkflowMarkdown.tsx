import type { PropsRenderFactories } from "@deepseek-ai/dsh-client-ui-slots";
import type React from "react";

export interface WorkflowMarkdownProps extends PropsRenderFactories {
	readonly text: string;
	readonly className?: string;
}

/**
 * Purpose: Render markdown through DSH's shared Markdown factory.
 * Contract:
 * - Inputs: text string, optional className, and renderFactorySlot.
 * - Outputs: Markdown-rendered block.
 */
export function WorkflowMarkdown({
	text,
	className,
	renderFactorySlot,
}: WorkflowMarkdownProps): React.JSX.Element {
	return (
		<div className={className}>
			{renderFactorySlot("conversation.chat.reasoning.content", {
				text,
				running: false,
			})}
		</div>
	);
}
