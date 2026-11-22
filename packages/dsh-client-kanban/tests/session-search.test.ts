import assert from "node:assert/strict";
import type {
	ISessions,
	SessionListState,
	SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import workspaceRemote from "@deepseek-ai/dsh-api-workspace-controller/remote";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
	ChangeEvent,
	ComponentProps,
	DependencyList,
	EffectCallback,
} from "react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
	KanbanPane,
	type KanbanPaneInjected,
} from "../src/client/KanbanPane.tsx";
import { KanbanSection } from "../src/client/KanbanSection.tsx";
import { deriveKanbanBoard } from "../src/client/store.ts";
import { useKanban } from "../src/client/use-kanban.ts";
import { searchRequestSchema } from "../src/search.ts";

const hooks = vi.hoisted(() => {
	const memos: { dependencies: DependencyList; value: unknown }[] = [];
	return {
		states: [] as unknown[],
		cursor: 0,
		memos,
		memoCursor: 0,
		hydration: { current: new Set<SessionId>() },
		dirty: false,
		jsx: vi.fn((_type: unknown, _props: unknown) => null),
	};
});

function dependenciesMatch(
	left: DependencyList | undefined,
	right: DependencyList | undefined,
): boolean {
	return (
		left !== undefined &&
		right !== undefined &&
		left.length === right.length &&
		left.every((value, index) => Object.is(value, right[index]))
	);
}

vi.mock("react", () => ({
	useState: <T>(initial: T | (() => T)) => {
		const index = hooks.cursor++;
		if (index === hooks.states.length) {
			// edge case: the hook fixture erases heterogeneous React state at its boundary
			hooks.states.push(
				typeof initial === "function" ? (initial as () => T)() : initial,
			);
		}
		return [
			hooks.states[index],
			(value: T) => {
				hooks.dirty ||= !Object.is(hooks.states[index], value);
				hooks.states[index] = value;
			},
		];
	},
	useEffect: vi.fn(),
	useMemo: (compute: () => unknown, dependencies: DependencyList) => {
		const index = hooks.memoCursor++;
		const memo = hooks.memos[index];
		if (
			memo !== undefined &&
			dependenciesMatch(dependencies, memo.dependencies)
		)
			return memo.value;
		const value = compute();
		hooks.memos[index] = { dependencies, value };
		return value;
	},
	useCallback: (callback: unknown) => callback,
	useRef: () => hooks.hydration,
}));
vi.mock("react/jsx-dev-runtime", () => ({ jsxDEV: hooks.jsx }));
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	Menu: "Menu",
}));
vi.mock("../src/client/use-kanban.ts", () => ({
	useKanban: vi.fn(),
	useStore: (store: ISessions["list"]) => store.getSnapshot(),
}));

// edge case: fixture IDs use DSH's branded string type
const id = "content-match" as SessionId;
const session: SessionSummary = {
	id,
	displayTitle: "Unrelated title",
	running: false,
	blank: false,
	updatedAt: Date.now(),
	retainedBy: {},
	projectionValues: { kanban: { sessionId: id, createdAt: 1000, links: [] } },
};
const list: SessionListState = {
	ids: [id],
	byId: { [id]: session },
	phase: "ready",
	projectionsBySession: {},
};
const workspaces: WorkspaceSnapshot = {
	items: [],
	archivedSessionIds: [],
	pinnedSessionIds: [],
	state: "idle",
	phase: "ready",
	error: null,
};
const search = vi.fn<KanbanPaneInjected["searchSessions"]>();
const props: KanbanPaneInjected = {
	sessionsList: { getSnapshot: () => list, subscribe: () => () => {} },
	workspacesList: { getSnapshot: () => workspaces, subscribe: () => () => {} },
	sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} },
	searchSessions: search,
	searchResultLimit: 20,
	selectPanel: () => {},
	selectSession: () => {},
	startTask: async () => {},
	prepareTask: async () => {},
	startPreparedTask: async () => {},
	markDone: async () => {},
	reopen: async () => {},
	deleteSession: async () => {},
	holdSession: async () => {},
	unholdSession: async () => {},
	pinSession: async () => {},
	unpinSession: async () => {},
};

const effects: {
	dependencies: DependencyList | undefined;
	cleanup: ReturnType<EffectCallback>;
}[] = [];

function render(injected: KanbanPaneInjected) {
	do {
		hooks.dirty = false;
		hooks.cursor = 0;
		hooks.memoCursor = 0;
		hooks.jsx.mockClear();
		vi.mocked(useEffect).mockClear();
		KanbanPane(injected);
		for (const [index, [effect, dependencies]] of vi
			.mocked(useEffect)
			.mock.calls.entries()) {
			const previous = effects[index];
			if (
				previous !== undefined &&
				dependenciesMatch(dependencies, previous.dependencies)
			)
				continue;
			if (previous !== undefined && typeof previous.cleanup === "function")
				previous.cleanup();
			effects[index] = { dependencies, cleanup: effect() };
		}
	} while (hooks.dirty);
}

function changeQuery(value: string) {
	const input = hooks.jsx.mock.calls.find(([type]) => type === "input");
	assert(input);
	// edge case: captured intrinsic props and the partial event are fixture boundaries
	const inputProps = input[1] as ComponentProps<"input">;
	assert(inputProps.onChange);
	inputProps.onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);
	render(props);
}

function visibleIds() {
	return hooks.jsx.mock.calls
		.filter(([type]) => type === KanbanSection)
		.flatMap(([, value]) => {
			// edge case: the captured component identity determines its prop type
			const section = value as ComponentProps<typeof KanbanSection>;
			return section.sessions.map((item) => item.id);
		});
}

function statusText() {
	const status = hooks.jsx.mock.calls.find(([, value]) => {
		// edge case: JSX capture is untyped until narrowed to intrinsic div props
		const div = value as ComponentProps<"div">;
		return div.role === "status";
	});
	if (status === undefined) return "";
	// edge case: the status element carries intrinsic div props
	return (status[1] as ComponentProps<"div">).children;
}

beforeEach(() => {
	vi.useFakeTimers();
	hooks.states.length = 0;
	hooks.memos.length = 0;
	hooks.hydration.current.clear();
	vi.stubGlobal("window", new EventTarget());
	search.mockReset();
	vi.mocked(useKanban).mockReturnValue(
		deriveKanbanBoard(list, [], new Map(), 1000),
	);
	render(props);
});

afterEach(() => {
	for (const effect of effects) {
		if (typeof effect.cleanup === "function") effect.cleanup();
	}
	effects.length = 0;
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

test.each(["ungrouped", "no-workspace", "workspace"])(
	"hydrates missing projections once and restores cards in the %s view",
	async (view) => {
		const [groupedId, cwdId, nullId, knownId] =
			searchRequestSchema.shape.sessionIds.parse([
				"grouped",
				"cwd-match",
				"known-null",
				"known-value",
			]);
		const { projectionValues: _, ...cold } = session;
		let snapshot: SessionListState = {
			...list,
			ids: [id, groupedId, cwdId, nullId, knownId],
			byId: {
				[id]: cold,
				[groupedId]: { ...cold, id: groupedId },
				[cwdId]: { ...cold, id: cwdId, cwd: "/project" },
				[nullId]: { ...cold, id: nullId, projectionValues: { kanban: null } },
				[knownId]: { ...session, id: knownId },
			},
		};
		const { workspace } = workspaceRemote.methods["workspace/create"].result
			.create()
			.parse({
				created: true,
				workspace: {
					workspaceId: "workspace",
					path: "/project",
					title: "Project",
					sessionIds: [groupedId],
					createdAt: "2026-10-29T00:00:00Z",
					updatedAt: "2026-10-29T00:00:00Z",
				},
			});
		const items = view === "no-workspace" ? [] : [workspace];
		const refreshProjections = vi.fn(async (_id: SessionId) => {});
		const injected: KanbanPaneInjected = {
			...props,
			sessionsList: { getSnapshot: () => snapshot, subscribe: () => () => {} },
			workspacesList: {
				getSnapshot: () => ({ ...workspaces, items }),
				subscribe: () => () => {},
			},
			refreshProjections,
		};
		const expected =
			view === "workspace"
				? [groupedId, cwdId]
				: view === "ungrouped"
					? [id]
					: [id, groupedId, cwdId];
		vi.stubGlobal("localStorage", {
			getItem: () => (view === "ungrouped" ? "ungrouped" : null),
		});
		window.dispatchEvent(new Event("storage"));
		vi.mocked(useKanban).mockReturnValue(
			deriveKanbanBoard(snapshot, items, new Map(), 1000),
		);
		render(injected);
		expect(visibleIds()).not.toContain(expected[0]);
		expect(
			refreshProjections.mock.calls.map(([sessionId]) => sessionId),
		).toEqual(expected);

		snapshot = { ...snapshot, byId: { ...snapshot.byId } };
		vi.mocked(useKanban).mockReturnValue(
			deriveKanbanBoard(snapshot, items, new Map(), 1000),
		);
		render(injected);
		expect(refreshProjections).toHaveBeenCalledTimes(expected.length);

		const target = expected[0];
		const summary = snapshot.byId[target];
		assert(summary);
		snapshot = {
			...snapshot,
			byId: {
				...snapshot.byId,
				[target]: {
					...summary,
					projectionValues: {
						kanban: { sessionId: target, createdAt: 1000, links: [] },
					},
				},
			},
		};
		vi.mocked(useKanban).mockReturnValue(
			deriveKanbanBoard(snapshot, items, new Map(), 1000),
		);
		render(injected);
		expect(visibleIds()).toContain(target);
		expect(refreshProjections).toHaveBeenCalledTimes(expected.length);
	},
);

test("skips blank queries and debounces content searches without matching titles", async () => {
	changeQuery("   ");
	await vi.advanceTimersByTimeAsync(300);
	expect(search).not.toHaveBeenCalled();
	expect(visibleIds()).toEqual([id]);

	search.mockResolvedValue({
		ok: true,
		value: {
			items: [{ sessionId: id, snippet: "message content" }],
			hasMore: false,
		},
	});
	changeQuery("  message content  ");
	expect(visibleIds()).toEqual([]);
	expect(statusText()).toBe("Searching session contents…");
	await vi.advanceTimersByTimeAsync(249);
	expect(search).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(search).toHaveBeenCalledWith(
		{ query: "message content", sessionIds: [id] },
		expect.any(AbortSignal),
	);
	render(props);
	expect(visibleIds()).toEqual([id]);
	expect(statusText()).toBe("");
});

test("aborts superseded searches and ignores their late responses", async () => {
	const late =
		Promise.withResolvers<
			Awaited<ReturnType<KanbanPaneInjected["searchSessions"]>>
		>();
	search.mockReturnValueOnce(late.promise);
	changeQuery("old query");
	await vi.advanceTimersByTimeAsync(250);
	const [, signal] = search.mock.calls[0];
	search.mockResolvedValue({ ok: true, value: { items: [], hasMore: false } });
	changeQuery("new query");
	expect(signal.aborted).toBe(true);
	await vi.advanceTimersByTimeAsync(250);
	late.resolve({
		ok: true,
		value: { items: [{ sessionId: id, snippet: "old" }], hasMore: false },
	});
	await late.promise;
	render(props);
	expect(visibleIds()).toEqual([]);
	expect(statusText()).toBe("No matching sessions in this workspace.");
});

test("clearing restores the board and cancels the debounce or in-flight request", async () => {
	for (const delay of [0, 250]) {
		const pending =
			Promise.withResolvers<
				Awaited<ReturnType<KanbanPaneInjected["searchSessions"]>>
			>();
		search.mockReturnValue(pending.promise);
		changeQuery("message");
		await vi.advanceTimersByTimeAsync(delay);
		changeQuery("");
		expect(visibleIds()).toEqual([id]);
		pending.resolve({ ok: true, value: { items: [], hasMore: false } });
		await vi.advanceTimersByTimeAsync(300);
		render(props);
		expect(visibleIds()).toEqual([id]);
		expect(statusText()).toBe("");
	}
	expect(search).toHaveBeenCalledTimes(1);
	expect(search.mock.calls[0][1].aborted).toBe(true);
});

test("reports search failure without falling back to title matching", async () => {
	search.mockResolvedValue({
		ok: false,
		error: Object.assign(new Error("Search unavailable"), {
			code: "gateway/internal" as const,
			details: {},
			isDSHRemoteError: true as const,
		}),
	});
	changeQuery("Unrelated title");
	await vi.advanceTimersByTimeAsync(250);
	render(props);
	expect(visibleIds()).toEqual([]);
	expect(statusText()).toBe("Search failed: Search unavailable");
});

test("warns when the host truncates results within the selected workspace", async () => {
	search.mockResolvedValue({ ok: true, value: { items: [], hasMore: true } });
	changeQuery("common phrase");
	await vi.advanceTimersByTimeAsync(250);
	render(props);
	expect(statusText()).toBe(
		"Search limited to 20 sessions in this workspace. Narrow your query.",
	);
});

test("membership changes invalidate old results and send only the new board IDs", async () => {
	search.mockResolvedValue({
		ok: true,
		value: { items: [{ sessionId: id, snippet: "match" }], hasMore: false },
	});
	changeQuery("message");
	await vi.advanceTimersByTimeAsync(250);
	render(props);
	expect(visibleIds()).toEqual([id]);

	// edge case: fixture IDs use DSH's branded string type
	const otherId = "other-workspace-session" as SessionId;
	const other = { ...session, id: otherId };
	vi.mocked(useKanban).mockReturnValue({
		...deriveKanbanBoard(list, [], new Map(), 1000),
		partition: () => ({ todo: [], active: [], review: [other], done: [] }),
	});
	render(props);
	expect(visibleIds()).toEqual([]);
	expect(statusText()).toBe("Searching session contents…");
	search.mockResolvedValue({
		ok: true,
		value: {
			items: [{ sessionId: otherId, snippet: "match" }],
			hasMore: false,
		},
	});
	await vi.advanceTimersByTimeAsync(250);
	expect(search.mock.calls[1][0]).toEqual({
		query: "message",
		sessionIds: [otherId],
	});
	render(props);
	expect(visibleIds()).toEqual([otherId]);
});

test("unrelated snapshots cannot restart the debounce or clear settled hits", async () => {
	search.mockResolvedValue({
		ok: true,
		value: { items: [{ sessionId: id, snippet: "match" }], hasMore: false },
	});
	changeQuery("message");
	for (let update = 0; update < 10; update++) {
		await vi.advanceTimersByTimeAsync(100);
		vi.mocked(useKanban).mockReturnValue(
			deriveKanbanBoard(list, [], new Map(), 1000),
		);
		render(props);
	}
	expect(search).toHaveBeenCalledTimes(1);
	expect(search.mock.calls[0][1].aborted).toBe(false);
	expect(visibleIds()).toEqual([id]);
	expect(statusText()).toBe("");
});

test("unrelated snapshots preserve an in-flight request", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<KanbanPaneInjected["searchSessions"]>>
		>();
	search.mockReturnValue(pending.promise);
	changeQuery("message");
	await vi.advanceTimersByTimeAsync(250);
	const [, signal] = search.mock.calls[0];
	vi.mocked(useKanban).mockReturnValue(
		deriveKanbanBoard(list, [], new Map(), 1000),
	);
	render(props);
	expect(signal.aborted).toBe(false);
	pending.resolve({
		ok: true,
		value: { items: [{ sessionId: id, snippet: "match" }], hasMore: false },
	});
	await pending.promise;
	render(props);
	expect(visibleIds()).toEqual([id]);
	expect(search).toHaveBeenCalledTimes(1);
});

test("reordering and changing lanes preserve requests with identical membership", async () => {
	const otherId = searchRequestSchema.shape.sessionIds.parse([
		"another-session",
	])[0];
	const other = { ...session, id: otherId };
	const board = deriveKanbanBoard(list, [], new Map(), 1000);
	vi.mocked(useKanban).mockReturnValue({
		...board,
		partition: () => ({
			todo: [session, other],
			active: [],
			review: [],
			done: [],
		}),
	});
	search.mockResolvedValue({
		ok: true,
		value: {
			items: [
				{ sessionId: id, snippet: "match" },
				{ sessionId: otherId, snippet: "match" },
			],
			hasMore: false,
		},
	});
	changeQuery("message");
	await vi.advanceTimersByTimeAsync(250);
	render(props);
	expect(visibleIds()).toEqual([id, otherId]);
	vi.mocked(useKanban).mockReturnValue({
		...board,
		partition: () => ({
			todo: [other],
			active: [session],
			review: [],
			done: [],
		}),
	});
	render(props);
	expect(visibleIds()).toEqual([otherId, id]);
	expect(search.mock.calls[0][1].aborted).toBe(false);
	expect(search).toHaveBeenCalledTimes(1);
});

test("workspace identity changes cancel search even when membership is unchanged", async () => {
	search.mockResolvedValue({
		ok: true,
		value: { items: [{ sessionId: id, snippet: "match" }], hasMore: false },
	});
	changeQuery("message");
	await vi.advanceTimersByTimeAsync(250);
	render(props);
	expect(visibleIds()).toEqual([id]);
	vi.stubGlobal("localStorage", { getItem: () => "ungrouped" });
	window.dispatchEvent(new Event("storage"));
	render(props);
	expect(search.mock.calls[0][1].aborted).toBe(true);
	expect(visibleIds()).toEqual([]);
	await vi.advanceTimersByTimeAsync(250);
	expect(search).toHaveBeenCalledTimes(2);
	expect(search.mock.calls[1][0]).toEqual({
		query: "message",
		sessionIds: [id],
	});
});
