import {
	Button,
	IconChevronDownOutlineRegular,
	Menu,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { useMemo, useState } from "react";
import type { KanbanLane, KanbanRecord } from "../types.ts";
import { KanbanIcon } from "./KanbanIcon.tsx";
import { KanbanStatusDot } from "./KanbanStatusDot.tsx";
import { classifyKanbanSession } from "./store.ts";

function formatLaneLabel(lane: KanbanLane, record?: KanbanRecord): string {
	if (lane === "active") return "In Progress";
	if (lane === "review") return "In Review";
	if (lane === "done") return "Done";
	if (lane === "todo") {
		return record?.heldAt !== undefined ? "On Hold" : "Todo";
	}
	return "Kanban";
}

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

function IconPlay({ size = 14 }: { size?: number }) {
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
			<path d="M4.5 3.5V12.5L12.5 8L4.5 3.5Z" strokeLinejoin="round" />
		</svg>
	);
}

function IconReopen({ size = 14 }: { size?: number }) {
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
			<path d="M2.5 8a5.5 5.5 0 1 0 1.5-3.75L2 6" />
			<path d="M2 2v4h4" />
		</svg>
	);
}

export interface KanbanTransitionActions {
	readonly holdSession: (id: SessionId) => Promise<void>;
	readonly unholdSession: (id: SessionId) => Promise<void>;
	readonly markDone: (id: SessionId) => Promise<void>;
	readonly reopen: (id: SessionId) => Promise<void>;
	readonly startPreparedTask: (id: SessionId, prompt: string) => Promise<void>;
}

export type KanbanTransitionDropdownProps =
	PropsRuntime<"conversation.input.left"> & KanbanTransitionActions;

/**
 * Purpose: Render a dropdown button with the Kanban icon in the prompt input bar for task transitions.
 * Contract:
 * - Inputs: Session runtime hooks and injected Kanban transition mutation callbacks.
 * - Outputs: Rendered JSX element with an accessible trigger button and transition popover menu.
 * - Throws / Errors: Never throws; transition command failures are handled by callers.
 */
export function KanbanTransitionDropdown({
	sessionId,
	useSession,
	useSessions,
	holdSession,
	unholdSession,
	markDone,
	reopen,
	startPreparedTask,
}: KanbanTransitionDropdownProps) {
	const [open, setOpen] = useState(false);
	const isRunning = useSession((s) => s.running);
	const isBlank = useSession((s) => s.blank);
	const hasPendingInteraction = useSession(
		(s) => s.pendingSubmissions.length > 0,
	);
	const summary = useSessions((s) => s.byId[sessionId]);
	const record = summary?.projectionValues?.kanban as KanbanRecord | undefined;

	const fallbackRecord: KanbanRecord = {
		sessionId,
		createdAt: 0,
		links: [],
	};
	const lane = classifyKanbanSession(
		{ running: isRunning, blank: isBlank },
		record ?? fallbackRecord,
		hasPendingInteraction,
	);
	const laneLabel = formatLaneLabel(lane, record);

	const items = useMemo(() => {
		if (lane === "active") return [];
		if (lane === "review") {
			return [
				{
					id: "done",
					label: (
						<span className="dsh-kanban-transition-item dsh-kanban-transition-item-primary">
							<IconCheck size={14} />
							<span>Mark task done</span>
						</span>
					),
				},
				{
					id: "hold",
					label: (
						<span className="dsh-kanban-transition-item">
							<IconPause size={14} />
							<span>Put on hold</span>
						</span>
					),
				},
			];
		}
		if (lane === "todo") {
			return [
				{
					id: "resume",
					label: (
						<span className="dsh-kanban-transition-item">
							<IconPlay size={14} />
							<span>{isBlank ? "Start task" : "Resume task"}</span>
						</span>
					),
				},
				{
					id: "done",
					label: (
						<span className="dsh-kanban-transition-item">
							<IconCheck size={14} />
							<span>Mark task done</span>
						</span>
					),
				},
			];
		}
		if (lane === "done") {
			return [
				{
					id: "reopen",
					label: (
						<span className="dsh-kanban-transition-item">
							<IconReopen size={14} />
							<span>Reopen task</span>
						</span>
					),
				},
				{
					id: "hold",
					label: (
						<span className="dsh-kanban-transition-item">
							<IconPause size={14} />
							<span>Put on hold</span>
						</span>
					),
				},
			];
		}
		return [];
	}, [lane, isBlank]);

	// Subagent sessions have no Kanban lane of their own.
	if (summary?.origin === "subagent") return null;

	return (
		<Menu
			open={open && !isRunning}
			portal
			side="top"
			align="start"
			className="dsh-kanban-transition-menu"
			listClassName="dsh-kanban-transition-menu-list"
			onClose={() => setOpen(false)}
			onSelect={(id) => {
				setOpen(false);
				if (id === "hold") {
					void holdSession(sessionId);
				} else if (id === "done") {
					void markDone(sessionId);
				} else if (id === "reopen") {
					void reopen(sessionId);
				} else if (id === "resume") {
					if (isBlank && record?.prompt) {
						void startPreparedTask(sessionId, record.prompt);
					} else {
						void unholdSession(sessionId);
					}
				}
			}}
			items={items}
			anchor={
				<Button
					variant="ghost"
					size="sm"
					className={`dsh-kanban-input-chip ${open ? "is-pressed" : ""}`}
					title={
						isRunning
							? "Task is in progress"
							: `Kanban: ${laneLabel} (click to transition)`
					}
					aria-label={
						isRunning
							? "Task is in progress"
							: `Kanban: ${laneLabel} (click to transition)`
					}
					aria-haspopup="menu"
					aria-expanded={open}
					aria-pressed={open}
					disabled={isRunning}
					icon={<KanbanIcon size={18} strokeWidth={1} />}
					onClick={(event) => {
						event.stopPropagation();
						if (!isRunning) {
							setOpen((prev) => !prev);
						}
					}}
				>
					<KanbanStatusDot state={lane} />
					<IconChevronDownOutlineRegular
						size={12}
						className="dsh-kanban-input-chip-chevron"
						aria-hidden="true"
					/>
				</Button>
			}
		/>
	);
}
