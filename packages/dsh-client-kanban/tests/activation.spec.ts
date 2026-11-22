import { createRequire } from "node:module";
import { Context } from "@deepseek-ai/cordis";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SidebarSectionInjected } from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { afterEach, expect, test, vi } from "vitest";
import * as zod from "zod";
import { renderFaviconBadgeUri } from "../../dsh-client-favicon/src/client/favicon.ts";

import * as faviconPlugin from "../../dsh-client-favicon/src/client/index.tsx";

afterEach(() => vi.unstubAllGlobals());

test("client activation follows split slot declaration lifetimes", async () => {
	let SlotRegistry!: typeof import("@deepseek-ai/dsh-client-ui-renderer/client")["SlotRegistry"];
	vi.stubGlobal("window", {
		__ModuleLoader__: {
			load: ({
				factory,
			}: {
				factory: (
					require: ReturnType<typeof createRequire>,
				) => typeof import("@deepseek-ai/dsh-client-ui-renderer/client");
			}) => {
				SlotRegistry = factory(createRequire(import.meta.url)).SlotRegistry;
			},
		},
	});
	await import("@deepseek-ai/dsh-client-ui-renderer/client");
	let clientPlugin!: typeof import("../src/client/index.tsx");
	(globalThis as unknown as { window: unknown }).window = {
		__ModuleLoader__: {
			load: ({
				factory,
			}: {
				id: string;
				factory: (
					require: (mod: string) => unknown,
				) => typeof import("../src/client/index.tsx");
			}) => {
				clientPlugin = factory((module) => (module === "zod" ? zod : {}));
			},
		},
	};

	// @ts-expect-error Bundle output has no generated declaration file
	await import("../dist/client.js");
	expect(clientPlugin).toBeDefined();

	const ctx = new Context();

	const registryFiber = ctx.plugin(SlotRegistry);
	await registryFiber.await();
	ctx.slots.register(
		{
			name: "root",
			children: {
				"sidebar.panellist": { kind: "list", scope: "root" },
				main: { kind: "keyed", scope: "root" },
				"conversation.chat.commandview": { kind: "keyed", scope: "session" },
				"sidebar.footer.action": { kind: "list", scope: "root" },
				"sidebar.workspaces": {
					kind: "single",
					scope: "root",
					inject: {
						hooks: {
							sectionScroller: (_standard, { useSectionScroller }) =>
								useSectionScroller,
						},
					} satisfies SidebarSectionInjected,
				},
				"conversation.input.left": { kind: "list", scope: "session" },
			},
		},
		(
			_props: PropsRenderSlots<
				| "sidebar.panellist"
				| "main"
				| "conversation.chat.commandview"
				| "sidebar.footer.action"
				| "sidebar.workspaces"
				| "conversation.input.left"
			>,
		) => null,
	);
	const declareSplitSlots = () => {
		const removeMain = ctx.slots.register(
			{
				name: "main",
				key: "split-view",
				children: {
					"split.pane": { kind: "single", scope: "session" },
				},
			},
			(_props: PropsRenderSlots<"split.pane">) => null,
		);
		ctx.slots.register(
			{
				name: "split.pane",
				children: {
					"split.pane.status": { kind: "single", scope: "session" },
					"split.subagent.status": { kind: "single", scope: "session" },
				},
			},
			(
				_props: PropsRenderSlots<"split.pane.status" | "split.subagent.status">,
			) => null,
		);
		return removeMain;
	};

	const openSessionMock = vi.fn();
	const startSessionMock = vi.fn();
	ctx.provide("uiWorkspace", {
		openSession: openSessionMock,
		startSession: startSessionMock,
	});
	ctx.provide("sidebarRight", { openResource: () => {} });
	const link = {
		href: "original.ico",
		getAttribute: () => "original.ico",
		setAttribute: (_key: string, value: string) => {
			link.href = value;
		},
	};
	vi.stubGlobal("document", {
		querySelectorAll: () => [link],
		createElement: () => ({ setAttribute: () => {}, remove: () => {} }),
		head: { appendChild: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {},
	});
	const [running, review, secondReview] = ["running", "review", "review-2"].map(
		(name): SessionSummary => {
			// edge case: SessionId is branded; test IDs stand in for server-issued IDs.
			const id = name as SessionId;
			return {
				id,
				displayTitle: name,
				running: name === "running",
				blank: false,
				updatedAt: 1000,
				retainedBy: {},
				projectionValues: {
					kanban: { links: [], sessionId: id, createdAt: 1000 },
				},
			};
		},
	);
	let visibleSessions: SessionSummary[] = [];
	const sessionListeners = new Set<() => void>();
	const remoteSearch = async () => ({
		ok: true,
		value: { items: [], hasMore: false },
	});
	ctx.provide("remote", {
		$mount: async () => {},
		kanban: { search: remoteSearch },
		workspaceFiles: {},
	});
	ctx.provide("remote.kanban", { search: remoteSearch });
	const splitState = {
		sessionIds: [] as SessionId[],
		focusedSessionId: undefined as SessionId | undefined,
		maximizedSessionId: undefined as SessionId | undefined,
		suspended: false,
		overlays: new Map(),
	};
	const splitViewListeners = new Set<() => void>();
	const splitViewMock = {
		setFallbackPanelId: vi.fn(),
		getSnapshot: () => ({ ...splitState }),
		subscribe: (listener: () => void) => {
			splitViewListeners.add(listener);
			return () => splitViewListeners.delete(listener);
		},
		isSuspended: () => splitState.suspended,
		isSplitActive: () =>
			splitState.sessionIds.length > 0 && !splitState.suspended,
		toggleSession: vi.fn((id: SessionId) => {
			if (!splitState.sessionIds.includes(id)) {
				splitState.sessionIds.push(id);
				splitState.focusedSessionId = id;
			}
			for (const l of splitViewListeners) l();
		}),
		openSession: vi.fn((id: SessionId) => {
			splitState.sessionIds = [id];
			splitState.focusedSessionId = id;
			for (const l of splitViewListeners) l();
		}),
		removeSession: vi.fn(),
		resetToSingle: vi.fn(() => {
			splitState.sessionIds = [];
			for (const l of splitViewListeners) l();
		}),
		suspend: vi.fn(),
		resume: vi.fn(),
		setFocus: vi.fn(),
		toggleMaximize: vi.fn((id: SessionId) => {
			if (splitState.sessionIds.length <= 1) return;
			splitState.maximizedSessionId =
				splitState.maximizedSessionId === id ? undefined : id;
			for (const l of splitViewListeners) l();
		}),
	};
	const installSplit = () =>
		ctx.plugin({
			apply(provider) {
				provider.provide("splitView", splitViewMock);
			},
		});
	ctx.provide("remote.workspaceFiles", {});
	let createdSessionCount = 0;
	ctx.provide("sessions", {
		create: vi.fn(async (_opts?: { workspaceId?: string }) => {
			createdSessionCount += 1;
			return `created-session-${createdSessionCount}` as SessionId;
		}),
		using: vi.fn(
			async (
				_id: SessionId,
				_opts: unknown,
				op: (ref: {
					binding: {
						session: { command: (cmd: string) => Promise<unknown> };
					};
				}) => Promise<unknown>,
			) => {
				return op({
					binding: {
						session: { command: async () => ({ ok: true }) },
					},
				});
			},
		),
		retain: vi.fn((id: SessionId) => ({ release: vi.fn(), sessionId: id })),
		search: async () => ({ ok: true, value: { items: [], hasMore: false } }),
		searchResultLimit: 20,
		refreshProjections: async () => {},
		list: {
			getSnapshot: () => ({
				ids: visibleSessions.map((session) => session.id),
				byId: Object.fromEntries(
					visibleSessions.map((session) => [session.id, session]),
				),
				phase: "settled",
				projectionsBySession: {},
			}),
			subscribe: (listener: () => void) => {
				sessionListeners.add(listener);
				return () => sessionListeners.delete(listener);
			},
		},
	});
	ctx.provide("workspaces", {
		list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} },
	});
	ctx.provide("uiSession", {
		sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} },
	});
	let activePanelId: string | null = null;
	ctx.provide("layout", {
		selectPanel: (id: string | null) => {
			activePanelId = id;
		},
		panelInfo: {
			getSnapshot: () => ({ activePanelId }),
			subscribe: () => () => {},
		},
	});

	const fiber = ctx.plugin(clientPlugin);
	await fiber.await();

	expect(fiber.state).toBe(2);
	const nativeActions = ctx.slots
		.entries("main")
		.find((slot) => slot.options.key === "kanban");
	expect(nativeActions).toBeDefined();
	// edge case: the slot registry erases the component-specific injected props.
	const native = (
		nativeActions as unknown as {
			inject: () => {
				startTask: () => Promise<void>;
				selectSession: (id: SessionId) => void;
				markDone: (id: SessionId) => Promise<void>;
				deleteSession: (id: SessionId) => Promise<void>;
			};
		}
	).inject();
	await native.startTask();
	expect(openSessionMock).toHaveBeenCalledWith("created-session-1");
	native.selectSession(review.id);
	expect(openSessionMock).toHaveBeenCalledWith(review.id);
	await native.markDone(review.id);
	await native.deleteSession(review.id);
	createdSessionCount = 0;
	openSessionMock.mockClear();
	expect(ctx.slots.entries("split.pane.status")).toHaveLength(0);
	let splitProvider = installSplit();
	await splitProvider.await();
	let favicon = ctx.plugin(faviconPlugin);
	await favicon.await();
	let removeSplit = declareSplitSlots();
	for (let lifetime = 0; lifetime < 2; lifetime += 1) {
		expect(ctx.slots.entries("split.pane.status")).toHaveLength(1);
		expect(ctx.slots.entries("split.subagent.status")).toHaveLength(1);
		removeSplit();
		expect(ctx.slots.entries("split.pane.status")).toHaveLength(0);
		expect(ctx.slots.entries("split.subagent.status")).toHaveLength(0);
		removeSplit = declareSplitSlots();
	}

	// 2 is FiberState.ACTIVE
	expect(fiber.state).toBe(2);
	expect(link.href).toBe("original.ico");
	for (const [sessions, expectedHref] of [
		[[review, secondReview], renderFaviconBadgeUri({ review: 2, running: 0 })],
		[
			[running, review, secondReview],
			renderFaviconBadgeUri({ review: 2, running: 1 }),
		],
		[[running], renderFaviconBadgeUri({ review: 0, running: 1 })],
		[[running, review], renderFaviconBadgeUri({ review: 1, running: 1 })],
		[[], "original.ico"],
		[[running, review], renderFaviconBadgeUri({ review: 1, running: 1 })],
		[[review], renderFaviconBadgeUri({ review: 1, running: 0 })],
	] satisfies [SessionSummary[], string][]) {
		visibleSessions = sessions;
		for (const listener of sessionListeners) listener();
		expect(link.href).toBe(expectedHref);
	}

	const commandView = ctx.slots
		.entries("conversation.chat.commandview")
		.find((slot) => slot.options.key === "kanban");
	expect(commandView).toBeDefined();

	const transitionDropdownSlot = ctx.slots
		.entries("conversation.input.left")
		.find((slot) => slot.options.id === "kanban.transition-dropdown");
	expect(transitionDropdownSlot).toBeDefined();
	const renderFn = commandView?.component as (props?: {
		node: { args?: string | null; outcome?: { text?: string } | null };
	}) => unknown;
	expect(
		renderFn({
			node: { args: '{"action":"done"}', outcome: { text: "done" } },
		}),
	).toBeNull();
	expect(
		renderFn({
			node: { args: "", outcome: { text: "Session enabled in Kanban" } },
		}),
	).toBeNull();
	expect(
		renderFn({
			node: { args: null, outcome: { text: "Session enabled in Kanban" } },
		}),
	).toBeNull();

	// In workspaces mode: top sidebar icon is registered, footer action is removed
	const panelIcon = ctx.slots.entries("sidebar.panellist")[0];
	expect(panelIcon).toBeDefined();
	expect(panelIcon?.options.id).toBe("kanban");
	expect(ctx.slots.entries("sidebar.footer.action")[0]).toBeUndefined();

	// In workspaces mode: sidebar.workspaces is unshadowed so native workspace browser remains 100% intact
	expect(ctx.slots.entries("sidebar.workspaces")[0]).toBeUndefined();

	// Switch mode to "kanban": sidebar.workspaces is shadowed with priority -10, and top sidebar icon is hidden
	ctx.sidebarMode.setMode("kanban");
	const shadowedWorkspaces = ctx.slots.entries("sidebar.workspaces")[0];
	expect(shadowedWorkspaces).toBeDefined();
	expect(shadowedWorkspaces?.options.priority).toBe(-10);
	expect(ctx.slots.entries("sidebar.panellist")[0]).toBeUndefined();

	const injected = (
		shadowedWorkspaces as unknown as {
			inject: () => {
				startTask: (ws?: string) => Promise<void>;
				markDone: (id: SessionId) => Promise<void>;
			};
		}
	)?.inject();
	expect(injected).toBeDefined();

	// 1. Not in split mode: startTask opens session in split view
	await injected.startTask("ws-1");
	expect(splitViewMock.openSession).toHaveBeenCalledWith("created-session-1");
	expect(splitViewMock.getSnapshot().sessionIds).toEqual(["created-session-1"]);

	// 2. In split mode: startTask delegates to ctx.splitView.toggleSession
	openSessionMock.mockClear();
	splitState.sessionIds = [running.id, secondReview.id];
	activePanelId = "split-view";
	await injected.startTask("ws-1");
	expect(splitViewMock.toggleSession).toHaveBeenCalledWith("created-session-2");
	expect(openSessionMock).not.toHaveBeenCalled();

	// 3. markDone removes session from split view if present
	await injected.markDone(running.id);
	expect(splitViewMock.removeSession).toHaveBeenCalledWith(running.id);

	await native.deleteSession(running.id);
	expect(splitViewMock.removeSession).toHaveBeenCalledWith(running.id);

	// 4. Sessions marked done in list remain in split view until explicitly closed
	splitViewMock.removeSession.mockClear();
	const doneSession: SessionSummary = {
		...secondReview,
		projectionValues: {
			kanban: {
				createdAt: 1000,
				doneAt: Date.now(),
				links: [],
				sessionId: secondReview.id,
			},
		},
	};
	visibleSessions = [doneSession];
	for (const listener of sessionListeners) listener();
	expect(splitViewMock.removeSession).not.toHaveBeenCalled();

	await splitProvider.dispose();
	expect(splitViewMock.setFallbackPanelId).toHaveBeenLastCalledWith(null);
	expect(splitViewListeners.size).toBe(0);
	expect(ctx.slots.entries("split.pane.status")).toHaveLength(0);
	native.selectSession(review.id);
	expect(openSessionMock).toHaveBeenCalledWith(review.id);
	splitProvider = installSplit();
	await splitProvider.await();
	expect(splitViewMock.setFallbackPanelId).toHaveBeenLastCalledWith("kanban");

	// 5. Board selection adds a maximized pane instead of replacing the split
	splitState.sessionIds = [running.id, secondReview.id];
	splitState.focusedSessionId = running.id;
	splitState.maximizedSessionId = undefined;
	splitViewMock.openSession.mockClear();
	splitViewMock.toggleSession.mockClear();
	splitViewMock.toggleMaximize.mockClear();
	openSessionMock.mockClear();
	native.selectSession(review.id);
	expect(splitViewMock.toggleSession).toHaveBeenCalledWith(review.id);
	expect(splitViewMock.toggleMaximize).toHaveBeenCalledWith(review.id);
	expect(splitViewMock.openSession).not.toHaveBeenCalled();
	expect(openSessionMock).not.toHaveBeenCalled();

	visibleSessions = [running, review];
	for (const listener of sessionListeners) listener();
	expect(link.href).toBe(renderFaviconBadgeUri({ review: 1, running: 1 }));
	await favicon.dispose();
	expect(link.href).toBe("original.ico");
	favicon = ctx.plugin(faviconPlugin);
	await favicon.await();
	expect(link.href).toBe(renderFaviconBadgeUri({ review: 1, running: 1 }));
	// Switch mode back to "workspaces": sidebar.workspaces is disposed and top sidebar icon returns
	ctx.sidebarMode.setMode("workspaces");
	expect(ctx.slots.entries("sidebar.workspaces")[0]).toBeUndefined();
	expect(ctx.slots.entries("sidebar.panellist")[0]).toBeDefined();
	await fiber.dispose();
	expect(link.href).toBe(renderFaviconBadgeUri({ review: 0, running: 1 }));
	expect(sessionListeners.size).toBe(1);
	await favicon.dispose();
	expect(link.href).toBe("original.ico");
	expect(sessionListeners.size).toBe(0);
	expect(ctx.slots.entries("split.pane.status")).toHaveLength(0);
	expect(ctx.slots.entries("split.subagent.status")).toHaveLength(0);
	removeSplit();
	removeSplit = declareSplitSlots();
	expect(ctx.slots.entries("split.pane.status")).toHaveLength(0);
	expect(ctx.slots.entries("split.subagent.status")).toHaveLength(0);
	const reactivated = ctx.plugin(clientPlugin);
	await reactivated.await();
	expect(reactivated.state).toBe(2);
	expect(ctx.slots.entries("split.pane.status")).toHaveLength(1);
	expect(ctx.slots.entries("split.subagent.status")).toHaveLength(1);
	await reactivated.dispose();
	removeSplit();
	await registryFiber.dispose();
});
