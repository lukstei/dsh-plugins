import type { WorkspaceId } from "@deepseek-ai/dsh-api-workspace-controller/client";
import {
	IconCloseOutlineRegular,
	IconFullscreenOutlineRegular,
	IconRefreshOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { SidebarSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type { InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { KanbanLane } from "../types.ts";
import { KanbanIcon } from "./KanbanIcon.tsx";
import type { KanbanPaneInjected } from "./KanbanPane.tsx";
import { KanbanStatusDot } from "./KanbanStatusDot.tsx";
import { SessionLinks } from "./SessionLinks.tsx";
import { sidebarModeStore } from "./sidebar-mode.ts";
import {
	formatKanbanAlertLabel,
	formatRelativeTime,
	getKanbanSessionTitle,
	getSessionRecency,
	setStoredKanbanWorkspace,
} from "./store.ts";
import { useKanban } from "./use-kanban.ts";

function IconCheck({ size = 14 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" />
		</svg>
	);
}

function IconPause({ size = 14 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
			aria-hidden="true"
		>
			<path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" />
			<path d="M6.5 5.5V10.5" strokeLinecap="round" />
			<path d="M9.5 5.5V10.5" strokeLinecap="round" />
		</svg>
	);
}

export interface InFlightSidebarInjected extends KanbanPaneInjected {
	readonly navigation: {
		readonly subscribe: (listener: () => void) => () => void;
		readonly getSnapshot: () => {
			readonly sessionIds: readonly SessionId[];
			readonly focusedSessionId: SessionId | undefined;
			readonly maximizedSessionId: SessionId | undefined;
			readonly suspended: boolean;
		};
		readonly toggleSession: (id: SessionId) => void;
		readonly removeSession: (id: SessionId) => void;
		readonly toggleMaximize: (id: SessionId) => void;
		readonly setHoveredSession: (id: SessionId | undefined) => void;
	};
}

export type InFlightSidebarProps = SidebarSectionOwnerProps &
	InjectFace<InFlightSidebarInjected>;

function laneLabel(lane: KanbanLane): string {
	switch (lane) {
		case "active":
			return "In Progress";
		case "review":
			return "In Review";
		case "todo":
			return "On Hold";
		case "done":
			return "Done";
	}
}

/**
 * Purpose: Render a dedicated in-flight Kanban preview in the left sidebar grouped by workspace.
 * Contract:
 * - Inputs: InFlightSidebarProps containing sidebar geometry (wide, expandSidebar) and injected Kanban data/actions.
 * - Outputs: Rendered JSX element for the sidebar browsing region.
 * - Throws / Errors: Never throws.
 */
export function InFlightSidebar({
	wide,
	expandSidebar: _expandSidebar,
	sessionsList,
	workspacesList,
	sessionStatus,
	currentSessionId: _currentSessionId,
	selectPanel,
	selectSession,
	navigation,
	startTask,
	markDone,
	reopen,
	holdSession,
}: InFlightSidebarProps) {
	const [now, setNow] = useState<number>(() => Date.now());
	const splitState = useSyncExternalStore(
		navigation.subscribe,
		navigation.getSnapshot,
	);

	useEffect(() => {
		const timer = setInterval(() => {
			setNow(Date.now());
		}, 10_000);
		return () => {
			clearInterval(timer);
		};
	}, []);

	const board = useKanban(
		sessionsList,
		workspacesList,
		sessionStatus,
		now,
		splitState.sessionIds,
	);
	const { sidebarSessions, workspaceGroups, activeSessionId } = board;
	const activeCount = board.totalCounts.running;
	const reviewCount = board.totalCounts.inReview;
	const alertCount = board.totalCounts.alerts;
	const totalInFlight = sidebarSessions.length;

	const switchToWorkspaces = () => {
		sidebarModeStore.setMode("workspaces");
		selectPanel(null);
	};

	const handleOpenWorkspaceKanban = (workspaceId: string) => {
		setStoredKanbanWorkspace(workspaceId);
		selectPanel("kanban");
	};

	const handleSelectSession = (sessionId: SessionId, e: React.MouseEvent) => {
		if (e.detail > 1) return;
		if (e.metaKey || e.ctrlKey) {
			e.preventDefault();
			navigation.toggleSession(sessionId);
			return;
		}
		selectSession(sessionId);
	};

	const handleDoubleClick = (sessionId: SessionId, e: React.MouseEvent) => {
		e.stopPropagation();
		if (e.metaKey || e.ctrlKey) return;
		navigation.toggleMaximize(sessionId);
	};

	if (!wide) {
		return (
			<nav
				className="dsh-inflight-sidebar-rail"
				aria-label="In-flight sidebar rail"
			>
				<button
					type="button"
					className="dsh-inflight-rail-switcher-btn is-active"
					onClick={() => {
						selectPanel("kanban");
					}}
					title={`Open Kanban (${totalInFlight})`}
					aria-label={`Open Kanban (${totalInFlight})`}
				>
					<KanbanIcon size={18} />
					{(activeCount > 0 || reviewCount > 0 || alertCount > 0) && (
						<span className="dsh-inflight-rail-badges">
							{alertCount > 0 && (
								<span
									className="dsh-kanban-ws-badge dsh-kanban-ws-badge-alert"
									title={`${alertCount} requiring attention`}
								>
									{alertCount}
								</span>
							)}
							{activeCount > 0 && (
								<span
									className="dsh-kanban-ws-badge dsh-kanban-ws-badge-top"
									title={`${activeCount} in progress`}
								>
									{activeCount}
								</span>
							)}
							{reviewCount > 0 && (
								<span
									className="dsh-kanban-ws-badge dsh-kanban-ws-badge-bottom"
									title={`${reviewCount} in review`}
								>
									{reviewCount}
								</span>
							)}
						</span>
					)}
				</button>
				<div className="dsh-inflight-rail-divider" />
				{sidebarSessions.map((session) => {
					const lane = board.getLane(session.id);
					const alert = board.getAlert(session.id);
					const isSplitActive =
						splitState.sessionIds.length > 0 && !splitState.suspended;
					const isInSplit =
						isSplitActive && splitState.sessionIds.includes(session.id);
					const isFocused =
						splitState.sessionIds.length > 1 &&
						!splitState.suspended &&
						session.id === splitState.focusedSessionId;
					const isCurrent = isSplitActive
						? isInSplit
						: session.id === activeSessionId;
					const alertLabel =
						alert !== undefined ? formatKanbanAlertLabel(alert) : undefined;
					const statusLabel = alertLabel ?? laneLabel(lane);
					const sessionTitle = getKanbanSessionTitle(session);

					return (
						<button
							key={session.id}
							type="button"
							aria-current={isFocused ? "true" : undefined}
							className={`dsh-inflight-rail-session-dot ${
								isCurrent ? "is-current" : ""
							} ${isFocused ? "is-focused" : ""}`}
							onClick={(e) => {
								handleSelectSession(session.id, e);
							}}
							title={`${sessionTitle} (${statusLabel})`}
							aria-label={`${sessionTitle} (${statusLabel})`}
						>
							{isSplitActive && splitState.maximizedSessionId === session.id ? (
								<IconFullscreenOutlineRegular size={14} />
							) : (
								<KanbanStatusDot state={alert ? "alert" : lane} />
							)}
						</button>
					);
				})}
			</nav>
		);
	}

	return (
		<div className="dsh-inflight-sidebar">
			<div className="dsh-inflight-sidebar-header">
				<button
					type="button"
					className="dsh-inflight-header-clickable"
					onClick={() => selectPanel("kanban")}
					title="Open Kanban"
				>
					<span className="dsh-inflight-header-icon">
						<KanbanIcon size={16} />
					</span>
					<span className="dsh-inflight-sidebar-title">Kanban</span>
					{(activeCount > 0 || reviewCount > 0 || alertCount > 0) && (
						<span className="dsh-inflight-badges">
							{alertCount > 0 && (
								<span
									className="dsh-kanban-badge is-alert"
									title={`${alertCount} requiring attention`}
								>
									{alertCount}
								</span>
							)}
							{activeCount > 0 && (
								<span
									className="dsh-kanban-badge is-active"
									title={`${activeCount} in progress`}
								>
									{activeCount}
								</span>
							)}
							{reviewCount > 0 && (
								<span
									className="dsh-kanban-badge is-review"
									title={`${reviewCount} in review`}
								>
									{reviewCount}
								</span>
							)}
						</span>
					)}
				</button>
				<button
					type="button"
					className="dsh-inflight-btn-close"
					onClick={switchToWorkspaces}
					title="Close Kanban"
					aria-label="Close Kanban"
				>
					✕
				</button>
			</div>

			<div className="dsh-inflight-sidebar-list">
				{workspaceGroups.map((group) => {
					const counts =
						group.workspaceId === "ungrouped"
							? undefined
							: board.workspaceCounts.get(group.workspaceId as WorkspaceId);
					let wsActiveCount = counts ? counts.running : 0;
					let wsReviewCount = counts ? counts.inReview : 0;
					let wsAlertCount = counts ? counts.alerts : 0;
					if (group.workspaceId === "ungrouped") {
						for (const s of group.sessions) {
							const lane = board.getLane(s.id);
							const alert = board.getAlert(s.id);
							if (alert !== undefined) wsAlertCount += 1;
							if (lane === "active") wsActiveCount += 1;
							else if (lane === "review" && alert === undefined)
								wsReviewCount += 1;
						}
					}

					return (
						<div key={group.workspaceId} className="dsh-inflight-ws-group">
							<div className="dsh-inflight-ws-header-row">
								<button
									type="button"
									className="dsh-inflight-ws-header"
									onClick={() => handleOpenWorkspaceKanban(group.workspaceId)}
									title={`Open ${group.title} in Kanban`}
								>
									<span className="dsh-inflight-ws-icon">
										<svg
											width="14"
											height="14"
											viewBox="0 0 16 16"
											fill="currentColor"
											aria-hidden="true"
										>
											<path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v7A1.5 1.5 0 0 0 1.5 13h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H8.414l-1.707-1.707A1 1 0 0 0 6 2.5H1.5z" />
										</svg>
									</span>
									<span className="dsh-inflight-ws-title">{group.title}</span>
									{(wsActiveCount > 0 ||
										wsReviewCount > 0 ||
										wsAlertCount > 0) && (
										<span className="dsh-inflight-badges">
											{wsAlertCount > 0 && (
												<span
													className="dsh-kanban-badge is-alert"
													title={`${wsAlertCount} requiring attention`}
												>
													{wsAlertCount}
												</span>
											)}
											{wsActiveCount > 0 && (
												<span
													className="dsh-kanban-badge is-active"
													title={`${wsActiveCount} in progress`}
												>
													{wsActiveCount}
												</span>
											)}
											{wsReviewCount > 0 && (
												<span
													className="dsh-kanban-badge is-review"
													title={`${wsReviewCount} in review`}
												>
													{wsReviewCount}
												</span>
											)}
										</span>
									)}
								</button>
								<button
									type="button"
									className="dsh-inflight-btn-add-task"
									onClick={(e) => {
										e.stopPropagation();
										void startTask(
											group.workspaceId === "ungrouped"
												? undefined
												: (group.workspaceId as WorkspaceId),
										);
									}}
									title={`Add task in ${group.title}`}
									aria-label={`Add task in ${group.title}`}
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.75"
										strokeLinecap="round"
										aria-hidden="true"
									>
										<path d="M8 3v10M3 8h10" />
									</svg>
								</button>
							</div>
							{group.sessions.length > 0 && (
								<div className="dsh-inflight-ws-cards">
									{group.sessions.map((session) => {
										const lane = board.getLane(session.id);
										const alert = board.getAlert(session.id);
										const isInProgress = lane === "active" || session.running;
										const isSplitActive =
											splitState.sessionIds.length > 0 && !splitState.suspended;
										const isInSplit =
											isSplitActive &&
											splitState.sessionIds.includes(session.id);
										const isFocused =
											splitState.sessionIds.length > 1 &&
											!splitState.suspended &&
											session.id === splitState.focusedSessionId;
										const isCurrent = isSplitActive
											? isInSplit
											: session.id === activeSessionId;
										const alertLabel =
											alert !== undefined
												? formatKanbanAlertLabel(alert)
												: undefined;
										const statusTitle = alertLabel ?? laneLabel(lane);
										const values = session.projectionValues;
										const record =
											values === undefined ? undefined : values.kanban;

										const isMaximized =
											isSplitActive &&
											splitState.maximizedSessionId === session.id;

										const canClosePane = isInSplit && !isMaximized;
										const sessionTitle = getKanbanSessionTitle(
											session,
											group.title,
										);

										return (
											<div
												key={session.id}
												className={`dsh-inflight-card ${isCurrent ? "is-current" : ""} ${isFocused ? "is-focused" : ""} ${alert ? "is-alert" : ""} ${canClosePane ? "has-slot-close" : ""}`}
												onPointerEnter={() => {
													if (isInSplit)
														navigation.setHoveredSession(session.id);
												}}
												onPointerLeave={() => {
													navigation.setHoveredSession(undefined);
												}}
											>
												{isMaximized ? (
													<button
														type="button"
														aria-pressed="true"
														className="dsh-inflight-card-slot dsh-inflight-btn-fullscreen-toggle is-active is-pressed"
														onClick={(e) => {
															e.stopPropagation();
															navigation.toggleMaximize(session.id);
														}}
														title="Restore split layout"
														aria-label={`Restore split layout for ${sessionTitle}`}
													>
														<IconFullscreenOutlineRegular size={14} />
													</button>
												) : (
													<span className="dsh-inflight-card-slot">
														<span
															className="dsh-inflight-card-slot-status"
															aria-hidden="true"
															title={statusTitle}
														>
															<KanbanStatusDot state={alert ? "alert" : lane} />
														</span>
														{canClosePane && (
															<button
																type="button"
																className="dsh-inflight-btn-slot-close"
																onClick={(e) => {
																	e.stopPropagation();
																	navigation.removeSession(session.id);
																}}
																title={`Close ${sessionTitle} in split view`}
																aria-label={`Close ${sessionTitle} in split view`}
															>
																<IconCloseOutlineRegular size={14} />
															</button>
														)}
													</span>
												)}
												<div className="dsh-inflight-card-content">
													{record !== undefined && record !== null && (
														<SessionLinks
															links={record.links}
															onOpenSession={selectSession}
														/>
													)}
													<button
														type="button"
														className="dsh-inflight-card-main"
														aria-current={isFocused ? "true" : undefined}
														onClick={(e) => handleSelectSession(session.id, e)}
														onDoubleClick={(e) =>
															handleDoubleClick(session.id, e)
														}
														aria-label={`${sessionTitle} (${statusTitle})`}
													>
														<span className="dsh-inflight-card-title">
															{sessionTitle}
														</span>
													</button>
												</div>
												<span className="dsh-inflight-card-time">
													{formatRelativeTime(getSessionRecency(session), now)
														.replace("just now", "now")
														.replace(" ago", "")}
												</span>
												<div className="dsh-inflight-card-actions">
													{lane === "done" ? (
														<button
															type="button"
															className="dsh-inflight-btn-action"
															onClick={(e) => {
																e.stopPropagation();
																void reopen(session.id);
															}}
															title="Reopen task"
															aria-label="Reopen task"
														>
															<IconRefreshOutlineRegular size={14} />
														</button>
													) : (
														<>
															<button
																type="button"
																className={`dsh-inflight-btn-action is-hold ${
																	isInProgress ? "is-disabled" : ""
																}`}
																disabled={isInProgress}
																onClick={(e) => {
																	e.stopPropagation();
																	if (!isInProgress) {
																		void holdSession(session.id);
																	}
																}}
																title={
																	isInProgress
																		? "Session is in progress"
																		: "Put on hold"
																}
																aria-label={
																	isInProgress
																		? "Session is in progress"
																		: "Put on hold"
																}
															>
																<IconPause size={14} />
															</button>
															<button
																type="button"
																className={`dsh-inflight-btn-action is-done ${
																	isInProgress ? "is-disabled" : ""
																}`}
																disabled={isInProgress}
																onClick={(e) => {
																	e.stopPropagation();
																	if (!isInProgress) {
																		void markDone(session.id);
																	}
																}}
																title={
																	isInProgress
																		? "Session is in progress"
																		: "Mark task done"
																}
																aria-label={
																	isInProgress
																		? "Session is in progress"
																		: "Mark task done"
																}
															>
																<IconCheck size={14} />
															</button>
														</>
													)}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
