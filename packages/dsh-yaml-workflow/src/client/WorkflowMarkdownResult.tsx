import type { CommandRowProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { PropsRenderFactories } from "@deepseek-ai/dsh-client-ui-slots";
import type React from "react";
import { CopyIcon } from "./icons.tsx";
import { WorkflowMarkdown } from "./WorkflowMarkdown.tsx";
import { WorkflowStyles } from "./WorkflowStyles.tsx";

/**
 * Purpose: Render workflow command outcomes through DSH's shared Markdown factory.
 * Contract:
 * - Inputs: Command lifecycle fields and the framework's factory renderer.
 * - Outputs: An always-visible result body with a command header and copy action.
 * - Throws: Clipboard failures propagate to the browser.
 */
export function WorkflowMarkdownResult({
	node,
	renderFactorySlot,
}: {
	node: Pick<CommandRowProps["node"], "name" | "args" | "outcome">;
} & PropsRenderFactories): React.JSX.Element {
	const { outcome } = node;
	const state =
		outcome === null
			? "running"
			: outcome.kind === "error"
				? "aborted"
				: "completed";
	const command = node.name === null ? "" : `/${node.name}`;
	const rawArgs =
		typeof node.args === "string" && node.args.trim().length > 0
			? node.args.startsWith(" ")
				? node.args
				: ` ${node.args}`
			: "";
	const rawCommand = command ? `${command}${rawArgs}` : "";

	return (
		<>
			<WorkflowStyles />
			<div className="dsh-wf-card" data-state={state}>
				<div className="dsh-wf-header">
					<div className="dsh-wf-title-group">
						<span className="dsh-wf-command-badge">{command}</span>
						{node.args && (
							<span className="dsh-wf-args" title={node.args}>
								{node.args}
							</span>
						)}
					</div>
					<span
						className={`dsh-wf-badge-${state === "completed" ? "success" : state}`}
					>
						{outcome === null
							? "Running…"
							: outcome.kind === "error"
								? "Failed"
								: "Done"}
					</span>
					<button
						type="button"
						className="dsh-wf-copy-btn"
						title="Copy command"
						aria-label="Copy command"
						onClick={() => navigator.clipboard.writeText(rawCommand)}
					>
						<CopyIcon />
					</button>
				</div>
				{outcome !== null && outcome.text !== undefined && (
					<WorkflowMarkdown
						className="dsh-wf-markdown-body"
						text={
							outcome.kind === "error"
								? outcome.text
										.split("\n")
										.map((line) => `    ${line}`)
										.join("\n")
								: outcome.text
						}
						renderFactorySlot={renderFactorySlot}
					/>
				)}
			</div>
		</>
	);
}
