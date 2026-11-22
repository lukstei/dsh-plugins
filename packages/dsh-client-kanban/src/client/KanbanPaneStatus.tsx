import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { KanbanPaneInjected } from "./KanbanPane.tsx";
import { KanbanStatusDot } from "./KanbanStatusDot.tsx";
import { formatKanbanAlertLabel } from "./store.ts";
import { useKanban } from "./use-kanban.ts";

/**
 * Purpose: Render the sidebar's Kanban lane and alert indicator in a split pane.
 * Contract:
 * - Inputs: Bound Session identity and the sidebar's reactive stores.
 * - Outputs: An accessible dot using the sidebar's classification and paint rules.
 * - Throws / Errors: Missing required stores fail at the call site.
 */
export function KanbanPaneStatus({
	sessionId,
	sessionsList,
	workspacesList,
	sessionStatus,
}: Pick<PropsRuntime<"split.pane.status">, "sessionId"> &
	Pick<
		KanbanPaneInjected,
		"sessionsList" | "workspacesList" | "sessionStatus"
	>) {
	const board = useKanban(sessionsList, workspacesList, sessionStatus);
	const lane = board.getLane(sessionId);
	const alert = board.getAlert(sessionId);
	const label =
		alert === undefined
			? {
					todo: "To Do",
					active: "In Progress",
					review: "In Review",
					done: "Done",
				}[lane]
			: formatKanbanAlertLabel(alert);
	return (
		<span
			className="dsh-kanban-pane-status"
			role="img"
			aria-label={label}
			title={label}
		>
			<KanbanStatusDot state={alert === undefined ? lane : "alert"} />
		</span>
	);
}
