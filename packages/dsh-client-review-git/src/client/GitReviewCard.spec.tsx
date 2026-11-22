// @vitest-environment happy-dom
import assert from "node:assert/strict";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { BranchReviewScope } from "@lukstei/util-review-ui/types";
import { act, type ComponentProps, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GitReviewCard } from "./GitReviewCard.tsx";
import type { GitReviewEntry, GitReviewScopeOrTarget } from "./review-turn.ts";

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
	IconBranchOutlineRegular: () => <svg aria-hidden="true" />,
	IconCopyOutlineRegular: () => <svg aria-hidden="true" />,
	IconCheckOutlineRegular: () => <svg aria-hidden="true" />,
	useClipboardCopy: () => ({ copied: false, onCopy: vi.fn() }),
}));

const Component = GitReviewCard as unknown as ComponentType<
	Record<string, unknown>
>;

const commitScope: BranchReviewScope = {
	kind: "branch",
	repository: "/repo",
	ref: "refs/heads/feature/auth",
	base: { kind: "manual", ref: "refs/remotes/origin/main" },
	revision: {
		kind: "commit",
		commit: {
			sha: "1234567890abcdef",
			subject: "Reject outer shell evaluation",
			author: "Diff Test",
			date: "2026-11-17T09:00:00+01:00",
		},
	},
};

const allCommitsScope: BranchReviewScope = {
	...commitScope,
	ref: "refs/heads/feature/other",
	revision: { kind: "all-commits" },
};

const commitReview: GitReviewEntry = { id: "call-1", scope: commitScope };
const allCommitsReview: GitReviewEntry = {
	id: "call-2",
	scope: allCommitsScope,
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(() => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function turnOf(reviews: readonly GitReviewEntry[] | undefined) {
	return {
		data: {
			get: (key: string) =>
				key === "git-review" && reviews !== undefined ? { reviews } : undefined,
		},
	};
}

function render(
	openReview:
		| ((sessionId: SessionId, scope: GitReviewScopeOrTarget) => void)
		| undefined,
	reviews: readonly GitReviewEntry[] | undefined,
): void {
	root.render(
		<Component
			sessionId={SessionId("session-1")}
			turn={turnOf(reviews)}
			openReview={openReview}
		/>,
	);
}

function card(): HTMLElement {
	const match = container.querySelector<HTMLElement>("[data-review-card]");
	assert(match, "Missing review card");
	return match;
}

test("renders nothing when the turn presented no review", async () => {
	await act(async () => render(() => {}, undefined));
	assert.equal(container.childElementCount, 0);
});

test("shows the branch and commit line and opens the scope", async () => {
	const openReview = vi.fn();
	await act(async () => render(openReview, [commitReview]));
	assert.match(container.textContent, /feature\/auth/);
	assert.match(
		container.textContent,
		/1234567 — Reject outer shell evaluation/,
	);
	await act(async () => card().click());
	expect(openReview).toHaveBeenCalledExactlyOnceWith(
		SessionId("session-1"),
		commitScope,
	);
});

test("labels an all-commits scope", async () => {
	const openReview = vi.fn();
	await act(async () => render(openReview, [allCommitsReview]));
	assert.match(container.textContent, /feature\/other/);
	assert.match(container.textContent, /All commits/);
	await act(async () => card().click());
	expect(openReview).toHaveBeenCalledExactlyOnceWith(
		SessionId("session-1"),
		allCommitsScope,
	);
});

test("renders presentation-only card when openReview is undefined", async () => {
	await act(async () => render(undefined, [commitReview]));
	assert.match(container.textContent, /feature\/auth/);
	assert.match(
		container.textContent,
		/1234567 — Reject outer shell evaluation/,
	);
	assert.equal(container.querySelector("[data-clickable='true']"), null);
});

test("renders review target without commit subject and opens it", async () => {
	const openReview = vi.fn();
	const targetReview: GitReviewEntry = {
		id: "call-3",
		scope: {
			repository: "/repo",
			branch: "feature/target",
			commit: "abcdef1234567890",
		},
	};
	await act(async () => render(openReview, [targetReview]));
	assert.match(container.textContent, /feature\/target/);
	assert.match(container.textContent, /abcdef1/);
	await act(async () => card().click());
	expect(openReview).toHaveBeenCalledExactlyOnceWith(
		SessionId("session-1"),
		targetReview.scope,
	);
});

test("resolves review target via useChat fallback when turn data is empty", async () => {
	const openReview = vi.fn();
	const target = {
		repository: "/repo",
		branch: "feature/fallback-branch",
		commit: "9876543210abcdef",
	};
	const fakeSnapshot = {
		locations: {
			getTurn: () => ["node-1"],
		},
		nodes: {
			get: (key: string) =>
				key === "node-1"
					? {
							kind: "tool-call",
							data: {
								root: {
									callId: "call-fallback-1",
									isError: false,
									call: {
										name: "git_review_present",
										argsRaw: JSON.stringify(target),
									},
								},
							},
						}
					: undefined,
		},
	};
	const useChat = vi.fn((selector) => selector(fakeSnapshot));

	await act(async () => {
		root.render(
			<Component
				sessionId={SessionId("session-1")}
				turn={{ turn: 1, data: { get: () => undefined } }}
				openReview={openReview}
				useChat={useChat}
			/>,
		);
	});
	assert.match(container.textContent, /feature\/fallback-branch/);
	assert.match(container.textContent, /9876543/);
	await act(async () => card().click());
	expect(openReview).toHaveBeenCalledExactlyOnceWith(
		SessionId("session-1"),
		target,
	);
});

test("renders presentation-only card when canOpen returns false", async () => {
	const openReview = vi.fn();
	await act(async () => {
		root.render(
			<Component
				sessionId={SessionId("session-1")}
				turn={turnOf([commitReview])}
				openReview={openReview}
				canOpen={() => false}
			/>,
		);
	});
	assert.match(container.textContent, /feature\/auth/);
	assert.equal(container.querySelector("[data-clickable='true']"), null);
});
