/** Pure business logic, filtering, and classification for DSH Kanban sessions. */
import type {
	SessionListState,
	SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type {
	WorkspaceId,
	WorkspaceView,
} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type {
	SessionStatus,
	SessionStatusSnapshot,
} from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { workspaceTitleOf } from "@deepseek-ai/dsh-util-workspace-path";
import { type KanbanLane, type KanbanRecord, ONE_WEEK_MS } from "../types.ts";

/**
 * Purpose: Determine whether a session belongs to the Kanban board and has not expired.
 * Contract:
 * - Inputs: KanbanRecord or null/undefined, optional session summary with blank status, and reference timestamp (defaults to Date.now()).
 * - Outputs: True if session is initialized, not expired in Done (> 7 days), and not an unstarted empty session.
 * - Throws / Errors: Never throws.
 */
export function isSessionVisibleInKanban(
	record: KanbanRecord | null | undefined,
	session?: Pick<SessionSummary, "blank">,
	now: number = Date.now(),
): boolean {
	if (!record) return false;
	if (
		record.doneAt !== undefined &&
		record.pinnedAt === undefined &&
		now - record.doneAt > ONE_WEEK_MS
	) {
		return false;
	}
	// edge case: unstarted session from '+' without a prompt or hold state
	if (
		session !== undefined &&
		session.blank &&
		!record.prompt &&
		record.heldAt === undefined &&
		record.reviewAt === undefined &&
		record.doneAt === undefined
	) {
		return false;
	}
	return true;
}

/**
 * Purpose: Determine whether a session belongs to a specified workspace by ID or directory path.
 * Contract:
 * - Inputs: Session summary with id and cwd, and workspace with sessionIds and path.
 * - Outputs: True if session id is in workspace or cwd matches workspace path.
 * - Throws / Errors: Never throws.
 */
export function isSessionInWorkspace(
	session: Pick<SessionSummary, "id" | "cwd">,
	workspace: Pick<WorkspaceView, "sessionIds" | "path">,
): boolean {
	return (
		workspace.sessionIds.includes(session.id) ||
		(session.cwd !== undefined && session.cwd === workspace.path)
	);
}

/**
 * Purpose: Context signals required to evaluate whether a session is relevant to the In-Flight Sidebar.
 * Contract:
 * - Inputs: Optional active session ID, split view session IDs, live session status map, and active subagent parent IDs.
 */
export interface SidebarRelevanceContext {
	readonly activeSessionId?: SessionId;
	readonly splitSessionIds?: readonly SessionId[];
	readonly sessionStatus?: SessionStatusSnapshot;
	readonly activeSubagentParentIds?: ReadonlySet<SessionId>;
}

/**
 * Purpose: Determine whether a session is relevant to the In-Flight Sidebar without requiring its Kanban projection.
 * Contract:
 * - Inputs: Session ID, summary (running and retainedBy flags), and context containing active ID, split IDs, and session status.
 * - Outputs: True if the session is currently active, running, awaiting user attention, or displayed in split view.
 * - Throws / Errors: Never throws.
 */
export function isSessionRelevantToSidebar(
	id: SessionId,
	summary: Pick<SessionSummary, "running" | "retainedBy"> | null | undefined,
	context: SidebarRelevanceContext,
): boolean {
	if (
		id === context.activeSessionId ||
		(summary?.retainedBy?.mainView ?? 0) > 0
	) {
		return true;
	}
	if (
		summary?.running ||
		context.sessionStatus?.get(id)?.running === true ||
		context.activeSubagentParentIds?.has(id) === true
	) {
		return true;
	}
	if (context.sessionStatus?.get(id)?.pendingInteraction !== undefined) {
		return true;
	}
	if (context.splitSessionIds?.includes(id) === true) {
		return true;
	}
	return false;
}

export const RECENT_REVIEW_WINDOW_MS = 30 * 60 * 1000;

/**
 * Purpose: Determine whether a session is eligible for Kanban projection hydration.
 * Contract:
 * - Inputs: Session summary with running and updatedAt (or undefined), optional timestamp.
 * - Outputs: True if session exists and is either running or updated within ONE_WEEK_MS.
 * - Throws / Errors: Never throws.
 */
export function isSessionEligibleForHydration(
	summary: Pick<SessionSummary, "running" | "updatedAt"> | null | undefined,
	now: number = Date.now(),
): boolean {
	if (!summary) return false;
	return Boolean(summary.running || now - summary.updatedAt <= ONE_WEEK_MS);
}

/**
 * Purpose: Retrieve effective recency for a session, prioritizing Kanban lastActivityAt over session.updatedAt.
 * Contract:
 * - Inputs: SessionSummary or a session subset with updatedAt and optional projectionValues.
 * - Outputs: Highest timestamp representing session activity in milliseconds.
 * - Throws / Errors: Never throws.
 */
export function getSessionRecency(
	session: Pick<SessionSummary, "updatedAt"> & {
		readonly projectionValues?: Record<string, unknown>;
	},
): number {
	const record = session.projectionValues?.kanban as
		| KanbanRecord
		| null
		| undefined;
	return Math.max(session.updatedAt, record?.lastActivityAt ?? 0);
}

/**
 * Purpose: Sort workspaces descending by the recency of their most recently updated session.
 * Contract:
 * - Inputs: Readonly array of workspaces and a record of sessions by ID.
 * - Outputs: New array of workspaces sorted descending by session recency, then updatedAt, then title/path.
 * - Throws / Errors: Never throws.
 */
export function sortWorkspacesByRecency(
	workspaces: readonly WorkspaceView[],
	sessionsById: Readonly<
		Record<
			string,
			Pick<SessionSummary, "updatedAt" | "cwd"> & {
				readonly projectionValues?: Record<string, unknown>;
			}
		>
	>,
): WorkspaceView[] {
	const recencyMap = new Map<string, number>();

	for (const [id, session] of Object.entries(sessionsById)) {
		if (!session) continue;
		for (const ws of workspaces) {
			if (isSessionInWorkspace({ id: id as SessionId, cwd: session.cwd }, ws)) {
				const current = recencyMap.get(ws.workspaceId) ?? 0;
				const sessionRecency = getSessionRecency(session);
				if (sessionRecency > current) {
					recencyMap.set(ws.workspaceId, sessionRecency);
				}
			}
		}
	}

	return [...workspaces].sort((a, b) => {
		const recDiff =
			(recencyMap.get(b.workspaceId) ?? 0) -
			(recencyMap.get(a.workspaceId) ?? 0);
		if (recDiff !== 0) return recDiff;
		const fallbackA = a.updatedAt ? Date.parse(a.updatedAt) || 0 : 0;
		const fallbackB = b.updatedAt ? Date.parse(b.updatedAt) || 0 : 0;
		if (fallbackB !== fallbackA) return fallbackB - fallbackA;
		return (a.title || a.path).localeCompare(b.title || b.path);
	});
}

/**
 * Purpose: Classify a live session into one of the four Kanban lanes.
 * Contract:
 * - Inputs: Session running/blank status, KanbanRecord, optional boolean indicating pending user interaction, and optional boolean indicating active subagent.
 * - Outputs: "review" if pending interaction, "active" if running or has active subagent, "done" if completed, "review" if explicitly placed there, "todo" if blank or held, otherwise "review".
 * - Throws / Errors: Never throws.
 */
export function classifyKanbanSession(
	session: Pick<SessionSummary, "running" | "blank">,
	record: KanbanRecord,
	hasPendingInteraction = false,
	hasActiveSubagent = false,
): KanbanLane {
	if (hasPendingInteraction) {
		return "review";
	}
	if (session.running || hasActiveSubagent) {
		return "active";
	}
	if (record.doneAt !== undefined) {
		return "done";
	}
	if (record.reviewAt !== undefined) {
		return "review";
	}
	if (session.blank || record.heldAt !== undefined) {
		return "todo";
	}
	return "review";
}

/**
 * Purpose: Determine whether a Kanban session draft should be seeded into localStorage.
 * Contract:
 * - Inputs: Session summary (running and blank flags), KanbanRecord, and optional running flag from sessionStatus.
 * - Outputs: True only if the session is unstarted (blank, not running, not done, and has a prompt).
 * - Throws / Errors: Never throws.
 */
export function shouldSeedKanbanDraft(
	session: Pick<SessionSummary, "running" | "blank"> | undefined,
	record: KanbanRecord | undefined,
	isRunning = false,
): boolean {
	if (!session || !record?.prompt) return false;
	if (record.doneAt !== undefined) return false;
	// edge case: DSH keeps session.blank true during the first executing turn until entries are committed
	if (session.running || isRunning) return false;
	return session.blank;
}

export type KanbanSessionAlert = "question" | "permission" | "error";

/**
 * Purpose: Determine whether a session requires immediate user attention (question, permission request, or non-finish stop reason).
 * Contract:
 * - Inputs: Optional SessionStatus for the session, and optional session summary.
 * - Outputs: KanbanSessionAlert ("question" | "permission" | "error") if urgent action is required, or undefined.
 * - Throws / Errors: Never throws.
 */
export function getKanbanSessionAlert(
	status?: SessionStatus,
	_session?: SessionSummary,
): KanbanSessionAlert | undefined {
	if (status && status.pendingInteraction) {
		const interaction = status.pendingInteraction;
		// edge case: ACP permission requests are published under kind 'question' with 'acp-permission:' question IDs
		const hasAcpPermissionQuestion = (
			interaction as { questions?: readonly { readonly id?: string }[] }
		).questions?.some((q) => q.id?.startsWith("acp-permission:"));
		if (
			interaction.kind === "approval" ||
			interaction.key?.startsWith("acp-permission:") ||
			hasAcpPermissionQuestion
		) {
			return "permission";
		}
		if (interaction.kind === "question") {
			return "question";
		}
		if (interaction.kind !== "plan-review") {
			return "error";
		}
	}
	return undefined;
}

/**
 * Purpose: Format a concise user-facing label for a KanbanSessionAlert.
 * Contract:
 * - Inputs: KanbanSessionAlert ("question" | "permission" | "error").
 * - Outputs: Formatted label string ("Question", "Permission", or "Stopped").
 * - Throws / Errors: Never throws.
 */
export function formatKanbanAlertLabel(alert: KanbanSessionAlert): string {
	switch (alert) {
		case "permission":
			return "Permission";
		case "question":
			return "Question";
		case "error":
			return "Stopped";
	}
}

/**
 * Purpose: Resolve the display title for a session in Kanban views (sidebar and board cards) matching native DSH fallback behavior.
 * Contract:
 * - Inputs: Session summary (title, blank, displayTitle, cwd) and optional workspace/group title.
 * - Outputs: Explicit session title if set; "New Session" for blank sessions; "Untitled session" if displayTitle matches workspace/cwd fallback or is unset; otherwise displayTitle.
 * - Throws / Errors: Never throws.
 */
export function getKanbanSessionTitle(
	session: Pick<SessionSummary, "title" | "blank" | "displayTitle"> & {
		readonly cwd?: string;
	},
	workspaceTitle?: string,
): string {
	if (session.title) {
		return session.title;
	}
	if (session.blank) {
		return "New Session";
	}
	const cwdBase = session.cwd ? workspaceTitleOf(session.cwd) : undefined;
	if (
		!session.displayTitle ||
		session.displayTitle === "Untitled Task" ||
		session.displayTitle === "Untitled session" ||
		(workspaceTitle !== undefined && session.displayTitle === workspaceTitle) ||
		(cwdBase !== undefined && session.displayTitle === cwdBase)
	) {
		return "Untitled session";
	}
	return session.displayTitle;
}

/**
 * Purpose: Compare two session summaries by priority: alerts first, then running, then recency.
 * Contract:
 * - Inputs: Two SessionSummary objects a and b, optional alert map or resolver, and optional running map or resolver.
 * - Outputs: Negative if a outranks b, positive if b outranks a, 0 if equal.
 * - Throws / Errors: Never throws.
 */
export function compareKanbanSessionPriority(
	a: SessionSummary,
	b: SessionSummary,
	alertMap?: ReadonlyMap<SessionId, KanbanSessionAlert | undefined>,
	runningMap?: ReadonlyMap<SessionId, boolean>,
): number {
	const alertA = alertMap ? alertMap.get(a.id) : undefined;
	const alertB = alertMap ? alertMap.get(b.id) : undefined;

	if (alertA !== undefined && alertB === undefined) return -1;
	if (alertA === undefined && alertB !== undefined) return 1;

	const runningA = runningMap ? (runningMap.get(a.id) ?? false) : a.running;
	const runningB = runningMap ? (runningMap.get(b.id) ?? false) : b.running;

	if (runningA && !runningB) return -1;
	if (!runningA && runningB) return 1;

	return getSessionRecency(b) - getSessionRecency(a);
}

export interface PartitionedKanbanSessions {
	readonly todo: readonly SessionSummary[];
	readonly active: readonly SessionSummary[];
	readonly review: readonly SessionSummary[];
	readonly done: readonly SessionSummary[];
}

export interface WorkspaceSessionCounts {
	readonly running: number;
	readonly inReview: number;
	readonly alerts: number;
}

export interface ActiveAndReviewCounts {
	readonly running: number;
	readonly inReview: number;
	/** In-review sessions with activity within RECENT_REVIEW_WINDOW_MS. */
	readonly recentInReview: number;
	readonly alerts: number;
}

export interface WorkspaceGroup {
	readonly workspaceId: WorkspaceId | "ungrouped";
	readonly title: string;
	readonly path?: string;
	readonly sessions: readonly SessionSummary[];
}

/**
 * Purpose: Determine whether moving a session between two Kanban lanes is permitted.
 * Contract:
 * - Inputs: Source KanbanLane and target KanbanLane.
 * - Outputs: True for distinct stopped lanes and "todo" -> "active"; false for all other moves.
 * - Throws / Errors: Never throws.
 */
export function isKanbanTransitionAllowed(
	sourceLane: KanbanLane,
	targetLane: KanbanLane,
): boolean {
	return (
		sourceLane !== targetLane &&
		sourceLane !== "active" &&
		(targetLane !== "active" || sourceLane === "todo")
	);
}

/**
 * Purpose: Extract the set of parent session IDs that currently have active running subagents.
 * Contract:
 * - Inputs: Record or dictionary of session summaries keyed by session ID.
 * - Outputs: Set of parent SessionIds whose child subagent sessions are running.
 * - Throws / Errors: Never throws.
 */
export function extractActiveSubagentParentIds(
	sessionsById: Readonly<
		Record<
			string,
			Pick<SessionSummary, "origin" | "parentId" | "running"> | null | undefined
		>
	>,
): Set<SessionId> {
	const activeSubagentParentIds = new Set<SessionId>();
	for (const summary of Object.values(sessionsById)) {
		if (
			summary?.origin === "subagent" &&
			summary.parentId !== undefined &&
			summary.running
		) {
			activeSubagentParentIds.add(summary.parentId);
		}
	}
	return activeSubagentParentIds;
}

/**
 * Purpose: Group session summaries by workspace according to workspace memberships and directory matching.
 * Contract:
 * - Inputs: Readonly array of workspaces, readonly array of session summaries, and optional sort comparator.
 * - Outputs: Readonly array of WorkspaceGroup items with sessions sorted by the comparator (or descending by updatedAt), with loose sessions appended last.
 * - Throws / Errors: Never throws.
 */
export function groupSessionsByWorkspace(
	workspaces: readonly WorkspaceView[],
	sessions: readonly SessionSummary[],
	comparator?: (a: SessionSummary, b: SessionSummary) => number,
): readonly WorkspaceGroup[] {
	const claimed = new Set<SessionId>();
	const groups: WorkspaceGroup[] = [];
	const sortFn =
		comparator ?? ((a, b) => getSessionRecency(b) - getSessionRecency(a));

	for (const ws of workspaces) {
		const wsSessions: SessionSummary[] = [];
		for (const session of sessions) {
			if (isSessionInWorkspace(session, ws)) {
				wsSessions.push(session);
				claimed.add(session.id);
			}
		}
		wsSessions.sort(sortFn);
		groups.push({
			workspaceId: ws.workspaceId,
			title: ws.title || ws.path,
			path: ws.path,
			sessions: wsSessions,
		});
	}

	const unclaimed = sessions.filter((s) => !claimed.has(s.id)).sort(sortFn);

	if (unclaimed.length > 0) {
		groups.push({
			workspaceId: "ungrouped",
			title: "Other Sessions",
			sessions: unclaimed,
		});
	}

	return groups;
}

export interface KanbanBoard {
	readonly activeSessionId: SessionId | undefined;
	readonly sortedWorkspaces: readonly WorkspaceView[];
	readonly workspaceCounts: ReadonlyMap<WorkspaceId, WorkspaceSessionCounts>;
	readonly totalCounts: ActiveAndReviewCounts;
	readonly sidebarSessions: readonly SessionSummary[];
	readonly workspaceGroups: readonly WorkspaceGroup[];
	readonly getLane: (sessionId: SessionId) => KanbanLane;
	readonly getAlert: (sessionId: SessionId) => KanbanSessionAlert | undefined;
	readonly partition: (
		workspaceId?: WorkspaceId | "ungrouped" | null,
	) => PartitionedKanbanSessions;
}

/**
 * Purpose: Derive complete reactive Kanban board state from session and workspace snapshots.
 * Contract:
 * - Inputs: Session list snapshot, workspaces list, optional session status snapshot, optional timestamp now, and optional split pane session ids.
 * - Outputs: KanbanBoard interface containing active session, sorted workspaces, counts, sidebar groupings, lane classifier, and partitioner.
 * - Throws / Errors: Never throws.
 */
export function deriveKanbanBoard(
	sessionList: Pick<SessionListState, "ids" | "byId">,
	workspaces: readonly WorkspaceView[],
	sessionStatus?: SessionStatusSnapshot,
	now: number = Date.now(),
	splitSessionIds?: readonly SessionId[],
): KanbanBoard {
	const sortedWorkspaces = sortWorkspacesByRecency(
		workspaces,
		sessionList.byId,
	);

	const activeSessionId = sessionList.ids.find((id) => {
		const s = sessionList.byId[id];
		return s !== undefined && (s.retainedBy.mainView ?? 0) > 0;
	});

	const activeSubagentParentIds = extractActiveSubagentParentIds(
		sessionList.byId,
	);

	const isPendingInteraction = (id: SessionId): boolean => {
		const status = sessionStatus?.get(id);
		return status !== undefined && status.pendingInteraction !== undefined;
	};

	const visibleSummaries: SessionSummary[] = [];
	const laneBySessionId = new Map<SessionId, KanbanLane>();
	const alertBySessionId = new Map<SessionId, KanbanSessionAlert | undefined>();
	const runningBySessionId = new Map<SessionId, boolean>();

	for (const id of sessionList.ids) {
		const summary = sessionList.byId[id];
		if (!summary) continue;
		const record = summary.projectionValues?.kanban as KanbanRecord | undefined;
		if (isSessionVisibleInKanban(record, summary, now)) {
			visibleSummaries.push(summary);
			const lane = classifyKanbanSession(
				summary,
				record as KanbanRecord,
				isPendingInteraction(id),
				activeSubagentParentIds.has(id),
			);
			laneBySessionId.set(id, lane);
			const status = sessionStatus?.get(id);
			alertBySessionId.set(id, getKanbanSessionAlert(status, summary));
			runningBySessionId.set(
				id,
				Boolean(
					summary.running ||
						status?.running === true ||
						activeSubagentParentIds.has(id),
				),
			);
		}
	}

	const priorityComparator = (a: SessionSummary, b: SessionSummary): number =>
		compareKanbanSessionPriority(a, b, alertBySessionId, runningBySessionId);

	visibleSummaries.sort(priorityComparator);

	const workspaceCounts = new Map<
		WorkspaceId,
		{ running: number; inReview: number; alerts: number }
	>();
	for (const ws of workspaces) {
		workspaceCounts.set(ws.workspaceId, { running: 0, inReview: 0, alerts: 0 });
	}

	let totalRunning = 0;
	let totalInReview = 0;
	let totalRecentInReview = 0;
	let totalAlerts = 0;

	for (const session of visibleSummaries) {
		const lane = laneBySessionId.get(session.id);
		const alert = alertBySessionId.get(session.id);

		if ((lane === "active" || lane === "review") && alert !== undefined) {
			totalAlerts += 1;
		}
		if (lane === "active") {
			totalRunning += 1;
		} else if (lane === "review" && alert === undefined) {
			totalInReview += 1;
			if (now - getSessionRecency(session) <= RECENT_REVIEW_WINDOW_MS) {
				totalRecentInReview += 1;
			}
		}

		if (lane === "active" || lane === "review") {
			for (const ws of workspaces) {
				if (isSessionInWorkspace(session, ws)) {
					const counts = workspaceCounts.get(ws.workspaceId);
					if (counts !== undefined) {
						if (alert !== undefined) {
							counts.alerts += 1;
						}
						if (lane === "active") {
							counts.running += 1;
						} else if (alert === undefined) {
							counts.inReview += 1;
						}
					}
				}
			}
		}
	}

	const inFlightSessions = visibleSummaries.filter((session) => {
		const lane = laneBySessionId.get(session.id);
		return lane === "active" || lane === "review";
	});

	// edge case: a pane can outlive its Kanban lane (done TTL, hold), so split membership keeps it listed.
	const inFlightIds = new Set(inFlightSessions.map((session) => session.id));
	const splitOnlySessions: SessionSummary[] = [];
	for (const id of splitSessionIds ?? []) {
		if (inFlightIds.has(id)) continue;
		const summary = sessionList.byId[id];
		if (!summary) continue;
		const record = summary.projectionValues?.kanban as KanbanRecord | undefined;
		if (record === undefined) continue;
		splitOnlySessions.push(summary);
	}
	const sidebarSessions = [...inFlightSessions, ...splitOnlySessions];

	const workspaceGroups = groupSessionsByWorkspace(
		sortedWorkspaces,
		sidebarSessions,
		priorityComparator,
	).filter((group) => group.sessions.length > 0);

	const getLane = (sessionId: SessionId): KanbanLane => {
		const cached = laneBySessionId.get(sessionId);
		if (cached !== undefined) return cached;
		const summary = sessionList.byId[sessionId];
		if (!summary) return "todo";
		const record = summary.projectionValues?.kanban as KanbanRecord | undefined;
		if (!record) {
			if (isPendingInteraction(sessionId)) return "review";
			const status =
				sessionStatus === undefined ? undefined : sessionStatus.get(sessionId);
			return summary.running ||
				(status !== undefined && status.running === true) ||
				activeSubagentParentIds.has(sessionId)
				? "active"
				: "todo";
		}
		return classifyKanbanSession(
			summary,
			record,
			isPendingInteraction(sessionId),
			activeSubagentParentIds.has(sessionId),
		);
	};

	const partition = (
		workspaceId?: WorkspaceId | "ungrouped" | null,
	): PartitionedKanbanSessions => {
		const result: Record<KanbanLane, SessionSummary[]> = {
			todo: [],
			active: [],
			review: [],
			done: [],
		};

		let filtered: readonly SessionSummary[];
		if (workspaceId === "ungrouped") {
			filtered = visibleSummaries.filter(
				(s) => !sortedWorkspaces.some((ws) => isSessionInWorkspace(s, ws)),
			);
		} else if (workspaceId) {
			const targetWs = sortedWorkspaces.find(
				(w) => w.workspaceId === workspaceId,
			);
			filtered = targetWs
				? visibleSummaries.filter((s) => isSessionInWorkspace(s, targetWs))
				: [];
		} else {
			filtered = visibleSummaries;
		}

		for (const session of filtered) {
			const lane = laneBySessionId.get(session.id) ?? "todo";
			result[lane].push(session);
		}

		result.done.sort((a, b) => {
			// type-safe: projectionValues is typed Record<string, unknown> by SessionSummary
			const aRecord = a.projectionValues?.kanban as KanbanRecord | undefined;
			// type-safe: projectionValues is typed Record<string, unknown> by SessionSummary
			const bRecord = b.projectionValues?.kanban as KanbanRecord | undefined;
			const aPinned = aRecord?.pinnedAt !== undefined;
			const bPinned = bRecord?.pinnedAt !== undefined;
			if (aPinned !== bPinned) return aPinned ? -1 : 1;
			if (aRecord?.pinnedAt !== undefined && bRecord?.pinnedAt !== undefined) {
				const pinDiff = bRecord.pinnedAt - aRecord.pinnedAt;
				if (pinDiff !== 0) return pinDiff;
			}
			return getSessionRecency(b) - getSessionRecency(a);
		});

		return result;
	};

	return {
		activeSessionId,
		sortedWorkspaces,
		workspaceCounts,
		totalCounts: {
			running: totalRunning,
			inReview: totalInReview,
			recentInReview: totalRecentInReview,
			alerts: totalAlerts,
		},
		sidebarSessions,
		workspaceGroups,
		getLane,
		getAlert: (sessionId: SessionId) =>
			getKanbanSessionAlert(
				sessionStatus === undefined ? undefined : sessionStatus.get(sessionId),
				sessionList.byId[sessionId],
			),
		partition,
	};
}

/**
 * Purpose: Format a millisecond timestamp as a human-readable relative duration string.
 * Contract:
 * - Inputs: Number timestamp in ms and optional reference timestamp now (defaulting to Date.now()).
 * - Outputs: Short relative time string (e.g. \"just now\", \"5m ago\", \"2h ago\", \"3d ago\").
 * - Throws / Errors: Never throws.
 */
export function formatRelativeTime(
	timestamp: number,
	now: number = Date.now(),
): string {
	const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (diffSec < 60) return "just now";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHours = Math.floor(diffMin / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays}d ago`;
}

export const KANBAN_SELECTED_WORKSPACE_KEY = "dsh-kanban-selected-workspace";

/**
 * Purpose: Retrieve the user's selected workspace ID for Kanban filtering from local storage.
 * Contract:
 * - Inputs: None.
 * - Outputs: Workspace ID string if stored, otherwise null.
 * - Throws / Errors: Never throws.
 */
export function getStoredKanbanWorkspace(): string | null {
	if (typeof localStorage === "undefined") return null;
	try {
		return localStorage.getItem(KANBAN_SELECTED_WORKSPACE_KEY);
	} catch {
		return null;
	}
}

/**
 * Purpose: Persist the user's selected workspace ID for Kanban filtering and notify active views.
 * Contract:
 * - Inputs: Workspace ID string.
 * - Outputs: void.
 * - Throws / Errors: Never throws.
 */
export function setStoredKanbanWorkspace(workspaceId: string): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(KANBAN_SELECTED_WORKSPACE_KEY, workspaceId);
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("dsh-kanban-workspace-change"));
		}
	} catch {
		// ignore
	}
}

/**
 * Purpose: Intersect partitioned Kanban lanes with host content-search hits.
 * Contract:
 * - Inputs: PartitionedKanbanSessions snapshot and matching session IDs.
 * - Outputs: Matching visible sessions in their existing lane order.
 * - Throws / Errors: Never throws.
 */
export function filterPartitionedSessions(
	partitioned: PartitionedKanbanSessions,
	matchingIds: ReadonlySet<SessionId>,
): PartitionedKanbanSessions {
	const matches = (session: SessionSummary): boolean =>
		matchingIds.has(session.id);

	return {
		todo: partitioned.todo.filter(matches),
		active: partitioned.active.filter(matches),
		review: partitioned.review.filter(matches),
		done: partitioned.done.filter(matches),
	};
}
