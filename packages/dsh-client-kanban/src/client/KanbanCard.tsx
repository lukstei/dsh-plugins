import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { KanbanLane } from "../types.ts";
import { KanbanStatusDot } from "./KanbanStatusDot.tsx";
import { SessionLinks } from "./SessionLinks.tsx";
import {
	formatKanbanAlertLabel,
	formatRelativeTime,
	getKanbanSessionTitle,
	getSessionRecency,
	isKanbanTransitionAllowed,
	type KanbanSessionAlert,
} from "./store.ts";

export interface KanbanCardProps {
	readonly session: SessionSummary;
	readonly lane: KanbanLane;
	readonly alert?: KanbanSessionAlert;
	readonly isSelected: boolean;
	readonly onSelect: (id: SessionId) => void;
	readonly onDragStart?: (id: SessionId, lane: KanbanLane) => void;
	readonly onDragEnd?: () => void;
	readonly onTransition?: (
		sessionId: SessionId,
		targetLane: KanbanLane,
	) => void;
	readonly onTogglePin?: (id: SessionId) => void;
}

/**
 * Purpose: Render a draggable Kanban card displaying session status, title/prompt, and runtime badge.
 * Contract:
 * - Inputs: KanbanCardProps containing session data, lane context, selection flag, prompt preview, and callbacks.
 * - Outputs: Rendered JSX element representing the card.
 * - Throws / Errors: Never throws.
 */
export function KanbanCard({
	session,
	lane,
	alert,
	isSelected,
	onSelect,
	onDragStart,
	onDragEnd,
	onTransition,
	onTogglePin,
}: KanbanCardProps) {
	const values = session.projectionValues;
	const record = values === undefined ? undefined : values.kanban;
	const isPinned =
		lane === "done" &&
		record !== undefined &&
		record !== null &&
		record.pinnedAt !== undefined;

	const alertLabel =
		alert !== undefined ? formatKanbanAlertLabel(alert) : undefined;

	const handleDragStart = (e: React.DragEvent) => {
		e.dataTransfer.setData("text/plain", session.id);
		e.dataTransfer.effectAllowed = "move";
		if (onDragStart) {
			onDragStart(session.id, lane);
		}
	};

	const handleDragEnd = () => {
		if (onDragEnd) {
			setTimeout(() => {
				onDragEnd();
			}, 0);
		}
	};

	return (
		<div
			className={`dsh-kanban-card ${isSelected ? "is-active-session" : ""} ${isPinned ? "is-pinned" : ""} ${alert ? "is-alert" : ""}`}
			draggable
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onClick={() => onSelect(session.id)}
		>
			<div className="dsh-kanban-card-header">
				<div className="dsh-kanban-card-title">
					{getKanbanSessionTitle(session)}
				</div>
				{lane === "done" && onTogglePin !== undefined && (
					<button
						type="button"
						className={`dsh-kanban-card-pin-btn ${isPinned ? "is-pinned" : ""}`}
						onClick={(e) => {
							e.stopPropagation();
							onTogglePin(session.id);
						}}
						aria-pressed={isPinned}
						title={isPinned ? "Unpin session" : "Pin session to top"}
						aria-label={isPinned ? "Unpin session" : "Pin session to top"}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 16 16"
							fill={isPinned ? "currentColor" : "none"}
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.909-1.414.714-.195-.195.519-1.218.714-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z" />
						</svg>
					</button>
				)}
			</div>

			<div className="dsh-kanban-card-footer">
				<div>
					{alert ? (
						<span className="dsh-kanban-badge-alert-pill">
							<KanbanStatusDot state="alert" />
							{alertLabel}
						</span>
					) : session.running || lane === "active" ? (
						<span className="dsh-kanban-badge-running">
							<KanbanStatusDot state="active" />
							Running...
						</span>
					) : (
						<>
							<span>{formatRelativeTime(getSessionRecency(session))}</span>
							{lane === "todo" && !session.blank && (
								<span className="dsh-kanban-badge-hold">On hold</span>
							)}
						</>
					)}
				</div>
				{record !== undefined && record !== null && (
					<SessionLinks links={record.links} />
				)}
			</div>
			{onTransition !== undefined && lane !== "active" && (
				<div className="dsh-kanban-card-mobile-actions">
					{isKanbanTransitionAllowed(lane, "active") && (
						<button
							type="button"
							className="dsh-kanban-btn-mobile-action is-primary"
							onClick={(e) => {
								e.stopPropagation();
								onTransition(session.id, "active");
							}}
						>
							{session.blank ? "Start" : "Resume"}
						</button>
					)}
					{isKanbanTransitionAllowed(lane, "review") && (
						<button
							type="button"
							className="dsh-kanban-btn-mobile-action"
							onClick={(e) => {
								e.stopPropagation();
								onTransition(session.id, "review");
							}}
						>
							Review
						</button>
					)}
					{isKanbanTransitionAllowed(lane, "done") && (
						<button
							type="button"
							className="dsh-kanban-btn-mobile-action is-primary"
							onClick={(e) => {
								e.stopPropagation();
								onTransition(session.id, "done");
							}}
						>
							Done
						</button>
					)}
					{isKanbanTransitionAllowed(lane, "todo") && (
						<button
							type="button"
							className="dsh-kanban-btn-mobile-action"
							onClick={(e) => {
								e.stopPropagation();
								onTransition(session.id, "todo");
							}}
						>
							Hold
						</button>
					)}
				</div>
			)}
		</div>
	);
}
