import type {
	ISessions,
	SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplitPaneHeader } from "../src/client/SplitPaneHeader.tsx";
import { splitStore } from "../src/client/split-store.ts";

const ui = vi.hoisted(() => ({
	open: false,
	setOpen: vi.fn(),
	jsx: vi.fn((_type: unknown, _props: unknown) => null),
	renderSlot: vi.fn((name: string, props: { state?: string }) => ({
		type: name,
		props,
	})),
	sessionsState: {
		byId: {} as Record<string, SessionSummary>,
		projectionsBySession: {},
	},
	sessionState: {
		pendingSubmissions: [],
		running: false,
		blank: false,
		awaitingFirstTurn: false,
		promptAttempted: false,
		openState: "open",
	},
	statusState: new Map<string, { running?: boolean }>(),
	conversationState: {
		activeTargets: new Set(),
	},
	inputState: {
		phase: "plain",
		draft: "",
		draftRev: 0,
		attachmentIds: [],
	},
}));

vi.mock("react", () => ({
	Component: class {},
	createContext: () => ({ Provider: () => null }),
	useContext: () => ({}),
	useMemo: (factory: () => unknown) => factory(),
	useRef: (val: unknown) => ({ current: val }),
	useState: (initial: unknown) => [
		typeof initial === "boolean" ? ui.open : initial,
		ui.setOpen,
	],
	useEffect: () => {},
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
		getSnapshot(),
}));

vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: (...args: unknown[]) => {
		ui.jsx(args[0], args[1]);
		if (args[0] === SplitPaneHeader) {
			// edge case: JSX test instrumentation receives untyped props at its boundary
			return SplitPaneHeader(args[1] as ComponentProps<typeof SplitPaneHeader>);
		}
		return { type: args[0], props: args[1] };
	},
	Fragment: Symbol.for("react.fragment"),
}));

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	Button: "Button",
	CodeBlock: "CodeBlock",
	IconChevronDownOutlineRegular: "IconChevronDownOutlineRegular",
	IconCloseOutlineRegular: "IconCloseOutlineRegular",
	IconCompareSplitOutlineRegular: "IconCompareSplitOutlineRegular",
	IconDeliverDocRegular: "IconDeliverDocRegular",
	IconFullscreenOutlineRegular: "IconFullscreenOutlineRegular",
	IconRightUpOutlineRegular: "IconRightUpOutlineRegular",
	languageForPath: vi.fn(),
	MarkdownText: "MarkdownText",
	Menu: "Menu",
	PathLabel: "PathLabel",
	StateDot: "StateDot",
	Tooltip: "Tooltip",
}));

import { SplitPaneContent } from "../src/client/SplitPane.tsx";

describe("SplitPane Subagent Indicator and Dropdown", () => {
	const parentId = "parent-session" as SessionId;

	const createSummary = (
		partial: Partial<SessionSummary> &
			Pick<SessionSummary, "id" | "displayTitle">,
	): SessionSummary => ({
		running: false,
		blank: false,
		updatedAt: 100,
		retainedBy: {},
		...partial,
	});

	const subagent1 = createSummary({
		id: "sub-1" as SessionId,
		parentId,
		origin: "subagent",
		displayTitle: "Crawler Subagent",
		running: true,
	});
	const subagent2 = createSummary({
		id: "sub-2" as SessionId,
		parentId,
		origin: "subagent",
		displayTitle: "Analyzer Subagent",
		running: false,
	});

	beforeEach(() => {
		vi.restoreAllMocks();
		splitStore.resetToSingle();
		ui.open = false;
		ui.sessionsState.byId = {};
		ui.jsx.mockClear();
		ui.renderSlot.mockClear();
		ui.statusState = new Map();
	});

	const renderPane = () =>
		SplitPaneContent({
			sessionId: parentId,
			useSession: ((selector: (s: typeof ui.sessionState) => unknown) =>
				selector(ui.sessionState)) as never,
			useInput: ((selector: (i: typeof ui.inputState) => unknown) =>
				selector(ui.inputState)) as never,
			useConversation: ((
				selector: (c: typeof ui.conversationState) => unknown,
			) => selector(ui.conversationState)) as never,
			useSessions: ((selector: (s: typeof ui.sessionsState) => unknown) =>
				selector(ui.sessionsState)) as never,
			useSessionStatus: ((selector: (s: typeof ui.statusState) => unknown) =>
				selector(ui.statusState)) as never,
			useWorkspaces: ((selector: (s: { items: [] }) => unknown) =>
				selector({ items: [] })) as never,
			renderSlot: ui.renderSlot,
			renderFactorySlot: () => null,
			SessionProvider: () => null,
		} as never);

	it("does not render subagent menu when session has no subagents", () => {
		ui.sessionsState.byId = {
			[parentId]: createSummary({
				id: parentId,
				displayTitle: "Parent Task",
			}),
		};

		renderPane();

		const menuCalls = ui.jsx.mock.calls.filter(([type]) => type === "Menu");
		expect(menuCalls.length).toBe(0);
	});

	it("renders subagent menu to the right of crumbs while subagent is running", () => {
		ui.sessionsState.byId = {
			[parentId]: createSummary({
				id: parentId,
				displayTitle: "Parent Task",
			}),
			"sub-1": subagent1,
		};

		renderPane();

		const headerLeftCall = ui.jsx.mock.calls.find(
			([, props]) =>
				(props as { className?: string })?.className ===
				"dsh-split-header-left",
		);
		expect(headerLeftCall).toBeDefined();
		if (!headerLeftCall) throw new Error("headerLeftCall is missing");

		const headerProps = headerLeftCall[1] as {
			children: Array<{ props?: { className?: string } }>;
		};
		const children = headerProps.children;
		expect(children[0].props?.className).toBe("dsh-split-crumbs");
		expect(children[1].props?.className).toBe("dsh-split-header-actions");
		expect(children).toHaveLength(2);
		const header = ui.jsx.mock.calls.find(([type]) => type === "header");
		expect(header).toBeDefined();
		if (!header) throw new Error("header is missing");
		expect((header[1] as { children: unknown[] }).children[2]).toMatchObject({
			type: "Menu",
		});

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === "Menu");
		expect(menuCall).toBeDefined();
		if (!menuCall) throw new Error("menuCall is missing");
		const menuProps = menuCall[1] as {
			open: boolean;
			align: string;
			items: Array<{ id: string }>;
		};
		expect(menuProps.align).toBe("start");
		expect(menuProps.items).toHaveLength(1);
		expect(menuProps.items[0].id).toBe("sub-1");
		const trigger = ui.jsx.mock.calls.find(([, props]) =>
			(props as { className?: string }).className?.includes(
				"dsh-split-subagent-pill",
			),
		);
		expect(trigger).toMatchObject([
			"Button",
			{
				variant: "ghost",
				size: "sm",
				"aria-haspopup": "menu",
				"aria-expanded": false,
			},
		]);

		const stateDotCalls = ui.renderSlot.mock.calls.filter(
			([name]) => name === "split.subagent.status",
		);
		expect(
			stateDotCalls.some(
				([, props]) => (props as { state?: string })?.state === "active",
			),
		).toBe(true);
	});

	it("keeps subagent indicator visible with 'warning' status (orange) and label '1 subagent' after subagents finish", () => {
		ui.sessionsState.byId = {
			[parentId]: createSummary({
				id: parentId,
				displayTitle: "Parent Task",
			}),
			"sub-2": subagent2, // running: false
		};

		renderPane();

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === "Menu");
		expect(menuCall).toBeDefined();
		if (!menuCall) throw new Error("menuCall is missing");
		const menuProps = menuCall[1] as {
			items: Array<{ id: string; icon: { props: { state?: string } } }>;
			anchor: {
				props: {
					children: Array<{
						props: { children?: unknown; state?: string };
					}>;
				};
			};
		};
		expect(menuProps.items).toHaveLength(1);
		expect(menuProps.items[0].id).toBe("sub-2");
		expect(menuProps.items[0].icon.props.state).toBe("review");

		const textSpan = menuProps.anchor.props.children.find(
			(child) => child.props.children === "1 subagent",
		);
		expect(textSpan).toBeDefined();

		// Pill should show warning dot (orange)
		const stateDotCalls = ui.renderSlot.mock.calls.filter(
			([name]) => name === "split.subagent.status",
		);
		expect(
			stateDotCalls.some(
				([, props]) => (props as { state?: string })?.state === "review",
			),
		).toBe(true);
	});

	it("opens the selected subagent session as an overlay when clicked from dropdown", () => {
		const overlaySpy = vi
			.spyOn(splitStore, "openSessionOverlay")
			.mockImplementation(() => {});
		ui.sessionsState.byId = {
			[parentId]: createSummary({
				id: parentId,
				displayTitle: "Parent Task",
			}),
			"sub-1": subagent1,
			"sub-2": subagent2,
		};

		renderPane();

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === "Menu");
		expect(menuCall).toBeDefined();
		if (!menuCall) throw new Error("menuCall is missing");
		const menuProps = menuCall[1] as {
			onSelect: (id: string) => void;
			items: Array<{ id: string }>;
		};
		expect(menuProps.items).toHaveLength(2);

		menuProps.onSelect("sub-2");
		expect(overlaySpy).toHaveBeenCalledWith(
			parentId,
			"sub-2",
			"Subagent: Analyzer Subagent",
		);
	});

	it("renders 'Subagent: <title>' in the overlay tab for session overlays", () => {
		splitStore.openSessionOverlay(
			parentId,
			"sub-2" as SessionId,
			"Subagent: Analyzer Subagent",
			// type-safe: minimal ISessions stub providing only the retain() method required by openSessionOverlay
			{
				retain: vi.fn(() => ({ release: vi.fn() })),
			} as unknown as ISessions,
		);
		renderPane();

		const tabTitleCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "span" &&
				(props as { className?: string })?.className ===
					"dsh-split-overlay-tab-title",
		);
		expect(tabTitleCall).toBeDefined();
		expect((tabTitleCall?.[1] as { children?: unknown })?.children).toBe(
			"Subagent: Analyzer Subagent",
		);
	});

	it("renders regular session title without 'Subagent:' prefix for non-subagent session overlays", () => {
		splitStore.openSessionOverlay(
			parentId,
			"task-99" as SessionId,
			"Design Document Review",
			// type-safe: minimal ISessions stub providing only the retain() method required by openSessionOverlay
			{
				retain: vi.fn(() => ({ release: vi.fn() })),
			} as unknown as ISessions,
		);
		renderPane();

		const tabTitleCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "span" &&
				(props as { className?: string })?.className ===
					"dsh-split-overlay-tab-title",
		);
		expect(tabTitleCall).toBeDefined();
		expect((tabTitleCall?.[1] as { children?: unknown })?.children).toBe(
			"Design Document Review",
		);
	});

	it("renders 'Subagent: <title>' in ancestry crumbs for subagents", () => {
		ui.sessionsState.byId = {
			[parentId]: createSummary({
				id: parentId,
				displayTitle: "Root Task",
			}),
			"sub-1": createSummary({
				id: "sub-1" as SessionId,
				parentId,
				origin: "subagent",
				displayTitle: "Worker Subagent",
			}),
		};

		SplitPaneContent({
			sessionId: "sub-1" as SessionId,
			useSession: ((selector: (s: typeof ui.sessionState) => unknown) =>
				selector(ui.sessionState)) as never,
			useInput: ((selector: (i: typeof ui.inputState) => unknown) =>
				selector(ui.inputState)) as never,
			useConversation: ((
				selector: (c: typeof ui.conversationState) => unknown,
			) => selector(ui.conversationState)) as never,
			useSessions: ((selector: (s: typeof ui.sessionsState) => unknown) =>
				selector(ui.sessionsState)) as never,
			useSessionStatus: ((selector: (s: typeof ui.statusState) => unknown) =>
				selector(ui.statusState)) as never,
			useWorkspaces: ((selector: (s: { items: [] }) => unknown) =>
				selector({ items: [] })) as never,
			renderSlot: ui.renderSlot,
			renderFactorySlot: () => null,
			SessionProvider: () => null,
		} as never);

		const crumbCalls = ui.jsx.mock.calls.filter(
			([type, props]) =>
				type === "span" &&
				typeof (props as { className?: string })?.className === "string" &&
				(props as { className: string }).className.includes("dsh-split-crumb"),
		);
		const subagentCrumb = crumbCalls.find(([, props]) =>
			(props as { className?: string })?.className?.includes("is-subagent"),
		);
		expect(subagentCrumb).toBeDefined();
		expect((subagentCrumb?.[1] as { title?: string })?.title).toBe(
			"Subagent: Worker Subagent",
		);
		expect((subagentCrumb?.[1] as { children?: unknown })?.children).toBe(
			"Subagent: Worker Subagent",
		);
	});

	it("identifies running subagents through useSessionStatus even when SessionSummary.running is false", () => {
		const coldSummary = createSummary({
			id: "sub-cold" as SessionId,
			parentId,
			origin: "subagent",
			displayTitle: "Background Worker",
			running: false,
		});

		ui.sessionsState.byId = {
			[parentId]: createSummary({
				id: parentId,
				displayTitle: "Parent Task",
			}),
			"sub-cold": coldSummary,
		};
		ui.statusState.set("sub-cold", { running: true });

		renderPane();

		const stateDotCalls = ui.renderSlot.mock.calls.filter(
			([name]) => name === "split.subagent.status",
		);
		expect(
			stateDotCalls.some(
				([, props]) => (props as { state?: string })?.state === "active",
			),
		).toBe(true);

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === "Menu");
		expect(menuCall).toBeDefined();
		if (!menuCall) throw new Error("menuCall is missing");
		const menuProps = menuCall[1] as {
			items: Array<{
				id: string;
				label: { props: { children: Array<{ props: { children: string } }> } };
			}>;
		};
		expect(menuProps.items).toHaveLength(1);
		expect(menuProps.items[0].id).toBe("sub-cold");
	});

	it("recognizes completed subagent through useSessionStatus even when SessionSummary.running is true", () => {
		const warmSummary = createSummary({
			id: "sub-warm" as SessionId,
			parentId,
			origin: "subagent",
			displayTitle: "Completed Worker",
			running: true,
		});

		ui.sessionsState.byId = {
			[parentId]: createSummary({
				id: parentId,
				displayTitle: "Parent Task",
			}),
			"sub-warm": warmSummary,
		};
		ui.statusState.set("sub-warm", { running: false });

		renderPane();

		const menuCall = ui.jsx.mock.calls.find(([type]) => type === "Menu");
		expect(menuCall).toBeDefined();
		if (!menuCall) throw new Error("menuCall is missing");
		const menuProps = menuCall[1] as {
			items: Array<{
				id: string;
				icon: { props: { state?: string } };
				label: {
					props: {
						children: Array<{
							props: { className?: string; children?: unknown };
						}>;
					};
				};
			}>;
		};
		expect(menuProps.items).toHaveLength(1);
		expect(menuProps.items[0].id).toBe("sub-warm");
		expect(menuProps.items[0].icon.props.state).toBe("review");

		const statusSpan = menuProps.items[0].label.props.children.find(
			(child) => child.props.className === "dsh-split-subagent-menu-status",
		);
		expect(statusSpan?.props.children).toBe("Finished");

		const stateDotCalls = ui.renderSlot.mock.calls.filter(
			([name]) => name === "split.subagent.status",
		);
		expect(
			stateDotCalls.every(
				([, props]) => (props as { state?: string })?.state !== "active",
			),
		).toBe(true);
		expect(
			stateDotCalls.some(
				([, props]) => (props as { state?: string })?.state === "review",
			),
		).toBe(true);
	});
});
