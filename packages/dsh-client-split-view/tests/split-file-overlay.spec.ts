import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	codeBlockProps: null as unknown,
	markdownTextProps: null as unknown,
	jsxCalls: [] as Array<[unknown, unknown]>,
	overlayState: new Map<string, unknown>(),
	floatingQuote: null as unknown,
	clearFloatingQuote: vi.fn(),
	quoteToComposer: vi.fn(),
	useSelectionQuote: vi.fn(),
}));

let effectCallback: (() => void) | null = null;
let stateIndex = 0;
const stateSlots: unknown[] = [];
const stateSetters: Array<(val: unknown) => void> = [];

vi.mock("react", () => ({
	Component: class {},
	createContext: () => ({ Provider: () => null }),
	useContext: () => ({}),
	useMemo: (factory: () => unknown) => factory(),
	useRef: (val: unknown) => ({ current: val }),
	useState: (initial: unknown) => {
		const index = stateIndex++;
		if (stateSlots.length <= index) {
			stateSlots[index] = initial;
			stateSetters[index] = (val: unknown) => {
				stateSlots[index] =
					typeof val === "function"
						? (val as (prev: unknown) => unknown)(stateSlots[index])
						: val;
			};
		}
		return [stateSlots[index], stateSetters[index]];
	},
	useEffect: (fn: () => void) => {
		effectCallback = fn;
	},
	useSyncExternalStore: (_sub: unknown, getSnapshot: () => unknown) =>
		getSnapshot(),
}));

vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: (type: unknown, props: unknown) => {
		mocks.jsxCalls.push([type, props]);
		if (type === "CodeBlock") {
			mocks.codeBlockProps = props;
		}
		if (type === "MarkdownText") {
			mocks.markdownTextProps = props;
		}
		if (typeof type === "function") {
			return (type as (p: unknown) => unknown)(props);
		}
		return { type, props };
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
	IconCopyOutlineRegular: "IconCopyOutlineRegular",
	IconDeliverDocRegular: "IconDeliverDocRegular",
	IconFullscreenOutlineRegular: "IconFullscreenOutlineRegular",
	IconRightUpOutlineRegular: "IconRightUpOutlineRegular",
	languageForPath: vi.fn((path: string) => {
		if (path.endsWith(".ts")) return "typescript";
		if (path.endsWith(".py")) return "python";
		return undefined;
	}),
	MarkdownText: "MarkdownText",
	Menu: "Menu",
	StateDot: "StateDot",
	Tooltip: "Tooltip",
	writeClipboard: () => Promise.resolve(true),
}));

vi.mock("../src/client/split-store.ts", () => ({
	splitStore: {
		subscribe: () => () => {},
		getSnapshot: () => ({
			overlays: mocks.overlayState,
		}),
		updateFileOverlayFullPath: vi.fn(),
		updateFileOverlayContents: vi.fn(),
	},
}));

vi.mock("@lukstei/util-review-ui/client/useSelectionQuote.ts", () => ({
	useSelectionQuote: (args: unknown) => {
		mocks.useSelectionQuote(args);
		return {
			floatingQuote: mocks.floatingQuote,
			clearFloatingQuote: mocks.clearFloatingQuote,
		};
	},
}));

vi.mock("@lukstei/util-review-ui/client/quote.ts", () => ({
	quoteToComposer: (...args: unknown[]) => mocks.quoteToComposer(...args),
}));

import { SplitOverlayContent } from "../src/client/SplitPane.tsx";

describe("SplitOverlayContent code file preview", () => {
	const hostSessionId = "session-host" as SessionId;

	beforeEach(() => {
		mocks.jsxCalls = [];
		mocks.codeBlockProps = null;
		mocks.markdownTextProps = null;
		mocks.floatingQuote = null;
		mocks.clearFloatingQuote.mockClear();
		mocks.quoteToComposer.mockClear();
		mocks.useSelectionQuote.mockClear();
		mocks.overlayState.clear();
		effectCallback = null;
		stateIndex = 0;
		stateSlots.length = 0;
		stateSetters.length = 0;
	});

	it("renders the generic factory with nonempty props under its host session binding", () => {
		mocks.overlayState.set(hostSessionId, {
			kind: "slot",
			slotName: "split.props-test",
			props: { query: "inspector", options: { line: 12 } },
			title: "Inspector",
		});
		const renderFactorySlot = vi.fn(() => null);
		SplitOverlayContent({
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel({ blank: false, openState: "open" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot,
			readFile: vi.fn(),
			readBytes: vi.fn(),
			openNativeResource: vi.fn(),
		} as never);
		expect(renderFactorySlot).toHaveBeenCalledExactlyOnceWith(
			"split.props-test",
			{ query: "inspector", options: { line: 12 } },
		);
	});

	it("renders CodeBlock with syntax highlighting language hint for code files", async () => {
		mocks.overlayState.set(hostSessionId, {
			kind: "file",
			path: "src/main.ts",
			ownerSessionId: hostSessionId,
			address: "dsh-resource://file/session/session-host/src/main.ts",
			title: "main.ts",
		});

		const readFile = vi.fn(async () => ({
			ok: true as const,
			value: {
				text: 'const greeting = "hello";',
				lines: 1,
				offset: 1,
				eof: true,
			},
		}));

		stateIndex = 0;
		SplitOverlayContent({
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel({ blank: false, openState: "open" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot: vi.fn(),
			readFile: readFile as never,
			readBytes: vi.fn() as never,
			openNativeResource: vi.fn(),
		} as never);

		expect(effectCallback).toBeDefined();
		effectCallback?.();
		await new Promise((r) => setTimeout(r, 10));

		stateIndex = 0;
		SplitOverlayContent({
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel({ blank: false, openState: "open" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot: vi.fn(),
			readFile: readFile as never,
			readBytes: vi.fn() as never,
			openNativeResource: vi.fn(),
		} as never);

		expect(mocks.codeBlockProps).toBeDefined();
		const props = mocks.codeBlockProps as {
			code: string;
			lang: string;
			lineNumbers: boolean;
			streaming: boolean;
			toolbarLabels: {
				codeLabel: string;
				wrapLabel: string;
				unwrapLabel: string;
			};
		};
		expect(props.code).toBe('const greeting = "hello";');
		expect(props.lang).toBe("typescript");
		expect(props.lineNumbers).toBe(true);
		expect(props.streaming).toBe(false);
		expect(props.toolbarLabels).toEqual({
			codeLabel: "Code",
			wrapLabel: "Wrap",
			unwrapLabel: "Unwrap",
		});
	});

	it("renders MarkdownText for markdown documents", async () => {
		mocks.overlayState.set(hostSessionId, {
			kind: "file",
			path: "docs/README.md",
			ownerSessionId: hostSessionId,
			address: "dsh-resource://file/session/session-host/docs/README.md",
			title: "README.md",
		});

		const readFile = vi.fn(async () => ({
			ok: true as const,
			value: {
				text: "# Heading",
				lines: 1,
				offset: 1,
				eof: true,
			},
		}));

		stateIndex = 0;
		SplitOverlayContent({
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel({ blank: false, openState: "open" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot: vi.fn(),
			readFile: readFile as never,
			readBytes: vi.fn() as never,
			openNativeResource: vi.fn(),
		} as never);

		effectCallback?.();
		await new Promise((r) => setTimeout(r, 10));

		stateIndex = 0;
		SplitOverlayContent({
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel({ blank: false, openState: "open" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot: vi.fn(),
			readFile: readFile as never,
			readBytes: vi.fn() as never,
			openNativeResource: vi.fn(),
		} as never);

		expect(mocks.markdownTextProps).toBeDefined();
		const props = mocks.markdownTextProps as { text: string };
		expect(props.text).toBe("# Heading");
	});

	it("disables selection quoting when inputActions is not supplied", async () => {
		mocks.overlayState.set(hostSessionId, {
			kind: "file",
			path: "src/index.ts",
			ownerSessionId: hostSessionId,
			address: "dsh-resource://file/session/session-host/src/index.ts",
			title: "index.ts",
		});

		const readFile = vi.fn(async () => ({
			ok: true as const,
			value: { text: "export {};", lines: 1, offset: 1, eof: true },
		}));

		stateIndex = 0;
		SplitOverlayContent({
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel({ blank: false, openState: "open" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot: vi.fn(),
			readFile: readFile as never,
			readBytes: vi.fn() as never,
			openNativeResource: vi.fn(),
		} as never);

		expect(mocks.useSelectionQuote).toHaveBeenCalledWith(
			expect.objectContaining({ enabled: false }),
		);
	});

	it("renders floating quote button and dispatches quoteToComposer on click", async () => {
		mocks.overlayState.set(hostSessionId, {
			kind: "file",
			path: "src/index.ts",
			ownerSessionId: hostSessionId,
			address: "dsh-resource://file/session/session-host/src/index.ts",
			title: "index.ts",
		});
		mocks.floatingQuote = {
			text: "export const answer = 42;",
			lines: "1–2",
			top: 25,
			left: 60,
		};

		const readFile = vi.fn(async () => ({
			ok: true as const,
			value: {
				text: "export const answer = 42;",
				lines: 1,
				offset: 1,
				eof: true,
			},
		}));

		const inputActions = {
			insertText: vi.fn(() => true),
			insertQuote: vi.fn(() => true),
			captureInsertion: vi.fn(),
			persistDraft: vi.fn(),
		};

		stateIndex = 0;
		SplitOverlayContent({
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel({ blank: false, openState: "open" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot: vi.fn(),
			readFile: readFile as never,
			readBytes: vi.fn() as never,
			openNativeResource: vi.fn(),
			inputActions: inputActions as never,
		} as never);

		expect(effectCallback).toBeDefined();
		effectCallback?.();
		await new Promise((r) => setTimeout(r, 10));

		stateIndex = 0;
		SplitOverlayContent({
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel({ blank: false, openState: "open" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot: vi.fn(),
			readFile: readFile as never,
			readBytes: vi.fn() as never,
			openNativeResource: vi.fn(),
			inputActions: inputActions as never,
		} as never);

		expect(mocks.useSelectionQuote).toHaveBeenCalledWith(
			expect.objectContaining({ enabled: true }),
		);

		const quoteContainer = mocks.jsxCalls.find(
			([type, props]) =>
				type === "div" &&
				(props as { className?: string })?.className ===
					"dsh-split-floating-quote",
		);
		expect(quoteContainer).toBeDefined();
		const quoteContainerProps = quoteContainer?.[1] as {
			style?: { top: string; left: string };
		};
		expect(quoteContainerProps.style).toEqual({
			top: "25px",
			left: "60px",
		});

		const quoteBtnCall = mocks.jsxCalls.find(
			([type, props]) =>
				type === "button" &&
				(props as { className?: string })?.className ===
					"dsh-split-floating-quote-btn",
		);
		expect(quoteBtnCall).toBeDefined();
		const quoteBtnProps = quoteBtnCall?.[1] as {
			onClick?: (e: unknown) => void;
			onPointerDown?: (e: unknown) => void;
		};

		const preventDefault = vi.fn();
		quoteBtnProps.onPointerDown?.({ preventDefault });
		expect(preventDefault).toHaveBeenCalled();

		quoteBtnProps.onClick?.({ preventDefault });
		expect(mocks.quoteToComposer).toHaveBeenCalledWith(
			{
				text: "export const answer = 42;",
				path: "src/index.ts",
				lines: "1–2",
			},
			inputActions,
		);
		expect(mocks.clearFloatingQuote).toHaveBeenCalled();
	});
});
