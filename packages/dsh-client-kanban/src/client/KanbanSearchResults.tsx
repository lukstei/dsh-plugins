import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ReactNode } from "react";
import type { KanbanLane } from "../types.ts";
import { KanbanStatusDot } from "./KanbanStatusDot.tsx";
import {
	formatRelativeTime,
	getKanbanSessionTitle,
	getSessionRecency,
} from "./store.ts";

export interface KanbanSearchHit {
	readonly session: SessionSummary;
	readonly lane: KanbanLane;
	readonly snippet: string;
}

const LANE_LABELS: Record<KanbanLane, string> = {
	todo: "To Do",
	active: "Active",
	review: "Review",
	done: "Done",
};

const escapeRegExp = (text: string): string =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wrap every query term occurrence in <mark>; terms are literal, case-insensitive. */
function highlight(text: string, query: string) {
	const terms = query.split(/\s+/).filter((term) => term !== "");
	if (terms.length === 0) return text;
	const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
	// edge case: split with one capture group puts matches at odd indexes
	return text.split(pattern).map((part, index) =>
		index % 2 === 1 ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: static derived text
			<mark key={index}>{part}</mark>
		) : (
			part
		),
	);
}

/**
 * Purpose: Replace the board while searching with a ranked list beside a full preview of the focused session.
 * Contract:
 * - Inputs: Ranked hits, the raw query for highlighting, the focused hit, the preview body and focus/open callbacks.
 * - Outputs: One focusable row per hit and a preview pane with an "Open session" action.
 * - Throws / Errors: Never throws.
 */
export function KanbanSearchResults({
	hits,
	query,
	focusedId,
	preview,
	onFocus,
	onOpen,
}: {
	readonly hits: readonly KanbanSearchHit[];
	readonly query: string;
	readonly focusedId?: SessionId;
	readonly preview: ReactNode;
	readonly onFocus: (id: SessionId) => void;
	readonly onOpen: (id: SessionId) => void;
}) {
	const focused = hits.find((hit) => hit.session.id === focusedId);
	return (
		<div className="dsh-kanban-results-layout">
			<ul className="dsh-kanban-results" aria-label="Search results">
				{hits.map(({ session, lane, snippet }) => (
					<li key={session.id}>
						<button
							type="button"
							className={`dsh-kanban-result ${session.id === focusedId ? "is-focused" : ""}`}
							aria-current={session.id === focusedId}
							onClick={() => onFocus(session.id)}
							onDoubleClick={() => onOpen(session.id)}
						>
							<span className="dsh-kanban-result-head">
								<span className="dsh-kanban-result-title">
									{getKanbanSessionTitle(session)}
								</span>
								<span className="dsh-kanban-result-meta">
									<KanbanStatusDot state={lane} />
									{LANE_LABELS[lane]} ·{" "}
									{formatRelativeTime(getSessionRecency(session))}
								</span>
							</span>
							<span className="dsh-kanban-result-snippet">
								{highlight(snippet, query)}
							</span>
						</button>
					</li>
				))}
			</ul>
			{focused !== undefined && (
				<section className="dsh-kanban-preview" aria-label="Session preview">
					<div className="dsh-kanban-preview-head">
						<span className="dsh-kanban-preview-title">
							{getKanbanSessionTitle(focused.session)}
						</span>
						<button
							type="button"
							className="dsh-kanban-btn-prepare"
							onClick={() => onOpen(focused.session.id)}
						>
							Open session
						</button>
					</div>
					<div className="dsh-kanban-preview-body">{preview}</div>
				</section>
			)}
		</div>
	);
}
