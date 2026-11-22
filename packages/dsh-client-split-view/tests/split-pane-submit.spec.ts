declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface SlotFactoryMap {
		"split.test": { scope: "session" };
	}
}

import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { splitStore } from "../src/client/split-store.ts";

const ui = vi.hoisted(() => ({
	sessionsState: {
		byId: {} as Record<string, SessionSummary>,
		projectionsBySession: {},
	},
	sessionState: {
		pendingSubmissions: [] as unknown[],
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

let refIndex = 0;
const refSlots: Array<{ current: unknown }> = [];

vi.mock("react", () => ({
	Component: class {},
	createContext: () => ({ Provider: () => null }),
	useContext: () => ({}),
	useMemo: (factory: () => unknown) => factory(),
	useRef: (initial: unknown) => {
		const index = refIndex++;
		if (!refSlots[index]) {
			refSlots[index] = { current: initial };
		}
		return refSlots[index];
	},
	useState: (initial: unknown) => [initial, () => {}],
	useEffect: (effect: () => void) => {
		effect();
	},
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
		getSnapshot(),
}));

vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: () => null,
	Fragment: Symbol.for("react.fragment"),
}));

vi.stubGlobal("document", {
	addEventListener: vi.fn(),
	removeEventListener: vi.fn(),
});

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
	languageForPath: vi.fn((path: string) =>
		path.endsWith(".ts") ? "typescript" : undefined,
	),
	MarkdownText: "MarkdownText",
	Menu: "Menu",
	PathLabel: "PathLabel",
	StateDot: "StateDot",
	Tooltip: "Tooltip",
	writeClipboard: () => Promise.resolve(true),
}));

import { SplitPaneContent } from "../src/client/SplitPane.tsx";

describe("SplitPane auto-close on prompt submission", () => {
	const sessionId = "session-1" as SessionId;

	const renderPane = () => {
		refIndex = 0;
		return SplitPaneContent({
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
			useWorkspaces: ((selector: (s: { items: [] }) => unknown) =>
				selector({ items: [] })) as never,
			renderSlot: () => null,
			renderFactorySlot: () => null,
			SessionProvider: () => null,
		} as never);
	};

	beforeEach(() => {
		refSlots.length = 0;
		refIndex = 0;
		splitStore.resetToSingle();
		ui.sessionState = {
			pendingSubmissions: [],
			running: false,
			blank: false,
			awaitingFirstTurn: false,
			promptAttempted: false,
			openState: "open",
		};
		ui.inputState = {
			phase: "plain",
			draft: "",
			draftRev: 0,
			attachmentIds: [],
		};
	});

	it("closes slot overlay when input.phase shifts to 'sending'", () => {
		splitStore.openSlotOverlay(sessionId, "split.test", "Inspector", {});
		expect(splitStore.getOverlay(sessionId)?.kind).toBe("slot");

		// Initial render while idle
		renderPane();
		expect(splitStore.getOverlay(sessionId)?.kind).toBe("slot");

		// User submits prompt: phase becomes sending
		ui.inputState.phase = "sending";
		renderPane();

		expect(splitStore.getOverlay(sessionId)).toBeUndefined();
	});

	it("closes file overlay when input.phase shifts to 'sending'", () => {
		splitStore.openFileOverlay(sessionId, {
			address: "file://test.ts",
			ownerSessionId: sessionId,
			path: "test.ts",
			title: "test.ts",
		});
		expect(splitStore.getOverlay(sessionId)?.kind).toBe("file");

		renderPane();
		expect(splitStore.getOverlay(sessionId)?.kind).toBe("file");

		// Submitting
		ui.inputState.phase = "sending";
		renderPane();

		expect(splitStore.getOverlay(sessionId)).toBeUndefined();
	});

	it("closes slot overlay when claimed command is submitted", () => {
		splitStore.openSlotOverlay(sessionId, "split.test", "Inspector", {});

		ui.inputState.phase = "claimed";
		renderPane();
		expect(splitStore.getOverlay(sessionId)?.kind).toBe("slot");

		// Submitting claimed command
		ui.inputState.phase = "submitting";
		renderPane();

		expect(splitStore.getOverlay(sessionId)).toBeUndefined();
	});

	it("does not close overlay when typing without submitting", () => {
		splitStore.openSlotOverlay(sessionId, "split.test", "Inspector", {});

		renderPane();
		ui.inputState.draft = "some draft feedback";
		renderPane();

		expect(splitStore.getOverlay(sessionId)?.kind).toBe("slot");
	});

	it("does not close session overlay when prompt is submitted", () => {
		const subSessionId = "subagent-1" as SessionId;
		const mockRef = { release: vi.fn(), id: subSessionId };
		const mockSessions = {
			retain: vi.fn(() => mockRef),
		};
		splitStore.openSessionOverlay(
			sessionId,
			subSessionId,
			"Subagent",
			mockSessions as never,
		);
		expect(splitStore.getOverlay(sessionId)?.kind).toBe("session");

		renderPane();
		ui.inputState.phase = "sending";
		renderPane();

		expect(splitStore.getOverlay(sessionId)?.kind).toBe("session");
	});

	it("closes review overlay on pendingSubmissions increase fallback", () => {
		splitStore.openSlotOverlay(sessionId, "split.test", "Inspector", {});

		renderPane();
		expect(splitStore.getOverlay(sessionId)?.kind).toBe("slot");

		// Simulating external pendingSubmissions arrival
		ui.sessionState.pendingSubmissions = [{ requestId: "req-1" }];
		renderPane();

		expect(splitStore.getOverlay(sessionId)).toBeUndefined();
	});
});
