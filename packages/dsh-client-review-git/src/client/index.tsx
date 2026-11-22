import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import {
	Button,
	IconBranchOutlineRegular,
	Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type {
	PropsRenderFactories,
	PropsRuntime,
	SnapshotSelectorHook,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SplitState } from "@lukstei/dsh-client-split-view/client-contract";
import { branchLabel, GIT_REVIEW_TOOL } from "@lukstei/util-review-ui/review";
import type { BranchReviewScope } from "@lukstei/util-review-ui/types";
import contribution from "../../lib/typert.remote-client.js";
import "./contract.ts";
import { GitDiffPane } from "./GitDiffPane.tsx";
import { GitReviewCard } from "./GitReviewCard.tsx";
import { GitReviewRow } from "./GitReviewRow.tsx";
import {
	type GitReviewScopeOrTarget,
	gitReviewDefinition,
	isBranchReviewScope,
} from "./review-turn.ts";

export const inject = [
	"sidebarRightTabs",
	"slots",
	"remote",
	"uiConversation",
] as const;

function ReviewTabBody({ renderFactorySlot }: PropsRenderFactories) {
	return renderFactorySlot("gitdiff.review", {});
}

function ReviewHeaderAction({
	sessionId,
	useSplit,
	toggle,
}: PropsRuntime<"split.pane.header.actions"> & {
	useSplit: SnapshotSelectorHook<SplitState>;
	toggle: () => void;
}) {
	const pressed = useSplit((state) => {
		const overlay = state.overlays.get(sessionId);
		return (
			overlay !== undefined &&
			overlay.kind === "slot" &&
			overlay.slotName === "gitdiff.review"
		);
	});
	const label = pressed ? "Close git review" : "Show git review";
	return (
		<Tooltip label={label} portal>
			<Button
				size="sm"
				variant="ghost"
				className={`dsh-split-icon-btn${pressed ? " is-pressed" : ""}`}
				aria-label={label}
				aria-pressed={pressed}
				onClick={toggle}
				icon={<IconBranchOutlineRegular size={14} />}
			/>
		</Tooltip>
	);
}

export async function apply(ctx: Context): Promise<void> {
	const dispose = await ctx.remote.$mount(contribution);
	ctx.effect(() => dispose);

	let opener:
		| ((sessionId: SessionId, target: GitReviewScopeOrTarget) => Promise<void>)
		| undefined;

	const reviewInjected = () => ({
		openReview: (sessionId: SessionId, target: GitReviewScopeOrTarget) => {
			if (opener) {
				void opener(sessionId, target).catch((error) => {
					console.error("[GitReview] Open review failed:", error);
				});
			}
		},
		canOpen: () => opener !== undefined,
	});

	ctx.effect(
		() => ctx.uiConversation.events.register(gitReviewDefinition),
		"review: git-review turn data",
	);

	ctx.effect(
		() =>
			ctx.slots.inject("tool.call.toolview", () =>
				ctx.slots.register(
					{
						name: "tool.call.toolview",
						key: GIT_REVIEW_TOOL,
						inject: reviewInjected,
					},
					GitReviewRow,
				),
			),
		"review: review tool view",
	);

	ctx.effect(
		() =>
			ctx.slots.inject("conversation.chat.turnTail", () =>
				ctx.slots.register(
					{
						name: "conversation.chat.turnTail",
						id: "git-review",
						inject: reviewInjected,
					},
					GitReviewCard,
				),
			),
		"review: review cards",
	);

	ctx.plugin({
		inject: ["splitView", "remote.workspaceReview"],
		apply(splitCtx) {
			opener = async (sessionId, targetOrScope) => {
				let scope: BranchReviewScope;
				if (isBranchReviewScope(targetOrScope)) {
					scope = targetOrScope;
				} else {
					const res = await splitCtx.remote.workspaceReview.resolve(
						sessionId,
						targetOrScope,
						new AbortController().signal,
					);
					if (!res.ok) {
						console.error("[GitReview] Resolution failed:", res.error.message);
						return;
					}
					scope = res.value;
				}
				splitCtx.splitView.openSlotOverlay(
					sessionId,
					"gitdiff.review",
					`Review ${branchLabel(scope.ref)}`,
					{ scope },
				);
			};
			splitCtx.effect(() => () => {
				opener = undefined;
			});
			splitCtx.effect(
				() =>
					splitCtx.slots.inject("split.pane.header.actions", () =>
						splitCtx.slots.register(
							{
								name: "split.pane.header.actions",
								id: "git-review",
								order: 12,
								inject: (sessionId) => ({
									hooks: { split: splitCtx.splitView },
									toggle: () => {
										const overlay = splitCtx.splitView
											.getSnapshot()
											.overlays.get(sessionId);
										if (
											overlay !== undefined &&
											overlay.kind === "slot" &&
											overlay.slotName === "gitdiff.review"
										)
											splitCtx.splitView.closeOverlay(sessionId);
										else
											splitCtx.splitView.openSlotOverlay(
												sessionId,
												"gitdiff.review",
												"Review",
												{},
											);
									},
								}),
							},
							ReviewHeaderAction,
						),
					),
				"review: split pane action",
			);
		},
	});

	ctx.inject(["remote.workspaceReview"], (ctx) => {
		ctx.effect(() =>
			ctx.sidebarRightTabs.register({
				id: "dsh-client-git-diff",
				kind: "gitbutler",
				title: () => "Workspace Review",
				guide: [
					{
						id: "open",
						order: 50,
						title: () => "Review",
						description: () => "Browse Git changes",
					},
				],
			}),
		);
		ctx.effect(() =>
			ctx.slots.registerFactory(
				{
					name: "gitdiff.review",
					scope: "session",
					inject: () => ({ api: ctx.remote.workspaceReview }),
				},
				GitDiffPane,
			),
		);
		ctx.effect(() =>
			ctx.slots.inject("sidebar.right.pane.tab", () =>
				ctx.slots.register(
					{ name: "sidebar.right.pane.tab", key: "dsh-client-git-diff" },
					ReviewTabBody,
				),
			),
		);
	});
}
