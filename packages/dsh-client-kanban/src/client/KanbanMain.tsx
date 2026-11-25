import type { SessionReference } from "@deepseek-ai/dsh-api-session-controller/client";
import type {
	InjectFace,
	PropsRenderSlots,
	PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { useEffect, useState } from "react";
import { KanbanPane, type KanbanPaneInjected } from "./KanbanPane.tsx";

export interface KanbanMainInjected extends KanbanPaneInjected {
	readonly retainSession: (id: SessionId) => SessionReference;
}

type KanbanMainProps = PropsRuntime<"main", "kanban"> &
	PropsRenderSlots<"kanban.preview"> &
	InjectFace<KanbanMainInjected>;

/**
 * Purpose: Main-panel entry that gives the board a session-scoped preview renderer.
 * Contract:
 * - Inputs: Slot runtime (SessionProvider, renderSlot) and the board's injected face plus `retainSession`.
 * - Outputs: KanbanPane whose `renderPreview` holds the session open while it is shown.
 * - Throws / Errors: Never throws.
 */
export function KanbanMain({
	SessionProvider,
	renderSlot,
	retainSession,
	...injected
}: KanbanMainProps) {
	const renderPreview = (id: SessionId) => (
		<PreviewHost
			key={id}
			sessionId={id}
			retainSession={retainSession}
			SessionProvider={SessionProvider}
			renderSlot={renderSlot}
		/>
	);
	return <KanbanPane {...injected} renderPreview={renderPreview} />;
}

function PreviewHost({
	sessionId,
	retainSession,
	SessionProvider,
	renderSlot,
}: {
	readonly sessionId: SessionId;
	readonly retainSession: KanbanMainInjected["retainSession"];
	readonly SessionProvider: KanbanMainProps["SessionProvider"];
	readonly renderSlot: KanbanMainProps["renderSlot"];
}) {
	const [reference, setReference] = useState<SessionReference>();
	useEffect(() => {
		const retained = retainSession(sessionId);
		setReference(retained);
		return () => retained.release();
	}, [retainSession, sessionId]);
	if (reference === undefined) return null;
	return (
		<SessionProvider session={reference}>
			{renderSlot("kanban.preview", {})}
		</SessionProvider>
	);
}
