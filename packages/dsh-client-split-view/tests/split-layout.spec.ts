import { SessionId } from "@deepseek-ai/dsh-session/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dom = vi.hoisted(() => ({
	scrollers: [{ scrollTop: 700 }, { scrollTop: 1100 }, { scrollTop: 3000 }],
	query: vi.fn(),
}));

vi.mock("react", () => ({
	Component: class<P> {
		constructor(public props: P) {}
	},
	createRef: () => ({ current: { querySelectorAll: dom.query } }),
}));
vi.mock("react/jsx-dev-runtime", () => ({ jsxDEV: () => null }));

import { SplitLayout } from "../src/client/SplitLayout.tsx";

const a = SessionId("a");
const b = SessionId("b");

describe("split layout scroll preservation", () => {
	beforeEach(() => {
		dom.scrollers = [
			{ scrollTop: 700 },
			{ scrollTop: 1100 },
			{ scrollTop: 3000 },
		];
		dom.query.mockReset().mockImplementation(() => dom.scrollers);
	});

	it.each([
		[a, b],
		[b, a],
	])("preserves both scrollports when moving %s past %s", (source, target) => {
		const previous = { sessionIds: [source, target], children: null };
		const layout = new SplitLayout({
			sessionIds: [target, source],
			children: null,
		});
		const snapshot = layout.getSnapshotBeforeUpdate(previous);
		// edge case: Chromium resets the moved pane during DOM insertion without a JavaScript scroll write
		dom.scrollers[0].scrollTop = 0;
		dom.scrollers[2].scrollTop = 0;
		layout.componentDidUpdate(previous, {}, snapshot);
		expect(dom.query).toHaveBeenCalledWith(
			"[data-conversation-scroll], .dsh-split-file",
		);
		expect(dom.scrollers).toMatchInlineSnapshot(`
			[
			  {
			    "scrollTop": 700,
			  },
			  {
			    "scrollTop": 1100,
			  },
			  {
			    "scrollTop": 3000,
			  },
			]
		`);
	});

	it.each([[a, b], [a], [a, b, SessionId("c")]])(
		"leaves non-reorder updates to the chat scroll owner: %j",
		(...sessionIds) => {
			const previous = { sessionIds: [a, b], children: null };
			const layout = new SplitLayout({ sessionIds, children: null });
			const snapshot = layout.getSnapshotBeforeUpdate(previous);
			expect(snapshot).toBeNull();
			dom.scrollers[0].scrollTop = 1200;
			layout.componentDidUpdate(previous, {}, snapshot);
			expect(dom.scrollers[0].scrollTop).toBe(1200);
			expect(dom.query).not.toHaveBeenCalled();
		},
	);
});
