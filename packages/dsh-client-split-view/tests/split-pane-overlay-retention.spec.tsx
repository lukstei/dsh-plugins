// @vitest-environment happy-dom
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SplitOverlayContent,
	SplitOverlayConversationView,
	SplitOverlayHostContext,
	SplitPaneContent,
} from "../src/client/SplitPane.tsx";
import { splitStore } from "../src/client/split-store.ts";

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
	languageForPath: () => undefined,
	MarkdownText: "MarkdownText",
	Menu: "Menu",
	StateDot: "StateDot",
	Tooltip: ({ children }: { children?: unknown }) => children,
	writeClipboard: () => Promise.resolve(true),
}));

describe("SplitOverlayContent conditional rendering", () => {
	const hostSessionId = "session-1" as SessionId;
	let container: HTMLDivElement;
	let root: ReturnType<typeof createRoot>;

	const createMockSession = () => ({
		blank: false,
		openState: "open" as const,
		awaitingFirstTurn: false,
		running: false,
		promptAttempted: true,
		pendingSubmissions: [],
	});

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		splitStore.closeOverlay(hostSessionId);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		splitStore.closeOverlay(hostSessionId);
	});

	it("conditionally mounts overlay when open and unmounts when closed", async () => {
		let cleanupFired = false;

		function ReviewComponent() {
			useEffect(() => {
				return () => {
					cleanupFired = true;
				};
			}, []);
			return <div data-testid="review-content">Git Review</div>;
		}

		const renderFactorySlot = vi.fn((slotName: string) => {
			if (slotName === "gitdiff.review") {
				return <ReviewComponent />;
			}
			return null;
		});

		const props = {
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel(createMockSession())),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot,
			readFile: vi.fn(),
			readBytes: vi.fn(),
			openNativeResource: vi.fn(),
		} as unknown as Parameters<typeof SplitOverlayContent>[0];

		// 1. Initial state: no overlay open, SplitOverlayContent renders null
		await act(async () => {
			root.render(<SplitOverlayContent {...props} />);
		});
		expect(
			container.querySelector('[data-testid="review-content"]'),
		).toBeNull();

		// 2. Open git review overlay: component mounts
		await act(async () => {
			splitStore.openSlotOverlay(
				hostSessionId,
				"gitdiff.review" as never,
				"Review",
				{},
			);
		});
		expect(
			container.querySelector('[data-testid="review-content"]'),
		).not.toBeNull();
		expect(cleanupFired).toBe(false);

		// 3. Close overlay: unmounts cleanly and triggers effect cleanup
		await act(async () => {
			splitStore.closeOverlay(hostSessionId);
		});
		expect(
			container.querySelector('[data-testid="review-content"]'),
		).toBeNull();
		expect(cleanupFired).toBe(true);
	});

	it("switches between distinct slot overlays with clean conditional rendering", async () => {
		function ReviewComponent() {
			return <div data-testid="git-review-content">Git Review Content</div>;
		}

		function SlotComponent() {
			return <div data-testid="slot-content">Slot Content</div>;
		}

		const renderFactorySlot = vi.fn((slotName: string) => {
			if (slotName === "gitdiff.review") return <ReviewComponent />;
			if (slotName === "test.slot") return <SlotComponent />;
			return null;
		});

		const props = {
			sessionId: hostSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel(createMockSession())),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot,
			readFile: vi.fn(),
			readBytes: vi.fn(),
			openNativeResource: vi.fn(),
		} as unknown as Parameters<typeof SplitOverlayContent>[0];

		await act(async () => {
			root.render(<SplitOverlayContent {...props} />);
		});

		// 1. Open Git Review
		await act(async () => {
			splitStore.openSlotOverlay(
				hostSessionId,
				"gitdiff.review" as never,
				"Review",
				{},
			);
		});
		expect(
			container.querySelector('[data-testid="git-review-content"]'),
		).not.toBeNull();
		expect(container.querySelector('[data-testid="slot-content"]')).toBeNull();

		// 2. Open slot: switches active slot
		await act(async () => {
			splitStore.openSlotOverlay(
				hostSessionId,
				"test.slot" as never,
				"Slot",
				{},
			);
		});
		expect(
			container.querySelector('[data-testid="git-review-content"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="slot-content"]'),
		).not.toBeNull();

		// 3. Close overlay: unmounts cleanly
		await act(async () => {
			splitStore.closeOverlay(hostSessionId);
		});
		expect(
			container.querySelector('[data-testid="git-review-content"]'),
		).toBeNull();
		expect(container.querySelector('[data-testid="slot-content"]')).toBeNull();
	});

	it("renders subagent session overlay with embedded conversation content", async () => {
		const subagentSessionId = "subagent-1" as SessionId;
		const renderFactorySlot = vi.fn((slotName: string, props: unknown) => {
			if (slotName === "conversation.content") {
				return (
					<div
						data-testid="subagent-conversation"
						data-variant={(props as { variant?: string })?.variant}
					>
						Subagent Conversation
					</div>
				);
			}
			return null;
		});

		const props = {
			sessionId: subagentSessionId,
			hostSessionId,
			useSession: vi.fn((sel) => sel(createMockSession())),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			renderFactorySlot,
			readFile: vi.fn(),
			readBytes: vi.fn(),
			openNativeResource: vi.fn(),
		} as unknown as Parameters<typeof SplitOverlayContent>[0];

		await act(async () => {
			root.render(<SplitOverlayContent {...props} />);
		});
		expect(
			container.querySelector('[data-testid="subagent-conversation"]'),
		).toBeNull();

		// Open subagent session overlay
		await act(async () => {
			splitStore.openSessionOverlay(
				hostSessionId,
				subagentSessionId,
				"Subagent: Analyzer",
				{ retain: vi.fn(() => ({ release: vi.fn() })) } as unknown as ISessions,
			);
		});

		const convEl = container.querySelector(
			'[data-testid="subagent-conversation"]',
		);
		expect(convEl).not.toBeNull();
		expect(convEl?.getAttribute("data-variant")).toBe("embedded");
		expect(renderFactorySlot).toHaveBeenCalledWith(
			"conversation.content",
			expect.objectContaining({ variant: "embedded" }),
		);

		// Close overlay
		await act(async () => {
			splitStore.closeOverlay(hostSessionId);
		});
		expect(
			container.querySelector('[data-testid="subagent-conversation"]'),
		).toBeNull();
	});

	it("renders overlay slot inside SplitOverlayConversationView", async () => {
		const renderOverlaySlot = vi.fn((slotName: string) => {
			if (slotName === "split.overlay") {
				return <div data-testid="split-overlay-node">Overlay Node</div>;
			}
			return null;
		});

		const hostValue = {
			sessionId: hostSessionId,
			renderSlot: renderOverlaySlot as never,
		};

		await act(async () => {
			root.render(
				<SplitOverlayHostContext.Provider value={hostValue}>
					<SplitOverlayConversationView />
				</SplitOverlayHostContext.Provider>,
			);
		});

		const overlayContainer = container.querySelector(
			".dsh-split-overlay-view",
		) as HTMLElement;
		expect(overlayContainer).not.toBeNull();
		expect(
			container.querySelector('[data-testid="split-overlay-node"]'),
		).not.toBeNull();
		expect(renderOverlaySlot).toHaveBeenCalledWith("split.overlay", {
			hostSessionId,
		});
	});

	it("renders conversation.content without overlay options when overlay is closed, and with overlay options when overlay is open", async () => {
		const renderFactorySlot = vi.fn(() => null);
		const renderSlot = vi.fn(() => null);

		const props = {
			sessionId: hostSessionId,
			useSession: vi.fn((sel) => sel(createMockSession())),
			useInput: vi.fn((sel) => sel({ phase: "plain" })),
			useConversation: vi.fn((sel) => sel({ activeTargets: new Set() })),
			useSessions: vi.fn((sel) => sel({ byId: {} })),
			useSessionStatus: vi.fn((sel) => sel(new Map())),
			useWorkspaces: vi.fn((sel) => sel({ items: [] })),
			renderSlot,
			renderFactorySlot,
			SessionProvider: ({ children }: { children?: unknown }) => children,
		} as unknown as Parameters<typeof SplitPaneContent>[0];

		// 1. Overlay is closed: renderFactorySlot called with (slot, props), without 3rd argument (options)
		await act(async () => {
			root.render(<SplitPaneContent {...props} />);
		});

		expect(renderFactorySlot).toHaveBeenCalledWith(
			"conversation.content",
			expect.objectContaining({ variant: "embedded" }),
		);
		expect(renderFactorySlot).not.toHaveBeenCalledWith(
			"conversation.content",
			expect.anything(),
			expect.anything(),
		);

		// 2. Open overlay: renderFactorySlot called with views options
		await act(async () => {
			splitStore.openSlotOverlay(
				hostSessionId,
				"gitdiff.review" as never,
				"Review",
				{},
			);
		});

		expect(renderFactorySlot).toHaveBeenCalledWith(
			"conversation.content",
			expect.objectContaining({ variant: "embedded" }),
			expect.objectContaining({
				slots: {
					views: SplitOverlayConversationView,
				},
			}),
		);
	});
});
