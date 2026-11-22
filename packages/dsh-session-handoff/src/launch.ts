import type { SessionEvent, SessionId } from "@deepseek-ai/dsh-session/types";

/**
 * First line of the launch result. A slash command has no structured return
 * channel, so the Host encodes the new Session id here and the client reads it
 * back out of the durable `command/done` record.
 */
export const LAUNCH_PREFIX = "Handoff launched: ";

export function formatLaunchResult(sessionId: SessionId): string {
	return `${LAUNCH_PREFIX}${String(sessionId)}`;
}

/**
 * The launched Session id carried by one durable event, or `undefined` when the
 * event is not a successful handoff launch.
 */
export function launchedSessionId(event: SessionEvent): SessionId | undefined {
	if (event.type !== "command/done") return undefined;
	if (event.data.kind !== "success") return undefined;
	const { text } = event.data;
	if (typeof text !== "string" || !text.startsWith(LAUNCH_PREFIX)) {
		return undefined;
	}
	// edge case: the id is a host-generated uuid that round-tripped through the
	// result text, so the brand is restored rather than validated.
	return text.slice(LAUNCH_PREFIX.length) as SessionId;
}
