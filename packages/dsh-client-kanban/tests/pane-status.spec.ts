import type {
	SessionListState,
	SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionStatusSnapshot } from "@deepseek-ai/dsh-client-ui-session/client";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { describe, expect, it, vi } from "vitest";
import { KanbanPaneStatus } from "../src/client/KanbanPaneStatus.tsx";
import { KanbanStatusDot } from "../src/client/KanbanStatusDot.tsx";

const ui = vi.hoisted(() => ({ jsx: vi.fn() }));
vi.mock("react", () => ({
	useCallback: (fn: unknown) => fn,
	useMemo: (fn: () => unknown) => fn(),
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
		getSnapshot(),
}));
vi.mock("react/jsx-dev-runtime", () => ({
	jsxDEV: (type: unknown, props: unknown) => {
		if (type === KanbanStatusDot) {
			// edge case: JSX test instrumentation receives untyped props at its boundary
			return KanbanStatusDot(props as Parameters<typeof KanbanStatusDot>[0]);
		}
		ui.jsx(type, props);
		return { type, props };
	},
}));

const sessionId = SessionId("task");
const workspaces: WorkspaceSnapshot = {
	items: [],
	archivedSessionIds: [],
	pinnedSessionIds: [],
	state: "idle",
	phase: "ready",
	error: null,
};
const store = <T>(value: T) => ({
	getSnapshot: () => value,
	subscribe: () => () => {},
});

describe("Kanban pane indicator", () => {
	it.each([
		[true, true, false, false, false, "active", "In Progress"],
		[true, false, false, false, false, "review", "In Review"],
		[true, false, true, false, false, "todo", "To Do"],
		[true, false, false, true, false, "done", "Done"],
		[true, true, false, false, true, "alert", "Permission"],
		[false, true, false, false, false, "active", "In Progress"],
		[false, false, false, false, true, "alert", "Permission"],
		[false, true, false, false, true, "alert", "Permission"],
		[false, false, false, false, false, "todo", "To Do"],
	] as const)(
		"uses the sidebar lane and alert classes (record=%s, running=%s, blank=%s, done=%s, pending=%s)",
		(hasRecord, running, blank, done, pending, state, label) => {
			ui.jsx.mockClear();
			const summary: SessionSummary = {
				id: sessionId,
				displayTitle: "Task",
				running,
				blank,
				updatedAt: 0,
				retainedBy: {},
				projectionValues: {
					kanban: hasRecord
						? {
								sessionId,
								createdAt: 0,
								links: [],
								...(done ? { doneAt: Date.now() } : {}),
							}
						: null,
				},
			};
			const sessions: SessionListState = {
				ids: [sessionId],
				byId: { [sessionId]: summary },
				phase: "ready",
				projectionsBySession: {},
			};
			const statuses: SessionStatusSnapshot = new Map([
				[
					sessionId,
					{
						running,
						completionUnread: false,
						pendingInteraction: pending
							? { kind: "approval", key: "approval", sessionId }
							: undefined,
					},
				],
			]);
			KanbanPaneStatus({
				sessionId,
				sessionsList: store(sessions),
				workspacesList: store(workspaces),
				sessionStatus: store(statuses),
			});
			expect(ui.jsx.mock.calls.map(([, props]) => props)).toEqual([
				{
					className: `dsh-kanban-badge-dot is-${state}`,
					"aria-hidden": "true",
				},
				expect.objectContaining({
					className: "dsh-kanban-pane-status",
					"aria-label": label,
					title: label,
				}),
			]);
		},
	);

	it("renders To Do when the session has no Kanban record", () => {
		ui.jsx.mockClear();
		const sessions: SessionListState = {
			ids: [],
			byId: {},
			phase: "ready",
			projectionsBySession: {},
		};
		KanbanPaneStatus({
			sessionId,
			sessionsList: store(sessions),
			workspacesList: store(workspaces),
			sessionStatus: store(new Map()),
		});
		expect(ui.jsx.mock.calls.at(-1)?.[1]).toMatchObject({
			className: "dsh-kanban-pane-status",
			"aria-label": "To Do",
		});
	});
});
