/** Shared strict Remote contract for scoped Kanban content search. */
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import {
	createTypertRemoteInfo,
	type RemoteResult,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

export const SEARCH_RESULT_LIMIT = 20;

// edge case: SessionId is a branded string without a separate runtime representation
const sessionIdSchema = z
	.string()
	.min(1)
	.transform((id) => id as SessionId);

export const searchRequestSchema = z.strictObject({
	query: z.string().trim().min(1),
	sessionIds: z.array(sessionIdSchema),
});

export const searchResultSchema = z.strictObject({
	items: z.array(
		z.strictObject({ sessionId: sessionIdSchema, snippet: z.string() }),
	),
	hasMore: z.boolean(),
});

const requestCodec = {
	mode: "strict",
	typeSymbol: "dsh-client-kanban#searchRequest",
	create: () => searchRequestSchema,
} as const;

// smell: monorepo-only generator; generate this contract when standalone generation is supported
export const searchRemote = createTypertRemoteInfo(
	{
		package: "dsh-client-kanban",
		methods: {
			"kanban/search": {
				service: "kanbanSearch",
				invocation: { kind: "direct" },
				parameters: [
					{
						name: "request",
						source: "json",
						codec: requestCodec,
						strictCodec: requestCodec,
					},
				],
				cancellation: { parameter: "signal" },
				result: {
					mode: "strict",
					typeSymbol: "dsh-client-kanban#searchResult",
					create: () => searchResultSchema,
				},
			},
		},
	},
	z,
);

declare module "@deepseek-ai/dsh-typert-protocol" {
	interface TypertRemoteNamespaceMap {
		kanban: {
			search(
				request: z.input<typeof searchRequestSchema>,
				signal: AbortSignal,
			): Promise<RemoteResult<z.output<typeof searchResultSchema>>>;
		};
	}
}
