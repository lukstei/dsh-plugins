import "../src/client/dsh.d.ts";
import { Context } from "@deepseek-ai/cordis";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { afterEach, expect, test, vi } from "vitest";
import * as zod from "zod";
import {
	SPLIT_VIEW_STORAGE_KEY,
	splitStore,
} from "../src/client/split-store.ts";

const RESTORED_ID = "session-restored" as SessionId;

interface ClientPlugin {
	inject: readonly string[];
	apply: (ctx: Context) => void;
}

let loadedClientPlugin: ClientPlugin | undefined;

/** Load the client bundle with the same stubs the activation spec uses. */
async function loadClientPlugin(): Promise<ClientPlugin> {
	// edge case: the bundle is evaluated once per test file, so later tests reuse the factory result
	if (loadedClientPlugin !== undefined) return loadedClientPlugin;
	const loaded: { plugin?: ClientPlugin } = {};
	vi.stubGlobal("window", {
		innerWidth: 1200,
		__ModuleLoader__: {
			load: ({
				factory,
			}: {
				id: string;
				factory: (require: (mod: string) => unknown) => unknown;
			}) => {
				loaded.plugin = factory((module) => {
					if (module === "zod") return zod;
					if (module === "react")
						return {
							Component: class {},
							createContext: () => ({ Provider: () => null }),
						};
					return {};
				}) as ClientPlugin;
			},
		},
	});
	// @ts-expect-error Bundle output has no generated declaration file
	await import("../dist/client.js");
	loadedClientPlugin = loaded.plugin as ClientPlugin;
	return loadedClientPlugin;
}

/** Browser globals the plugin touches during activation and hydration. */
function stubBrowserStorage(): void {
	vi.stubGlobal("document", {
		querySelectorAll: () => [],
		createElement: () => ({ setAttribute: () => {}, remove: () => {} }),
		head: { appendChild: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {},
	});
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			storage.set(key, value);
		},
		removeItem: (key: string) => {
			storage.delete(key);
		},
	});
}

/**
 * Activation world where `layout.selectPanel` rejects an unregistered main key,
 * exactly as `ILayout.selectPanel` does.
 */
function createHarness(): {
	ctx: Context;
	activePanelId: () => string | null;
	emitSessionList: (ids: readonly SessionId[]) => void;
} {
	const registeredMainKeys = new Set<string>();
	const listListeners = new Set<() => void>();
	let listedIds: SessionId[] = [RESTORED_ID];
	let activePanelId: string | null = null;
	const ctx = new Context();

	const summary: SessionSummary = {
		id: RESTORED_ID,
		displayTitle: "restored",
		running: false,
		blank: false,
		updatedAt: 1,
		retainedBy: {},
		projectionValues: {},
	};

	ctx.provide("slots", {
		inject: (_key: string, callback: () => void) => {
			callback();
			return () => {};
		},
		register: (def: { name: string; key?: string }) => {
			if (def.name === "main" && def.key !== undefined) {
				registeredMainKeys.add(def.key);
			}
			return () => {
				if (def.key !== undefined) registeredMainKeys.delete(def.key);
			};
		},
	});
	ctx.provide("layout", {
		selectPanel: (id: string | null) => {
			if (id !== null && !registeredMainKeys.has(id)) {
				throw new Error(
					`layout.selectPanel: main panel "${id}" is not registered`,
				);
			}
			activePanelId = id;
		},
		panelInfo: {
			getSnapshot: () => ({ activePanelId }),
			subscribe: () => () => {},
		},
	});
	ctx.provide("sessions", {
		list: {
			getSnapshot: () => ({
				ids: [...listedIds],
				byId: { [RESTORED_ID]: summary },
				phase: "ready",
				projectionsBySession: {},
			}),
			subscribe: (listener: () => void) => {
				listListeners.add(listener);
				return () => {
					listListeners.delete(listener);
				};
			},
		},
		retain: (id: SessionId) => ({ release: () => {}, sessionId: id }),
		subagentAddress: () => undefined,
	});
	ctx.provide("uiSession", {
		sessionStatus: {
			getSnapshot: () => new Map(),
			subscribe: () => () => {},
		},
	});
	ctx.provide("uiWorkspace", {
		openSession: () => {},
		startSession: () => {},
	});
	ctx.provide("sidebarRight", { openResource: () => {} });
	const workspaceFiles = { read: vi.fn(), readBytes: vi.fn() };
	ctx.provide("remote", { workspaceFiles });
	ctx.provide("remote.workspaceFiles", workspaceFiles);

	return {
		ctx,
		activePanelId: () => activePanelId,
		emitSessionList: (ids) => {
			listedIds = [...ids];
			for (const listener of listListeners) listener();
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	splitStore.resetToSingle();
});

test("restores a persisted split into the split panel", async () => {
	stubBrowserStorage();
	localStorage.setItem(
		SPLIT_VIEW_STORAGE_KEY,
		JSON.stringify({
			version: 1,
			sessionIds: [RESTORED_ID],
			focusedSessionId: RESTORED_ID,
			suspended: false,
			overlays: [],
		}),
	);

	const clientPlugin = await loadClientPlugin();
	const { ctx, activePanelId } = createHarness();
	const fiber = ctx.plugin(clientPlugin as never, undefined as never);
	await fiber;
	// 2 is FiberState.ACTIVE
	expect(fiber.state).toBe(2);
	expect(activePanelId()).toBe("split-view");
	await fiber.dispose();
});

test("keeps a pane whose session left the session list", async () => {
	stubBrowserStorage();
	localStorage.setItem(
		SPLIT_VIEW_STORAGE_KEY,
		JSON.stringify({
			version: 1,
			sessionIds: [RESTORED_ID],
			focusedSessionId: RESTORED_ID,
			suspended: false,
			overlays: [],
		}),
	);

	const clientPlugin = await loadClientPlugin();
	const { ctx, emitSessionList } = createHarness();
	const fiber = ctx.plugin(clientPlugin as never, undefined as never);
	await fiber;

	// A full list pull that omits the pane's session must not collapse the split.
	emitSessionList([]);
	expect(ctx.splitView.getSnapshot().sessionIds).toEqual([RESTORED_ID]);

	await fiber.dispose();
});
