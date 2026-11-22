import assert from "node:assert/strict";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SplitState } from "@lukstei/dsh-client-split-view/client-contract";
import type { ComponentProps, MouseEvent, PointerEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InFlightSidebar } from "../src/client/InFlightSidebar.tsx";
import { deriveKanbanBoard } from "../src/client/store.ts";
import { useKanban } from "../src/client/use-kanban.ts";

const toggleSession = vi.fn();
const toggleMaximize = vi.fn();
const removeSession = vi.fn();
const setHoveredSession = vi.fn();
const selectSession = vi.fn();

const ui = vi.hoisted(() => ({
	jsx: vi.fn((_type: unknown, _props: unknown) => null),
}));

vi.mock("react", () => ({
	useState: (initial: unknown) => [
		typeof initial === "function" ? initial() : initial,
		vi.fn(),
	],
	useEffect: () => {},
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
		getSnapshot(),
}));

vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: (...args: unknown[]) => {
		ui.jsx(args[0], args[1]);
		return { type: args[0], props: args[1] };
	},
	Fragment: Symbol.for("react.fragment"),
}));

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	Menu: "Menu",
	IconCloseOutlineRegular: "IconCloseOutlineRegular",
	IconFullscreenOutlineRegular: "IconFullscreenOutlineRegular",
}));

vi.mock("../src/client/use-kanban.ts", () => ({
	useKanban: vi.fn(),
}));

describe("InFlightSidebar fullscreen activation and toggle", () => {
	const sess1 = "sess-1" as SessionId;
	const sess2 = "sess-2" as SessionId;

	beforeEach(() => {
		vi.clearAllMocks();
		ui.jsx.mockClear();
	});

	const renderSidebar = (
		options: {
			sessionIds?: SessionId[];
			maximizedSessionId?: SessionId;
			wide?: boolean;
			suspended?: boolean;
			activeSessionId?: SessionId;
		} = {},
	) => {
		const {
			sessionIds = [sess1],
			maximizedSessionId = undefined,
			wide = true,
			suspended = false,
			activeSessionId,
		} = options;

		const s1: SessionSummary = {
			id: sess1,
			displayTitle: "Task 1",
			running: false,
			blank: false,
			updatedAt: 1000,
			retainedBy: activeSessionId === sess1 ? { mainView: 1 } : {},
			projectionValues: {
				kanban: { sessionId: sess1, createdAt: 1000, links: [] },
			},
		};
		const s2: SessionSummary = {
			id: sess2,
			displayTitle: "Task 2",
			running: false,
			blank: false,
			updatedAt: 1000,
			retainedBy: activeSessionId === sess2 ? { mainView: 1 } : {},
			projectionValues: {
				kanban: { sessionId: sess2, createdAt: 1000, links: [] },
			},
		};

		const list = {
			ids: [sess1, sess2],
			byId: { [sess1]: s1, [sess2]: s2 },
			phase: "ready" as const,
			projectionsBySession: {},
		};
		const workspaces: WorkspaceSnapshot = {
			items: [],
			archivedSessionIds: [],
			pinnedSessionIds: [],
			state: "idle",
			phase: "ready",
			error: null,
		};
		const status = new Map<SessionId, never>();
		vi.mocked(useKanban).mockReturnValue(
			deriveKanbanBoard(list, [], status, 1_000_000_000),
		);

		const mockNavigation = {
			getSnapshot: (): SplitState => ({
				sessionIds,
				focusedSessionId: sessionIds[0],
				maximizedSessionId,
				hoveredSessionId: undefined,
				suspended,
				overlays: new Map(),
			}),
			subscribe: () => () => {},
			toggleSession,
			removeSession,
			toggleMaximize,
			setHoveredSession,
		};

		return InFlightSidebar({
			wide,
			expandSidebar: () => {},
			sessionsList: { getSnapshot: () => list, subscribe: () => () => {} },
			workspacesList: {
				getSnapshot: () => workspaces,
				subscribe: () => () => {},
			},
			sessionStatus: { getSnapshot: () => status, subscribe: () => () => {} },
			selectSession,
			selectPanel: () => {},
			searchSessions: async () => ({
				ok: true,
				value: { items: [], hasMore: false },
			}),
			searchResultLimit: 20,
			startTask: async () => {},
			prepareTask: async () => {},
			startPreparedTask: async () => {},
			markDone: async () => {},
			reopen: async () => {},
			deleteSession: async () => {},
			holdSession: async () => {},
			unholdSession: async () => {},
			pinSession: async () => {},
			unpinSession: async () => {},
			navigation: mockNavigation,
		});
	};

	const cardClasses = (): string[] =>
		ui.jsx.mock.calls
			.map(([, props]) => String((props as ComponentProps<"div">).className))
			.filter((className) => className.startsWith("dsh-inflight-card "));

	const button = (label: string): ComponentProps<"button"> => {
		const match = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "button" &&
				(props as ComponentProps<"button">)["aria-label"] === label,
		);
		assert(match);
		return match[1] as ComponentProps<"button">;
	};

	it("highlights all split members while distinguishing the focused session", () => {
		renderSidebar({ sessionIds: [sess1, sess2] });
		expect(
			cardClasses().map((name) => ({
				current: name.includes("is-current"),
				focused: name.includes("is-focused"),
				closable: name.includes("has-slot-close"),
			})),
		).toEqual([
			{ current: true, focused: true, closable: true },
			{ current: true, focused: false, closable: true },
		]);
	});

	it("dispatches one selection then one maximize for a native double-click sequence", () => {
		renderSidebar({ sessionIds: [sess1, sess2] });
		const target = button("Task 1 (In Review)");
		assert(target.onClick);
		assert(target.onDoubleClick);
		// edge case: React handlers consume only these browser event fields.
		const event = (detail: number) =>
			({
				detail,
				metaKey: false,
				ctrlKey: false,
				stopPropagation: vi.fn(),
			}) as unknown as MouseEvent<HTMLButtonElement>;
		target.onClick(event(1));
		expect(selectSession).toHaveBeenCalledExactlyOnceWith(sess1);
		target.onClick(event(2));
		target.onDoubleClick(event(2));
		expect(selectSession).toHaveBeenCalledTimes(1);
		expect(toggleMaximize).toHaveBeenCalledExactlyOnceWith(sess1);
		expect(toggleSession).not.toHaveBeenCalled();
	});

	it("double-clicking a maximized row toggles back to the split layout", () => {
		renderSidebar({ sessionIds: [sess1, sess2], maximizedSessionId: sess1 });
		const target = button("Task 1 (In Review)");
		assert(target.onDoubleClick);
		// edge case: the handler consumes only the gesture modifiers and propagation action.
		target.onDoubleClick({
			stopPropagation: vi.fn(),
			metaKey: false,
			ctrlKey: false,
		} as unknown as MouseEvent<HTMLButtonElement>);
		expect(toggleMaximize).toHaveBeenCalledExactlyOnceWith(sess1);
	});

	it("does not cancel rapid selections of different rows, including keyboard activation", () => {
		renderSidebar();
		for (const label of ["Task 1 (In Review)", "Task 2 (In Review)"]) {
			const target = button(label);
			assert(target.onClick);
			// edge case: keyboard-generated button clicks have detail zero.
			target.onClick({
				detail: 0,
				metaKey: false,
				ctrlKey: false,
			} as MouseEvent<HTMLButtonElement>);
		}
		expect(selectSession.mock.calls).toEqual([[sess1], [sess2]]);
	});

	it.each(["metaKey", "ctrlKey"] as const)(
		"modified clicks toggle once and never maximize (%s)",
		(modifier) => {
			renderSidebar();
			const target = button("Task 1 (In Review)");
			assert(target.onClick);
			assert(target.onDoubleClick);
			// edge case: React handlers consume only these browser event fields.
			const event = {
				detail: 1,
				[modifier]: true,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
			} as unknown as MouseEvent<HTMLButtonElement>;
			target.onClick(event);
			target.onDoubleClick(event);
			expect(toggleSession).toHaveBeenCalledExactlyOnceWith(sess1);
			expect(selectSession).not.toHaveBeenCalled();
			expect(toggleMaximize).not.toHaveBeenCalled();
		},
	);

	it("renders a shared centered slot and restores without selecting the row", () => {
		renderSidebar({ sessionIds: [sess1, sess2], maximizedSessionId: sess1 });
		const restore = button("Restore split layout for Task 1");
		expect(restore.className).toContain("dsh-inflight-card-slot");
		expect(restore.className).toContain("is-active");
		expect(restore.className).toContain("is-pressed");
		expect(restore["aria-pressed"]).toBe("true");
		assert(restore.onClick);
		// edge case: the button handler only consumes stopPropagation.
		restore.onClick({
			stopPropagation: vi.fn(),
		} as unknown as MouseEvent<HTMLButtonElement>);
		expect(toggleMaximize).toHaveBeenCalledExactlyOnceWith(sess1);
		expect(selectSession).not.toHaveBeenCalled();
	});

	it("keeps the status indicator until a pane is maximized", () => {
		renderSidebar();
		expect(
			ui.jsx.mock.calls.some(
				([type, props]) =>
					type === "button" &&
					(props as ComponentProps<"button">).title === "Restore split layout",
			),
		).toBe(false);
	});

	it("closes a split pane from the row slot without selecting or maximizing it", () => {
		renderSidebar({ sessionIds: [sess1, sess2] });
		const close = button("Close Task 1 in split view");
		expect(cardClasses()[0]).toContain("has-slot-close");
		assert(close.onClick);
		// edge case: the button handler only consumes stopPropagation.
		close.onClick({
			stopPropagation: vi.fn(),
		} as unknown as MouseEvent<HTMLButtonElement>);
		expect(removeSession).toHaveBeenCalledExactlyOnceWith(sess1);
		expect(selectSession).not.toHaveBeenCalled();
		expect(toggleMaximize).not.toHaveBeenCalled();
	});

	it("offers no split-pane close button outside split view", () => {
		renderSidebar({ sessionIds: [] });
		expect(cardClasses()[0]).not.toContain("has-slot-close");
		expect(
			ui.jsx.mock.calls.some(
				([type, props]) =>
					type === "button" &&
					String((props as ComponentProps<"button">).className).includes(
						"dsh-inflight-btn-slot-close",
					),
			),
		).toBe(false);
	});

	const cardProps = (): ComponentProps<"div"> => {
		const match = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "div" &&
				String((props as ComponentProps<"div">).className).startsWith(
					"dsh-inflight-card ",
				),
		);
		assert(match);
		return match[1] as ComponentProps<"div">;
	};

	it("highlights the matching pane while a split row is hovered", () => {
		renderSidebar({ sessionIds: [sess1, sess2] });
		const card = cardProps();
		assert(card.onPointerEnter);
		assert(card.onPointerLeave);
		// edge case: the handlers ignore the pointer event payload entirely.
		const event = {} as unknown as PointerEvent<HTMLDivElement>;
		card.onPointerEnter(event);
		expect(setHoveredSession).toHaveBeenCalledExactlyOnceWith(sess1);
		card.onPointerLeave(event);
		expect(setHoveredSession).toHaveBeenLastCalledWith(undefined);
	});

	it("leaves the split view unhighlighted for rows outside it", () => {
		renderSidebar({ sessionIds: [] });
		const card = cardProps();
		assert(card.onPointerEnter);
		card.onPointerEnter({} as unknown as PointerEvent<HTMLDivElement>);
		expect(setHoveredSession).not.toHaveBeenCalled();
	});

	it("replaces the restore button with the close button only while maximized", () => {
		renderSidebar({ sessionIds: [sess1], maximizedSessionId: sess1 });
		expect(cardClasses()[0]).not.toContain("has-slot-close");
		expect(
			ui.jsx.mock.calls.some(
				([type, props]) =>
					type === "button" &&
					String((props as ComponentProps<"button">).className).includes(
						"dsh-inflight-btn-slot-close",
					),
			),
		).toBe(false);
	});

	it("does not leak is-current, close button, or fullscreen controls when split is suspended", () => {
		renderSidebar({
			sessionIds: [sess1, sess2],
			maximizedSessionId: sess1,
			suspended: true,
			activeSessionId: sess2,
		});
		const classes = cardClasses();
		// Only the active native session (sess2) gets is-current, dormant sess1 does not
		expect(classes[0]).not.toContain("is-current");
		expect(classes[0]).not.toContain("has-slot-close");
		expect(classes[1]).toContain("is-current");

		// Fullscreen restore button is suppressed while suspended
		expect(
			ui.jsx.mock.calls.some(
				([type, props]) =>
					type === "button" &&
					String((props as ComponentProps<"button">).className).includes(
						"dsh-inflight-btn-fullscreen-toggle",
					),
			),
		).toBe(false);
	});
});
