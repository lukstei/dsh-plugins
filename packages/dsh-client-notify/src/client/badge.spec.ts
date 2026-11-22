import { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, test, vi } from "vitest";
import * as plugin from "./index.ts";

afterEach(() => vi.unstubAllGlobals());

test("app badge sums pending interactions and recent review, then clears on dispose", async () => {
	const setAppBadge = vi.fn(() => Promise.resolve());
	const clearAppBadge = vi.fn(() => Promise.resolve());
	vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });
	vi.stubGlobal("window", {
		addEventListener: () => {},
		removeEventListener: () => {},
	});
	let status = new Map<string, { pendingInteraction?: object }>();
	const listeners = new Set<() => void>();
	const ctx = new Context();
	ctx.provide("remote", { $on: () => () => {} });
	ctx.provide("remote.session", {});
	ctx.provide("sessions", {
		subagentAddress: () => undefined,
		list: { getSnapshot: () => ({ byId: {} }) },
	});
	ctx.provide("uiSession", {
		sessionStatus: {
			getSnapshot: () => status,
			subscribe: (fn: () => void) => {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		},
	});
	const fiber = ctx.plugin(plugin);
	await fiber.await();

	expect(clearAppBadge).not.toHaveBeenCalled();
	ctx.appBadge.setRecentReviewCount(2);
	expect(setAppBadge).toHaveBeenLastCalledWith(2);

	status = new Map([
		["a", { pendingInteraction: { key: "k", kind: "plan-review" } }],
		["b", {}],
	]);
	for (const fn of listeners) fn();
	expect(setAppBadge).toHaveBeenLastCalledWith(3);

	setAppBadge.mockClear();
	ctx.appBadge.setRecentReviewCount(2);
	expect(setAppBadge).not.toHaveBeenCalled();

	await fiber.dispose();
	expect(clearAppBadge).toHaveBeenCalled();
});
