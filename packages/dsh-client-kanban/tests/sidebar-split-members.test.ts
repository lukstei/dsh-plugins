import assert from "node:assert/strict";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type {
	WorkspaceId,
	WorkspaceSnapshot,
} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ComponentProps, MouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InFlightSidebar } from "../src/client/InFlightSidebar.tsx";
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
	IconFullscreenOutlineRegular: "IconFullscreenOutlineRegular",
	IconRefreshOutlineRegular: "IconRefreshOutlineRegular",
}));

vi.mock("../src/client/use-kanban.ts", () => ({
	useKanban: vi.fn(),
}));

const now = 1_000_000_000;
const activeId = "s-active" as SessionId;
const doneId = "s-done" as SessionId;

const sActive: SessionSummary = {
	id: activeId,
	displayTitle: "Task active",
	running: true,
	blank: false,
	updatedAt: 1000,
	retainedBy: {},
	projectionValues: {
		kanban: { links: [], sessionId: activeId, createdAt: now },
	},
};
const sDone: SessionSummary = {
	id: doneId,
	displayTitle: "Task done",
	running: false,
	blank: false,
	updatedAt: 1000,
	retainedBy: {},
	projectionValues: {
		kanban: {
			links: [],
			sessionId: doneId,
			createdAt: now - 1000,
			doneAt: now,
		},
	},
};

const list = {
	ids: [activeId, doneId],
	byId: { [activeId]: sActive, [doneId]: sDone },
	phase: "ready" as const,
	projectionsBySession: {},
};
const workspaces: WorkspaceSnapshot = {
	items: [
		{
			workspaceId: "ws-1" as WorkspaceId,
			path: "/repo",
			title: "Repo",
			sessionIds: [activeId, doneId],
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		},
	],
	archivedSessionIds: [],
	pinnedSessionIds: [],
	state: "idle",
	phase: "ready",
	error: null,
};
const status = new Map<SessionId, never>();
const toggleSession = vi.fn();
const removeSession = vi.fn();
const toggleMaximize = vi.fn();
const selectSession = vi.fn();
const reopenSession = vi.fn();

const navigation = {
	getSnapshot: () => ({
		sessionIds: [doneId],
		focusedSessionId: doneId,
		maximizedSessionId: undefined,
		suspended: false,
		overlays: new Map(),
	}),
	subscribe: () => () => {},
	toggleSession,
	removeSession,
	toggleMaximize,
	setHoveredSession: () => {},
};

const renderSidebar = (wide: boolean) => {
	vi.mocked(useKanban).mockReturnValue(
		deriveKanbanBoard(list, workspaces.items, status, now, [doneId]),
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
		markDone: async () => {},
		reopen: async (id: SessionId) => {
			reopenSession(id);
		},
		deleteSession: async () => {},
		holdSession: async () => {},
		unholdSession: async () => {},
		pinSession: async () => {},
		unpinSession: async () => {},
		navigation,
	});
};

const buttons = () =>
	ui.jsx.mock.calls
		.filter(
			([type, props]) =>
				type === "button" && typeof props === "object" && props !== null,
		)
		.map(([, props]) => props as ComponentProps<"button">);

describe("InFlightSidebar closed split members", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ui.jsx.mockClear();
	});

	it("lists a closed pane session with a Done label in the expanded sidebar", () => {
		renderSidebar(true);

		const card = buttons().find(
			(button) =>
				button.className === "dsh-inflight-card-main" &&
				button["aria-label"] === "Task done (Done)",
		);
		assert(card);
		expect(card["aria-label"]).toBe("Task done (Done)");
	});

	it("dispatches selection and pane close for a closed pane session", () => {
		renderSidebar(true);

		const card = buttons().find(
			(button) =>
				button.className === "dsh-inflight-card-main" &&
				button["aria-label"] === "Task done (Done)",
		);
		assert(card?.onClick);
		card.onClick({
			detail: 1,
			metaKey: false,
			ctrlKey: false,
			preventDefault: () => {},
		} as unknown as MouseEvent<HTMLButtonElement>);
		expect(selectSession).toHaveBeenCalledWith(doneId);

		const close = buttons().find(
			(button) => button["aria-label"] === "Close Task done in split view",
		);
		assert(close?.onClick);
		close.onClick({
			stopPropagation: () => {},
		} as unknown as MouseEvent<HTMLButtonElement>);
		expect(removeSession).toHaveBeenCalledWith(doneId);
	});

	it("offers reopen instead of done and hold actions on a Done row", () => {
		renderSidebar(true);

		// The running row labels its actions "Session is in progress"; the Done row must not offer done/hold at all.
		expect(
			buttons().filter(
				(button) =>
					button["aria-label"] === "Mark task done" ||
					button["aria-label"] === "Put on hold",
			),
		).toHaveLength(0);
		expect(
			buttons().filter(
				(button) => button["aria-label"] === "Session is in progress",
			),
		).toHaveLength(2);

		const reopen = buttons().find(
			(button) => button["aria-label"] === "Reopen task",
		);
		assert(reopen?.onClick);
		reopen.onClick({
			stopPropagation: () => {},
		} as unknown as MouseEvent<HTMLButtonElement>);

		expect(reopenSession).toHaveBeenCalledWith(doneId);
		expect(removeSession).not.toHaveBeenCalled();
	});

	it("lists a closed pane session in the collapsed rail", () => {
		renderSidebar(false);

		const rail = buttons().find(
			(button) => button["aria-label"] === "Task done (Done)",
		);
		assert(rail);
		expect(rail.className).toContain("dsh-inflight-rail-session-dot");
	});

	it("renders 'New Session' fallback for a blank session whose displayTitle matches workspace", () => {
		const blankId = "s-blank" as SessionId;
		const sBlank: SessionSummary = {
			id: blankId,
			displayTitle: "Repo",
			cwd: "/repo",
			running: false,
			blank: true,
			updatedAt: 1000,
			retainedBy: {},
			projectionValues: {
				kanban: { links: [], sessionId: blankId, createdAt: now },
			},
		};
		const customList = {
			ids: [blankId],
			byId: { [blankId]: sBlank },
			phase: "ready" as const,
			projectionsBySession: {},
		};
		const customWorkspaces: WorkspaceSnapshot = {
			...workspaces,
			items: [
				{
					...workspaces.items[0],
					sessionIds: [blankId],
				},
			],
		};
		vi.mocked(useKanban).mockReturnValue(
			deriveKanbanBoard(customList, customWorkspaces.items, status, now, [
				blankId,
			]),
		);

		InFlightSidebar({
			wide: true,
			expandSidebar: () => {},
			sessionsList: {
				getSnapshot: () => customList,
				subscribe: () => () => {},
			},
			workspacesList: {
				getSnapshot: () => customWorkspaces,
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
			navigation,
		});

		const card = buttons().find(
			(button) =>
				button.className === "dsh-inflight-card-main" &&
				button["aria-label"]?.startsWith("New Session"),
		);
		assert(card);
		expect(card["aria-label"]).toBe("New Session (On Hold)");
	});
});
