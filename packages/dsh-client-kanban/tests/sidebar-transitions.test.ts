const toggleSession = vi.fn();
const mockSplitView = {
	getSnapshot: (): SplitState => ({
		sessionIds: [],
		focusedSessionId: undefined,
		maximizedSessionId: undefined,
		hoveredSessionId: undefined,
		suspended: false,
		overlays: new Map(),
	}),
	subscribe: () => () => {},
	isSuspended: () => false,
	isSplitActive: () => false,
	toggleSession,
	openSession: () => {},
	removeSession: () => {},
	setHoveredSession: () => {},
	resetToSingle: () => {},
	suspend: () => {},
	resume: () => {},
	setFocus: () => {},
	toggleMaximize: () => {},
	reorderSession: () => {},
};

import assert from "node:assert/strict";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SplitState } from "@lukstei/dsh-client-split-view/client-contract";
import type { ComponentProps, MouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InFlightSidebar } from "../src/client/InFlightSidebar.tsx";
import { KanbanStatusDot } from "../src/client/KanbanStatusDot.tsx";
import { deriveKanbanBoard } from "../src/client/store.ts";
import { useKanban } from "../src/client/use-kanban.ts";

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
}));

vi.mock("../src/client/use-kanban.ts", () => ({
	useKanban: vi.fn(),
}));

describe("InFlightSidebar transition buttons", () => {
	const sessionId = "sess-1" as SessionId;
	const holdSession = vi.fn(async () => {});
	const markDone = vi.fn(async () => {});
	const selectSession = vi.fn();

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		ui.jsx.mockClear();
	});

	const renderSidebar = (running: boolean, wide = true) => {
		const session: SessionSummary = {
			id: sessionId,
			displayTitle: "Task in flight",
			running,
			blank: false,
			updatedAt: 1000,
			retainedBy: {},
			projectionValues: {
				kanban: {
					sessionId,
					createdAt: 1000,
					links: [],
				},
			},
		};
		const list = {
			ids: [sessionId],
			byId: { [sessionId]: session },
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
			markDone,
			reopen: async () => {},
			deleteSession: async () => {},
			holdSession,
			unholdSession: async () => {},
			pinSession: async () => {},
			unpinSession: async () => {},
			navigation: mockSplitView,
		});
	};

	it.each([true, false])(
		"marks only the focused session as current (wide=%s)",
		(wide) => {
			let snapshot: SplitState = {
				sessionIds: [sessionId, "other" as SessionId],
				focusedSessionId: sessionId,
				maximizedSessionId: undefined,
				hoveredSessionId: undefined,
				suspended: false,
				overlays: new Map(),
			};
			vi.spyOn(mockSplitView, "getSnapshot").mockImplementation(() => snapshot);
			const current = () =>
				ui.jsx.mock.calls
					.filter(
						([type, props]) =>
							type === "button" &&
							(props as ComponentProps<"button">)["aria-current"] === "true",
					)
					.map(
						([, props]) => (props as ComponentProps<"button">)["aria-label"],
					);
			renderSidebar(false, wide);
			expect(current()).toEqual(["Task in flight (In Review)"]);
			expect(
				ui.jsx.mock.calls.some(
					([type, props]) =>
						type === KanbanStatusDot &&
						(props as ComponentProps<typeof KanbanStatusDot>).state ===
							"review",
				),
			).toBe(true);
			ui.jsx.mockClear();
			snapshot = { ...snapshot, focusedSessionId: "other" as SessionId };
			renderSidebar(false, wide);
			expect(current()).toEqual([]);
		},
	);

	it("renders hold and done buttons and dispatches actions for review sessions", () => {
		renderSidebar(false);

		const buttons = ui.jsx.mock.calls
			.filter(
				([type, props]) =>
					type === "button" &&
					typeof props === "object" &&
					props !== null &&
					"className" in props &&
					typeof (props as { className?: unknown }).className === "string" &&
					(props as { className: string }).className.includes(
						"dsh-inflight-btn-action",
					),
			)
			.map(([, props]) => props as ComponentProps<"button">);

		const holdBtn = buttons.find((b) => b.className?.includes("is-hold"));
		const doneBtn = buttons.find((b) => b.className?.includes("is-done"));

		assert(holdBtn);
		assert(doneBtn);
		expect(holdBtn.disabled).toBe(false);
		expect(doneBtn.disabled).toBe(false);
		expect(holdBtn["aria-label"]).toBe("Put on hold");
		expect(doneBtn["aria-label"]).toBe("Mark task done");

		const stopPropagation = vi.fn();
		const event = {
			stopPropagation,
		} as unknown as MouseEvent<HTMLButtonElement>;

		assert(holdBtn.onClick);
		holdBtn.onClick(event);
		expect(holdSession).toHaveBeenCalledWith(sessionId);
		expect(stopPropagation).toHaveBeenCalledOnce();

		stopPropagation.mockClear();
		assert(doneBtn.onClick);
		doneBtn.onClick(event);
		expect(markDone).toHaveBeenCalledWith(sessionId);
		expect(stopPropagation).toHaveBeenCalledOnce();
		expect(selectSession).not.toHaveBeenCalled();
	});

	it("disables transition buttons when the session is in progress", () => {
		renderSidebar(true);

		const buttons = ui.jsx.mock.calls
			.filter(
				([type, props]) =>
					type === "button" &&
					typeof props === "object" &&
					props !== null &&
					"className" in props &&
					typeof (props as { className?: unknown }).className === "string" &&
					(props as { className: string }).className.includes(
						"dsh-inflight-btn-action",
					),
			)
			.map(([, props]) => props as ComponentProps<"button">);

		const holdBtn = buttons.find((b) => b.className?.includes("is-hold"));
		const doneBtn = buttons.find((b) => b.className?.includes("is-done"));

		assert(holdBtn);
		assert(doneBtn);
		expect(holdBtn.disabled).toBe(true);
		expect(doneBtn.disabled).toBe(true);
		expect(holdBtn.className).toContain("is-disabled");
		expect(doneBtn.className).toContain("is-disabled");
		expect(holdBtn["aria-label"]).toBe("Session is in progress");
		expect(doneBtn["aria-label"]).toBe("Session is in progress");

		const stopPropagation = vi.fn();
		const event = {
			stopPropagation,
		} as unknown as MouseEvent<HTMLButtonElement>;

		assert(holdBtn.onClick);
		holdBtn.onClick(event);
		expect(holdSession).not.toHaveBeenCalled();

		assert(doneBtn.onClick);
		doneBtn.onClick(event);
		expect(markDone).not.toHaveBeenCalled();
	});

	it("selects immediately on single click in expanded sidebar", () => {
		renderSidebar(false, true);

		const button = ui.jsx.mock.calls
			.filter(
				([type, props]) =>
					type === "button" &&
					typeof props === "object" &&
					props !== null &&
					"className" in props &&
					(props as { className?: unknown }).className ===
						"dsh-inflight-card-main",
			)
			.map(([, props]) => props as ComponentProps<"button">)[0];

		assert(button);
		assert(button.onClick);
		button.onClick({} as MouseEvent<HTMLButtonElement>);
		expect(selectSession).toHaveBeenCalledWith(sessionId);
		expect(toggleSession).not.toHaveBeenCalled();
	});

	it("preserves rail behavior: single click selects, command-click toggles split view", () => {
		renderSidebar(false, false);

		const dotButton = ui.jsx.mock.calls
			.filter(
				([type, props]) =>
					type === "button" &&
					typeof props === "object" &&
					props !== null &&
					"className" in props &&
					typeof (props as { className?: unknown }).className === "string" &&
					(props as { className: string }).className.includes(
						"dsh-inflight-rail-session-dot",
					),
			)
			.map(([, props]) => props as ComponentProps<"button">)[0];

		assert(dotButton);
		assert(dotButton.onClick);

		// Plain click -> selects session
		dotButton.onClick({
			metaKey: false,
			ctrlKey: false,
		} as MouseEvent<HTMLButtonElement>);
		expect(selectSession).toHaveBeenCalledWith(sessionId);
		expect(toggleSession).not.toHaveBeenCalled();

		selectSession.mockClear();

		// Cmd-click -> toggles split view
		const preventDefault = vi.fn();
		dotButton.onClick({
			metaKey: true,
			ctrlKey: false,
			preventDefault,
		} as unknown as MouseEvent<HTMLButtonElement>);
		expect(preventDefault).toHaveBeenCalledOnce();
		expect(toggleSession).toHaveBeenCalledWith(sessionId);
		expect(selectSession).not.toHaveBeenCalled();
	});
});
