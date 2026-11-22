import "../src/client/dsh.d.ts";
import { Context } from "@deepseek-ai/cordis";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { afterEach, expect, test, vi } from "vitest";
import * as zod from "zod";
import { splitStore } from "../src/client/split-store.ts";

afterEach(() => {
	vi.unstubAllGlobals();
	splitStore.resetToSingle();
});

test("split-view client activation and split navigation test", async () => {
	let clientPlugin: unknown;
	(globalThis as unknown as { window: unknown }).window = {
		__ModuleLoader__: {
			load: ({
				factory,
			}: {
				id: string;
				factory: (require: (mod: string) => unknown) => unknown;
			}) => {
				clientPlugin = factory((module) => {
					if (module === "zod") return zod;
					if (module === "react")
						return {
							Component: class {},
							createContext: () => ({ Provider: () => null }),
						};
					return {};
				});
			},
		},
	};

	// @ts-expect-error Bundle output has no generated declaration file
	await import("../dist/client.js");
	expect(clientPlugin).toBeDefined();
	expect((clientPlugin as { inject: readonly string[] }).inject).toContain(
		"slots",
	);

	const ctx = new Context();

	const registeredSlots: {
		def: {
			name: string;
			key?: string;
			id?: string;
			order?: number;
			priority?: number;
			children?: Record<string, unknown>;
		};
		component?: unknown;
	}[] = [];

	ctx.provide("slots", {
		inject: (_key: string, cb: () => void) => {
			cb();
			return () => {};
		},
		register: (
			def: {
				name: string;
				key?: string;
				id?: string;
				order?: number;
				priority?: number;
				children?: Record<string, unknown>;
			},
			component?: unknown,
		) => {
			const validSlots = new Set([
				"main",
				"split.pane",
				"split.overlay",
				"conversation.session.header.utilities",
			]);
			if (!validSlots.has(def.name)) {
				throw new Error(`Undeclared slot registration: ${def.name}`);
			}
			const entry = { def, component };
			registeredSlots.push(entry);
			return () => {
				const idx = registeredSlots.indexOf(entry);
				if (idx !== -1) {
					registeredSlots.splice(idx, 1);
				}
			};
		},
	});

	const openSessionMock = vi.fn();
	const startSessionMock = vi.fn();
	ctx.provide("uiWorkspace", {
		openSession: openSessionMock,
		startSession: startSessionMock,
	});
	ctx.provide("sidebarRight", { openResource: () => {} });

	vi.stubGlobal("document", {
		querySelectorAll: () => [],
		createElement: () => ({ setAttribute: () => {}, remove: () => {} }),
		head: { appendChild: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {},
	});

	const [sessionA, sessionB] = ["session-a", "session-b"].map(
		(name, idx): SessionSummary => {
			const id = name as SessionId;
			return {
				id,
				displayTitle: name,
				running: false,
				blank: false,
				updatedAt: 1000,
				retainedBy: idx === 0 ? { mainView: 1 } : {},
				projectionValues: {},
			};
		},
	);

	const visibleSessions: SessionSummary[] = [sessionA, sessionB];
	const sessionListeners = new Set<() => void>();

	ctx.provide("remote", {
		workspaceFiles: {
			read: vi.fn(),
			readBytes: vi.fn(),
		},
	});
	ctx.provide("remote.workspaceFiles", {
		read: vi.fn(),
		readBytes: vi.fn(),
	});

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

	ctx.provide("workspaces", { list: { getSnapshot: () => ({ items: [] }) } });
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

	const fiber = ctx.plugin(clientPlugin as never, undefined as never);
	await fiber.await();

	// 2 is FiberState.ACTIVE
	expect(fiber.state).toBe(2);
	expect(ctx.splitView).toBeDefined();

	// Verify main panel slot registration
	const mainSlot = registeredSlots.find(
		(slot) => slot.def.name === "main" && slot.def.key === "split-view",
	);
	expect(mainSlot).toBeDefined();

	// Verify split.pane child slot registration
	const paneSlot = registeredSlots.find(
		(slot) => slot.def.name === "split.pane",
	);
	expect(paneSlot?.def.children).toHaveProperty("split.overlay");
	expect(paneSlot?.def.children).toHaveProperty("split.pane.status");
	expect(paneSlot?.def.children).toHaveProperty("split.subagent.status");

	// Verify restore control registration in header utilities
	const restoreControl = registeredSlots.find(
		(slot) =>
			slot.def.name === "conversation.session.header.utilities" &&
			slot.def.id === "split-view-restore",
	);
	expect(restoreControl).toBeDefined();

	// Toggle session into split mode
	ctx.splitView.toggleSession(sessionB.id);
	expect(activePanelId).toBe("split-view");
	expect(ctx.splitView.getSnapshot().sessionIds).toEqual([
		sessionA.id,
		sessionB.id,
	]);

	// In split mode: uiWorkspace.startSession opens session in a new additional split
	(ctx.uiWorkspace.startSession as (ws?: string) => void)("ws-1");
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(ctx.splitView.getSnapshot().sessionIds).toEqual([
		sessionA.id,
		sessionB.id,
		"created-session-1",
	]);
	expect(ctx.splitView.getSnapshot().focusedSessionId).toBe(
		"created-session-1",
	);

	// Toggle session from a non-null panel (e.g. kanban) does not pair stale mainView session
	ctx.splitView.resetToSingle();
	activePanelId = "kanban";
	ctx.splitView.toggleSession(sessionB.id);
	expect(ctx.splitView.getSnapshot().sessionIds).toEqual([sessionB.id]);

	await fiber.dispose();
});
