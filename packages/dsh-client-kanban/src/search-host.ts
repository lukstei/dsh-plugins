/** Host-only scoped content search and its Remote registration. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remote-access";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-session-query";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type {} from "@deepseek-ai/dsh-typert-registry";
import type { z } from "zod";
import {
	SEARCH_RESULT_LIMIT,
	searchRemote,
	type searchRequestSchema,
	type searchResultSchema,
} from "./search.ts";

declare module "@deepseek-ai/cordis" {
	interface Context {
		kanbanSearch: KanbanSearch;
	}
}

export class KanbanSearch extends TypertRemoteService {
	static inject = ["sessionQuery", "remoteAccess", "typert"];

	constructor(ctx: Context) {
		super(ctx, "kanbanSearch", { namespace: "kanban" });
		ctx.typert.register({
			package: searchRemote.package,
			face: "host",
			schemas: [],
			model: { services: [], events: [], objects: [] },
			invocations: searchRemote.descriptors,
		});
	}

	/**
	 * Purpose: Search only authorized sessions from the selected Kanban board.
	 * Contract:
	 * - Inputs: Strict Remote request containing query and board session IDs, and cancellation signal.
	 * - Outputs: At most 20 message-content hits, with a scoped continuation indicator.
	 * - Throws / Errors: Propagates cancellation and provider errors to the Gateway.
	 */
	async search(
		request: z.output<typeof searchRequestSchema>,
		signal: AbortSignal,
	): Promise<z.output<typeof searchResultSchema>> {
		signal.throwIfAborted();
		const sessionIds = request.sessionIds.filter((id) =>
			this.ctx.remoteAccess.allows({ kind: "session", id }),
		);
		if (sessionIds.length === 0) return { items: [], hasMore: false };
		const page = await this.ctx.sessionQuery.searchSessions(
			{
				query: request.query,
				sessionFilters: [{ kind: "id", values: sessionIds }],
				eventFilters: [
					{ kind: "type", values: ["user/message", "assistant/message"] },
					{ kind: "surface", values: ["current"] },
				],
				limit: SEARCH_RESULT_LIMIT,
			},
			{ signal },
		);
		signal.throwIfAborted();
		return {
			items: page.items
				.filter((hit) =>
					this.ctx.remoteAccess.allows({ kind: "session", id: hit.header.id }),
				)
				.map((hit) => ({
					sessionId: hit.header.id,
					snippet: hit.bestMatch.snippet,
				})),
			hasMore: page.nextCursor !== undefined,
		};
	}
}
