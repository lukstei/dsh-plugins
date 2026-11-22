import type {
	ToolCallBlock,
	UseChat,
} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {
	InjectFace,
	PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import css, {
	cssText,
} from "@lukstei/util-review-ui/client/GitDiffPane.module.css";
import { ReviewCard } from "@lukstei/util-review-ui/client/ReviewCard.tsx";
import {
	branchLabel,
	GIT_REVIEW_TOOL,
	shortSha,
} from "@lukstei/util-review-ui/review";
import {
	type GitReviewEntry,
	type GitReviewScopeOrTarget,
	isBranchReviewScope,
	reviewScopeOrTargetSchema,
} from "./review-turn.ts";

/** Injected face: the split-view opener and availability probe. */
export interface GitReviewInjected {
	openReview?: (sessionId: SessionId, scope: GitReviewScopeOrTarget) => void;
	canOpen?: () => boolean;
}

export type GitReviewCardProps = (
	| PropsRuntime<"conversation.chat.turnTail">
	| {
			sessionId: SessionId;
			turn?: {
				turn?: number;
				data?: {
					get: (
						key: string,
					) => { reviews: readonly GitReviewEntry[] } | undefined;
				};
			};
			useChat?: UseChat;
			reviews?: readonly GitReviewEntry[];
	  }
) &
	InjectFace<GitReviewInjected>;

function extractToolCall(block: unknown, key: string): GitReviewEntry | null {
	if (!block || typeof block !== "object") return null;
	const isError = "isError" in block && Boolean(block.isError);
	if (isError) return null;

	const call =
		"call" in block && block.call
			? block.call
			: "kind" in block && (block as { call?: unknown }).call
				? (block as { call?: unknown }).call
				: block;
	const isRecord = (v: unknown): v is Record<string, unknown> =>
		typeof v === "object" && v !== null;
	const toolName =
		isRecord(call) && typeof call.name === "string" ? call.name : undefined;
	if (toolName !== GIT_REVIEW_TOOL) return null;

	const argsRaw =
		isRecord(call) && typeof call.argsRaw === "string"
			? call.argsRaw
			: undefined;
	if (typeof argsRaw !== "string") return null;

	try {
		const parsed = JSON.parse(argsRaw);
		const target = reviewScopeOrTargetSchema.safeParse(parsed);
		if (!target.success) return null;
		const id =
			"callId" in block && typeof block.callId === "string"
				? block.callId
				: isRecord(call) && typeof call.callId === "string"
					? call.callId
					: key;
		return { id, scope: target.data };
	} catch {
		return null;
	}
}

function useResolvedReviews(
	props: GitReviewCardProps,
): readonly GitReviewEntry[] {
	const manualReviews = "reviews" in props ? props.reviews : undefined;
	const turnDataReviews =
		"turn" in props && props.turn?.data !== undefined
			? (props.turn.data.get("git-review")?.reviews ?? [])
			: [];
	const turnNumber =
		"turn" in props && props.turn !== undefined
			? typeof props.turn.turn === "number"
				? props.turn.turn
				: undefined
			: undefined;
	const useChat = "useChat" in props ? props.useChat : undefined;

	const fallbackReviews = useChat
		? // biome-ignore lint/correctness/useHookAtTopLevel: useChat presence is fixed per prop variant for a card's lifetime
			useChat((snapshot) => {
				if (
					(manualReviews !== undefined && manualReviews.length > 0) ||
					turnDataReviews.length > 0 ||
					turnNumber === undefined
				)
					return [];
				const keys = snapshot.locations.getTurn(turnNumber);
				const results: GitReviewEntry[] = [];
				for (const key of keys) {
					const node = snapshot.nodes.get(key);
					if (node?.kind === "assistant-step") {
						const blocks = (node.data as { blocks?: unknown[] })?.blocks;
						if (Array.isArray(blocks)) {
							for (const block of blocks) {
								const entry = extractToolCall(block, key);
								if (entry && !results.some((r) => r.id === entry.id)) {
									results.push(entry);
								}
							}
						}
					}
					if (node?.kind === "tool-call") {
						const root = (node.data as { root?: ToolCallBlock })?.root;
						const entry = extractToolCall(root, key);
						if (entry && !results.some((r) => r.id === entry.id)) {
							results.push(entry);
						}
					}
				}
				return results;
			})
		: [];

	if (manualReviews !== undefined && manualReviews.length > 0)
		return manualReviews;
	if (turnDataReviews.length > 0) return turnDataReviews;
	return fallbackReviews;
}

/**
 * Render the persistent review card for a presented Git review target or scope.
 * Intended for turn-tail rendering so it remains visible after turn completion.
 * @param props - turn-tail runtime props and injected opener.
 * @returns the cards, or null when no review target is present.
 */
export function GitReviewCard(props: GitReviewCardProps) {
	const { sessionId, openReview, canOpen } = props;
	const reviews = useResolvedReviews(props);
	if (reviews.length === 0) return null;

	const hasOpener =
		canOpen !== undefined ? canOpen() : openReview !== undefined;
	const onOpen = (scope: GitReviewScopeOrTarget) =>
		hasOpener && openReview !== undefined
			? () => openReview(sessionId, scope)
			: undefined;

	return (
		<div className={css.reviewCardList} data-git-review-cards>
			<style>{cssText}</style>
			{reviews.map((review) => {
				const scope = review.scope;
				let branch: string;
				let commitSha: string | null = null;
				let commitSubject: string | null = null;
				if (isBranchReviewScope(scope)) {
					branch = scope.ref;
					if (scope.revision.kind === "commit") {
						commitSha = scope.revision.commit.sha;
						commitSubject = scope.revision.commit.subject;
					}
				} else {
					branch = scope.branch;
					if (scope.commit !== undefined) {
						commitSha = scope.commit;
					}
				}
				const description =
					commitSha === null
						? "All commits"
						: commitSubject !== null
							? `${shortSha(commitSha)} — ${commitSubject}`
							: shortSha(commitSha);
				return (
					<ReviewCard
						key={review.id}
						title={branchLabel(branch)}
						description={description}
						onOpen={onOpen(review.scope)}
					/>
				);
			})}
		</div>
	);
}
