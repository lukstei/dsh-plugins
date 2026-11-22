import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { expect, test, vi } from "vitest";
import { createNavigation } from "../src/client/navigation.ts";

test("focusSession appends to an existing split without replacing membership", () => {
	// edge case: test IDs stand in for server-issued branded IDs.
	const [a, b, c] = ["a", "b", "c"] as SessionId[];
	const ids: SessionId[] = [];
	let focused: SessionId | undefined;
	const navigation = createNavigation(vi.fn());
	navigation.connect(
		{
			getSnapshot: () => ({
				sessionIds: [...ids],
				focusedSessionId: focused,
				maximizedSessionId: undefined,
				suspended: false,
			}),
			openSession: (id) => {
				if (!ids.includes(id)) {
					ids.length = 0;
					ids.push(id);
				}
				focused = id;
			},
			toggleSession: (id) => {
				const index = ids.indexOf(id);
				if (index >= 0) ids.splice(index, 1);
				else ids.push(id);
				focused = id;
			},
			toggleMaximize: () => {},
			removeSession: () => {},
			startTask: () => {},
			setHoveredSession: () => {},
		},
		() => () => {},
	);

	navigation.toggleSession(a);
	navigation.toggleSession(b);
	navigation.focusSession(c);
	expect(ids).toEqual([a, b, c]);
	expect(focused).toBe(c);

	navigation.focusSession(a);
	expect(ids).toEqual([a, b, c]);
	expect(focused).toBe(a);
});

test("maximizeSession adds a maximized pane and keeps an already maximized pane", () => {
	// edge case: test IDs stand in for server-issued branded IDs.
	const [a, b, c] = ["a", "b", "c"] as SessionId[];
	const ids: SessionId[] = [];
	let focused: SessionId | undefined;
	let maximized: SessionId | undefined;
	const toggleMaximize = vi.fn((id: SessionId) => {
		if (ids.length <= 1) return;
		maximized = maximized === id ? undefined : id;
	});
	const navigation = createNavigation(vi.fn());
	navigation.connect(
		{
			getSnapshot: () => ({
				sessionIds: [...ids],
				focusedSessionId: focused,
				maximizedSessionId: maximized,
				suspended: false,
			}),
			openSession: (id) => {
				if (!ids.includes(id)) {
					ids.length = 0;
					ids.push(id);
				}
				focused = id;
				maximized = undefined;
			},
			toggleSession: (id) => {
				const index = ids.indexOf(id);
				if (index >= 0) ids.splice(index, 1);
				else ids.push(id);
				focused = id;
			},
			toggleMaximize,
			removeSession: () => {},
			startTask: () => {},
			setHoveredSession: () => {},
		},
		() => () => {},
	);

	navigation.toggleSession(a);
	navigation.toggleSession(b);
	navigation.maximizeSession(c);
	expect(ids).toEqual([a, b, c]);
	expect(maximized).toBe(c);
	expect(focused).toBe(c);

	toggleMaximize.mockClear();
	navigation.maximizeSession(c);
	expect(maximized).toBe(c);
	expect(toggleMaximize).not.toHaveBeenCalled();

	navigation.maximizeSession(a);
	expect(maximized).toBe(a);

	// a single pane is already full width
	navigation.toggleSession(b);
	navigation.toggleSession(c);
	expect(ids).toEqual([a]);
	toggleMaximize.mockClear();
	navigation.maximizeSession(a);
	expect(maximized).toBeUndefined();
	expect(toggleMaximize).not.toHaveBeenCalled();
});

test("late integration updates membership and disposal restores native navigation", () => {
	// edge case: test IDs stand in for server-issued branded IDs.
	const id = "session" as SessionId;
	const open = vi.fn();
	const navigation = createNavigation(open);
	const listener = vi.fn();
	const unsubscribe = navigation.subscribe(listener);
	const empty = navigation.getSnapshot();
	navigation.startTask(id);
	navigation.toggleSession(id);
	expect(open).toHaveBeenCalledTimes(2);
	const snapshot = {
		sessionIds: [id],
		focusedSessionId: id,
		maximizedSessionId: undefined,
		suspended: false,
	};
	const toggle = vi.fn();
	const remove = vi.fn();
	const hover = vi.fn();
	const off = vi.fn();
	let update = () => {};
	const disconnect = navigation.connect(
		{
			getSnapshot: () => snapshot,
			openSession: toggle,
			toggleSession: toggle,
			startTask: toggle,
			removeSession: remove,
			toggleMaximize: toggle,
			setHoveredSession: hover,
		},
		(cb) => {
			update = cb;
			return off;
		},
	);
	expect(navigation.getSnapshot()).toBe(snapshot);
	expect(listener).toHaveBeenCalledTimes(1);
	navigation.startTask(id);
	navigation.openSession(id);
	navigation.toggleSession(id);
	navigation.removeSession(id);
	navigation.setHoveredSession(id);
	expect(toggle).toHaveBeenCalledTimes(3);
	expect(remove).toHaveBeenCalledWith(id);
	expect(hover).toHaveBeenCalledExactlyOnceWith(id);
	update();
	expect(listener).toHaveBeenCalledTimes(2);
	disconnect();
	expect(off).toHaveBeenCalledOnce();
	expect(navigation.getSnapshot()).toBe(empty);
	expect(listener).toHaveBeenCalledTimes(3);
	navigation.startTask(id);
	navigation.openSession(id);
	navigation.toggleSession(id);
	navigation.removeSession(id);
	expect(open).toHaveBeenCalledTimes(5);
	expect(remove).toHaveBeenCalledOnce();
	expect(hover).toHaveBeenCalledOnce();
	navigation.setHoveredSession(id);
	expect(hover).toHaveBeenCalledOnce();
	unsubscribe();
});
