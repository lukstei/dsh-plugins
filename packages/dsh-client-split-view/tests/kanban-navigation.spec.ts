import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { beforeEach, expect, test, vi } from "vitest";
import { createNavigation } from "../../dsh-client-kanban/src/client/navigation.ts";
import { SplitStore } from "../src/client/split-store.ts";

// edge case: test IDs stand in for server-issued branded IDs.
const [a, b, c] = ["a", "b", "c"] as SessionId[];
const release = vi.fn();
const nativeOpen = vi.fn();
let split: SplitStore;
let navigation: ReturnType<typeof createNavigation>;

beforeEach(() => {
	vi.clearAllMocks();
	split = new SplitStore();
	// edge case: these transitions only use the session controller's retain/release contract.
	const sessions = { retain: () => ({ release }) } as unknown as ISessions;
	split.setCallbacks(
		() => {},
		nativeOpen,
		() => sessions,
		() => undefined,
	);
	navigation = createNavigation(nativeOpen);
	navigation.connect(
		{
			getSnapshot: split.getSnapshot,
			openSession: split.openSession,
			toggleSession: split.toggleSession,
			toggleMaximize: split.toggleMaximize,
			removeSession: split.removeSession,
			setHoveredSession: split.setHoveredSession,
			startTask: (id) =>
				split.isSplitActive() ? split.toggleSession(id) : split.openSession(id),
		},
		split.subscribe,
	);
	split.openSession(a);
	split.toggleSession(b);
});

test("focus and double-click toggling preserve membership and overlays", () => {
	split.openFileOverlay(a, {
		address: "file",
		ownerSessionId: a,
		path: "a.ts",
		title: "a.ts",
	});
	const overlay = split.getOverlay(a);
	navigation.focusSession(a);
	navigation.toggleMaximize(a);
	navigation.focusSession(a);
	navigation.toggleMaximize(a);
	expect(split.getSnapshot()).toMatchObject({
		sessionIds: [a, b],
		focusedSessionId: a,
		maximizedSessionId: undefined,
		suspended: false,
	});
	expect(split.getOverlay(a)).toBe(overlay);
	expect(release).not.toHaveBeenCalled();
});

test("focusing an absent target adds it and restores a different maximized pane", () => {
	split.toggleMaximize(a);
	navigation.focusSession(c);
	expect(split.getSnapshot()).toMatchObject({
		sessionIds: [a, b, c],
		focusedSessionId: c,
		maximizedSessionId: undefined,
	});
	navigation.focusSession(c);
	navigation.toggleMaximize(c);
	expect(split.getSnapshot().maximizedSessionId).toBe(c);
	expect(release).not.toHaveBeenCalled();
});

test("focusing a retained foreign pane restores the split without removing either pane", () => {
	split.toggleMaximize(a);
	navigation.focusSession(b);
	expect(split.getSnapshot()).toMatchObject({
		sessionIds: [a, b],
		focusedSessionId: b,
		maximizedSessionId: undefined,
	});
});

test("modified membership toggle restores foreign maximization, restore preserves membership", () => {
	split.toggleMaximize(a);
	navigation.toggleSession(c);
	expect(split.getSnapshot().maximizedSessionId).toBeUndefined();
	navigation.focusSession(c);
	navigation.toggleMaximize(c);
	navigation.toggleMaximize(c);
	expect(split.getSnapshot()).toMatchObject({
		sessionIds: [a, b, c],
		maximizedSessionId: undefined,
	});
});

test("focus resumes a suspended split, and a single pane needs no maximized state", () => {
	split.suspend(a);
	navigation.focusSession(a);
	expect(split.getSnapshot().suspended).toBe(false);
	split.resetToSingle();
	navigation.focusSession(c);
	navigation.toggleMaximize(c);
	expect(split.getSnapshot()).toMatchObject({
		sessionIds: [c],
		maximizedSessionId: undefined,
	});
});

test("starting a new task or adding a session restores fullscreen layout", () => {
	split.toggleMaximize(a);
	expect(split.getSnapshot().maximizedSessionId).toBe(a);
	navigation.startTask(c);
	expect(split.getSnapshot().maximizedSessionId).toBeUndefined();

	split.toggleMaximize(a);
	expect(split.getSnapshot().maximizedSessionId).toBe(a);
	const d = "d" as SessionId;
	split.toggleSession(d);
	expect(split.getSnapshot().maximizedSessionId).toBeUndefined();
	expect(split.getSnapshot().sessionIds).toContain(d);
});

test("native fallback opens normally and has no fullscreen state", () => {
	const native = createNavigation(nativeOpen);
	native.focusSession(a);
	native.focusSession(b);
	native.toggleMaximize(b);
	expect(nativeOpen.mock.calls).toEqual([[a], [b]]);
	expect(native.getSnapshot().maximizedSessionId).toBeUndefined();
});
