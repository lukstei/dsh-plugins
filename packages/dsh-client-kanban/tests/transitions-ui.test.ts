import assert from "node:assert/strict";
import type {
	SessionListState,
	SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
	ComponentProps,
	Dispatch,
	MouseEvent,
	SetStateAction,
} from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { KanbanCard } from "../src/client/KanbanCard.tsx";
import {
	KanbanPane,
	type KanbanPaneInjected,
} from "../src/client/KanbanPane.tsx";
import { KanbanSection } from "../src/client/KanbanSection.tsx";
import { deriveKanbanBoard } from "../src/client/store.ts";
import { useKanban } from "../src/client/use-kanban.ts";
import type { KanbanLane } from "../src/types.ts";

const ui = vi.hoisted(() => ({
	jsx: vi.fn((_type: unknown, _props: unknown) => null),
}));
vi.mock("react", () => ({
	useState: <T>(
		initial?: T | (() => T),
	): [T | undefined, Dispatch<SetStateAction<T | undefined>>] => {
		const isInitializer = (value: typeof initial): value is () => T =>
			typeof value === "function";
		return [
			isInitializer(initial) ? initial() : initial,
			vi.fn<Dispatch<SetStateAction<T | undefined>>>(),
		];
	},
	useEffect: () => {},
	useMemo: (compute: () => unknown) => compute(),
	useCallback: (callback: unknown) => callback,
	useRef: (current: unknown) => ({ current }),
}));
vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: ui.jsx,
	Fragment: Symbol.for("react.fragment"),
}));
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	Menu: "Menu",
}));
vi.mock("../src/client/use-kanban.ts", () => ({
	useKanban: vi.fn(),
	useStore: (store: KanbanPaneInjected["sessionsList"]) => store.getSnapshot(),
}));

beforeEach(() => ui.jsx.mockClear());

test.each([
	{
		source: "todo",
		commands: [[], ["start"], ["unhold"], ["done"]],
		buttons: ["Start", "Review", "Done"],
		targets: ["active", "review", "done"],
	},
	{ source: "active", commands: [[], [], [], []], buttons: [], targets: [] },
	{
		source: "review",
		commands: [["hold"], [], [], ["done"]],
		buttons: ["Done", "Hold"],
		targets: ["done", "todo"],
	},
	{
		source: "done",
		commands: [["hold"], [], ["reopen"], []],
		buttons: ["Review", "Hold"],
		targets: ["review", "todo"],
	},
] satisfies {
	source: KanbanLane;
	commands: string[][];
	buttons: string[];
	targets: KanbanLane[];
}[])(
	"dispatches allowed $source moves and exposes matching card actions",
	async ({ source, commands, buttons, targets }) => {
		// edge case: fixture ID stands in for a server-issued branded SessionId
		const id = "transition" as SessionId;
		const session: SessionSummary = {
			id,
			displayTitle: "Task",
			running: source === "active",
			blank: source === "todo",
			updatedAt: 1000,
			retainedBy: {},
			projectionValues: {
				kanban: {
					sessionId: id,
					createdAt: 1000,
					prompt: "Task prompt",
					links: [],
					...(source === "todo" ? { heldAt: 2000 } : {}),
					...(source === "done" ? { doneAt: 2000 } : {}),
				},
			},
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
		const dispatched: string[] = [];
		const props: KanbanPaneInjected = {
			sessionsList: { getSnapshot: () => list, subscribe: () => () => {} },
			workspacesList: {
				getSnapshot: () => workspaces,
				subscribe: () => () => {},
			},
			sessionStatus: {
				getSnapshot: () => new Map(),
				subscribe: () => () => {},
			},
			searchSessions: async () => ({
				ok: true,
				value: { items: [], hasMore: false },
			}),
			searchResultLimit: 20,
			selectPanel: () => {},
			selectSession: () => {},
			startTask: async () => {},
			prepareTask: async () => {},
			deleteSession: async () => {},
			pinSession: async () => {},
			unpinSession: async () => {},
			startPreparedTask: async (sessionId, prompt) => {
				expect([sessionId, prompt]).toEqual([id, "Task prompt"]);
				dispatched.push("start");
			},
			holdSession: async () => {
				dispatched.push("hold");
			},
			unholdSession: async () => {
				dispatched.push("unhold");
			},
			markDone: async () => {
				dispatched.push("done");
			},
			reopen: async () => {
				dispatched.push("reopen");
			},
		};
		vi.mocked(useKanban).mockReturnValue(
			deriveKanbanBoard(list, [], new Map(), 3000),
		);
		KanbanPane(props);
		const call = ui.jsx.mock.calls.find(([type]) => type === KanbanSection);
		assert(call);
		// edge case: captured component identity determines its props
		const section = call[1] as ComponentProps<typeof KanbanSection>;
		const actual: string[][] = [];
		for (const target of [
			"todo",
			"active",
			"review",
			"done",
		] satisfies KanbanLane[]) {
			dispatched.length = 0;
			await section.onDropSession(id, target);
			actual.push([...dispatched]);
		}
		expect(actual).toEqual(commands);

		ui.jsx.mockClear();
		const onTransition = vi.fn();
		KanbanCard({
			session,
			lane: source,
			isSelected: false,
			onSelect: props.selectSession,
			onTransition,
		});
		const actions = ui.jsx.mock.calls
			.filter(([type]) => type === "button")
			.map(([, value]) => {
				// edge case: intrinsic button identity determines captured props
				return value as ComponentProps<"button">;
			});
		expect(actions.map((action) => action.children)).toEqual(buttons);
		const stopPropagation = vi.fn();
		for (const action of actions) {
			assert(action.onClick);
			// edge case: card actions only consume stopPropagation from the browser event
			action.onClick({
				stopPropagation,
			} as unknown as MouseEvent<HTMLButtonElement>);
		}
		expect(onTransition.mock.calls).toEqual(
			targets.map((target) => [id, target]),
		);
		expect(stopPropagation).toHaveBeenCalledTimes(targets.length);
	},
);
