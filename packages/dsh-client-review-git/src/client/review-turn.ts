import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-session/types";
import {
	branchReviewScopeSchema,
	GIT_REVIEW_TOOL,
	reviewTargetSchema,
} from "@lukstei/util-review-ui/review";
import type {
	BranchReviewScope,
	ReviewTarget,
} from "@lukstei/util-review-ui/types";
import { z } from "zod";
import type {} from "../review-tool.ts";

export const reviewScopeOrTargetSchema = z.union([
	branchReviewScopeSchema,
	reviewTargetSchema,
]);

export type GitReviewScopeOrTarget = BranchReviewScope | ReviewTarget;

export function isBranchReviewScope(
	scope: GitReviewScopeOrTarget,
): scope is BranchReviewScope {
	return "kind" in scope && scope.kind === "branch";
}

/** One successfully presented review target. */
export interface GitReviewEntry {
	readonly id: string;
	readonly scope: GitReviewScopeOrTarget;
}

/** Turn-scoped review cards published by the presentation tool. */
export interface GitReviewTurnData {
	readonly reviews: readonly GitReviewEntry[];
}

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Successful `git_review_present` calls of this Turn, in call order. */
		"git-review": GitReviewTurnData;
	}
}

interface State {
	readonly turn: number;
	readonly calls: ReadonlyMap<string, ReviewTarget | null>;
	readonly reviews: readonly GitReviewEntry[];
}

function parseTargetArgs(argsRaw: string): ReviewTarget | null {
	try {
		const parsed = JSON.parse(argsRaw);
		const target = reviewTargetSchema.safeParse(parsed);
		return target.success ? target.data : null;
	} catch {
		return null;
	}
}

/**
 * Turn-local accumulator for presentation calls; it publishes no view Node.
 * The tool persists its target or scope on the successful `tool/result`, so a
 * resumed or replayed session rebuilds the same cards, deferring review scope
 * resolution to click time.
 */
export const gitReviewDefinition: ConversationNodeDefinition<State> = {
	kind: "git-review",
	match: (event) => {
		if (event.type === "turn/start")
			return { id: String(event.data.turn), role: "start" };
		if (event.type === "command/run" && event.data.name === "git-review") {
			try {
				const data = JSON.parse(event.data.args ?? "{}");
				return typeof data === "object" &&
					data !== null &&
					"turn" in data &&
					typeof data.turn === "number"
					? { id: String(data.turn), role: "update" }
					: null;
			} catch {
				return null;
			}
		}
		if ((event as { type: string }).type === "git-review/presented") {
			const data = event.data as Record<string, unknown> | null;
			return typeof data === "object" &&
				data !== null &&
				"turn" in data &&
				typeof data.turn === "number"
				? { id: String(data.turn), role: "update" }
				: null;
		}
		if (event.type === "tool/call")
			return event.data.name === GIT_REVIEW_TOOL
				? { id: String(event.data.turn), role: "update" }
				: null;
		if (event.type === "tool/result")
			return { id: String(event.data.turn), role: "update" };
		return null;
	},
	start: (_context, match) => {
		if (match.event.type !== "turn/start")
			throw new Error("git-review start requires turn/start");
		return { turn: match.event.data.turn, calls: new Map(), reviews: [] };
	},
	update: (context, match) => {
		const event = match.event;
		if (event.type === "command/run" && event.data.name === "git-review") {
			try {
				const data = JSON.parse(event.data.args ?? "{}") as {
					callId?: string;
					target?: unknown;
				};
				const parsed = reviewScopeOrTargetSchema.safeParse(data.target);
				if (parsed.success) {
					const id = data.callId ? String(data.callId) : `review-${event.seq}`;
					if (context.state.reviews.some((r) => r.id === id)) {
						return context.state;
					}
					return {
						...context.state,
						reviews: [...context.state.reviews, { id, scope: parsed.data }],
					};
				}
			} catch {}
			return context.state;
		}
		if ((event as { type: string }).type === "git-review/presented") {
			const data = event.data as {
				callId?: string;
				target?: unknown;
			};
			const parsed = reviewScopeOrTargetSchema.safeParse(data.target);
			if (parsed.success) {
				const id = data.callId ? String(data.callId) : `review-${event.seq}`;
				if (context.state.reviews.some((r) => r.id === id)) {
					return context.state;
				}
				return {
					...context.state,
					reviews: [...context.state.reviews, { id, scope: parsed.data }],
				};
			}
			return context.state;
		}
		if (event.type === "tool/call") {
			const calls = new Map(context.state.calls);
			calls.set(
				String(event.data.callId),
				parseTargetArgs(event.data.arguments),
			);
			return { ...context.state, calls };
		}
		if (event.type !== "tool/result") return context.state;
		const callId = String(event.data.message.source.callId);
		if (!context.state.calls.has(callId)) return context.state;
		const calls = new Map(context.state.calls);
		const argumentTarget = calls.get(callId);
		calls.delete(callId);
		if (event.data.message.isError) return { ...context.state, calls };
		if (context.state.reviews.some((r) => r.id === callId)) {
			return { ...context.state, calls };
		}
		const parsed = reviewScopeOrTargetSchema.safeParse(event.data.meta);
		const scope = parsed.success ? parsed.data : argumentTarget;
		if (scope === null || scope === undefined)
			return { ...context.state, calls };
		return {
			...context.state,
			calls,
			reviews: [...context.state.reviews, { id: callId, scope }],
		};
	},
	buildLocationData: (context, scope, previous) => {
		const state = context.state;
		if (scope !== "turn" || state === undefined) return null;
		if (
			previous?.kind === "turn" &&
			previous.turn === state.turn &&
			previous.key === "git-review" &&
			previous.value.reviews === state.reviews
		)
			return previous;
		return {
			kind: "turn",
			turn: state.turn,
			key: "git-review",
			value: { reviews: state.reviews },
		};
	},
};
