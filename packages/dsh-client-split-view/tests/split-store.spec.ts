declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface SlotFactoryMap {
		"split.test": { scope: "session" };
		"split.props-test": {
			scope: "session";
			props: { query: string; options: { line: number } };
		};
	}
}

import type {
	ISessions,
	SessionReference,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import {
	SPLIT_VIEW_STORAGE_KEY,
	splitStore,
} from "../src/client/split-store.ts";

function createMockSessions(): {
	sessions: ISessions;
	retained: Map<SessionId, { release: () => void }>;
} {
	const retained = new Map<SessionId, { release: () => void }>();
	const sessionsList = {
		phase: "ready" as const,
		ids: [] as SessionId[],
		byId: {} as Record<string, unknown>,
	};
	const sessions = {
		retain: vi.fn((id: SessionId) => {
			const release = vi.fn();
			const ref = { release, sessionId: id } as unknown as SessionReference;
			retained.set(id, { release });
			return ref;
		}),
		list: {
			getSnapshot: () => sessionsList,
		},
	} as unknown as ISessions;
	return { sessions, retained };
}

describe("SplitStore", () => {
	const sid = (id: string) => id as SessionId;

	let sessions: ISessions;
	let retained: Map<SessionId, { release: () => void }>;
	let selectPanel: Mock<(id: string | null) => void>;
	let openSession: Mock<(id: SessionId) => void>;
	let activeId: SessionId | undefined;

	beforeEach(() => {
		const mock = createMockSessions();
		sessions = mock.sessions;
		retained = mock.retained;
		selectPanel = vi.fn<(id: string | null) => void>();
		openSession = vi.fn<(id: SessionId) => void>();
		activeId = sid("s1");
		splitStore.setFallbackPanelId(null);
		splitStore.setCallbacks(
			selectPanel,
			openSession,
			() => sessions,
			() => activeId,
		);
		splitStore.resetToSingle();
	});

	it("initializes with empty split state", () => {
		const state = splitStore.getSnapshot();
		expect(state.sessionIds).toEqual([]);
		expect(state.focusedSessionId).toBeUndefined();
	});

	it("enters 2-way split on Cmd+Click from single view", () => {
		splitStore.toggleSession(sid("s2"));

		const state = splitStore.getSnapshot();
		expect(state.sessionIds).toEqual([sid("s1"), sid("s2")]);
		expect(state.focusedSessionId).toBe(sid("s2"));
		expect(selectPanel).toHaveBeenCalledWith("split-view");
		expect(sessions.retain).toHaveBeenCalledWith(sid("s1"), {
			source: "splitView",
		});
		expect(sessions.retain).toHaveBeenCalledWith(sid("s2"), {
			source: "splitView",
		});
		expect(retained.has(sid("s1"))).toBe(true);
		expect(retained.has(sid("s2"))).toBe(true);
	});

	it("appends third session on subsequent Cmd+Click", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.toggleSession(sid("s3"));

		const state = splitStore.getSnapshot();
		expect(state.sessionIds).toEqual([sid("s1"), sid("s2"), sid("s3")]);
		expect(state.focusedSessionId).toBe(sid("s3"));
	});

	it("deselects already visible session on Cmd+Click", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.toggleSession(sid("s3"));

		// Deselect s2
		splitStore.toggleSession(sid("s2"));

		const state = splitStore.getSnapshot();
		expect(state.sessionIds).toEqual([sid("s1"), sid("s3")]);
		expect(retained.get(sid("s2"))?.release).toHaveBeenCalled();
	});

	it("retains single session in split view when deselecting leaves 1 session, and collapses only on 0", () => {
		splitStore.toggleSession(sid("s2"));

		// Deselect s2 leaves s1 in split view
		splitStore.toggleSession(sid("s2"));

		const state = splitStore.getSnapshot();
		expect(state.sessionIds).toEqual([sid("s1")]);
		expect(state.focusedSessionId).toBe(sid("s1"));
		expect(retained.get(sid("s2"))?.release).toHaveBeenCalled();
		expect(retained.get(sid("s1"))?.release).not.toHaveBeenCalled();

		// Deselecting s1 leaves 0 sessions -> collapses to native view
		splitStore.toggleSession(sid("s1"));
		expect(splitStore.getSnapshot().sessionIds).toEqual([]);
		expect(splitStore.getSnapshot().focusedSessionId).toBeUndefined();
		expect(selectPanel).toHaveBeenLastCalledWith(null);
		expect(retained.get(sid("s1"))?.release).toHaveBeenCalled();
	});

	it("resets all splits on normal single click", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.resetToSingle();

		const state = splitStore.getSnapshot();
		expect(state.sessionIds).toEqual([]);
		expect(state.focusedSessionId).toBeUndefined();
		expect(selectPanel).toHaveBeenLastCalledWith(null);
		expect(retained.get(sid("s1"))?.release).toHaveBeenCalled();
		expect(retained.get(sid("s2"))?.release).toHaveBeenCalled();
	});

	it("updates focus without altering sessionIds", () => {
		splitStore.toggleSession(sid("s2"));
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s2"));

		splitStore.setFocus(sid("s1"));
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s1"));
		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1"), sid("s2")]);
	});

	it("removes session via removeSession and collapses only when 0 remain", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.toggleSession(sid("s3"));

		// Remove s3
		splitStore.removeSession(sid("s3"));
		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1"), sid("s2")]);
		expect(retained.get(sid("s3"))?.release).toHaveBeenCalled();

		// Remove s2 -> keeps s1 in split view
		splitStore.removeSession(sid("s2"));
		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1")]);
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s1"));

		// Remove s1 -> collapses to native view
		splitStore.removeSession(sid("s1"));
		expect(splitStore.getSnapshot().sessionIds).toEqual([]);
		expect(selectPanel).toHaveBeenLastCalledWith(null);
	});

	it("suspends into the native view and resumes the retained split", () => {
		splitStore.toggleSession(sid("s2"));
		selectPanel.mockClear();
		openSession.mockClear();

		splitStore.suspend(sid("s2"));
		expect(splitStore.isSuspended()).toBe(true);
		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1"), sid("s2")]);
		expect(openSession).toHaveBeenCalledWith(sid("s2"));
		expect(selectPanel).toHaveBeenCalledWith(null);
		expect(retained.get(sid("s1"))?.release).not.toHaveBeenCalled();

		splitStore.resume();
		expect(splitStore.isSuspended()).toBe(false);
		expect(selectPanel).toHaveBeenLastCalledWith("split-view");
	});

	it("suspends into native view for a subagent not in sessionIds and resumes split", () => {
		splitStore.toggleSession(sid("s2"));
		selectPanel.mockClear();
		openSession.mockClear();

		splitStore.suspend(sid("subagent-1"));
		expect(splitStore.isSuspended()).toBe(true);
		expect(openSession).toHaveBeenCalledWith(sid("subagent-1"));
		expect(selectPanel).toHaveBeenCalledWith(null);

		splitStore.resume();
		expect(splitStore.isSuspended()).toBe(false);
		expect(selectPanel).toHaveBeenCalledWith("split-view");
	});

	it("layers a session overlay and releases it on close", () => {
		splitStore.toggleSession(sid("s2"));

		splitStore.openSessionOverlay(
			sid("s1"),
			sid("child"),
			"Child task",
			sessions,
		);
		const overlay = splitStore.getOverlay(sid("s1"));
		expect(overlay?.kind).toBe("session");
		expect(splitStore.getSnapshot().overlays.has(sid("s1"))).toBe(true);
		expect(retained.get(sid("child"))?.release).not.toHaveBeenCalled();

		splitStore.closeOverlay(sid("s1"));
		expect(splitStore.getOverlay(sid("s1"))).toBeUndefined();
		expect(retained.get(sid("child"))?.release).toHaveBeenCalled();
		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1"), sid("s2")]);
	});

	it("replaces an overlay and releases the previous session reference", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.openSessionOverlay(sid("s1"), sid("child-a"), "A", sessions);
		splitStore.openSessionOverlay(sid("s1"), sid("child-b"), "B", sessions);

		expect(retained.get(sid("child-a"))?.release).toHaveBeenCalled();
		expect(retained.get(sid("child-b"))?.release).not.toHaveBeenCalled();
		const overlay = splitStore.getOverlay(sid("s1"));
		expect(overlay?.kind === "session" ? overlay.title : undefined).toBe("B");
	});

	it("uses the configured fallback when closing the last pane and supports clearing it", () => {
		splitStore.setFallbackPanelId("board");
		splitStore.openSession(sid("s1"));
		splitStore.removeSession(sid("s1"));
		expect(selectPanel).toHaveBeenLastCalledWith("board");

		splitStore.setFallbackPanelId(null);
		splitStore.openSession(sid("s1"));
		splitStore.removeSession(sid("s1"));
		expect(selectPanel).toHaveBeenLastCalledWith(null);
	});

	it("replaces a retained session with a slot and closes it without releasing its host", () => {
		splitStore.openSession(sid("s1"));
		splitStore.openSessionOverlay(sid("s1"), sid("child"), "Child", sessions);
		splitStore.openSlotOverlay(sid("s1"), "split.test", "Inspector", {});
		expect(retained.get(sid("child"))?.release).toHaveBeenCalledOnce();
		expect(splitStore.getOverlay(sid("s1"))).toEqual({
			kind: "slot",
			slotName: "split.test",
			props: {},
			title: "Inspector",
		});
		splitStore.closeOverlay(sid("s1"));
		expect(splitStore.getOverlay(sid("s1"))).toBeUndefined();
		expect(retained.get(sid("s1"))?.release).not.toHaveBeenCalled();
	});

	it.each([
		{ callback: () => {} },
		{ value: undefined },
		{ value: Number.POSITIVE_INFINITY },
		{ value: new Date() },
	])(
		"rejects non-JSON props before releasing the previous overlay: %s",
		(props) => {
			splitStore.openSession(sid("s1"));
			splitStore.openSessionOverlay(sid("s1"), sid("child"), "Child", sessions);
			expect(() =>
				splitStore.openSlotOverlay(sid("s1"), "split.test", "Inspector", props),
			).toThrow("JSON object");
			expect(splitStore.getOverlay(sid("s1"))?.kind).toBe("session");
			expect(retained.get(sid("child"))?.release).not.toHaveBeenCalled();
		},
	);
	it("rejects circular JSON props", () => {
		const props: { self?: object } = {};
		props.self = props;
		expect(() =>
			splitStore.openSlotOverlay(sid("s1"), "split.test", "Inspector", props),
		).toThrow("JSON object");
	});

	it("layers a file overlay and updates its full path", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.openFileOverlay(sid("s1"), {
			address: "dsh-resource://file/session/s1/report.md",
			ownerSessionId: sid("s1"),
			path: "report.md",
			title: "report.md",
		});

		let overlay = splitStore.getOverlay(sid("s1"));
		expect(overlay?.kind).toBe("file");
		if (overlay?.kind === "file") {
			expect(overlay.path).toBe("report.md");
			expect(overlay.fullPath).toBeUndefined();
		}

		// Address mismatch does not update fullPath
		splitStore.updateFileOverlayFullPath(
			sid("s1"),
			"other:addr",
			"/wrong/path.md",
		);
		overlay = splitStore.getOverlay(sid("s1"));
		expect(overlay?.kind === "file" && overlay.fullPath).toBeUndefined();

		// Matching address updates fullPath
		splitStore.updateFileOverlayFullPath(
			sid("s1"),
			"dsh-resource://file/session/s1/report.md",
			"/workspace/report.md",
		);
		overlay = splitStore.getOverlay(sid("s1"));
		expect(overlay?.kind).toBe("file");
		if (overlay?.kind === "file") {
			expect(overlay.fullPath).toBe("/workspace/report.md");
		}
	});

	it("publishes full file contents only for the matching file overlay", () => {
		splitStore.toggleSession(sid("s2"));
		const address = "dsh-resource://file/session/s1/report.md";
		splitStore.openFileOverlay(sid("s1"), {
			address,
			ownerSessionId: sid("s1"),
			path: "report.md",
			title: "report.md",
		});

		splitStore.updateFileOverlayContents(sid("s1"), "other:addr", "wrong");
		let overlay = splitStore.getOverlay(sid("s1"));
		expect(overlay?.kind === "file" && overlay.contents).toBeUndefined();

		splitStore.updateFileOverlayContents(sid("s1"), address, "# Report");
		overlay = splitStore.getOverlay(sid("s1"));
		expect(overlay?.kind === "file" && overlay.contents).toBe("# Report");
	});

	it("clears overlays and suspension on reset", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.openSessionOverlay(sid("s1"), sid("child"), "Child", sessions);
		splitStore.suspend(sid("s2"));
		splitStore.resetToSingle();

		expect(splitStore.getSnapshot().sessionIds).toEqual([]);
		expect(splitStore.getSnapshot().overlays.size).toBe(0);
		expect(splitStore.isSuspended()).toBe(false);
		expect(retained.get(sid("child"))?.release).toHaveBeenCalled();
	});

	it("highlights a pane while its sidebar row is hovered and clears it on leave", () => {
		splitStore.toggleSession(sid("s2"));

		splitStore.setHoveredSession(sid("s1"));
		expect(splitStore.getSnapshot().hoveredSessionId).toBe(sid("s1"));

		splitStore.setHoveredSession(undefined);
		expect(splitStore.getSnapshot().hoveredSessionId).toBeUndefined();
	});

	it("ignores hover for sessions outside the split and after removal", () => {
		splitStore.toggleSession(sid("s2"));

		splitStore.setHoveredSession(sid("s3"));
		expect(splitStore.getSnapshot().hoveredSessionId).toBeUndefined();

		splitStore.setHoveredSession(sid("s2"));
		splitStore.removeSession(sid("s2"));
		expect(splitStore.getSnapshot().hoveredSessionId).toBeUndefined();
	});

	it("tracks the pointer origin of the last interacted pane", () => {
		expect(splitStore.getPointerOrigin()).toBeUndefined();
		splitStore.setPointerOrigin(sid("s1"));
		expect(splitStore.getPointerOrigin()).toBe(sid("s1"));
		splitStore.clearPointerOrigin();
		expect(splitStore.getPointerOrigin()).toBeUndefined();
	});

	it("closes a removed pane's overlay and releases its reference", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.toggleSession(sid("s3"));
		splitStore.openSessionOverlay(sid("s3"), sid("child"), "Child", sessions);
		splitStore.removeSession(sid("s3"));

		expect(splitStore.getOverlay(sid("s3"))).toBeUndefined();
		expect(retained.get(sid("child"))?.release).toHaveBeenCalled();
	});
	it("creates single-pane split in split-view when Cmd+clicking the active session", () => {
		splitStore.toggleSession(sid("s1"));

		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1")]);
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s1"));
		expect(selectPanel).toHaveBeenCalledWith("split-view");
		expect(retained.get(sid("s1"))).toBeDefined();
	});

	it("creates single-pane split in split-view when Cmd+clicking with no active session", () => {
		activeId = undefined;
		splitStore.toggleSession(sid("s2"));

		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s2")]);
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s2"));
		expect(selectPanel).toHaveBeenCalledWith("split-view");
		expect(retained.get(sid("s2"))).toBeDefined();
	});

	it("removes the last session and collapses to native panel on removeSession", () => {
		(sessions.list.getSnapshot().byId as Record<string, unknown>).s1 = {
			id: "s1",
			projectionValues: {
				kanban: { doneAt: 12345 },
			},
		};
		splitStore.toggleSession(sid("s1"));
		selectPanel.mockClear();

		splitStore.removeSession(sid("s1"));

		expect(splitStore.getSnapshot().sessionIds).toEqual([]);
		expect(selectPanel).toHaveBeenCalledWith(null);
	});

	it("opens single session directly in split-view when calling openSession from empty state", () => {
		splitStore.openSession(sid("s1"));

		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1")]);
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s1"));
		expect(selectPanel).toHaveBeenCalledWith("split-view");
		expect(retained.get(sid("s1"))).toBeDefined();
	});

	it("replaces existing split sessions with target session when calling openSession for an un-split session", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.toggleSession(sid("s3"));
		expect(splitStore.getSnapshot().sessionIds).toEqual([
			sid("s1"),
			sid("s2"),
			sid("s3"),
		]);

		splitStore.openSession(sid("s4"));

		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s4")]);
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s4"));
		expect(retained.get(sid("s1"))?.release).toHaveBeenCalled();
		expect(retained.get(sid("s2"))?.release).toHaveBeenCalled();
		expect(retained.get(sid("s3"))?.release).toHaveBeenCalled();
		expect(retained.get(sid("s4"))).toBeDefined();
	});

	it("focuses existing session and un-suspends when calling openSession on an already-present session", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.suspend(sid("s1"));
		expect(splitStore.isSuspended()).toBe(true);

		selectPanel.mockClear();
		splitStore.openSession(sid("s2"));

		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1"), sid("s2")]);
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s2"));
		expect(splitStore.isSuspended()).toBe(false);
		expect(selectPanel).toHaveBeenCalledWith("split-view");
	});

	it("resets maximizedSessionId when calling openSession on an already-present session", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.toggleMaximize(sid("s1"));
		expect(splitStore.getSnapshot().maximizedSessionId).toBe(sid("s1"));

		splitStore.openSession(sid("s2"));

		expect(splitStore.getSnapshot().maximizedSessionId).toBeUndefined();
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s2"));
	});

	it("suspends into native view and resumes for a single session", () => {
		splitStore.toggleSession(sid("s1"));
		selectPanel.mockClear();
		openSession.mockClear();

		splitStore.suspend(sid("s1"));
		expect(splitStore.isSuspended()).toBe(true);
		expect(splitStore.getSnapshot().suspended).toBe(true);
		expect(selectPanel).toHaveBeenCalledWith(null);
		expect(openSession).toHaveBeenCalledWith(sid("s1"));

		splitStore.resume();
		expect(splitStore.isSuspended()).toBe(false);
		expect(splitStore.getSnapshot().suspended).toBe(false);
		expect(selectPanel).toHaveBeenCalledWith("split-view");
	});

	it("toggles maximize state for a pane", () => {
		splitStore.toggleSession(sid("s2"));
		expect(splitStore.getSnapshot().maximizedSessionId).toBeUndefined();

		splitStore.toggleMaximize(sid("s2"));
		expect(splitStore.getSnapshot().maximizedSessionId).toBe(sid("s2"));
		expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s2"));

		// Toggling again restores split
		splitStore.toggleMaximize(sid("s2"));
		expect(splitStore.getSnapshot().maximizedSessionId).toBeUndefined();
	});

	it("does not maximize when only a single session is in split view", () => {
		splitStore.toggleSession(sid("s1"));
		expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1")]);

		splitStore.toggleMaximize(sid("s1"));
		expect(splitStore.getSnapshot().maximizedSessionId).toBeUndefined();
	});

	it("clears maximized state when maximized session is removed", () => {
		splitStore.toggleSession(sid("s2"));
		splitStore.toggleSession(sid("s3"));
		splitStore.toggleMaximize(sid("s2"));
		expect(splitStore.getSnapshot().maximizedSessionId).toBe(sid("s2"));

		splitStore.removeSession(sid("s2"));
		expect(splitStore.getSnapshot().maximizedSessionId).toBeUndefined();
	});

	function createMockLocalStorage(): Storage {
		const store = new Map<string, string>();
		return {
			get length() {
				return store.size;
			},
			clear: () => store.clear(),
			getItem: (key: string) => store.get(key) ?? null,
			key: (index: number) => Array.from(store.keys())[index] ?? null,
			removeItem: (key: string) => store.delete(key),
			setItem: (key: string, value: string) => store.set(key, String(value)),
		};
	}

	describe("localStorage persistence and hydration", () => {
		beforeEach(() => {
			vi.stubGlobal("localStorage", createMockLocalStorage());
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("persists split state to localStorage when >= 2 sessions are active", () => {
			splitStore.toggleSession(sid("s2"));
			const raw = localStorage.getItem(SPLIT_VIEW_STORAGE_KEY);
			expect(raw).not.toBeNull();
			const parsed = JSON.parse(raw ?? "{}");
			expect(parsed.version).toBe(1);
			expect(parsed.sessionIds).toEqual([sid("s1"), sid("s2")]);
			expect(parsed.focusedSessionId).toBe(sid("s2"));
			expect(parsed.suspended).toBe(false);
		});

		it("removes persisted state from localStorage when split collapses to 0 sessions", () => {
			splitStore.toggleSession(sid("s2"));
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).not.toBeNull();

			splitStore.removeSession(sid("s2"));
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).not.toBeNull();

			splitStore.removeSession(sid("s1"));
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).toBeNull();
		});

		it("removes persisted state from localStorage on resetToSingle()", () => {
			splitStore.toggleSession(sid("s2"));
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).not.toBeNull();

			splitStore.resetToSingle();
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).toBeNull();
		});

		it("persists overlays and maximize state", () => {
			splitStore.toggleSession(sid("s2"));
			splitStore.toggleMaximize(sid("s2"));
			splitStore.openSlotOverlay(sid("s1"), "split.test", "Inspector", {});

			const raw = localStorage.getItem(SPLIT_VIEW_STORAGE_KEY);
			const parsed = JSON.parse(raw ?? "{}");
			expect(parsed.maximizedSessionId).toBe(sid("s2"));
			expect(parsed.overlays).toEqual([
				{
					hostId: sid("s1"),
					kind: "slot",
					slotName: "split.test",
					props: {},
					title: "Inspector",
				},
			]);
		});

		it("restores generic slot overlays with nonempty props and focused, maximized and suspended state", () => {
			const snap = sessions.list.getSnapshot() as unknown as {
				ids: SessionId[];
			};
			snap.ids = [sid("s1"), sid("s2")];
			splitStore.toggleSession(sid("s2"));
			splitStore.toggleMaximize(sid("s2"));
			splitStore.openSlotOverlay(sid("s1"), "split.props-test", "Inspector", {
				query: "inspect",
				options: { line: 12 },
			});
			splitStore.suspend(sid("s2"));
			splitStore.dispose();
			splitStore.hydrate(sessions);
			expect(splitStore.getSnapshot()).toMatchObject({
				sessionIds: [sid("s1"), sid("s2")],
				focusedSessionId: sid("s2"),
				maximizedSessionId: sid("s2"),
				suspended: true,
			});
			expect(splitStore.getOverlay(sid("s1"))).toEqual({
				kind: "slot",
				slotName: "split.props-test",
				props: { query: "inspect", options: { line: 12 } },
				title: "Inspector",
			});
			splitStore.closeOverlay(sid("s1"));
			expect(splitStore.getSnapshot().sessionIds).toEqual([
				sid("s1"),
				sid("s2"),
			]);
		});

		it.each([undefined, null, [], "invalid"])(
			"ignores malformed stored slot props %s without dropping their host",
			(props) => {
				const snap = sessions.list.getSnapshot() as unknown as {
					ids: SessionId[];
				};
				snap.ids = [sid("s1")];
				localStorage.setItem(
					SPLIT_VIEW_STORAGE_KEY,
					JSON.stringify({
						version: 1,
						sessionIds: ["s1"],
						suspended: false,
						overlays: [
							{
								hostId: "s1",
								kind: "slot",
								slotName: 42,
								title: "Inspector",
								props: {},
							},

							{
								hostId: "s1",
								kind: "slot",
								slotName: "split.test",
								title: "Inspector",
								props,
							},
						],
					}),
				);
				splitStore.hydrate(sessions);
				expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1")]);
				expect(splitStore.getOverlay(sid("s1"))).toBeUndefined();
			},
		);

		it("hydrates valid split state from localStorage and selects panel", () => {
			// Populate mock sessions.list with s1, s2, child
			const snap = sessions.list.getSnapshot() as unknown as {
				ids: SessionId[];
				byId: Record<string, unknown>;
			};
			snap.ids = [sid("s1"), sid("s2"), sid("child")];
			snap.byId.s1 = { id: "s1" };
			snap.byId.s2 = { id: "s2" };
			snap.byId.child = { id: "child" };

			localStorage.setItem(
				SPLIT_VIEW_STORAGE_KEY,
				JSON.stringify({
					version: 1,
					sessionIds: [sid("s1"), sid("s2")],
					focusedSessionId: sid("s2"),
					maximizedSessionId: sid("s2"),
					suspended: false,
					overlays: [
						{
							hostId: sid("s1"),
							kind: "session",
							session: { target: sid("child"), title: "Subtask" },
						},
					],
				}),
			);

			splitStore.resetToSingle();
			selectPanel.mockClear();

			splitStore.hydrate(sessions);

			const state = splitStore.getSnapshot();
			expect(state.sessionIds).toEqual([sid("s1"), sid("s2")]);
			expect(state.focusedSessionId).toBe(sid("s2"));
			expect(state.maximizedSessionId).toBe(sid("s2"));
			expect(state.overlays.get(sid("s1"))?.kind).toBe("session");
			expect(selectPanel).toHaveBeenCalledWith("split-view");
			expect(retained.get(sid("s1"))).toBeDefined();
			expect(retained.get(sid("s2"))).toBeDefined();
			expect(retained.get(sid("child"))).toBeDefined();
		});

		it("clears storage and does not hydrate if 0 valid sessions exist", () => {
			const snap = sessions.list.getSnapshot() as unknown as {
				ids: SessionId[];
				byId: Record<string, unknown>;
			};
			snap.ids = [];

			localStorage.setItem(
				SPLIT_VIEW_STORAGE_KEY,
				JSON.stringify({
					version: 1,
					sessionIds: [sid("s1"), sid("s2")],
					focusedSessionId: sid("s1"),
					suspended: false,
					overlays: [],
				}),
			);

			splitStore.resetToSingle();
			selectPanel.mockClear();

			splitStore.hydrate(sessions);

			expect(splitStore.getSnapshot().sessionIds).toEqual([]);
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).toBeNull();
			expect(selectPanel).not.toHaveBeenCalledWith("split-view");
		});

		it("hydrates single session from localStorage and selects panel", () => {
			const snap = sessions.list.getSnapshot() as unknown as {
				ids: SessionId[];
				byId: Record<string, unknown>;
			};
			snap.ids = [sid("s1")];
			snap.byId.s1 = { id: "s1" };

			localStorage.setItem(
				SPLIT_VIEW_STORAGE_KEY,
				JSON.stringify({
					version: 1,
					sessionIds: [sid("s1")],
					focusedSessionId: sid("s1"),
					suspended: false,
					overlays: [],
				}),
			);

			splitStore.resetToSingle();
			selectPanel.mockClear();

			splitStore.hydrate(sessions);

			expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1")]);
			expect(selectPanel).toHaveBeenCalledWith("split-view");
			expect(retained.get(sid("s1"))).toBeDefined();
		});

		it("discards maximizedSessionId during hydration when only 1 session survives", () => {
			const snap = sessions.list.getSnapshot() as unknown as {
				ids: SessionId[];
				byId: Record<string, unknown>;
			};
			snap.ids = [sid("s1")];
			snap.byId.s1 = { id: "s1" };

			localStorage.setItem(
				SPLIT_VIEW_STORAGE_KEY,
				JSON.stringify({
					version: 1,
					sessionIds: [sid("s1")],
					focusedSessionId: sid("s1"),
					maximizedSessionId: sid("s1"),
					suspended: false,
					overlays: [],
				}),
			);

			splitStore.resetToSingle();
			splitStore.hydrate(sessions);

			expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1")]);
			expect(splitStore.getSnapshot().maximizedSessionId).toBeUndefined();
		});

		it("hydrates suspended state without selecting split-view panel", () => {
			const snap = sessions.list.getSnapshot() as unknown as {
				ids: SessionId[];
				byId: Record<string, unknown>;
			};
			snap.ids = [sid("s1"), sid("s2")];
			snap.byId.s1 = { id: "s1" };
			snap.byId.s2 = { id: "s2" };

			localStorage.setItem(
				SPLIT_VIEW_STORAGE_KEY,
				JSON.stringify({
					version: 1,
					sessionIds: [sid("s1"), sid("s2")],
					focusedSessionId: sid("s1"),
					suspended: true,
					overlays: [],
				}),
			);

			splitStore.resetToSingle();
			selectPanel.mockClear();

			splitStore.hydrate(sessions);

			expect(splitStore.getSnapshot().sessionIds).toEqual([
				sid("s1"),
				sid("s2"),
			]);
			expect(splitStore.isSuspended()).toBe(true);
			expect(selectPanel).not.toHaveBeenCalledWith("split-view");
		});

		it("does not clear storage or hydrate if sessions.list is still pending", () => {
			const snap = sessions.list.getSnapshot() as unknown as {
				phase: string;
				ids: SessionId[];
			};
			snap.phase = "pending";
			snap.ids = [];

			localStorage.setItem(
				SPLIT_VIEW_STORAGE_KEY,
				JSON.stringify({
					version: 1,
					sessionIds: [sid("s1"), sid("s2")],
					focusedSessionId: sid("s1"),
					suspended: false,
					overlays: [],
				}),
			);

			splitStore.resetToSingle();
			selectPanel.mockClear();

			splitStore.hydrate(sessions);

			// Must not wipe localStorage while list is still pending arrival
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).not.toBeNull();
			expect(splitStore.getSnapshot().sessionIds).toEqual([]);
			expect(selectPanel).not.toHaveBeenCalledWith("split-view");
		});

		it("splitStore.dispose() clears in-memory state without deleting localStorage", () => {
			splitStore.toggleSession(sid("s2"));
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).not.toBeNull();

			splitStore.dispose();

			expect(splitStore.getSnapshot().sessionIds).toEqual([]);
			expect(localStorage.getItem(SPLIT_VIEW_STORAGE_KEY)).not.toBeNull();
		});
	});

	describe("Mobile view behavior", () => {
		beforeEach(() => {
			vi.stubGlobal("localStorage", createMockLocalStorage());
			vi.stubGlobal("window", { innerWidth: 390 });
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("opens session in split-view on mobile openSession, replacing previous session", () => {
			splitStore.openSession(sid("s1"));
			expect(splitStore.isSuspended()).toBe(false);
			expect(selectPanel).toHaveBeenCalledWith("split-view");
			expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s1")]);
			expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s1"));

			// Opening another session on mobile replaces s1 with s2 instead of accumulating
			splitStore.openSession(sid("s2"));
			expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s2")]);
			expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s2"));
			expect(splitStore.isSuspended()).toBe(false);
			expect(retained.get(sid("s1"))?.release).toHaveBeenCalled();
			expect(splitStore.getReference(sid("s1"))).toBeUndefined();
			expect(splitStore.getReference(sid("s2"))).toBeDefined();
		});

		it("replaces session in split-view on mobile toggleSession", () => {
			splitStore.openSession(sid("s1"));
			splitStore.toggleSession(sid("s2"));
			expect(splitStore.isSuspended()).toBe(false);
			expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s2")]);
			expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s2"));
			expect(selectPanel).toHaveBeenCalledWith("split-view");
			expect(retained.get(sid("s1"))?.release).toHaveBeenCalled();
			expect(splitStore.getReference(sid("s1"))).toBeUndefined();
			expect(splitStore.getReference(sid("s2"))).toBeDefined();
		});

		it("hydrates single session in split-view on mobile and retains only focused session", () => {
			const snap = sessions.list.getSnapshot() as unknown as {
				phase: string;
				ids: SessionId[];
			};
			snap.phase = "ready";
			snap.ids = [sid("s1"), sid("s2")];

			localStorage.setItem(
				SPLIT_VIEW_STORAGE_KEY,
				JSON.stringify({
					version: 1,
					sessionIds: [sid("s1"), sid("s2")],
					focusedSessionId: sid("s2"),
					suspended: false,
					overlays: [],
				}),
			);

			splitStore.resetToSingle();
			selectPanel.mockClear();
			openSession.mockClear();

			splitStore.hydrate(sessions);

			expect(splitStore.isSuspended()).toBe(false);
			expect(selectPanel).toHaveBeenCalledWith("split-view");
			expect(splitStore.getSnapshot().sessionIds).toEqual([sid("s2")]);
			expect(splitStore.getSnapshot().focusedSessionId).toBe(sid("s2"));
			expect(splitStore.getReference(sid("s1"))).toBeUndefined();
			expect(splitStore.getReference(sid("s2"))).toBeDefined();
		});

		it("disables toggleMaximize on mobile", () => {
			splitStore.openSession(sid("s1"));
			splitStore.toggleMaximize(sid("s1"));
			expect(splitStore.getSnapshot().maximizedSessionId).toBeUndefined();
		});

		it("allows resuming into split-view when suspended on mobile", () => {
			splitStore.openSession(sid("s1"));
			splitStore.suspend(sid("s1"));
			expect(splitStore.isSuspended()).toBe(true);
			selectPanel.mockClear();

			splitStore.resume();
			expect(splitStore.isSuspended()).toBe(false);
			expect(selectPanel).toHaveBeenCalledWith("split-view");
		});
	});

	describe("reorderSession", () => {
		beforeEach(() => {
			vi.stubGlobal("localStorage", createMockLocalStorage());
			splitStore.openSession(sid("s1"));
			splitStore.toggleSession(sid("s2"));
			splitStore.toggleSession(sid("s3"));
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("moves a session forward to the target position", () => {
			expect(splitStore.getSnapshot().sessionIds).toEqual([
				sid("s1"),
				sid("s2"),
				sid("s3"),
			]);
			splitStore.reorderSession(sid("s1"), sid("s3"));
			expect(splitStore.getSnapshot().sessionIds).toEqual([
				sid("s2"),
				sid("s3"),
				sid("s1"),
			]);
		});

		it("moves a session backward to the target position", () => {
			splitStore.reorderSession(sid("s3"), sid("s1"));
			expect(splitStore.getSnapshot().sessionIds).toEqual([
				sid("s3"),
				sid("s1"),
				sid("s2"),
			]);
		});

		it("does nothing when sourceId equals targetId", () => {
			const listener = vi.fn();
			const unsubscribe = splitStore.subscribe(listener);
			splitStore.reorderSession(sid("s2"), sid("s2"));
			expect(listener).not.toHaveBeenCalled();
			expect(splitStore.getSnapshot().sessionIds).toEqual([
				sid("s1"),
				sid("s2"),
				sid("s3"),
			]);
			unsubscribe();
		});

		it("does nothing if source or target session does not exist", () => {
			splitStore.reorderSession(sid("unknown"), sid("s1"));
			expect(splitStore.getSnapshot().sessionIds).toEqual([
				sid("s1"),
				sid("s2"),
				sid("s3"),
			]);
			splitStore.reorderSession(sid("s1"), sid("unknown"));
			expect(splitStore.getSnapshot().sessionIds).toEqual([
				sid("s1"),
				sid("s2"),
				sid("s3"),
			]);
		});

		it("persists reordered sessions to localStorage", () => {
			splitStore.reorderSession(sid("s1"), sid("s2"));
			const raw = localStorage.getItem(SPLIT_VIEW_STORAGE_KEY);
			expect(raw).not.toBeNull();
			const parsed = JSON.parse(raw as string) as { sessionIds: string[] };
			expect(parsed.sessionIds).toEqual([sid("s2"), sid("s1"), sid("s3")]);
		});
	});
});

function checkFactoryProps(): void {
	// edge case: test identity stands in for a server-issued SessionId.
	const id = "s1" as SessionId;
	splitStore.openSlotOverlay(id, "split.props-test", "Inspector", {
		query: "ok",
		options: { line: 1 },
	});
	// @ts-expect-error factory-specific props are required
	splitStore.openSlotOverlay(id, "split.props-test", "Inspector", {});
	splitStore.openSlotOverlay(id, "split.props-test", "Inspector", {
		// @ts-expect-error the factory props do not match the chosen key
		query: 1,
		options: { line: 1 },
	});
}
void checkFactoryProps;
