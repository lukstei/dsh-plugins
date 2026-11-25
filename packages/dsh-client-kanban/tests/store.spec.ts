import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceId } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionStatusSnapshot } from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { describe, expect, it } from "vitest";
import {
	classifyKanbanSession,
	compareKanbanSessionPriority,
	deriveKanbanBoard,
	extractActiveSubagentParentIds,
	formatKanbanAlertLabel,
	formatRelativeTime,
	getKanbanSessionAlert,
	getKanbanSessionTitle,
	getSessionRecency,
	getStoredKanbanWorkspace,
	groupSessionsByWorkspace,
	isKanbanTransitionAllowed,
	isSessionEligibleForHydration,
	isSessionInWorkspace,
	isSessionRelevantToSidebar,
	isSessionVisibleInKanban,
	RECENT_REVIEW_WINDOW_MS,
	setStoredKanbanWorkspace,
	shouldSeedKanbanDraft,
	sortWorkspacesByRecency,
} from "../src/client/store.ts";
import {
	type KanbanLane,
	type KanbanRecord,
	ONE_WEEK_MS,
} from "../src/types.ts";

function mockSession(
	id: string,
	running: boolean,
	blank: boolean,
	cwd?: string,
): SessionSummary {
	return {
		id: id as SessionId,
		displayTitle: `Session ${id}`,
		running,
		blank,
		cwd,
		updatedAt: 1000,
		retainedBy: {},
	};
}

describe("isSessionRelevantToSidebar", () => {
	const s1 = "s1" as SessionId;
	const s2 = "s2" as SessionId;

	it("returns true for the active session", () => {
		expect(
			isSessionRelevantToSidebar(s1, undefined, { activeSessionId: s1 }),
		).toBe(true);
		expect(
			isSessionRelevantToSidebar(
				s1,
				{ running: false, retainedBy: { mainView: 1 } },
				{},
			),
		).toBe(true);
	});

	it("returns true for running sessions or subagents", () => {
		expect(
			isSessionRelevantToSidebar(s1, { running: true, retainedBy: {} }, {}),
		).toBe(true);
		const statusSnapshot = new Map([
			[s1, { running: true }],
		]) as unknown as SessionStatusSnapshot;
		expect(
			isSessionRelevantToSidebar(s1, undefined, {
				sessionStatus: statusSnapshot,
			}),
		).toBe(true);
		expect(
			isSessionRelevantToSidebar(s1, undefined, {
				activeSubagentParentIds: new Set([s1]),
			}),
		).toBe(true);
	});

	it("returns true for sessions with pending interactions", () => {
		const statusSnapshot = new Map([
			[
				s1,
				{ running: false, pendingInteraction: { kind: "question" as const } },
			],
		]) as unknown as SessionStatusSnapshot;
		expect(
			isSessionRelevantToSidebar(s1, undefined, {
				sessionStatus: statusSnapshot,
			}),
		).toBe(true);
	});

	it("returns true for sessions in split view", () => {
		expect(
			isSessionRelevantToSidebar(s1, undefined, {
				splitSessionIds: [s1],
			}),
		).toBe(true);
	});

	it("returns false for idle non-sidebar sessions", () => {
		expect(
			isSessionRelevantToSidebar(
				s1,
				{ running: false, retainedBy: {} },
				{
					activeSessionId: s2,
					splitSessionIds: [s2],
				},
			),
		).toBe(false);
	});
});

describe("isSessionEligibleForHydration", () => {
	const now = 1_000_000_000;

	it("returns false for null or undefined summary", () => {
		expect(isSessionEligibleForHydration(undefined, now)).toBe(false);
		expect(isSessionEligibleForHydration(null, now)).toBe(false);
	});

	it("returns true for running sessions regardless of recency", () => {
		expect(
			isSessionEligibleForHydration(
				{ running: true, updatedAt: now - ONE_WEEK_MS - 1000 },
				now,
			),
		).toBe(true);
	});

	it("returns true for inactive sessions within 7 days", () => {
		expect(
			isSessionEligibleForHydration(
				{ running: false, updatedAt: now - ONE_WEEK_MS },
				now,
			),
		).toBe(true);
		expect(
			isSessionEligibleForHydration(
				{ running: false, updatedAt: now - 1000 },
				now,
			),
		).toBe(true);
	});

	it("returns false for inactive sessions older than 7 days", () => {
		expect(
			isSessionEligibleForHydration(
				{ running: false, updatedAt: now - ONE_WEEK_MS - 1 },
				now,
			),
		).toBe(false);
	});
});

describe("isSessionVisibleInKanban", () => {
	const now = 1_000_000_000;

	it("filters out sessions not initialized with the plugin", () => {
		expect(isSessionVisibleInKanban(undefined, undefined, now)).toBe(false);
		expect(isSessionVisibleInKanban(null, undefined, now)).toBe(false);
	});

	it("includes active sessions without doneAt", () => {
		const record: KanbanRecord = {
			links: [],
			sessionId: "s1" as SessionId,
			createdAt: now - 1000,
		};
		expect(isSessionVisibleInKanban(record, undefined, now)).toBe(true);
		expect(isSessionVisibleInKanban(record, { blank: false }, now)).toBe(true);
	});

	it("filters out unstarted blank sessions without prompt or hold state", () => {
		const record: KanbanRecord = {
			links: [],
			sessionId: "s1" as SessionId,
			createdAt: now - 1000,
		};
		expect(isSessionVisibleInKanban(record, { blank: true }, now)).toBe(false);
	});

	it("includes unstarted blank sessions with a prepared prompt", () => {
		const record: KanbanRecord = {
			links: [],
			sessionId: "s1" as SessionId,
			createdAt: now - 1000,
			prompt: "Prepared task prompt",
		};
		expect(isSessionVisibleInKanban(record, { blank: true }, now)).toBe(true);
	});

	it("includes unstarted blank sessions that are held", () => {
		const record: KanbanRecord = {
			links: [],
			sessionId: "s1" as SessionId,
			createdAt: now - 1000,
			heldAt: now - 500,
		};
		expect(isSessionVisibleInKanban(record, { blank: true }, now)).toBe(true);
	});

	it("includes sessions marked done within 7 days", () => {
		const record: KanbanRecord = {
			links: [],
			sessionId: "s1" as SessionId,
			createdAt: now - 2000,
			doneAt: now - (ONE_WEEK_MS - 1000),
		};
		expect(isSessionVisibleInKanban(record, undefined, now)).toBe(true);
	});

	it("filters out sessions marked done more than 7 days ago", () => {
		const record: KanbanRecord = {
			links: [],
			sessionId: "s1" as SessionId,
			createdAt: now - 2000,
			doneAt: now - (ONE_WEEK_MS + 1000),
		};
		expect(isSessionVisibleInKanban(record, undefined, now)).toBe(false);
	});

	it("retains pinned sessions in done lane even if older than 7 days", () => {
		const record: KanbanRecord = {
			links: [],
			sessionId: "s1" as SessionId,
			createdAt: now - 2000,
			doneAt: now - (ONE_WEEK_MS + 5000),
			pinnedAt: now - 1000,
		};
		expect(isSessionVisibleInKanban(record, undefined, now)).toBe(true);
	});
});

describe("isSessionInWorkspace", () => {
	it("returns true if session id is in workspace.sessionIds", () => {
		const session = { id: "s1" as SessionId, cwd: "/path/a" };
		const workspace = { sessionIds: ["s1" as SessionId], path: "/path/b" };
		expect(isSessionInWorkspace(session, workspace)).toBe(true);
	});

	it("returns true if session cwd equals workspace path", () => {
		const session = { id: "s1" as SessionId, cwd: "/path/match" };
		const workspace = { sessionIds: [], path: "/path/match" };
		expect(isSessionInWorkspace(session, workspace)).toBe(true);
	});

	it("returns false if neither id nor cwd match", () => {
		const session = { id: "s1" as SessionId, cwd: "/path/a" };
		const workspace = { sessionIds: ["s2" as SessionId], path: "/path/b" };
		expect(isSessionInWorkspace(session, workspace)).toBe(false);
	});
});

describe("sortWorkspacesByRecency", () => {
	it("sorts workspaces descending by the highest updatedAt of their sessions", () => {
		const workspaces = [
			{
				workspaceId: "w1" as WorkspaceId,
				sessionIds: ["s1" as SessionId],
				path: "/w1",
				title: "W1",
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01",
			},
			{
				workspaceId: "w2" as WorkspaceId,
				sessionIds: ["s2" as SessionId],
				path: "/w2",
				title: "W2",
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01",
			},
		];
		const sessions = {
			s1: { updatedAt: 100, cwd: "/w1" },
			s2: { updatedAt: 500, cwd: "/w2" },
		};

		const sorted = sortWorkspacesByRecency(workspaces, sessions);
		expect(sorted[0].workspaceId).toBe("w2");
		expect(sorted[1].workspaceId).toBe("w1");
	});

	it("falls back to workspace updatedAt and title when no sessions match", () => {
		const workspaces = [
			{
				workspaceId: "w-beta" as WorkspaceId,
				sessionIds: [],
				path: "/beta",
				title: "Beta",
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				workspaceId: "w-alpha" as WorkspaceId,
				sessionIds: [],
				path: "/alpha",
				title: "Alpha",
				createdAt: "2026-01-01",
				updatedAt: "2026-01-02T00:00:00.000Z",
			},
		];

		const sorted = sortWorkspacesByRecency(workspaces, {});
		expect(sorted[0].workspaceId).toBe("w-alpha");
		expect(sorted[1].workspaceId).toBe("w-beta");
	});
});

describe("classifyKanbanSession", () => {
	const baseRecord: KanbanRecord = {
		links: [],
		sessionId: "s1" as SessionId,
		createdAt: 1000,
	};

	it("classifies as review if hasPendingInteraction is true regardless of running state", () => {
		expect(
			classifyKanbanSession({ running: true, blank: false }, baseRecord, true),
		).toBe("review");
		expect(
			classifyKanbanSession({ running: false, blank: true }, baseRecord, true),
		).toBe("review");
	});

	it("classifies as active if running is true and no pending interaction", () => {
		expect(
			classifyKanbanSession({ running: true, blank: false }, baseRecord, false),
		).toBe("active");
	});

	it("classifies as active if hasActiveSubagent is true and no pending interaction", () => {
		expect(
			classifyKanbanSession(
				{ running: false, blank: false },
				baseRecord,
				false,
				true,
			),
		).toBe("active");
	});

	it("classifies as done if doneAt is defined", () => {
		const doneRecord: KanbanRecord = { ...baseRecord, doneAt: 2000 };
		expect(
			classifyKanbanSession(
				{ running: false, blank: false },
				doneRecord,
				false,
			),
		).toBe("done");
	});

	it("classifies as todo if blank is true", () => {
		expect(
			classifyKanbanSession({ running: false, blank: true }, baseRecord, false),
		).toBe("todo");
	});

	it("honors runtime status before explicit Review placement", () => {
		const record = { ...baseRecord, reviewAt: 2000 };
		expect([
			classifyKanbanSession({ running: false, blank: true }, record),
			classifyKanbanSession({ running: true, blank: true }, record),
			classifyKanbanSession({ running: true, blank: true }, record, true),
			classifyKanbanSession(
				{ running: false, blank: true },
				record,
				false,
				true,
			),
		]).toEqual(["review", "active", "review", "active"]);
	});

	it("classifies as todo if heldAt is defined", () => {
		const heldRecord: KanbanRecord = { ...baseRecord, heldAt: 1500 };
		expect(
			classifyKanbanSession(
				{ running: false, blank: false },
				heldRecord,
				false,
			),
		).toBe("todo");
	});

	it("classifies as review if idle (not running, not blank, not done, not held)", () => {
		expect(
			classifyKanbanSession(
				{ running: false, blank: false },
				baseRecord,
				false,
			),
		).toBe("review");
	});
});

describe("getKanbanSessionAlert", () => {
	it("returns question for question pending interactions", () => {
		const status = {
			running: false,
			pendingInteraction: {
				key: "q-1",
				kind: "question",
				sessionId: "s1" as SessionId,
			},
			completionUnread: false,
		};
		expect(getKanbanSessionAlert(status)).toBe("question");
	});

	it("returns permission for approval pending interactions", () => {
		const status = {
			running: false,
			pendingInteraction: {
				key: "app-1",
				kind: "approval",
				sessionId: "s1" as SessionId,
			},
			completionUnread: false,
		};
		expect(getKanbanSessionAlert(status)).toBe("permission");
	});

	it("returns permission for ACP permission questions", () => {
		const status = {
			running: false,
			pendingInteraction: {
				key: "acp-permission:permission-1",
				kind: "question",
				sessionId: "s1" as SessionId,
			},
			completionUnread: false,
		};
		expect(getKanbanSessionAlert(status)).toBe("permission");
	});

	it("returns permission for question interactions containing acp-permission questions", () => {
		const status = {
			running: false,
			pendingInteraction: {
				key: "question:s1:req-42",
				kind: "question",
				sessionId: "s1" as SessionId,
				questions: [{ id: "acp-permission:req-42" }],
			} as never,
			completionUnread: false,
		};
		expect(getKanbanSessionAlert(status)).toBe("permission");
	});

	it("returns error for error pending interactions or non-plan-review interactions", () => {
		const status = {
			running: false,
			pendingInteraction: {
				key: "err-1",
				kind: "error",
				sessionId: "s1" as SessionId,
			},
			completionUnread: false,
		};
		expect(getKanbanSessionAlert(status)).toBe("error");
	});

	it("returns undefined for plan-review pending interactions", () => {
		const status = {
			running: false,
			pendingInteraction: {
				key: "plan-1",
				kind: "plan-review",
				sessionId: "s1" as SessionId,
			},
			completionUnread: false,
		};
		expect(getKanbanSessionAlert(status)).toBeUndefined();
	});

	it("returns undefined when no alert condition is present", () => {
		expect(getKanbanSessionAlert(undefined, undefined)).toBeUndefined();
	});
});

describe("formatKanbanAlertLabel", () => {
	it("formats concise labels for each alert variant", () => {
		expect(formatKanbanAlertLabel("permission")).toBe("Permission");
		expect(formatKanbanAlertLabel("question")).toBe("Question");
		expect(formatKanbanAlertLabel("error")).toBe("Stopped");
	});
});

describe("compareKanbanSessionPriority", () => {
	const s1 = mockSession("s1", false, false);
	const s2 = mockSession("s2", true, false);
	const s3 = mockSession("s3", false, false);

	it("prioritizes sessions with alerts above all others", () => {
		const alertMap = new Map([["s1" as SessionId, "question" as const]]);
		expect(compareKanbanSessionPriority(s1, s2, alertMap)).toBe(-1);
		expect(compareKanbanSessionPriority(s2, s1, alertMap)).toBe(1);
	});

	it("prioritizes running sessions above idle sessions when neither has an alert", () => {
		expect(compareKanbanSessionPriority(s2, s3)).toBe(-1);
		expect(compareKanbanSessionPriority(s3, s2)).toBe(1);
	});

	it("falls back to updatedAt descending when priority tiers are equal", () => {
		const sRecent = { ...s1, updatedAt: 500 };
		const sOld = { ...s3, updatedAt: 100 };
		expect(compareKanbanSessionPriority(sRecent, sOld)).toBe(-400);
	});
});

describe("deriveKanbanBoard", () => {
	const now = 1_000_000_000;

	it.each([
		[true, false, false, false, "active"],
		[false, true, false, false, "active"],
		[false, false, true, false, "active"],
		[false, false, false, true, "review"],
		[true, true, true, true, "review"],
		[false, false, false, false, "todo"],
	] as const)(
		"resolves recordless runtime state without board membership (%s, %s, %s, %s)",
		(running, statusRunning, subagentRunning, pending, lane) => {
			const parent = mockSession("parent", running, false);
			const child: SessionSummary = {
				...mockSession("child", subagentRunning, false),
				origin: "subagent",
				parentId: parent.id,
			};
			const status: SessionStatusSnapshot = new Map([
				[
					parent.id,
					{
						running: statusRunning,
						completionUnread: false,
						pendingInteraction: pending
							? { kind: "approval", key: "approval", sessionId: parent.id }
							: undefined,
					},
				],
			]);
			const board = deriveKanbanBoard(
				{
					ids: [parent.id, child.id],
					byId: { [parent.id]: parent, [child.id]: child },
				},
				[],
				status,
				now,
			);
			expect(board.getLane(parent.id)).toBe(lane);
			expect(board.getAlert(parent.id)).toBe(
				pending ? "permission" : undefined,
			);
			expect({
				partition: board.partition(),
				sidebar: board.sidebarSessions,
				groups: board.workspaceGroups,
				totals: board.totalCounts,
				workspaceCounts: board.workspaceCounts,
			}).toMatchInlineSnapshot(`
				{
				  "groups": [],
				  "partition": {
				    "active": [],
				    "done": [],
				    "review": [],
				    "todo": [],
				  },
				  "sidebar": [],
				  "totals": {
				    "alerts": 0,
				    "inReview": 0,
				    "recentInReview": 0,
				    "running": 0,
				  },
				  "workspaceCounts": Map {},
				}
			`);
		},
	);

	it("partitions sessions into appropriate lanes", () => {
		const s1 = {
			...mockSession("s1", false, true),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s1" as SessionId,
					createdAt: now,
					prompt: "Task 1",
				},
			},
		};
		const s2 = {
			...mockSession("s2", true, false),
			projectionValues: {
				kanban: { links: [], sessionId: "s2" as SessionId, createdAt: now },
			},
		};
		const s3 = {
			...mockSession("s3", false, false),
			projectionValues: {
				kanban: { links: [], sessionId: "s3" as SessionId, createdAt: now },
			},
		};
		const s4 = {
			...mockSession("s4", false, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s4" as SessionId,
					createdAt: now,
					doneAt: now,
				},
			},
		};
		const s5 = mockSession("s5", false, false); // unmanaged (no kanban projection)

		const board = deriveKanbanBoard(
			{
				ids: [
					"s1" as SessionId,
					"s2" as SessionId,
					"s3" as SessionId,
					"s4" as SessionId,
					"s5" as SessionId,
				],
				byId: { s1, s2, s3, s4, s5 } as Record<SessionId, SessionSummary>,
			},
			[],
			undefined,
			now,
		);

		const partitioned = board.partition();
		expect(partitioned.todo.map((s) => s.id)).toEqual(["s1"]);
		expect(partitioned.active.map((s) => s.id)).toEqual(["s2"]);
		expect(partitioned.review.map((s) => s.id)).toEqual(["s3"]);
		expect(partitioned.done.map((s) => s.id)).toEqual(["s4"]);
	});

	it("filters out unstarted blank sessions without prompt from todo lane", () => {
		const sEmpty = {
			...mockSession("s-empty", false, true),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-empty" as SessionId,
					createdAt: now,
				},
			},
		};
		const board = deriveKanbanBoard(
			{
				ids: ["s-empty" as SessionId],
				byId: { "s-empty": sEmpty } as Record<SessionId, SessionSummary>,
			},
			[],
			undefined,
			now,
		);
		const partitioned = board.partition();
		expect(partitioned.todo).toEqual([]);
		expect(partitioned.active).toEqual([]);
		expect(partitioned.review).toEqual([]);
		expect(partitioned.done).toEqual([]);
	});

	it("routes active session to review lane when pending interaction is true", () => {
		const sActiveQuestion = {
			...mockSession("active-q", true, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "active-q" as SessionId,
					createdAt: now,
				},
			},
		};
		const status = new Map([
			[
				"active-q" as SessionId,
				{
					running: true,
					pendingInteraction: {} as never,
					completionUnread: false,
				},
			],
		]);
		const board = deriveKanbanBoard(
			{
				ids: ["active-q" as SessionId],
				byId: { "active-q": sActiveQuestion } as Record<
					SessionId,
					SessionSummary
				>,
			},
			[],
			status,
			now,
		);
		const partitioned = board.partition();
		expect(partitioned.active).toHaveLength(0);
		expect(partitioned.review.map((s) => s.id)).toEqual(["active-q"]);
		expect(board.getLane("active-q" as SessionId)).toBe("review");
	});

	it("routes session with active subagent to active lane", () => {
		const parent = {
			...mockSession("parent-1", false, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "parent-1" as SessionId,
					createdAt: now,
				},
			},
		};
		const subagent: SessionSummary = {
			...mockSession("subagent-1", true, false),
			parentId: "parent-1" as SessionId,
			origin: "subagent",
		};
		const board = deriveKanbanBoard(
			{
				ids: ["parent-1" as SessionId],
				byId: {
					"parent-1": parent,
					"subagent-1": subagent,
				} as Record<SessionId, SessionSummary>,
			},
			[],
			undefined,
			now,
		);
		const partitioned = board.partition();
		expect(partitioned.active.map((s) => s.id)).toEqual(["parent-1"]);
		expect(partitioned.review).toHaveLength(0);
		expect(board.getLane("parent-1" as SessionId)).toBe("active");
	});

	it("sorts cards in lanes descending by last activity (updatedAt)", () => {
		const sOld = {
			...mockSession("s-old", false, true),
			updatedAt: 100,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-old" as SessionId,
					createdAt: now,
					prompt: "Old prompt",
				},
			},
		};
		const sRecent = {
			...mockSession("s-recent", false, true),
			updatedAt: 500,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-recent" as SessionId,
					createdAt: now,
					prompt: "Recent prompt",
				},
			},
		};
		const sNewest = {
			...mockSession("s-newest", false, true),
			updatedAt: 900,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-newest" as SessionId,
					createdAt: now,
					prompt: "Newest prompt",
				},
			},
		};

		const board = deriveKanbanBoard(
			{
				ids: [
					"s-old" as SessionId,
					"s-newest" as SessionId,
					"s-recent" as SessionId,
				],
				byId: {
					"s-old": sOld,
					"s-recent": sRecent,
					"s-newest": sNewest,
				} as Record<SessionId, SessionSummary>,
			},
			[],
			undefined,
			now,
		);

		const partitioned = board.partition();
		expect(partitioned.todo.map((s) => s.id)).toEqual([
			"s-newest",
			"s-recent",
			"s-old",
		]);
	});

	it("sorts cards by lastActivityAt when session.updatedAt is stale", () => {
		const sStaleUpdatedRecentActivity = {
			...mockSession("s-stale", false, true),
			updatedAt: 100, // stale updatedAt from old prompt
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-stale" as SessionId,
					createdAt: now,
					lastActivityAt: 2000, // recent output from scheduled task
					prompt: "Scheduled run prompt",
				},
			},
		};
		const sOrdinary = {
			...mockSession("s-ordinary", false, true),
			updatedAt: 500,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-ordinary" as SessionId,
					createdAt: now,
					prompt: "Ordinary prompt",
				},
			},
		};

		expect(getSessionRecency(sStaleUpdatedRecentActivity)).toBe(2000);
		expect(getSessionRecency(sOrdinary)).toBe(500);

		const board = deriveKanbanBoard(
			{
				ids: ["s-ordinary" as SessionId, "s-stale" as SessionId],
				byId: {
					"s-stale": sStaleUpdatedRecentActivity,
					"s-ordinary": sOrdinary,
				} as Record<SessionId, SessionSummary>,
			},
			[],
			undefined,
			now,
		);

		const partitioned = board.partition();
		expect(partitioned.todo.map((s) => s.id)).toEqual([
			"s-stale",
			"s-ordinary",
		]);
	});

	it("places pinned sessions in done lane at top regardless of age and recency", () => {
		const sDoneOldPinned = {
			...mockSession("s-done-pinned", false, false),
			updatedAt: 100,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-done-pinned" as SessionId,
					createdAt: now - (ONE_WEEK_MS + 100_000),
					doneAt: now - (ONE_WEEK_MS + 50_000),
					pinnedAt: 200,
				},
			},
		};
		const sDoneRecentUnpinned = {
			...mockSession("s-done-unpinned", false, false),
			updatedAt: 900,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-done-unpinned" as SessionId,
					createdAt: now - 1000,
					doneAt: now - 500,
				},
			},
		};

		const board = deriveKanbanBoard(
			{
				ids: ["s-done-unpinned" as SessionId, "s-done-pinned" as SessionId],
				byId: {
					"s-done-pinned": sDoneOldPinned,
					"s-done-unpinned": sDoneRecentUnpinned,
				} as Record<SessionId, SessionSummary>,
			},
			[],
			undefined,
			now,
		);

		const partitioned = board.partition();
		expect(partitioned.done.map((s) => s.id)).toEqual([
			"s-done-pinned",
			"s-done-unpinned",
		]);
	});

	it("sorts multiple pinned done sessions by pinnedAt descending", () => {
		const sPin1 = {
			...mockSession("s-pin-1", false, false),
			updatedAt: 500,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-pin-1" as SessionId,
					createdAt: now,
					doneAt: now,
					pinnedAt: 1000,
				},
			},
		};
		const sPin2 = {
			...mockSession("s-pin-2", false, false),
			updatedAt: 200,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-pin-2" as SessionId,
					createdAt: now,
					doneAt: now,
					pinnedAt: 2000,
				},
			},
		};

		const board = deriveKanbanBoard(
			{
				ids: ["s-pin-1" as SessionId, "s-pin-2" as SessionId],
				byId: {
					"s-pin-1": sPin1,
					"s-pin-2": sPin2,
				} as Record<SessionId, SessionSummary>,
			},
			[],
			undefined,
			now,
		);

		const partitioned = board.partition();
		expect(partitioned.done.map((s) => s.id)).toEqual(["s-pin-2", "s-pin-1"]);
	});

	it("partitions by workspace and ungrouped correctly", () => {
		const ws1 = {
			workspaceId: "w1" as WorkspaceId,
			title: "Workspace 1",
			path: "/dev/project-1",
			sessionIds: ["s1" as SessionId],
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		};
		const s1 = {
			...mockSession("s1", false, false, "/dev/project-1"),
			projectionValues: {
				kanban: { links: [], sessionId: "s1" as SessionId, createdAt: now },
			},
		};
		const sUngrouped = {
			...mockSession("s-ungrouped", false, false, "/dev/other"),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-ungrouped" as SessionId,
					createdAt: now,
				},
			},
		};

		const board = deriveKanbanBoard(
			{
				ids: ["s1" as SessionId, "s-ungrouped" as SessionId],
				byId: { s1, "s-ungrouped": sUngrouped } as Record<
					SessionId,
					SessionSummary
				>,
			},
			[ws1],
			undefined,
			now,
		);

		expect(
			board.partition("w1" as WorkspaceId).review.map((s) => s.id),
		).toEqual(["s1"]);
		expect(board.partition("ungrouped").review.map((s) => s.id)).toEqual([
			"s-ungrouped",
		]);
	});

	it("computes workspace counts and total counts accurately", () => {
		const ws1 = {
			workspaceId: "ws-1" as WorkspaceId,
			path: "/repo-1",
			title: "Repo 1",
			sessionIds: ["s-active-1" as SessionId, "s-review-1" as SessionId],
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		};
		const ws2 = {
			workspaceId: "ws-2" as WorkspaceId,
			path: "/repo-2",
			title: "Repo 2",
			sessionIds: ["s-active-2" as SessionId],
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		};

		const sActive1 = {
			...mockSession("s-active-1", true, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-active-1" as SessionId,
					createdAt: now,
				},
			},
		};
		const sActive2 = {
			...mockSession("s-active-2", true, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-active-2" as SessionId,
					createdAt: now,
				},
			},
		};
		const sReview1 = {
			...mockSession("s-review-1", false, false),
			updatedAt: now,
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-review-1" as SessionId,
					createdAt: now,
				},
			},
		};
		const sDone = {
			...mockSession("s-done", false, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-done" as SessionId,
					createdAt: now,
					doneAt: now,
				},
			},
		};

		const board = deriveKanbanBoard(
			{
				ids: [
					"s-active-1" as SessionId,
					"s-active-2" as SessionId,
					"s-review-1" as SessionId,
					"s-done" as SessionId,
				],
				byId: {
					"s-active-1": sActive1,
					"s-active-2": sActive2,
					"s-review-1": sReview1,
					"s-done": sDone,
				} as Record<SessionId, SessionSummary>,
			},
			[ws1, ws2],
			undefined,
			now,
		);

		expect(board.workspaceCounts.get("ws-1" as WorkspaceId)).toEqual({
			running: 1,
			inReview: 1,
			alerts: 0,
		});
		expect(board.workspaceCounts.get("ws-2" as WorkspaceId)).toEqual({
			running: 1,
			inReview: 0,
			alerts: 0,
		});
		expect(board.totalCounts).toEqual({
			running: 2,
			inReview: 1,
			recentInReview: 1,
			alerts: 0,
		});

		const later = deriveKanbanBoard(
			{
				ids: ["s-review-1" as SessionId],
				byId: { "s-review-1": sReview1 } as Record<SessionId, SessionSummary>,
			},
			[ws1],
			undefined,
			now + RECENT_REVIEW_WINDOW_MS + 60_000,
		);
		expect(later.totalCounts.inReview).toBe(1);
		expect(later.totalCounts.recentInReview).toBe(0);
	});

	it("does not double-count alert sessions as inReview in workspaceCounts and totalCounts", () => {
		const ws = {
			workspaceId: "ws-1" as WorkspaceId,
			path: "/repo",
			title: "Repo",
			sessionIds: ["s-alert" as SessionId],
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		};
		const sAlert = {
			...mockSession("s-alert", false, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-alert" as SessionId,
					createdAt: now,
				},
			},
		};
		const status = new Map([
			[
				"s-alert" as SessionId,
				{
					running: false,
					pendingInteraction: {
						key: "q-1",
						kind: "question",
						sessionId: "s-alert" as SessionId,
					},
					completionUnread: false,
				},
			],
		]);
		const board = deriveKanbanBoard(
			{
				ids: ["s-alert" as SessionId],
				byId: { "s-alert": sAlert } as Record<SessionId, SessionSummary>,
			},
			[ws],
			status,
			now,
		);
		expect(board.workspaceCounts.get("ws-1" as WorkspaceId)).toEqual({
			running: 0,
			inReview: 0,
			alerts: 1,
		});
		expect(board.totalCounts).toEqual({
			running: 0,
			inReview: 0,
			recentInReview: 0,
			alerts: 1,
		});
	});

	it("identifies activeSessionId from mainView retention", () => {
		const s1 = mockSession("s1", false, false);
		const sMain = {
			...mockSession("s-main", false, false),
			retainedBy: { mainView: 1 },
		};

		const board = deriveKanbanBoard(
			{
				ids: ["s1" as SessionId, "s-main" as SessionId],
				byId: { s1, "s-main": sMain } as Record<SessionId, SessionSummary>,
			},
			[],
		);

		expect(board.activeSessionId).toBe("s-main");
	});

	it("keeps closed split members in sidebarSessions even past the done TTL", () => {
		const ws = {
			workspaceId: "ws-1" as WorkspaceId,
			path: "/repo",
			title: "Repo",
			sessionIds: ["s-active" as SessionId, "s-done" as SessionId],
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		};
		const sActive = {
			...mockSession("s-active", true, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-active" as SessionId,
					createdAt: now,
				},
			},
		};
		const sDone = {
			...mockSession("s-done", false, false),
			projectionValues: {
				kanban: {
					links: [],
					sessionId: "s-done" as SessionId,
					createdAt: now - 2 * ONE_WEEK_MS,
					doneAt: now - 2 * ONE_WEEK_MS,
				},
			},
		};

		const board = deriveKanbanBoard(
			{
				ids: ["s-active" as SessionId, "s-done" as SessionId],
				byId: {
					"s-active": sActive,
					"s-done": sDone,
				} as Record<SessionId, SessionSummary>,
			},
			[ws],
			undefined,
			now,
			["s-done" as SessionId, "s-active" as SessionId],
		);

		expect(board.sidebarSessions.map((session) => session.id)).toEqual([
			"s-active",
			"s-done",
		]);
		expect(board.workspaceGroups[0]?.sessions.map((s) => s.id)).toEqual([
			"s-active",
			"s-done",
		]);
		// TTL still hides the expired session from the board lanes.
		expect(board.partition().done).toEqual([]);
		expect(board.totalCounts.running).toBe(1);
	});

	it("does not list unmanaged split sessions in the sidebar", () => {
		const sUnmanaged = mockSession("s-unmanaged", false, false);

		const board = deriveKanbanBoard(
			{
				ids: ["s-unmanaged" as SessionId],
				byId: { "s-unmanaged": sUnmanaged } as Record<
					SessionId,
					SessionSummary
				>,
			},
			[],
			undefined,
			now,
			["s-unmanaged" as SessionId],
		);

		expect(board.sidebarSessions).toEqual([]);
	});
});

describe("isKanbanTransitionAllowed", () => {
	const allLanes: KanbanLane[] = ["todo", "active", "review", "done"];

	it("allows stopped-state movement and only starts tasks from todo", () => {
		expect(
			allLanes.map((source) =>
				allLanes.map((target) => isKanbanTransitionAllowed(source, target)),
			),
		).toEqual([
			[false, true, true, true],
			[false, false, false, false],
			[true, false, false, true],
			[true, false, true, false],
		]);
	});
});

describe("shouldSeedKanbanDraft", () => {
	const baseRecord: KanbanRecord = {
		links: [],
		sessionId: "s1" as SessionId,
		createdAt: 1000,
		prompt: "Implement user authentication",
	};

	it("seeds when session is unstarted, blank, not running, and has a prompt", () => {
		expect(
			shouldSeedKanbanDraft({ running: false, blank: true }, baseRecord),
		).toBe(true);
	});

	it("does not seed when session is currently running", () => {
		// edge case: DSH keeps blank: true during the first executing turn
		expect(
			shouldSeedKanbanDraft({ running: true, blank: true }, baseRecord),
		).toBe(false);
	});

	it("does not seed when isRunning parameter is true", () => {
		expect(
			shouldSeedKanbanDraft({ running: false, blank: true }, baseRecord, true),
		).toBe(false);
	});

	it("does not seed when session is not blank", () => {
		expect(
			shouldSeedKanbanDraft({ running: false, blank: false }, baseRecord),
		).toBe(false);
	});

	it("does not seed when session is done", () => {
		const doneRecord: KanbanRecord = {
			...baseRecord,
			doneAt: 2000,
		};
		expect(
			shouldSeedKanbanDraft({ running: false, blank: true }, doneRecord),
		).toBe(false);
	});

	it("does not seed when record has no prompt", () => {
		const promptlessRecord: KanbanRecord = {
			links: [],
			sessionId: "s1" as SessionId,
			createdAt: 1000,
		};
		expect(
			shouldSeedKanbanDraft({ running: false, blank: true }, promptlessRecord),
		).toBe(false);
	});

	it("does not seed when session or record is undefined", () => {
		expect(shouldSeedKanbanDraft(undefined, baseRecord)).toBe(false);
		expect(
			shouldSeedKanbanDraft({ running: false, blank: true }, undefined),
		).toBe(false);
	});
});

describe("groupSessionsByWorkspace", () => {
	it("groups sessions by workspace path and includes unclaimed sessions under ungrouped", () => {
		const ws1 = {
			workspaceId: "w1" as WorkspaceId,
			title: "Workspace 1",
			path: "/dev/project-1",
			sessionIds: ["s1" as SessionId],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		};
		const ws2 = {
			workspaceId: "w2" as WorkspaceId,
			title: "Workspace 2",
			path: "/dev/project-2",
			sessionIds: [],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		};

		const s1 = {
			...mockSession("s1", false, false, "/dev/project-1"),
			updatedAt: 100,
		};
		const s2 = {
			...mockSession("s2", true, false, "/dev/project-2"),
			updatedAt: 200,
		};
		const s3 = {
			...mockSession("s3", false, false, "/dev/project-1"),
			updatedAt: 300,
		};
		const sUnclaimed = {
			...mockSession("s4", false, false, "/dev/other"),
			updatedAt: 50,
		};

		const groups = groupSessionsByWorkspace(
			[ws1, ws2],
			[s1, s2, s3, sUnclaimed],
		);

		expect(groups).toHaveLength(3);
		// ws1 contains s3 (updatedAt: 300) then s1 (updatedAt: 100)
		expect(groups[0].workspaceId).toBe("w1");
		expect(groups[0].sessions.map((s) => s.id)).toEqual(["s3", "s1"]);

		// ws2 contains s2 via cwd matching
		expect(groups[1].workspaceId).toBe("w2");
		expect(groups[1].sessions.map((s) => s.id)).toEqual(["s2"]);

		// ungrouped contains sUnclaimed
		expect(groups[2].workspaceId).toBe("ungrouped");
		expect(groups[2].sessions.map((s) => s.id)).toEqual(["s4"]);
	});

	it("does not create ungrouped section if all sessions are claimed", () => {
		const ws = {
			workspaceId: "w1" as WorkspaceId,
			title: "Project",
			path: "/dev/project",
			sessionIds: ["s1" as SessionId],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		};
		const s1 = mockSession("s1", false, false);
		const groups = groupSessionsByWorkspace([ws], [s1]);
		expect(groups).toHaveLength(1);
		expect(groups[0].workspaceId).toBe("w1");
	});
});

describe("formatRelativeTime", () => {
	const now = 100_000_000;

	it("formats just now for under 60 seconds", () => {
		expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
	});

	it("formats minutes ago", () => {
		expect(formatRelativeTime(now - 120_000, now)).toBe("2m ago");
		expect(formatRelativeTime(now - 3_500_000, now)).toBe("58m ago");
	});

	it("formats hours ago", () => {
		expect(formatRelativeTime(now - 7_200_000, now)).toBe("2h ago");
	});

	it("formats days ago", () => {
		expect(formatRelativeTime(now - 86_400_000 * 3, now)).toBe("3d ago");
	});
});

describe("getStoredKanbanWorkspace and setStoredKanbanWorkspace", () => {
	it("reads and writes workspace ID to storage", () => {
		const storage = new Map<string, string>();
		const mockStorage = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
			clear: () => storage.clear(),
			key: () => null,
			length: 0,
		} as Storage;

		const originalStorage = globalThis.localStorage;
		try {
			globalThis.localStorage = mockStorage;
			expect(getStoredKanbanWorkspace()).toBe(null);
			setStoredKanbanWorkspace("ws-test-123");
			expect(getStoredKanbanWorkspace()).toBe("ws-test-123");
		} finally {
			globalThis.localStorage = originalStorage;
		}
	});
});

describe("extractActiveSubagentParentIds", () => {
	it("extractActiveSubagentParentIds collects parent IDs only from running subagent sessions", () => {
		const parent1 = "p1" as SessionId;
		const parent2 = "p2" as SessionId;
		const sessionsById = {
			s1: {
				origin: "subagent",
				parentId: parent1,
				running: true,
			},
			s2: {
				origin: "subagent",
				parentId: parent1,
				running: true,
			},
			s3: {
				origin: "subagent",
				parentId: parent2,
				running: false,
			},
			s4: {
				origin: undefined,
				parentId: parent2,
				running: true,
			},
			s5: undefined,
		};
		const result = extractActiveSubagentParentIds(sessionsById as never);
		expect(result.has(parent1)).toBe(true);
		expect(result.has(parent2)).toBe(false);
		expect(result.size).toBe(1);
	});
});

describe("getKanbanSessionTitle", () => {
	it("returns explicit session title when present", () => {
		const session = {
			title: "Refactor login workflow",
			blank: false,
			displayTitle: "dsh-plugins",
			cwd: "/Users/dev/dsh-plugins",
		};
		expect(getKanbanSessionTitle(session, "dsh-plugins")).toBe(
			"Refactor login workflow",
		);
	});

	it("returns 'New Session' when session is blank", () => {
		const session = {
			title: undefined,
			blank: true,
			displayTitle: "dsh-plugins",
			cwd: "/Users/dev/dsh-plugins",
		};
		expect(getKanbanSessionTitle(session, "dsh-plugins")).toBe("New Session");
		expect(getKanbanSessionTitle(session)).toBe("New Session");
	});

	it("returns 'Untitled session' when title is unset and displayTitle equals workspace/cwd title", () => {
		const session = {
			title: undefined,
			blank: false,
			displayTitle: "dsh-plugins",
			cwd: "/Users/dev/dsh-plugins",
		};
		expect(getKanbanSessionTitle(session, "dsh-plugins")).toBe(
			"Untitled session",
		);
		expect(getKanbanSessionTitle(session)).toBe("Untitled session");
	});

	it("returns 'Untitled session' when displayTitle is 'Untitled Task' or empty", () => {
		const session1 = {
			title: undefined,
			blank: false,
			displayTitle: "Untitled Task",
		};
		const session2 = {
			title: undefined,
			blank: false,
			displayTitle: "",
		};
		expect(getKanbanSessionTitle(session1)).toBe("Untitled session");
		expect(getKanbanSessionTitle(session2)).toBe("Untitled session");
	});

	it("preserves explicit custom displayTitle when different from workspace fallback", () => {
		const session = {
			title: undefined,
			blank: false,
			displayTitle: "Task active",
			cwd: "/Users/dev/dsh-plugins",
		};
		expect(getKanbanSessionTitle(session, "Repo")).toBe("Task active");
	});
});
