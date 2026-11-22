import {
	DisclosureRow,
	IconBranchOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
	InjectFace,
	PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { cssText } from "@lukstei/util-review-ui/client/GitDiffPane.module.css";
import { ReviewCard } from "@lukstei/util-review-ui/client/ReviewCard.tsx";
import {
	branchLabel,
	reviewTargetSchema,
	shortSha,
} from "@lukstei/util-review-ui/review";
import type { ReviewTarget } from "@lukstei/util-review-ui/types";
import { useState } from "react";
import type { GitReviewInjected } from "./GitReviewCard.tsx";

export type GitReviewRowProps = PropsRuntime<"tool.call.toolview"> &
	InjectFace<GitReviewInjected> & {
		sessionId?: SessionId;
	};

/* v8 ignore next */
const noop = (): void => undefined;

function formatTarget(argsRaw: string): string {
	try {
		const parsed = JSON.parse(argsRaw);
		const target = reviewTargetSchema.safeParse(parsed);
		if (target.success) {
			const label = branchLabel(target.data.branch);
			return target.data.commit !== undefined
				? `${label} @ ${shortSha(target.data.commit)}`
				: label;
		}
	} catch {
		// Partial or streaming JSON
	}
	return argsRaw;
}

function parseTarget(argsRaw: string): ReviewTarget | undefined {
	try {
		const parsed = JSON.parse(argsRaw);
		const target = reviewTargetSchema.safeParse(parsed);
		return target.success ? target.data : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Render a git_review_present call during tool execution inside the process group.
 * @param props - tool call props.
 * @returns in-process disclosure row.
 */
export function GitReviewRow(props: GitReviewRowProps) {
	const { block, inspect, phase, openReview, canOpen, sessionId } = props;
	const [expanded, setExpanded] = useState(false);

	if (phase === "preparing") {
		return (
			<div data-tool="git_review_present" data-state="preparing">
				<DisclosureRow
					title="Git Review"
					icon={<IconBranchOutlineRegular size={14} />}
					open={false}
					expandable={false}
					onToggle={noop}
					running
				/>
			</div>
		);
	}

	const settled = block && "kind" in block;
	const isError = block && "isError" in block && Boolean(block.isError);
	const error = block && "error" in block ? block.error : undefined;
	const state = !settled
		? "running"
		: error?.code === "interrupted"
			? "stopped"
			: isError
				? "error"
				: "ok";
	const call = block && "call" in block ? block.call : block;
	const args =
		(call && "argsRaw" in call && typeof call.argsRaw === "string"
			? call.argsRaw
			: undefined) ?? "";
	const output =
		settled && "content" in block && Array.isArray(block.content)
			? block.content
					.map((item) =>
						item.type === "text" ? item.text : JSON.stringify(item),
					)
					.join("\n")
			: "";
	const details =
		output || (settled && error ? `${error.name}: ${error.code}` : "");
	const target = parseTarget(args);
	const hasContent = details !== "" || target !== undefined;

	const hasOpener =
		canOpen !== undefined ? canOpen() : openReview !== undefined;
	const onOpen =
		target && hasOpener && openReview !== undefined && sessionId !== undefined
			? () => openReview(sessionId, target)
			: undefined;

	return (
		<div data-tool="git_review_present" data-state={state}>
			<DisclosureRow
				title="Git Review"
				icon={<IconBranchOutlineRegular size={14} />}
				open={expanded && hasContent}
				expandable={hasContent}
				expandOnRowClick
				keepContentWhenOpen
				onToggle={() => {
					setExpanded((value) => !value);
				}}
				collapsedContent={
					<span
						style={{
							marginLeft: 8,
							fontSize: 12,
							display: "flex",
							gap: 8,
							alignItems: "center",
						}}
					>
						<span>{formatTarget(args)}</span>
					</span>
				}
			>
				{details !== "" && (
					<pre
						style={{
							margin: "8px 0",
							padding: 12,
							borderRadius: "var(--dsw-radius-lg)",
							background: "var(--dsw-alias-bg-layer-1)",
							color: "var(--dsw-alias-label-secondary)",
							whiteSpace: "pre-wrap",
							overflowWrap: "anywhere",
							fontSize: 12,
						}}
					>
						{details}
					</pre>
				)}
				{target && (
					<div style={{ marginTop: 8 }}>
						<style>{cssText}</style>
						<ReviewCard
							title={branchLabel(target.branch)}
							description={
								target.commit !== undefined
									? shortSha(target.commit)
									: "All commits"
							}
							onOpen={onOpen}
						/>
					</div>
				)}
				{inspect && (
					<button
						type="button"
						style={{
							alignSelf: "flex-start",
							border: "none",
							padding: "4px 0",
							background: "transparent",
							color: "var(--dsw-alias-link)",
							font: "inherit",
							fontSize: 12,
							cursor: "pointer",
						}}
						onClick={inspect}
					>
						Inspect
					</button>
				)}
			</DisclosureRow>
		</div>
	);
}
