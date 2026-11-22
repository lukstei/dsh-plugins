/**
 * PURPOSE: Render an error card for failed workflow slash-commands in conversation chat.
 * ALLOWED: React rendering, clipboard actions, reading command outcome and arguments.
 * FORBIDDEN: Direct agent manipulation, inline filesystem operations.
 */

import type { ChatNodeViewProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type React from "react";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "./icons.tsx";
import { WorkflowStyles } from "./WorkflowStyles.tsx";

export interface WorkflowErrorChatData {
	readonly name?: string;
	readonly args?: string | null;
	readonly text: string;
}

export type WorkflowErrorCardProps = Pick<
	ChatNodeViewProps<"wf-error">,
	"node"
>;

/**
 * Reconstructs the original slash command invocation string from error chat data.
 */
export function resolveErrorCommand(data: {
	readonly name?: string;
	readonly args?: string | null;
}): string {
	const rawArgs = typeof data.args === "string" ? data.args.trim() : "";
	const commandBadge = data.name ? `/${data.name}` : "/wf";
	return rawArgs.length > 0 ? `${commandBadge} ${rawArgs}` : commandBadge;
}

/**
 * Purpose: Renders a failed workflow command card in the conversation.chat.node slot.
 * Contract:
 * - Inputs: WorkflowErrorCardProps containing 'wf-error' chat node.
 * - Outputs: React JSX element rendering error details.
 * - Throws: None.
 */
export function WorkflowErrorCard({
	node,
}: WorkflowErrorCardProps): React.JSX.Element {
	const data = node.data;
	const rawArgs = typeof data.args === "string" ? data.args.trim() : "";
	const errorText = data.text;
	const commandBadge = data.name ? `/${data.name}` : "/wf";
	const rawCommand = resolveErrorCommand(data);
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard
			.writeText(rawCommand)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			})
			.catch(() => {});
	};

	return (
		<>
			<WorkflowStyles />
			<div className="dsh-wf-card" data-state="aborted">
				<div className="dsh-wf-header">
					<div className="dsh-wf-title-group">
						<span className="dsh-wf-command-badge">{commandBadge}</span>
						{rawArgs.length > 0 && (
							<span className="dsh-wf-args" title={rawArgs}>
								{rawArgs}
							</span>
						)}
						<button
							type="button"
							className="dsh-wf-copy-btn"
							data-copied={copied ? "true" : "false"}
							onClick={handleCopy}
							title={copied ? "Copied" : "Copy command"}
							aria-label={copied ? "Copied" : "Copy command"}
						>
							{copied ? <CheckIcon /> : <CopyIcon />}
						</button>
					</div>
					<div className="dsh-wf-status">
						<span className="dsh-wf-badge-aborted">✕ Failed</span>
					</div>
				</div>

				{errorText && (
					<div className="dsh-wf-body" data-error="true">
						{errorText}
					</div>
				)}
			</div>
		</>
	);
}
