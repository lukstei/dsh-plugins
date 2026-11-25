/** Domain contracts and type declarations for DSH Kanban. */
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { z } from "zod";

/** Session id of a `dsh://sessions/{id}` link, or `undefined` for any other URL. */
export function sessionLinkId(value: string): SessionId | undefined {
	const url = URL.parse(value);
	if (url === null || url.protocol !== "dsh:" || url.hostname !== "sessions") {
		return undefined;
	}
	const id = url.pathname.slice(1);
	// edge case: the id is user-authored URL text, so the brand is restored only
	// for a single non-empty path segment.
	return id === "" || id.includes("/") ? undefined : (id as SessionId);
}

export const kanbanLinkSchema = z.object({
	label: z.string().trim().min(1),
	url: z.string().refine((value) => {
		const url = URL.parse(value);
		return (
			url !== null &&
			(url.protocol === "http:" ||
				url.protocol === "https:" ||
				sessionLinkId(value) !== undefined)
		);
	}, "Expected an absolute HTTP(S) URL or dsh://sessions/{id}"),
	priority: z.number().default(0),
});

export type KanbanLane = "todo" | "active" | "review" | "done";

export interface KanbanRecord {
	readonly sessionId: SessionId;
	readonly createdAt: number;
	readonly doneAt?: number;
	readonly heldAt?: number;
	readonly reviewAt?: number;
	readonly prompt?: string;
	readonly pinnedAt?: number;
	readonly links: readonly Readonly<z.infer<typeof kanbanLinkSchema>>[];
	readonly lastActivityAt?: number;
}

export interface KanbanState {
	readonly sessionId: SessionId;
	readonly createdAt: number;
	readonly doneAt?: number;
	readonly heldAt?: number;
	readonly reviewAt?: number;
	readonly prompt?: string;
	readonly pinnedAt?: number;
	readonly links: KanbanRecord["links"];
	readonly initialized: boolean;
	readonly deleted: boolean;
	readonly lastActivityAt?: number;
}

export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const kanbanPayloadSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("init"),
		createdAt: z.number(),
		prompt: z.string().optional(),
	}),
	z.object({ action: z.literal("done"), doneAt: z.number() }),
	z.object({ action: z.literal("reopen"), reopenedAt: z.number() }),
	z.object({ action: z.literal("delete"), deletedAt: z.number() }),
	z.object({ action: z.literal("hold"), heldAt: z.number() }),
	z.object({ action: z.literal("unhold"), unheldAt: z.number() }),
	z.object({ action: z.literal("pin"), pinnedAt: z.number() }),
	z.object({ action: z.literal("unpin"), unpinnedAt: z.number() }),
	kanbanLinkSchema.extend({ action: z.literal("add-link") }),
]);

export type KanbanPayload = z.infer<typeof kanbanPayloadSchema>;

declare module "@deepseek-ai/dsh-session-projection/types" {
	interface SessionProjectionMap {
		kanban: KanbanRecord | null;
	}
	interface SessionProjectionStateMap {
		kanban: KanbanState;
	}
}

declare module "@deepseek-ai/dsh-session-projection" {
	interface SessionProjectionMap {
		kanban: KanbanRecord | null;
	}
	interface SessionProjectionStateMap {
		kanban: KanbanState;
	}
}
