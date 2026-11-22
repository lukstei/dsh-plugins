import { Context } from "@deepseek-ai/cordis";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionStatus } from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("react", () => ({
	useState: vi.fn(),
	useEffect: vi.fn(),
	useMemo: vi.fn(),
	useCallback: vi.fn(),
	useRef: vi.fn(() => ({ current: null })),
	useSyncExternalStore: vi.fn(),
}));

vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: () => null,
	Fragment: Symbol.for("react.fragment"),
}));

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({ Menu: "Menu" }));

import { apply } from "../src/client/index.tsx";

afterEach(() => {
	vi.unstubAllGlobals();
});

test("background hydration requests projections only for sidebar-relevant sessions (active, running, alert)", async () => {
	const ctx = new Context();

	vi.stubGlobal("localStorage", {
		getItem: (key: string) =>
			key === "dsh-kanban-selected-workspace" ? "ws-1" : null,
	});

	ctx.provide("slots", {
		inject: (_key: string, cb: () => void) => {
			cb();
			return () => {};
		},
		register: () => () => {},
	});

	ctx.provide("uiWorkspace", { openSession: () => {} });
	ctx.provide("sidebarRight", { openResource: () => {} });

	const sActive = "s-active" as SessionId;
	const sRunning = "s-running" as SessionId;
	const sAlert = "s-alert" as SessionId;
	const sIdle = "s-idle" as SessionId;
	const sAlready = "s-already" as SessionId;

	const sessionStatusMap = new Map<SessionId, SessionStatus>([
		[
			sAlert,
			{
				running: false,
				completionUnread: false,
				pendingInteraction: {
					kind: "question",
				} as unknown as SessionStatus["pendingInteraction"],
			},
		],
	]);

	ctx.provide("uiSession", {
		sessionStatus: {
			getSnapshot: () => sessionStatusMap,
			subscribe: () => () => {},
		},
	});
	ctx.provide("layout", {
		selectPanel: () => {},
		panelInfo: {
			getSnapshot: () => ({ activePanelId: null }),
			subscribe: () => () => {},
		},
	});

	const remoteSearch = async () => ({
		ok: true as const,
		value: { items: [], hasMore: false },
	});
	ctx.provide("remote", {
		$mount: async () => {
			ctx.provide("remote.kanban", { search: remoteSearch });
		},
		kanban: { search: remoteSearch },
		workspaceFiles: {},
	});
	ctx.provide("remote.workspaceFiles", {});

	const now = Date.now();
	const sessionsById: Record<string, SessionSummary> = {
		[sActive]: {
			id: sActive,
			displayTitle: "Active Session",
			running: false,
			blank: false,
			updatedAt: now - 1000,
			retainedBy: { mainView: 1 },
		},
		[sRunning]: {
			id: sRunning,
			displayTitle: "Running Session",
			running: true,
			blank: false,
			updatedAt: now - 1000,
			retainedBy: {},
		},
		[sAlert]: {
			id: sAlert,
			displayTitle: "Alert Session",
			running: false,
			blank: false,
			updatedAt: now - 1000,
			retainedBy: {},
		},
		[sIdle]: {
			id: sIdle,
			displayTitle: "Idle Workspace Session",
			running: false,
			blank: false,
			updatedAt: now - 500,
			retainedBy: {},
		},
		[sAlready]: {
			id: sAlready,
			displayTitle: "Already Hydrated Session",
			running: true,
			blank: false,
			updatedAt: now - 500,
			retainedBy: {},
			projectionValues: { kanban: null },
		},
	};

	const refreshProjections = vi.fn(async (_id: SessionId) => {});

	ctx.provide("sessions", {
		search: async () => ({
			ok: true as const,
			value: { items: [], hasMore: false },
		}),
		searchResultLimit: 20,
		refreshProjections,
		list: {
			getSnapshot: () => ({
				ids: [sActive, sRunning, sAlert, sIdle, sAlready],
				byId: sessionsById,
				phase: "settled",
				projectionsBySession: {},
			}),
			subscribe: () => () => {},
		},
	});

	ctx.provide("workspaces", {
		list: {
			getSnapshot: () => ({
				items: [
					{
						workspaceId: "ws-1",
						path: "/path/ws-1",
						sessionIds: [sActive, sRunning, sAlert, sIdle],
						title: "Workspace 1",
						createdAt: "2026-10-29T00:00:00Z",
						updatedAt: "2026-10-29T00:00:00Z",
					},
				],
			}),
			subscribe: () => () => {},
		},
	});

	const fiber = ctx.plugin({ apply });
	await fiber.await();

	// Active session in main view is hydrated
	expect(refreshProjections).toHaveBeenCalledWith(sActive);

	// Running background session is hydrated
	expect(refreshProjections).toHaveBeenCalledWith(sRunning);

	// Session with pending interaction/alert is hydrated
	expect(refreshProjections).toHaveBeenCalledWith(sAlert);

	// Idle cold session in workspace is NOT hydrated on reload
	expect(refreshProjections).not.toHaveBeenCalledWith(sIdle);

	// Already-hydrated session is skipped
	expect(refreshProjections).not.toHaveBeenCalledWith(sAlready);
});
