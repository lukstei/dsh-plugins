import type {
	ISessions,
	SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceView } from "@deepseek-ai/dsh-api-workspace-controller/types";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { type ComponentProps, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplitPaneHeader } from "../src/client/SplitPaneHeader.tsx";
import { splitStore } from "../src/client/split-store.ts";

const ui = vi.hoisted(() => ({
	jsx: vi.fn((_type: unknown, _props: unknown) => null),
	renderSlot: vi.fn(() => null),
	sessionsState: {
		byId: {} as Record<string, SessionSummary>,
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
	workspaceState: {
		items: [] as Pick<WorkspaceView, "title" | "sessionIds">[],
	},
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
	useState: (initial: unknown) => [initial, () => {}],
	useEffect: vi.fn(),
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
	IconCheckOutlineRegular: "IconCheckOutlineRegular",
	IconChevronDownOutlineRegular: "IconChevronDownOutlineRegular",
	IconCloseOutlineRegular: "IconCloseOutlineRegular",
	IconCompareSplitOutlineRegular: "IconCompareSplitOutlineRegular",
	IconDeliverDocRegular: "IconDeliverDocRegular",
	IconFullscreenOutlineRegular: "IconFullscreenOutlineRegular",
	IconRightUpOutlineRegular: "IconRightUpOutlineRegular",
	languageForPath: vi.fn(),
	MarkdownText: "MarkdownText",
	Menu: "Menu",
	StateDot: "StateDot",
	Tooltip: "Tooltip",
	writeClipboard: () => Promise.resolve(true),
}));

import { SplitPaneContent, SplitView } from "../src/client/SplitPane.tsx";

describe("SplitPane header double-click maximize", () => {
	const sessionId = "session-1" as SessionId;

	const renderPane = () =>
		SplitPaneContent({
			sessionId,
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
			useWorkspaces: ((selector: (s: typeof ui.workspaceState) => unknown) =>
				selector(ui.workspaceState)) as never,
			renderSlot: ui.renderSlot,
			renderFactorySlot: () => null,
			SessionProvider: () => null,
		} as never);

	const mockSessions = {
		retain: vi.fn((id: SessionId) => ({ release: vi.fn(), sessionId: id })),
		list: { getSnapshot: () => ({ phase: "ready", ids: [], byId: {} }) },
	} as unknown as ISessions;

	beforeEach(() => {
		vi.restoreAllMocks();
		ui.jsx.mockClear();
		ui.renderSlot.mockClear();
		vi.mocked(useEffect).mockClear();
		ui.sessionsState.byId = {};
		ui.statusState.clear();
		ui.workspaceState.items = [];
		splitStore.resetToSingle();
		splitStore.setCallbacks(
			() => {},
			() => {},
			() => mockSessions,
			() => undefined,
		);
	});

	it("unmounting the split root clears current maximization without releasing panes or overlays", () => {
		splitStore.openSession(sessionId);
		const other = "other-session" as SessionId;
		splitStore.toggleSession(other);
		splitStore.openFileOverlay(sessionId, {
			address: "file",
			ownerSessionId: sessionId,
			path: "a.ts",
			title: "a.ts",
		});
		const reference = splitStore.getReference(sessionId);
		const overlay = splitStore.getOverlay(sessionId);
		// edge case: this root consumes only SessionProvider and renderSlot from the canonical slot props.
		SplitView({
			SessionProvider: () => null,
			renderSlot: ui.renderSlot,
		} as never);
		const mount = vi.mocked(useEffect).mock.calls[0];
		expect(mount).toBeDefined();
		const cleanup = mount[0]();
		if (typeof cleanup !== "function")
			throw new Error("Missing unmount cleanup");
		splitStore.toggleMaximize(sessionId);
		cleanup();
		cleanup();
		expect(splitStore.getSnapshot()).toMatchObject({
			sessionIds: [sessionId, other],
			maximizedSessionId: undefined,
		});
		expect(splitStore.getReference(sessionId)).toBe(reference);
		expect(splitStore.getOverlay(sessionId)).toBe(overlay);
	});

	it.each([false, true])(
		"orders header actions with native tooltips (maximized: %s)",
		(maximized) => {
			splitStore.openSession(sessionId);
			splitStore.toggleSession("other-session" as SessionId);
			if (maximized) splitStore.toggleMaximize(sessionId);
			renderPane();

			const labels = [
				maximized ? "Restore split layout" : "Maximize pane in split screen",
				"Open this session in the native view",
				"Close pane",
			];
			expect(
				ui.jsx.mock.calls
					.filter(([type]) => type === SplitPaneHeader)
					.map(([, props]) => props),
			).toMatchObject([
				{
					actions: {
						props: {
							children: [
								null,
								...labels.map((label) => ({
									type: "Tooltip",
									props: {
										label,
										portal: true,
										children: {
											type: "Button",
											props: { "aria-label": label },
										},
									},
								})),
							],
						},
					},
				},
			]);
		},
	);

	it("renders the pane workspace and delegates its indicator to the status slot", () => {
		ui.sessionsState.byId = {
			[sessionId]: {
				id: sessionId,
				displayTitle: "Header polish",
				running: false,
				blank: false,
				updatedAt: 0,
				retainedBy: {},
			},
		};
		ui.workspaceState.items = [
			{ title: "Other workspace", sessionIds: [] },
			{ title: "dsh-plugins", sessionIds: [sessionId] },
		];
		renderPane();
		const identity = ui.jsx.mock.calls
			.map(([, props]) => props as { className?: string; children?: unknown })
			.filter((props) => props.className === "dsh-split-crumb is-workspace")
			.map((props) => props.children);
		expect(identity).toEqual(["dsh-plugins"]);
		expect(ui.renderSlot).toHaveBeenCalledWith("split.pane.status", {});
		expect(ui.renderSlot).toHaveBeenCalledWith("split.pane.header.actions", {});
	});

	it("keeps an explicit close control for a slot without its provider", () => {
		splitStore.openSession(sessionId);
		splitStore.openSlotOverlay(sessionId, "split.test", "Inspector", {});
		renderPane();
		const close = ui.jsx.mock.calls
			.map(
				([, props]) =>
					props as {
						"aria-label"?: string;
						onClick: (event: { stopPropagation: () => void }) => void;
					},
			)
			.find((props) => props["aria-label"] === "Close overlay");
		expect(close).toBeDefined();
		close?.onClick({ stopPropagation: vi.fn() });
		expect(splitStore.getOverlay(sessionId)).toBeUndefined();
	});

	it("keeps focus on the header without passing it to status indicators", () => {
		splitStore.openSession(sessionId);
		splitStore.toggleSession("other-session" as SessionId);
		splitStore.setFocus(sessionId);
		renderPane();
		expect(ui.renderSlot).toHaveBeenCalledWith("split.pane.status", {});
		expect(
			ui.jsx.mock.calls.find(([type]) => type === "header")?.[1],
		).toMatchObject({
			className: "dsh-split-pane-header is-focused",
		});
	});

	it("uses the root workspace for a subagent pane and the native default title", () => {
		const rootId = "root-session" as SessionId;
		ui.sessionsState.byId = {
			[rootId]: {
				id: rootId,
				displayTitle: "Root",
				running: false,
				blank: false,
				updatedAt: 0,
				retainedBy: {},
			},
			[sessionId]: {
				id: sessionId,
				parentId: rootId,
				origin: "subagent",
				displayTitle: "Worker",
				running: false,
				blank: false,
				updatedAt: 0,
				retainedBy: {},
			},
		};
		ui.workspaceState.items = [
			{ title: "default-workspace", sessionIds: [rootId] },
		];
		renderPane();
		expect(
			ui.jsx.mock.calls.find(
				([, props]) =>
					(props as { className?: string }).className ===
					"dsh-split-crumb is-workspace",
			)?.[1],
		).toMatchObject({ children: "Default workspace" });
	});

	it("attaches onDoubleClick to the split pane header and toggles maximize", () => {
		const toggleSpy = vi.spyOn(splitStore, "toggleMaximize");
		renderPane();

		const headerCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "header" &&
				typeof (props as { className?: string })?.className === "string" &&
				(props as { className: string }).className.includes(
					"dsh-split-pane-header",
				),
		);

		expect(headerCall).toBeDefined();
		const headerProps = headerCall?.[1] as {
			onDoubleClick?: (event: unknown) => void;
		};
		expect(typeof headerProps.onDoubleClick).toBe("function");

		// Simulate double clicking the header background
		const mockHeaderElement = { closest: vi.fn(() => null) };
		headerProps.onDoubleClick?.({
			target: mockHeaderElement,
			defaultPrevented: false,
		});

		expect(toggleSpy).toHaveBeenCalledWith(sessionId);
	});

	it("ignores double-click events originating from button elements", () => {
		const toggleSpy = vi.spyOn(splitStore, "toggleMaximize");
		renderPane();

		const headerCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "header" &&
				typeof (props as { className?: string })?.className === "string" &&
				(props as { className: string }).className.includes(
					"dsh-split-pane-header",
				),
		);

		const headerProps = headerCall?.[1] as {
			onDoubleClick?: (event: unknown) => void;
		};

		// Simulate double clicking on an action button inside the header
		const mockButtonElement = {
			closest: vi.fn((selector) => (selector === "button" ? {} : null)),
		};
		headerProps.onDoubleClick?.({
			target: mockButtonElement,
			defaultPrevented: false,
		});

		expect(toggleSpy).not.toHaveBeenCalled();
	});

	it("ignores double-click events when default was prevented", () => {
		const toggleSpy = vi.spyOn(splitStore, "toggleMaximize");
		renderPane();

		const headerCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "header" &&
				typeof (props as { className?: string })?.className === "string" &&
				(props as { className: string }).className.includes(
					"dsh-split-pane-header",
				),
		);

		const headerProps = headerCall?.[1] as {
			onDoubleClick?: (event: unknown) => void;
		};

		const mockHeaderElement = { closest: vi.fn(() => null) };
		headerProps.onDoubleClick?.({
			target: mockHeaderElement,
			defaultPrevented: true,
		});

		expect(toggleSpy).not.toHaveBeenCalled();
	});

	it("enables draggable only when more than one session is in split", () => {
		// Single session: draggable is false
		renderPane();
		let headerCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "header" &&
				(props as { className?: string })?.className?.includes(
					"dsh-split-pane-header",
				),
		);
		expect(headerCall).toBeDefined();
		if (!headerCall) throw new Error("headerCall missing");
		expect((headerCall[1] as { draggable?: boolean }).draggable).toBe(false);

		// Multiple sessions: draggable is true
		ui.jsx.mockClear();
		splitStore.openSession("session-1" as SessionId);
		splitStore.toggleSession("session-2" as SessionId);
		renderPane();
		headerCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "header" &&
				(props as { className?: string })?.className?.includes(
					"dsh-split-pane-header",
				),
		);
		expect(headerCall).toBeDefined();
		if (!headerCall) throw new Error("headerCall missing");
		expect((headerCall[1] as { draggable?: boolean }).draggable).toBe(true);
	});

	it("sets dataTransfer on dragStart and ignores button clicks", () => {
		splitStore.openSession("session-1" as SessionId);
		splitStore.toggleSession("session-2" as SessionId);
		renderPane();

		const headerCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "header" &&
				(props as { className?: string })?.className?.includes(
					"dsh-split-pane-header",
				),
		);
		const headerProps = headerCall?.[1] as {
			onDragStart?: (event: unknown) => void;
		};

		// 1. Drag start on header background
		const setData = vi.fn();
		const preventDefault = vi.fn();
		const addClass = vi.fn();
		const removeClass = vi.fn();
		const mockShell = { classList: { add: addClass, remove: removeClass } };
		headerProps.onDragStart?.({
			target: { closest: vi.fn(() => null) },
			currentTarget: { closest: vi.fn(() => mockShell) },
			defaultPrevented: false,
			dataTransfer: { setData, effectAllowed: "" },
			preventDefault,
		});
		expect(preventDefault).not.toHaveBeenCalled();
		expect(addClass).toHaveBeenCalledWith("is-dragging");
		expect(setData).toHaveBeenCalledWith(
			"application/x-dsh-split-session",
			sessionId,
		);

		// 2. Drag start inside a button
		const preventDefaultBtn = vi.fn();
		headerProps.onDragStart?.({
			target: {
				closest: vi.fn((sel) => (sel.includes("button") ? {} : null)),
			},
			currentTarget: { closest: vi.fn(() => mockShell) },
			defaultPrevented: false,
			dataTransfer: { setData: vi.fn(), effectAllowed: "" },
			preventDefault: preventDefaultBtn,
		});
		expect(preventDefaultBtn).toHaveBeenCalled();

		// 3. Drag end cleans up is-dragging
		const headerCallAfter = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "header" &&
				(props as { className?: string })?.className?.includes(
					"dsh-split-pane-header",
				),
		);
		const headerPropsAfter = headerCallAfter?.[1] as {
			onDragEnd?: (event: unknown) => void;
		};
		headerPropsAfter.onDragEnd?.({
			currentTarget: { closest: vi.fn(() => mockShell) },
		});
		expect(removeClass).toHaveBeenCalledWith("is-dragging");
	});

	it("reorders session on drop over the wrapper", () => {
		const reorderSpy = vi.spyOn(splitStore, "reorderSession");
		splitStore.openSession("session-1" as SessionId);
		splitStore.toggleSession("session-2" as SessionId);
		renderPane();

		const wrapperCall = ui.jsx.mock.calls.find(
			([type, props]) =>
				type === "div" &&
				(props as { className?: string })?.className?.includes(
					"dsh-split-pane-wrapper",
				),
		);
		expect(wrapperCall).toBeDefined();
		const wrapperProps = wrapperCall?.[1] as {
			onDrop?: (event: unknown) => void;
			onDragOver: (event: unknown) => void;
			onDragLeave?: (event: unknown) => void;
		};

		for (const types of [[], ["text/plain"]]) {
			const preventDefault = vi.fn();
			const event = {
				dataTransfer: { types, dropEffect: "none" },
				preventDefault,
			};
			wrapperProps.onDragOver(event);
			expect(preventDefault).not.toHaveBeenCalled();
			expect(event.dataTransfer.dropEffect).toBe("none");
		}

		// Drag over wrapper with valid split session type
		const preventDefaultOver = vi.fn();
		const dragOverEvent = {
			dataTransfer: {
				types: ["application/x-dsh-split-session"],
				dropEffect: "",
			},
			preventDefault: preventDefaultOver,
		};
		wrapperProps.onDragOver(dragOverEvent);
		expect(preventDefaultOver).toHaveBeenCalled();
		expect(dragOverEvent.dataTransfer.dropEffect).toBe("move");

		// Drag leave inside child elements (should not clear)
		const contains = vi.fn(() => true);
		wrapperProps.onDragLeave?.({
			currentTarget: { contains },
			relatedTarget: {},
		});
		expect(contains).toHaveBeenCalled();

		// Drop
		const preventDefaultDrop = vi.fn();
		const removeClass = vi.fn();
		const mockShell = { classList: { remove: removeClass } };
		wrapperProps.onDrop?.({
			currentTarget: { closest: vi.fn(() => mockShell) },
			dataTransfer: {
				getData: vi.fn((type) =>
					type === "application/x-dsh-split-session" ? "session-2" : "",
				),
			},
			preventDefault: preventDefaultDrop,
		});
		expect(preventDefaultDrop).toHaveBeenCalled();
		expect(removeClass).toHaveBeenCalledWith("is-dragging");
		expect(reorderSpy).toHaveBeenCalledWith("session-2", sessionId);
	});
});
