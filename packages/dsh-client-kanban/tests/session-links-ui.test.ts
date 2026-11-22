const mockSplitView = {
	getSnapshot: () => ({
		sessionIds: [],
		focusedSessionId: undefined,
		maximizedSessionId: undefined,
		suspended: false,
		hoveredSessionId: undefined,
		overlays: new Map(),
	}),
	subscribe: () => () => {},
	isSuspended: () => false,
	isSplitActive: () => false,
	toggleSession: () => {},
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
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ComponentProps, DragEvent } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InFlightSidebar } from "../src/client/InFlightSidebar.tsx";
import { KanbanCard } from "../src/client/KanbanCard.tsx";
import { SessionLinks } from "../src/client/SessionLinks.tsx";
import { deriveKanbanBoard } from "../src/client/store.ts";
import { useKanban } from "../src/client/use-kanban.ts";

const ui = vi.hoisted(() => ({
	open: false,
	setOpen: vi.fn(),
	jsx: vi.fn((_type: unknown, _props: unknown) => null),
}));
vi.mock("react", () => ({
	useState: (initial: unknown) => [
		initial === false ? ui.open : 1_000_000_000,
		ui.setOpen,
	],
	useEffect: () => {},
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
		getSnapshot(),
}));
vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: ui.jsx,
	Fragment: Symbol.for("react.fragment"),
}));
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	Menu: "Menu",
	IconCloseOutlineRegular: "IconCloseOutlineRegular",
}));
vi.mock("../src/client/use-kanban.ts", () => ({ useKanban: vi.fn() }));

const links = [
	{ label: "Issue", url: "https://jira.example/ABC-1", priority: 0 },
	{ label: "Review", url: "https://github.example/pull/2", priority: 0 },
];

function menuProps() {
	const call = ui.jsx.mock.calls.find(([type]) => type === Menu);
	assert(call);
	// edge case: JSX fixture props are erased at capture and recovered by component identity
	return call[1] as ComponentProps<typeof Menu>;
}

beforeEach(() => {
	ui.open = false;
	ui.jsx.mockClear();
	ui.setOpen.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

test.each([
	{ entries: [] },
	{ entries: links.slice(0, 1) },
	{ entries: links },
])("shows the collected URLs behind an icon for $entries", ({ entries }) => {
	const result = SessionLinks({ links: entries });
	if (entries.length === 0) {
		expect(result).toBe(false);
		expect(ui.jsx).not.toHaveBeenCalled();
		return;
	}
	const menu = menuProps();
	assert(menu.items !== undefined);
	expect(
		ui.jsx.mock.calls
			.filter(([type]) => type === "span")
			.map(([, props]) => props),
	).toEqual(
		entries.map((entry) => ({
			className: "dsh-session-link",
			children: entry.label,
		})),
	);
	expect({
		open: menu.open,
		portal: menu.portal,
		compact: menu.compact,
		align: menu.align,
		ids: menu.items.map((item) => item.id),
	}).toEqual({
		open: false,
		portal: true,
		compact: true,
		align: "end",
		ids: entries.map((entry) => entry.url),
	});
	const trigger = ui.jsx.mock.calls.find(([type]) => type === "button");
	assert(trigger);
	// edge case: JSX fixture props are recovered by component identity
	const props = trigger[1] as ComponentProps<"button">;
	expect(props.className).toBe(
		"dsh-inflight-btn-action dsh-session-links-trigger",
	);
	const icon = ui.jsx.mock.calls.find(([type]) => type === "svg");
	assert(icon);
	expect(icon[1]).toMatchObject({
		width: "14",
		height: "14",
		viewBox: "0 0 24 24",
		strokeWidth: "2",
	});
	expect(props["aria-label"]).toBe(`Session links (${entries.length})`);
	expect(props["aria-haspopup"]).toBe("menu");
	expect(props["aria-expanded"]).toBe(false);
	const stopPropagation = vi.fn();
	const preventDefault = vi.fn();
	// edge case: this event fixture supplies the methods consumed by the trigger
	const event = {
		stopPropagation,
		preventDefault,
	} as unknown as DragEvent<HTMLButtonElement>;
	assert(props.onClick);
	assert(props.onDragStart);
	props.onClick(event);
	expect(ui.setOpen).toHaveBeenCalledWith(true);
	props.onDragStart(event);
	expect(stopPropagation).toHaveBeenCalledTimes(2);
	expect(preventDefault).toHaveBeenCalledOnce();
});

test("opens selected URLs safely, closes, and renders updated projections", () => {
	const open = vi.fn();
	vi.stubGlobal("window", { open });
	ui.open = true;
	SessionLinks({ links });
	const menu = menuProps();
	assert(menu.onSelect);
	menu.onSelect(links[1].url);
	expect(open).toHaveBeenCalledWith(
		links[1].url,
		"_blank",
		"noopener,noreferrer",
	);
	expect(ui.setOpen).toHaveBeenCalledWith(false);
	menu.onClose();
	expect(ui.setOpen).toHaveBeenCalledTimes(2);
	ui.jsx.mockClear();
	SessionLinks({ links: [{ ...links[0], label: "Updated issue" }] });
	expect(menuProps().items).toHaveLength(1);
	expect(
		ui.jsx.mock.calls.some(
			([, props]) =>
				typeof props === "object" &&
				props !== null &&
				"children" in props &&
				props.children === "Updated issue",
		),
	).toBe(true);
});

test("both card surfaces use the same collected-link component", () => {
	// edge case: fixture ID uses DSH's branded session identity
	const id = "linked" as SessionId;
	const session: SessionSummary = {
		id,
		displayTitle: "Linked task",
		running: false,
		blank: false,
		updatedAt: 1000,
		retainedBy: {},
		projectionValues: { kanban: { sessionId: id, createdAt: 1000, links } },
	};
	const onSelect = vi.fn();
	KanbanCard({ session, lane: "review", isSelected: false, onSelect });
	expect(
		ui.jsx.mock.calls
			.filter(([type]) => type === SessionLinks)
			.map(([, props]) => props),
	).toEqual([{ links }]);
	ui.jsx.mockClear();
	const list = {
		ids: [id],
		byId: { [id]: session },
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
	InFlightSidebar({
		wide: true,
		expandSidebar: () => {},
		sessionsList: { getSnapshot: () => list, subscribe: () => () => {} },
		workspacesList: {
			getSnapshot: () => workspaces,
			subscribe: () => () => {},
		},
		sessionStatus: { getSnapshot: () => status, subscribe: () => () => {} },
		selectSession: onSelect,
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
		navigation: mockSplitView,
	});
	expect(
		ui.jsx.mock.calls
			.filter(([type]) => type === SessionLinks)
			.map(([, props]) => props),
	).toEqual([{ links }]);
	expect(onSelect).not.toHaveBeenCalled();
});
