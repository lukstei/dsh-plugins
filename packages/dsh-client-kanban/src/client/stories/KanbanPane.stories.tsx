import type {
	SessionListState,
	SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type {
	SessionStatus,
	SessionStatusSnapshot,
} from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { Story } from "@ladle/react";
import { useState } from "react";
import { KanbanPane } from "../KanbanPane.tsx";
import {
	createMockObservable,
	createMockSession,
	createMockWorkspace,
} from "./fixtures.ts";

export const FullBoard: Story = () => {
	const [selectedSessionId, setSelectedSessionId] = useState<SessionId>(
		"session-2" as SessionId,
	);

	const sessions: SessionSummary[] = [
		createMockSession(
			"session-1",
			"task: Update OpenAPI specs for v2 routes",
			"todo",
			{ prompt: "Add OpenAPI schema tags" },
		),
		createMockSession(
			"session-2",
			"feat(auth): OAuth2 PKCE callback handler",
			"active",
			{ running: true, prompt: "Implement auth exchange" },
		),
		createMockSession(
			"session-3",
			"test(e2e): Fix worker shutdown timeout",
			"active",
			{ running: true },
		),
		createMockSession(
			"session-4",
			"refactor: Migrate connection pool to pgx",
			"review",
			{ prompt: "Post-review code updates" },
		),
		createMockSession(
			"session-5",
			"docs: Architecture review guidelines",
			"done",
			{ pinned: true },
		),
		createMockSession(
			"session-6",
			"ci: Update matrix runners to node 22",
			"done",
		),
	];

	const workspaces = [
		createMockWorkspace("ws-1", "Backend Services", "/Users/dev/dev/backend", [
			"session-1",
			"session-2",
			"session-3",
			"session-4",
		]),
		createMockWorkspace("ws-2", "Documentation", "/Users/dev/dev/docs", [
			"session-5",
			"session-6",
		]),
	];

	const byId = Object.fromEntries(sessions.map((s) => [s.id, s])) as Record<
		SessionId,
		SessionSummary
	>;

	const sessionsListState: SessionListState = {
		ids: sessions.map((s) => s.id),
		byId,
		phase: "ready",
		projectionsBySession: {},
	};

	const workspacesSnapshot: WorkspaceSnapshot = {
		items: workspaces,
		archivedSessionIds: [],
		pinnedSessionIds: [],
		state: "idle",
		phase: "ready",
		error: null,
	};

	const statusEntry: SessionStatus = {
		running: true,
		pendingInteraction: {
			key: "pi-1",
			kind: "question",
			sessionId: "session-2" as SessionId,
		},
		completionUnread: false,
	};

	const sessionStatusSnapshot: SessionStatusSnapshot = new Map<
		SessionId,
		SessionStatus
	>([["session-2" as SessionId, statusEntry]]);

	return (
		<div
			style={{
				height: "700px",
				width: "100%",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<KanbanPane
				sessionsList={createMockObservable(sessionsListState)}
				workspacesList={createMockObservable(workspacesSnapshot)}
				sessionStatus={createMockObservable(sessionStatusSnapshot)}
				searchSessions={async () => ({
					ok: true,
					value: { items: [], hasMore: false },
				})}
				searchResultLimit={20}
				currentSessionId={selectedSessionId}
				selectPanel={() => {}}
				selectSession={(id) => setSelectedSessionId(id)}
				startTask={async () => {}}
				prepareTask={async () => {}}
				startPreparedTask={async () => {}}
				markDone={async () => {}}
				reopen={async () => {}}
				deleteSession={async () => {}}
				holdSession={async () => {}}
				unholdSession={async () => {}}
				pinSession={async () => {}}
				unpinSession={async () => {}}
			/>
		</div>
	);
};
