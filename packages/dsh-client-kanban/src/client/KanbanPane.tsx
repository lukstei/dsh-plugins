import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type {
	WorkspaceId,
	WorkspaceSnapshot,
} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type { SessionStatusSnapshot } from "@deepseek-ai/dsh-client-ui-session/client";
import type { InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { TypertRemoteNamespaceMap } from "@deepseek-ai/dsh-typert-protocol";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchRequestSchema } from "../search.ts";
import type { KanbanLane, KanbanRecord } from "../types.ts";
import { KanbanIcon } from "./KanbanIcon.tsx";
import { KanbanSearchResults } from "./KanbanSearchResults.tsx";
import { KanbanSection } from "./KanbanSection.tsx";
import {
	getStoredKanbanWorkspace,
	isKanbanTransitionAllowed,
	isSessionEligibleForHydration,
	isSessionInWorkspace,
	setStoredKanbanWorkspace,
} from "./store.ts";
import { useKanban, useStore } from "./use-kanban.ts";

export interface KanbanPaneInjected {
	readonly sessionsList: ObservableSnapshot<SessionListState>;
	readonly workspacesList: ObservableSnapshot<WorkspaceSnapshot>;
	readonly sessionStatus: ObservableSnapshot<SessionStatusSnapshot>;
	readonly searchSessions: TypertRemoteNamespaceMap["kanban"]["search"];
	readonly searchResultLimit: number;
	readonly currentSessionId?: SessionId;
	readonly selectPanel: (id: string | null) => void;
	readonly refreshProjections?: (id: SessionId) => Promise<void>;
	readonly startTask: (workspaceId?: WorkspaceId) => Promise<void>;
	readonly prepareTask: (
		prompt: string,
		workspaceId?: WorkspaceId,
	) => Promise<void>;
	readonly startPreparedTask: (id: SessionId, prompt: string) => Promise<void>;
	readonly selectSession: (id: SessionId) => void;
	readonly markDone: (id: SessionId) => Promise<void>;
	readonly reopen: (id: SessionId) => Promise<void>;
	readonly deleteSession: (id: SessionId) => Promise<void>;
	readonly holdSession: (id: SessionId) => Promise<void>;
	readonly unholdSession: (id: SessionId) => Promise<void>;
	readonly pinSession: (id: SessionId) => Promise<void>;
	readonly unpinSession: (id: SessionId) => Promise<void>;
}

export type KanbanPaneProps = InjectFace<KanbanPaneInjected> & {
	readonly renderPreview: (id: SessionId) => ReactNode;
};

/**
 * Purpose: Render the full interactive Kanban board container with workspace filtering and 4-column lane layout.
 * Contract:
 * - Inputs: KanbanPaneProps injected with observable session/workspace stores and operational dispatchers.
 * - Outputs: Rendered JSX element for the Kanban board view.
 * - Throws / Errors: Never throws.
 */
export function KanbanPane({
	sessionsList,
	workspacesList,
	sessionStatus,
	searchSessions,
	searchResultLimit,
	renderPreview,
	currentSessionId,
	refreshProjections,
	startTask,
	prepareTask,
	startPreparedTask,
	selectSession,
	markDone,
	reopen,
	deleteSession,
	holdSession,
	unholdSession,
	pinSession,
	unpinSession,
}: KanbanPaneProps) {
	const [userWorkspaceId, setUserWorkspaceId] = useState<string | null>(() =>
		getStoredKanbanWorkspace(),
	);
	const [isStarting, setIsStarting] = useState(false);
	const [isPreparingTask, setIsPreparingTask] = useState(false);
	const [isRecycleOver, setIsRecycleOver] = useState(false);
	const [activeDragSourceLane, setActiveDragSourceLane] = useState<
		KanbanLane | undefined
	>();
	const [searchQuery, setSearchQuery] = useState("");
	const query = searchQuery.trim();
	const [searchState, setSearchState] = useState<
		| { status: "pending" }
		| {
				status: "settled";
				query: string;
				scope: string;
				workspaceId: WorkspaceId | "ungrouped" | undefined;
				result: Awaited<ReturnType<KanbanPaneInjected["searchSessions"]>>;
		  }
	>({ status: "pending" });

	useEffect(() => {
		if (typeof window === "undefined") return;
		const handleStorage = () => {
			setUserWorkspaceId(getStoredKanbanWorkspace());
		};
		window.addEventListener("dsh-kanban-workspace-change", handleStorage);
		window.addEventListener("storage", handleStorage);
		return () => {
			window.removeEventListener("dsh-kanban-workspace-change", handleStorage);
			window.removeEventListener("storage", handleStorage);
		};
	}, []);

	const handleDragStart = useCallback(
		(_id: SessionId, sourceLane: KanbanLane) => {
			setActiveDragSourceLane(sourceLane);
		},
		[],
	);

	const handleDragEnd = useCallback(() => {
		setActiveDragSourceLane(undefined);
	}, []);

	const board = useKanban(sessionsList, workspacesList, sessionStatus);
	const listSnapshot = useStore(sessionsList);

	const handleSelectWorkspace = (id: string) => {
		setUserWorkspaceId(id);
		setStoredKanbanWorkspace(id);
	};

	// Default to user's saved selection if valid; otherwise default to current session's workspace or most recent workspace
	const isUngroupedSelected = userWorkspaceId === "ungrouped";

	const selectedWorkspace = useMemo(() => {
		if (isUngroupedSelected) return null;
		if (
			userWorkspaceId !== null &&
			board.sortedWorkspaces.some((w) => w.workspaceId === userWorkspaceId)
		) {
			return (
				board.sortedWorkspaces.find((w) => w.workspaceId === userWorkspaceId) ??
				null
			);
		}
		if (currentSessionId) {
			const match = board.sortedWorkspaces.find((w) =>
				w.sessionIds.includes(currentSessionId),
			);
			if (match) return match;
		}
		return board.sortedWorkspaces[0] ?? null;
	}, [
		isUngroupedSelected,
		userWorkspaceId,
		currentSessionId,
		board.sortedWorkspaces,
	]);

	const effectiveWorkspaceId = isUngroupedSelected
		? "ungrouped"
		: selectedWorkspace?.workspaceId;

	const handleStartTask = async () => {
		if (isStarting) return;
		setIsStarting(true);
		try {
			await startTask(effectiveWorkspaceId as WorkspaceId | undefined);
		} finally {
			setIsStarting(false);
		}
	};

	const handlePrepareTask = async (prompt: string) => {
		try {
			await prepareTask(
				prompt,
				effectiveWorkspaceId as WorkspaceId | undefined,
			);
		} finally {
			setIsPreparingTask(false);
		}
	};

	const requestedHydrationRef = useRef<Set<SessionId>>(new Set());

	useEffect(() => {
		if (!refreshProjections) return;

		const targetIds = new Set<SessionId>();
		const now = Date.now();
		if (selectedWorkspace) {
			for (const id of listSnapshot.ids) {
				if (!requestedHydrationRef.current.has(id)) {
					const summary = listSnapshot.byId[id];
					if (
						summary &&
						isSessionInWorkspace(summary, selectedWorkspace) &&
						isSessionEligibleForHydration(summary, now) &&
						summary.projectionValues?.kanban === undefined
					) {
						targetIds.add(id);
					}
				}
			}
		} else {
			for (const id of listSnapshot.ids) {
				const summary = listSnapshot.byId[id];
				if (
					summary === undefined ||
					requestedHydrationRef.current.has(id) ||
					!isSessionEligibleForHydration(summary, now)
				)
					continue;
				if (
					isUngroupedSelected &&
					board.sortedWorkspaces.some((workspace) =>
						isSessionInWorkspace(summary, workspace),
					)
				)
					continue;
				const values = summary.projectionValues;
				if (values === undefined || values.kanban === undefined) {
					targetIds.add(id);
				}
			}
		}

		for (const id of targetIds) {
			requestedHydrationRef.current.add(id);
			void refreshProjections(id).catch((err: unknown) => {
				console.warn(`[Kanban] Failed to hydrate projections for ${id}:`, err);
			});
		}
	}, [
		selectedWorkspace,
		isUngroupedSelected,
		board.sortedWorkspaces,
		listSnapshot,
		refreshProjections,
	]);

	const workspaceCounts = board.workspaceCounts;
	const sortedWorkspaces = board.sortedWorkspaces;

	// Partition sessions into lanes using their projectionValues.kanban records
	const partitioned = useMemo(() => {
		return board.partition(
			effectiveWorkspaceId as WorkspaceId | "ungrouped" | undefined,
		);
	}, [board, effectiveWorkspaceId]);

	const searchScope = JSON.stringify(
		partitioned.todo
			.concat(partitioned.active, partitioned.review, partitioned.done)
			.map((session) => session.id)
			.sort(),
	);

	useEffect(() => {
		setSearchState({ status: "pending" });
		if (query === "") return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			const sessionIds = searchRequestSchema.shape.sessionIds.parse(
				JSON.parse(searchScope),
			);
			void searchSessions({ query, sessionIds }, controller.signal).then(
				(result) => {
					if (!controller.signal.aborted) {
						setSearchState({
							status: "settled",
							query,
							scope: searchScope,
							workspaceId: effectiveWorkspaceId,
							result,
						});
					}
				},
			);
		}, 250);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query, searchSessions, searchScope, effectiveWorkspaceId]);

	const searchResult =
		searchState.status === "settled" &&
		searchState.query === query &&
		searchState.workspaceId === effectiveWorkspaceId &&
		searchState.scope === searchScope
			? searchState.result
			: undefined;

	const searchHits = useMemo(() => {
		if (searchResult === undefined || !searchResult.ok) return [];
		const byId = new Map(
			(["todo", "active", "review", "done"] as const).flatMap((lane) =>
				partitioned[lane].map((session) => [session.id, { session, lane }]),
			),
		);
		// edge case: results keep the host's relevance rank, not lane order
		return searchResult.value.items.flatMap((item) => {
			const entry = byId.get(item.sessionId);
			return entry === undefined ? [] : [{ ...entry, snippet: item.snippet }];
		});
	}, [searchResult, partitioned]);

	const [focusedId, setFocusedId] = useState<SessionId | undefined>();
	const focusedHit =
		searchHits.find((hit) => hit.session.id === focusedId) ?? searchHits[0];
	const focusedHitId = focusedHit?.session.id;
	// edge case: arrowing through results must not open every session, so the preview trails focus
	const [previewId, setPreviewId] = useState<SessionId | undefined>();
	useEffect(() => {
		const timer = setTimeout(() => setPreviewId(focusedHitId), 150);
		return () => clearTimeout(timer);
	}, [focusedHitId]);

	const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (query === "") return;
		if (event.key === "Escape") {
			setSearchQuery("");
			return;
		}
		if (event.key === "Enter" && focusedHitId !== undefined) {
			selectSession(focusedHitId);
			return;
		}
		const step =
			event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
		if (step === 0 || searchHits.length === 0) return;
		event.preventDefault();
		const index = searchHits.findIndex(
			(hit) => hit.session.id === focusedHitId,
		);
		const next = Math.min(Math.max(index + step, 0), searchHits.length - 1);
		setFocusedId(searchHits[next].session.id);
	};

	let searchMessage = "";
	if (query !== "") {
		if (searchResult === undefined) {
			searchMessage = "Searching session contents…";
		} else if (!searchResult.ok) {
			searchMessage = `Search failed: ${searchResult.error.message}`;
		} else if (searchResult.value.hasMore) {
			searchMessage = `Search limited to ${searchResultLimit} sessions in this workspace. Narrow your query.`;
		} else if (searchHits.length === 0) {
			searchMessage = "No matching sessions in this workspace.";
		}
	}

	const handleDropSession = async (
		sessionId: SessionId,
		targetLane: KanbanLane,
	) => {
		setActiveDragSourceLane(undefined);
		const summary = listSnapshot.byId[sessionId];
		const record = summary?.projectionValues?.kanban as
			| KanbanRecord
			| undefined;
		if (!summary || !record) return;

		const sourceLane = board.getLane(sessionId);
		if (!isKanbanTransitionAllowed(sourceLane, targetLane)) return;

		if (targetLane === "todo") {
			await holdSession(sessionId);
		} else if (targetLane === "review") {
			if (sourceLane === "done") {
				await reopen(sessionId);
			} else {
				await unholdSession(sessionId);
			}
		} else if (targetLane === "active") {
			if (summary.blank) {
				await startPreparedTask(sessionId, record.prompt ?? "");
			} else if (record.heldAt !== undefined) {
				await unholdSession(sessionId);
			}
		} else if (targetLane === "done") {
			await markDone(sessionId);
		}
	};

	const handleTogglePin = useCallback(
		async (sessionId: SessionId) => {
			const summary = listSnapshot.byId[sessionId];
			// type-safe: projectionValues is typed Record<string, unknown> by SessionSummary
			const record = summary?.projectionValues?.kanban as
				| KanbanRecord
				| undefined;
			if (!record) return;
			if (record.pinnedAt !== undefined) {
				await unpinSession(sessionId);
			} else {
				await pinSession(sessionId);
			}
		},
		[listSnapshot.byId, pinSession, unpinSession],
	);

	return (
		<div className="dsh-kanban-pane">
			<div className="dsh-kanban-topbar">
				<div className="dsh-kanban-topbar-left">
					<div className="dsh-kanban-title" title="Kanban">
						<KanbanIcon size={18} />
					</div>
					{sortedWorkspaces.length > 0 && (
						<div className="dsh-kanban-workspace-scroll">
							{sortedWorkspaces.map((ws) => {
								const label =
									ws.title ||
									ws.path.split("/").filter(Boolean).pop() ||
									ws.workspaceId;
								const counts = workspaceCounts.get(ws.workspaceId);
								const running = counts ? counts.running : 0;
								const inReview = counts ? counts.inReview : 0;
								const alerts = counts ? counts.alerts : 0;
								return (
									<button
										key={ws.workspaceId}
										type="button"
										onClick={() => handleSelectWorkspace(ws.workspaceId)}
										className={`dsh-kanban-ws-btn ${effectiveWorkspaceId === ws.workspaceId ? "active" : ""}`}
										title={ws.path}
									>
										<span>{label}</span>
										{(running > 0 || inReview > 0 || alerts > 0) && (
											<span className="dsh-kanban-ws-badges">
												{running > 0 && (
													<span
														className="dsh-kanban-ws-badge dsh-kanban-ws-badge-top"
														title={`${running} running`}
													>
														{running}
													</span>
												)}
												{alerts > 0 && (
													<span
														className="dsh-kanban-ws-badge dsh-kanban-ws-badge-alert"
														title={`${alerts} requiring attention`}
													>
														{alerts}
													</span>
												)}
												{inReview > 0 && (
													<span
														className="dsh-kanban-ws-badge dsh-kanban-ws-badge-bottom"
														title={`${inReview} in review`}
													>
														{inReview}
													</span>
												)}
											</span>
										)}
									</button>
								);
							})}
							{(isUngroupedSelected ||
								Object.values(listSnapshot.byId).some(
									(s) =>
										s &&
										!sortedWorkspaces.some((w) => isSessionInWorkspace(s, w)),
								)) && (
								<button
									type="button"
									onClick={() => handleSelectWorkspace("ungrouped")}
									className={`dsh-kanban-ws-btn ${effectiveWorkspaceId === "ungrouped" ? "active" : ""}`}
									title="Other Sessions"
								>
									<span>Other Sessions</span>
								</button>
							)}
						</div>
					)}
				</div>
			</div>

			<div className="dsh-kanban-controls">
				<button
					type="button"
					className="dsh-kanban-btn-start"
					onClick={handleStartTask}
					disabled={isStarting}
					title="Start task immediately with native prompt input"
				>
					{isStarting ? "Starting..." : "+ Start task"}
				</button>
				<button
					type="button"
					className="dsh-kanban-btn-prepare"
					onClick={() => setIsPreparingTask(true)}
					title="Prepare task with prompt"
				>
					Prepare task
				</button>
				<div className="dsh-kanban-search-box">
					<input
						type="search"
						className="dsh-kanban-search-input"
						placeholder="Search sessions..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={handleSearchKeyDown}
						aria-label="Search sessions"
					/>
				</div>
			</div>

			{searchMessage && (
				<div className="dsh-kanban-search-status" role="status">
					{searchMessage}
				</div>
			)}

			<div
				className="dsh-kanban-scroll"
				aria-busy={query !== "" && searchResult === undefined}
			>
				{query !== "" ? (
					<KanbanSearchResults
						hits={searchHits}
						query={query}
						focusedId={focusedHitId}
						preview={
							previewId !== undefined && previewId === focusedHitId
								? renderPreview(previewId)
								: null
						}
						onFocus={setFocusedId}
						onOpen={selectSession}
					/>
				) : (
					<div className="dsh-kanban-board">
						<KanbanSection
							lane="todo"
							title="To Do"
							sessions={partitioned.todo}
							selectedSessionId={currentSessionId}
							isPreparing={isPreparingTask}
							activeDragSourceLane={activeDragSourceLane}
							getAlert={board.getAlert}
							onSelect={selectSession}
							onDropSession={handleDropSession}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							onSubmitPrepare={handlePrepareTask}
							onCancelPrepare={() => setIsPreparingTask(false)}
						/>

						<KanbanSection
							lane="active"
							title="Active"
							sessions={partitioned.active}
							selectedSessionId={currentSessionId}
							activeDragSourceLane={activeDragSourceLane}
							getAlert={board.getAlert}
							onSelect={selectSession}
							onDropSession={handleDropSession}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
						/>

						<KanbanSection
							lane="review"
							title="Review"
							sessions={partitioned.review}
							selectedSessionId={currentSessionId}
							activeDragSourceLane={activeDragSourceLane}
							getAlert={board.getAlert}
							onSelect={selectSession}
							onDropSession={handleDropSession}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
						/>

						<KanbanSection
							lane="done"
							title="Done"
							sessions={partitioned.done}
							selectedSessionId={currentSessionId}
							activeDragSourceLane={activeDragSourceLane}
							getAlert={board.getAlert}
							onSelect={selectSession}
							onDropSession={handleDropSession}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							onTogglePin={handleTogglePin}
						/>
					</div>
				)}
			</div>

			{activeDragSourceLane !== undefined && (
				<div
					className={`dsh-kanban-recycle-bin ${isRecycleOver ? "is-drag-over" : ""}`}
					onDragOver={(e) => {
						e.preventDefault();
						e.dataTransfer.dropEffect = "move";
						if (!isRecycleOver) setIsRecycleOver(true);
					}}
					onDragLeave={() => setIsRecycleOver(false)}
					onDrop={async (e) => {
						e.preventDefault();
						setIsRecycleOver(false);
						setActiveDragSourceLane(undefined);
						const rawId = e.dataTransfer.getData("text/plain");
						const sessionId = rawId as SessionId;
						if (sessionId && listSnapshot.byId[sessionId]) {
							await deleteSession(sessionId);
						}
					}}
				>
					<span>🗑️</span>
					<span>Drop here to remove from board</span>
				</div>
			)}
		</div>
	);
}
