/** Pure session event folding to derive Kanban state. */
import type {
	SessionEventMap,
	SessionHeader,
} from "@deepseek-ai/dsh-session/types";
import {
	type KanbanRecord,
	type KanbanState,
	kanbanPayloadSchema,
} from "./types.ts";

/**
 * Purpose: Create the initial uninitialized Kanban state from a session header.
 * Contract:
 * - Inputs: Valid session header with id and createdAt timestamp.
 * - Outputs: Uninitialized KanbanState with an empty link collection.
 * - Throws / Errors: Never throws.
 */
export function initialKanbanState(header: SessionHeader): KanbanState {
	return {
		sessionId: header.id,
		createdAt: header.createdAt,
		links: [],
		initialized: false,
		deleted: false,
	};
}

/**
 * Purpose: Fold a single session event into the existing Kanban state.
 * Contract:
 * - Inputs: Current KanbanState and a committed event with its canonical DSH payload.
 * - Outputs: Next immutable KanbanState reflecting the event transition.
 * - Throws / Errors: Never throws.
 */
export function foldKanbanEvent(
	state: KanbanState,
	event: {
		readonly type: string;
		readonly time?: number;
		readonly data?: unknown;
	},
): KanbanState {
	if (event.type === "command/run") {
		// edge case: the event tag identifies the canonical payload in this open envelope
		const data = event.data as SessionEventMap["command/run"];
		if (data.name !== "kanban") return state;
		if (data.args === undefined || data.args.trim() === "") {
			if (state.initialized || state.deleted) return state;
			return {
				...state,
				initialized: true,
			};
		}
		let input: unknown;
		try {
			input = JSON.parse(data.args);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			return state;
		}
		const parsed = kanbanPayloadSchema.safeParse(input);
		if (!parsed.success) return state;
		const payload = parsed.data;
		if (payload.action === "add-link") {
			if (state.deleted) return state;
			const link = {
				label: payload.label,
				url: payload.url,
				priority: payload.priority,
			};
			const existing = state.links.find((entry) => entry.url === link.url);
			if (existing === undefined)
				return { ...state, links: [...state.links, link] };
			if (existing.label === link.label && existing.priority === link.priority)
				return state;
			return {
				...state,
				links: state.links.map((entry) =>
					entry.url === link.url ? link : entry,
				),
			};
		}
		if (payload.action === "init") {
			if (state.initialized || state.deleted) return state;
			return {
				...state,
				initialized: true,
				createdAt: payload.createdAt,
				...(payload.prompt !== undefined ? { prompt: payload.prompt } : {}),
			};
		}
		if (payload.action === "delete") {
			if (!state.initialized || state.deleted) return state;
			return {
				...state,
				deleted: true,
			};
		}
		if (payload.action === "done") {
			if (!state.initialized || state.deleted || state.doneAt !== undefined)
				return state;
			const { heldAt: _, reviewAt: __, ...rest } = state;
			return {
				...rest,
				doneAt: payload.doneAt,
			};
		}
		if (payload.action === "reopen") {
			if (!state.initialized || state.deleted || state.doneAt === undefined)
				return state;
			const { doneAt: _, ...rest } = state;
			return { ...rest, reviewAt: payload.reopenedAt };
		}
		if (payload.action === "hold") {
			if (!state.initialized || state.deleted) return state;
			const { doneAt: _, reviewAt: __, ...rest } = state;
			return {
				...rest,
				heldAt: payload.heldAt,
			};
		}
		if (payload.action === "unhold") {
			if (
				!state.initialized ||
				state.deleted ||
				state.doneAt !== undefined ||
				state.reviewAt !== undefined
			)
				return state;
			const { heldAt: _, ...rest } = state;
			return { ...rest, reviewAt: payload.unheldAt };
		}
		if (payload.action === "pin") {
			if (!state.initialized || state.deleted || state.doneAt === undefined)
				return state;
			if (state.pinnedAt !== undefined) return state;
			return {
				...state,
				pinnedAt: payload.pinnedAt,
			};
		}
		if (payload.action === "unpin") {
			if (!state.initialized || state.deleted || state.pinnedAt === undefined)
				return state;
			const { pinnedAt: _, ...rest } = state;
			return rest;
		}
	}
	if (event.type === "assistant/message" || event.type === "user/message") {
		if (state.deleted) return state;
		const eventTime = typeof event.time === "number" ? event.time : undefined;
		const nextActivity =
			eventTime !== undefined && eventTime > (state.lastActivityAt ?? 0)
				? eventTime
				: state.lastActivityAt;

		if (event.type === "user/message") {
			// edge case: user messages clear manual lane placement when execution resumes
			if (
				state.initialized &&
				(state.doneAt !== undefined ||
					state.heldAt !== undefined ||
					state.reviewAt !== undefined)
			) {
				const { doneAt: _, heldAt: __, reviewAt: ___, ...rest } = state;
				return nextActivity !== state.lastActivityAt
					? { ...rest, lastActivityAt: nextActivity }
					: rest;
			}
		}

		if (nextActivity !== state.lastActivityAt) {
			return { ...state, lastActivityAt: nextActivity };
		}
		return state;
	}
	return state;
}

/**
 * Purpose: Fold an ordered list of session events to compute final Kanban state.
 * Contract:
 * - Inputs: Initial SessionHeader and list of session events.
 * - Outputs: Final folded KanbanState.
 * - Throws / Errors: Never throws.
 */
export function foldKanbanState(
	header: SessionHeader,
	events: readonly {
		readonly type: string;
		readonly time?: number;
		readonly data?: unknown;
	}[],
): KanbanState {
	return events.reduce(foldKanbanEvent, initialKanbanState(header));
}

/**
 * Purpose: Convert internal KanbanState into a public projection record.
 * Contract:
 * - Inputs: Current KanbanState.
 * - Outputs: Public KanbanRecord with links sorted by ascending priority and collection order for ties, or null when uninitialized/deleted.
 * - Throws / Errors: Never throws.
 */
export function toKanbanRecord(state: KanbanState): KanbanRecord | null {
	if (!state.initialized || state.deleted) return null;
	const { initialized: _, deleted: __, ...record } = state;
	return {
		...record,
		links: record.links.toSorted((a, b) => a.priority - b.priority),
	};
}
