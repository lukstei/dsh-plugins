import type {
	PropsRenderFactories,
	PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";

/**
 * Purpose: Occupant of `kanban.preview`: the embedded read-only conversation of the scoped session.
 * Contract:
 * - Inputs: Session-scoped runtime hooks and the factory renderer.
 * - Outputs: The same `conversation.content` body split view shows in its overlays.
 * - Throws / Errors: Never throws.
 */
export function KanbanSessionPreview({
	sessionId,
	useSession,
	useConversation,
	useSessions,
	renderFactorySlot,
}: PropsRuntime<"kanban.preview"> & PropsRenderFactories) {
	const session = useSession((value) => value);
	const conversation = useConversation((value) => value);
	const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank);
	// smell: phase duplicated from split view because ui-conversation is not importable from a platform bundle
	const active =
		conversation.activeTargets.size > 0 ||
		(!session.blank && !session.awaitingFirstTurn) ||
		session.running;
	const blank = !active && !session.promptAttempted;
	const hero = blank && (session.openState === "open" || summaryBlank === true);
	const settling =
		blank && session.openState === "loading" && summaryBlank !== true;
	return renderFactorySlot("conversation.content", {
		variant: "embedded",
		phase: settling ? "settling" : hero ? "hero" : "active",
		hero,
	});
}
