import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { useState } from "react";
import type { KanbanLane } from "../types.ts";
import { KanbanCard } from "./KanbanCard.tsx";
import { isKanbanTransitionAllowed, type KanbanSessionAlert } from "./store.ts";

export interface KanbanSectionProps {
	readonly lane: KanbanLane;
	readonly title: string;
	readonly sessions: readonly SessionSummary[];
	readonly selectedSessionId?: SessionId;
	readonly isPreparing?: boolean;
	readonly activeDragSourceLane?: KanbanLane;
	readonly getAlert?: (id: SessionId) => KanbanSessionAlert | undefined;
	readonly onSelect: (id: SessionId) => void;
	readonly onDropSession: (
		sessionId: SessionId,
		targetLane: KanbanLane,
	) => void;
	readonly onDragStart?: (id: SessionId, lane: KanbanLane) => void;
	readonly onDragEnd?: () => void;
	readonly onSubmitPrepare?: (prompt: string) => void;
	readonly onCancelPrepare?: () => void;
	readonly onTogglePin?: (id: SessionId) => void;
}

/**
 * Purpose: Render a droppable Kanban column lane with header count, inline task preparer, and session cards.
 * Contract:
 * - Inputs: KanbanSectionProps containing lane identifier, title, sessions list, records map, and event handlers.
 * - Outputs: Rendered JSX element for the column lane.
 * - Throws / Errors: Never throws.
 */
export function KanbanSection({
	lane,
	title,
	sessions,
	selectedSessionId,
	isPreparing = false,
	activeDragSourceLane,
	getAlert,
	onSelect,
	onDropSession,
	onDragStart,
	onDragEnd,
	onSubmitPrepare,
	onCancelPrepare,
	onTogglePin,
}: KanbanSectionProps) {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [isDragOver, setIsDragOver] = useState(false);
	const canAcceptDrop =
		activeDragSourceLane !== undefined &&
		isKanbanTransitionAllowed(activeDragSourceLane, lane);
	const [newPrompt, setNewPrompt] = useState("");

	const handleDragOver = (e: React.DragEvent) => {
		if (!canAcceptDrop) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		if (!isDragOver) setIsDragOver(true);
	};

	const handleDragLeave = () => {
		setIsDragOver(false);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);
		const rawId = e.dataTransfer.getData("text/plain");
		if (rawId) {
			onDropSession(rawId as SessionId, lane);
		}
	};

	const handleSave = () => {
		const trimmedPrompt = newPrompt.trim();
		if (trimmedPrompt && onSubmitPrepare) {
			onSubmitPrepare(trimmedPrompt);
			setNewPrompt("");
		}
	};

	const handleCancel = () => {
		if (onCancelPrepare) onCancelPrepare();
		setNewPrompt("");
	};

	const isEmpty = sessions.length === 0 && !isPreparing;

	return (
		<div
			className={`dsh-kanban-section ${isDragOver ? "drag-over" : ""} ${isEmpty ? "is-empty" : ""} ${isCollapsed && !isPreparing ? "is-collapsed" : ""}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<div
				className="dsh-kanban-section-header"
				onClick={() => setIsCollapsed((prev) => !prev)}
			>
				<div className="dsh-kanban-section-title-wrap">
					<span className="dsh-kanban-collapse-icon">
						{isCollapsed && !isPreparing ? "▸" : "▾"}
					</span>
					<span>{title}</span>
					<span className="dsh-kanban-pill">{sessions.length}</span>
				</div>
			</div>

			<div className="dsh-kanban-lane-body">
				{isPreparing && (
					<div
						className="dsh-kanban-new-card"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="dsh-kanban-prepare-label">Prepare Task</div>
						<textarea
							ref={(el) => el?.focus()}
							className="dsh-kanban-new-card-textarea"
							placeholder="Task instructions / prompt..."
							rows={3}
							value={newPrompt}
							onChange={(e) => setNewPrompt(e.target.value)}
							onKeyDown={(e) => {
								if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
									e.preventDefault();
									handleSave();
								} else if (e.key === "Escape") {
									handleCancel();
								}
							}}
						/>
						<div className="dsh-kanban-new-card-actions">
							<button
								type="button"
								className="dsh-kanban-btn-add"
								onClick={handleSave}
								disabled={!newPrompt.trim()}
							>
								Save Task
							</button>
							<button
								type="button"
								className="dsh-kanban-btn-cancel"
								onClick={handleCancel}
							>
								Cancel
							</button>
						</div>
					</div>
				)}

				{sessions.length === 0 && !isPreparing ? (
					<div className="dsh-kanban-empty">No sessions</div>
				) : (
					sessions.map((session) => (
						<KanbanCard
							key={session.id}
							session={session}
							lane={lane}
							alert={getAlert?.(session.id)}
							isSelected={session.id === selectedSessionId}
							onSelect={onSelect}
							onDragStart={onDragStart}
							onDragEnd={onDragEnd}
							onTransition={onDropSession}
							onTogglePin={onTogglePin}
						/>
					))
				)}
			</div>
		</div>
	);
}
