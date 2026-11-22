// @vitest-environment happy-dom
import type { ReviewScope } from "@lukstei/util-review-ui/types";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
	REVIEW_STORAGE_PREFIX,
	readPersistedReviewState,
	useReviewViewState,
	writePersistedReviewState,
} from "./useReviewViewState.ts";

describe("useReviewViewState persistence", () => {
	const sessionId = "session-test-review-1";

	beforeEach(() => {
		try {
			localStorage.removeItem(`${REVIEW_STORAGE_PREFIX}${sessionId}`);
		} catch {
			// ignore
		}
	});

	it("writes and reads persisted review state", () => {
		const scope: ReviewScope = {
			kind: "branch",
			repository: "/workspace/repo",
			ref: "refs/heads/feature/x",
			base: { kind: "automatic" },
			revision: { kind: "all-commits" },
		};

		writePersistedReviewState(sessionId, {
			selectedRepoCwd: "/workspace/repo",
			scope,
			expandedPaths: ["src/index.ts"],
			scrollTop: 120,
			wrapped: true,
		});

		const restored = readPersistedReviewState(sessionId);
		expect(restored).not.toBeNull();
		expect(restored?.selectedRepoCwd).toBe("/workspace/repo");
		expect(restored?.scope).toEqual(scope);
		expect(restored?.expandedPaths).toEqual(["src/index.ts"]);
		expect(restored?.scrollTop).toBe(120);
		expect(restored?.wrapped).toBe(true);
	});

	it("rejects corrupted scope objects when deserializing", () => {
		localStorage.setItem(
			`${REVIEW_STORAGE_PREFIX}${sessionId}`,
			JSON.stringify({
				version: 1,
				selectedRepoCwd: "/workspace/repo",
				scope: { kind: "branch" }, // missing repository, ref, etc.
				expandedPaths: [],
				scrollTop: 0,
				wrapped: false,
				updatedAt: Date.now(),
			}),
		);

		const restored = readPersistedReviewState(sessionId);
		expect(restored).not.toBeNull();
		expect(restored?.scope).toBeNull();
	});

	it("prioritizes explicit initialScope over persisted scope and resets expanded paths/scroll", async () => {
		const persistedScope: ReviewScope = {
			kind: "branch",
			repository: "/workspace/repo",
			ref: "refs/heads/feature/old",
			base: { kind: "automatic" },
			revision: { kind: "all-commits" },
		};

		writePersistedReviewState(sessionId, {
			selectedRepoCwd: "/workspace/repo",
			scope: persistedScope,
			expandedPaths: ["old/file.ts"],
			scrollTop: 500,
			wrapped: false,
		});

		const explicitScope: ReviewScope = {
			kind: "branch",
			repository: "/workspace/repo",
			ref: "refs/heads/feature/new",
			base: { kind: "automatic" },
			revision: { kind: "all-commits" },
		};

		let currentResult!: ReturnType<typeof useReviewViewState>;
		function TestComponent() {
			currentResult = useReviewViewState(sessionId, explicitScope);
			return null;
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(createElement(TestComponent));
		});

		expect(currentResult.scope).toEqual(explicitScope);
		expect(currentResult.expandedPaths.size).toBe(0);
		expect(currentResult.scrollTop).toBe(0);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
