import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type { SessionStatusSnapshot } from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { deriveKanbanBoard, type KanbanBoard } from "./store.ts";

/**
 * Purpose: Subscribe to an ObservableSnapshot reactive store.
 * Contract:
 * - Inputs: ObservableSnapshot store.
 * - Outputs: Current snapshot value T.
 * - Throws / Errors: Never throws.
 */
export function useStore<T>(store: ObservableSnapshot<T>): T {
	return useSyncExternalStore(
		useCallback((cb) => store.subscribe(cb), [store]),
		useCallback(() => store.getSnapshot(), [store]),
	);
}

/**
 * Purpose: React hook subscribing to session and workspace stores and providing derived KanbanBoard state.
 * Contract:
 * - Inputs: Observable snapshots for sessionsList, workspacesList, sessionStatus, optional timestamp now, and optional split pane session ids.
 * - Outputs: Derived KanbanBoard model.
 * - Throws / Errors: Never throws.
 */
export function useKanban(
	sessionsList: ObservableSnapshot<SessionListState>,
	workspacesList: ObservableSnapshot<WorkspaceSnapshot>,
	sessionStatus: ObservableSnapshot<SessionStatusSnapshot>,
	now?: number,
	splitSessionIds?: readonly SessionId[],
): KanbanBoard {
	const sessions = useStore(sessionsList);
	const workspaces = useStore(workspacesList);
	const status = useStore(sessionStatus);

	return useMemo(
		() =>
			deriveKanbanBoard(
				sessions,
				workspaces.items,
				status,
				now,
				splitSessionIds,
			),
		[sessions, workspaces.items, status, now, splitSessionIds],
	);
}
