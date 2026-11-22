import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type {
	WorkspaceId,
	WorkspaceView,
} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { KanbanLane, KanbanRecord } from "../../types.ts";
import type { KanbanSessionAlert } from "../store.ts";

export function createMockObservable<T>(value: T): ObservableSnapshot<T> {
	return {
		getSnapshot: () => value,
		subscribe: () => () => {},
	};
}

export function createMockSession(
	id: string,
	displayTitle: string,
	lane: KanbanLane,
	options: {
		running?: boolean;
		prompt?: string;
		pinned?: boolean;
		cwd?: string;
		links?: KanbanRecord["links"];
	} = {},
): SessionSummary {
	const now = Date.now();
	const record: KanbanRecord = {
		sessionId: id as SessionId,
		createdAt: now - 3600_000,
		prompt: options.prompt,
		pinnedAt: options.pinned ? now - 1800_000 : undefined,
		heldAt: lane === "todo" ? now - 3600_000 : undefined,
		reviewAt: lane === "review" ? now - 1200_000 : undefined,
		doneAt: lane === "done" ? now - 600_000 : undefined,
		links: options.links ?? [],
	};

	return {
		id: id as SessionId,
		displayTitle,
		running: options.running ?? lane === "active",
		blank: false,
		cwd: options.cwd ?? "/Users/dev/dev/project-alpha",
		updatedAt: now - 300_000,
		retainedBy: {},
		projectionValues: {
			kanban: record,
		},
	};
}

export function createMockAlert(kind: KanbanSessionAlert): KanbanSessionAlert {
	return kind;
}

export function createMockWorkspace(
	workspaceId: string,
	title: string,
	path: string,
	sessionIds: string[],
): WorkspaceView {
	return {
		workspaceId: workspaceId as WorkspaceId,
		title,
		path,
		sessionIds: sessionIds as SessionId[],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}
