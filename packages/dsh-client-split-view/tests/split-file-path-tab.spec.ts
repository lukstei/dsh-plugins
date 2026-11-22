import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
	jsxCalls: [] as Array<[unknown, unknown]>,
	overlayState: new Map<string, unknown>(),
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
	useState: (initial: unknown) => [initial, vi.fn()],
	useEffect: () => {},
	useSyncExternalStore: (_sub: unknown, getSnapshot: () => unknown) =>
		getSnapshot(),
}));

vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: (...args: unknown[]) => {
		ui.jsxCalls.push([args[0], args[1]]);
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

vi.mock("../src/client/split-store.ts", () => ({
	splitStore: {
		subscribe: () => () => {},
		getSnapshot: () => ({
			sessionIds: ["host-session-1"],
			focusedSessionId: "host-session-1",
			maximizedSessionId: undefined,
			overlays: ui.overlayState,
		}),
		closeOverlay: vi.fn(),
	},
}));

import { SplitPaneContent } from "../src/client/SplitPane.tsx";

describe("SplitPane file overlay tab PathLabel", () => {
	const sessionId = "host-session-1" as SessionId;

	beforeEach(() => {
		vi.clearAllMocks();
		ui.jsxCalls = [];
		ui.overlayState.clear();
		ui.sessionsState.byId = {
			[sessionId]: {
				id: sessionId,
				origin: "user",
				parentId: undefined,
				displayTitle: "Host Session",
				running: false,
				blank: false,
				updatedAt: 100,
				retainedBy: {},
			} as unknown as SessionSummary,
		};
	});

	const renderPane = () =>
		SplitPaneContent({
			sessionId,
			useSession: ((selector: (s: typeof ui.sessionState) => unknown) =>
				selector(ui.sessionState)) as never,
			useInput: ((selector: (s: typeof ui.inputState) => unknown) =>
				selector(ui.inputState)) as never,
			useConversation: ((
				selector: (s: typeof ui.conversationState) => unknown,
			) => selector(ui.conversationState)) as never,
			useSessions: ((selector: (s: typeof ui.sessionsState) => unknown) =>
				selector(ui.sessionsState)) as never,
			useSessionStatus: ((selector: (s: typeof ui.statusState) => unknown) =>
				selector(ui.statusState)) as never,
			useWorkspaces: ((selector: (s: { items: [] }) => unknown) =>
				selector({ items: [] })) as never,
			renderSlot: () => null,
			renderFactorySlot: () => null,
			SessionProvider: ({ children }: { children?: unknown }) =>
				children as never,
		} as never);

	it("renders PathLabel for file overlays with full resolved path and without any copy button", () => {
		ui.overlayState.set(sessionId, {
			kind: "file",
			address: "file://session/doc.md",
			ownerSessionId: sessionId,
			path: "doc.md",
			title: "doc.md",
			fullPath: "/Users/dev/workspace/doc.md",
		});

		renderPane();

		const pathLabelCall = ui.jsxCalls.find(([type]) => type === "PathLabel");
		expect(pathLabelCall).toBeDefined();
		const pathProps = pathLabelCall?.[1] as {
			path?: string;
			className?: string;
		};
		expect(pathProps.path).toBe("/Users/dev/workspace/doc.md");
		expect(pathProps.className).toBe("dsh-split-overlay-tab-path");

		// Should NOT render any copy button
		const copyBtnCall = ui.jsxCalls.find(([, props]) => {
			const p = props as { className?: string };
			return p?.className?.includes("copy-btn");
		});
		expect(copyBtnCall).toBeUndefined();
	});

	it("renders fallback path if fullPath is not available", () => {
		ui.overlayState.set(sessionId, {
			kind: "file",
			address: "file://session/src/app.ts",
			ownerSessionId: sessionId,
			path: "src/app.ts",
			title: "app.ts",
		});

		renderPane();

		const pathLabelCall = ui.jsxCalls.find(([type]) => type === "PathLabel");
		expect(pathLabelCall).toBeDefined();
		const pathProps = pathLabelCall?.[1] as { path?: string };
		expect(pathProps.path).toBe("src/app.ts");
	});

	it("renders standard span for non-file session overlay", () => {
		ui.overlayState.set(sessionId, {
			kind: "session",
			target: "child-session",
			title: "Subagent Task",
			reference: {},
		});

		renderPane();

		const pathLabelCall = ui.jsxCalls.find(([type]) => type === "PathLabel");
		expect(pathLabelCall).toBeUndefined();

		const titleSpanCall = ui.jsxCalls.find(([, props]) => {
			const p = props as { className?: string; children?: unknown };
			return (
				p?.className === "dsh-split-overlay-tab-title" &&
				p?.children === "Subagent Task"
			);
		});
		expect(titleSpanCall).toBeDefined();
	});
});
