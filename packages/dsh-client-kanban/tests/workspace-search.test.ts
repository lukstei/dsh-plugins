import { Context } from "@deepseek-ai/cordis";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import * as clientGateway from "@deepseek-ai/dsh-api-gateway/client";
import { RemoteAccessService } from "@deepseek-ai/dsh-api-remote-access";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
	SessionQueryEngine,
	SessionSearchCursor,
	SessionSearchHit,
} from "@deepseek-ai/dsh-session-query";
import type {
	PeerScope,
	RemoteAccessResourceOf,
} from "@deepseek-ai/dsh-typert-protocol";
import { TypertRegistry } from "@deepseek-ai/dsh-typert-registry";
import { expect, test, vi } from "vitest";
import { searchRemote, searchRequestSchema } from "../src/search.ts";
import { KanbanSearch } from "../src/search-host.ts";

declare module "@deepseek-ai/dsh-typert-protocol" {
	interface PrincipalMap {
		"kanban-test": { readonly kind: "kanban-test" };
	}
}

test("restricts the query to authorized board sessions before ranking and limiting", async () => {
	// edge case: fixture IDs use DSH's branded string type
	const sessionIds = ["workspace-session", "forbidden-session"] as SessionId[];
	const ctx = new Context();
	const searchSessions = vi
		.fn<SessionQueryEngine["searchSessions"]>()
		.mockResolvedValue({ items: [] });
	const allows = vi.fn(
		(resource: RemoteAccessResourceOf<"session">) =>
			resource.id === sessionIds[0],
	);
	ctx.provide("sessionQuery", { searchSessions });
	ctx.provide("remoteAccess", { allows });
	ctx.provide("typert", { register: vi.fn() });
	const search = new KanbanSearch(ctx);
	expect(
		await search.search(
			{ query: "phrase", sessionIds },
			new AbortController().signal,
		),
	).toEqual({ items: [], hasMore: false });
	expect(searchSessions.mock.calls[0][0]).toMatchInlineSnapshot(`
		{
		  "eventFilters": [
		    {
		      "kind": "type",
		      "values": [
		        "user/message",
		        "assistant/message",
		      ],
		    },
		    {
		      "kind": "surface",
		      "values": [
		        "current",
		      ],
		    },
		  ],
		  "limit": 20,
		  "query": "phrase",
		  "sessionFilters": [
		    {
		      "kind": "id",
		      "values": [
		        "workspace-session",
		      ],
		    },
		  ],
		}
	`);
});

test("an empty or wholly unauthorized scope never becomes a global query", async () => {
	const ctx = new Context();
	const searchSessions = vi.fn();
	ctx.provide("sessionQuery", { searchSessions });
	ctx.provide("remoteAccess", { allows: () => false });
	ctx.provide("typert", { register: vi.fn() });
	const search = new KanbanSearch(ctx);
	for (const sessionIds of [[], ["forbidden"]]) {
		expect(
			await search.search(
				searchRequestSchema.parse({ query: "phrase", sessionIds }),
				new AbortController().signal,
			),
		).toEqual({ items: [], hasMore: false });
	}
	expect(searchSessions).not.toHaveBeenCalled();
});

test("the real Gateway validates the contract and enforces caller access before ranking", async () => {
	const ctx = new Context();
	new TypertRegistry(ctx);
	const access = new RemoteAccessService(ctx);
	const searchSessions = vi
		.fn<SessionQueryEngine["searchSessions"]>()
		.mockResolvedValue({ items: [] });
	ctx.provide("sessionQuery", { searchSessions });
	new KanbanSearch(ctx);
	const gateway = new TypertGatewayService(ctx, {});
	const peer: PeerScope = {
		// edge case: fixture peer IDs use DSH's branded string type
		id: "kanban-test-peer" as PeerScope["id"],
		ctx,
		principal: { kind: "kanban-test" },
		signal: new AbortController().signal,
		interactions: "none",
		dispose: async () => {
			await ctx.fiber.dispose();
		},
	};
	const call = {
		namespace: "kanban",
		method: "search",
		args: { request: { query: "phrase", sessionIds: ["allowed", "denied"] } },
		peer,
	};
	await expect(gateway.invoke(call)).rejects.toMatchObject({
		code: "remote-access/denied",
	});
	expect(searchSessions).not.toHaveBeenCalled();
	access.registerPolicy("kanban-test", {
		bindings: () => [
			{
				role: {
					name: "search",
					resource: "global",
					actions: ["kanban/search"],
				},
				resource: { kind: "global" },
			},
			{
				role: {
					name: "search",
					resource: "session",
					actions: ["kanban/search"],
				},
				// edge case: fixture IDs use DSH's branded string type
				resource: { kind: "session", id: "allowed" as SessionId },
			},
		],
	});
	expect(await gateway.invoke(call)).toEqual({ items: [], hasMore: false });
	expect(searchSessions.mock.calls[0][0].sessionFilters).toEqual([
		{ kind: "id", values: ["allowed"] },
	]);
	await expect(
		gateway.invoke({
			...call,
			args: { request: { query: " ", sessionIds: [] } },
		}),
	).rejects.toMatchObject({ code: "gateway/input-invalid" });
	await expect(
		gateway.invoke({
			...call,
			args: { request: { ...call.args.request, extra: true } },
		}),
	).rejects.toMatchObject({ code: "gateway/input-invalid" });
	await ctx.fiber.dispose();
});

test("the real Client Remote mounts the contract and sends the scoped wire request", async () => {
	const ctx = new Context();
	new TypertRegistry(ctx);
	const value = { items: [], hasMore: false };
	const call = vi.fn().mockResolvedValue({ ok: true, value });
	ctx.provide("connection", {
		interactions: "none",
		rpc: { call, open: () => {} },
	});
	clientGateway.apply(ctx);
	await ctx.remote.$mount(searchRemote);
	const request = { query: "phrase", sessionIds: ["board-session"] };
	expect(
		await ctx.remote.kanban.search(request, new AbortController().signal),
	).toEqual({ ok: true, value });
	expect(call).toHaveBeenCalledWith(
		"/api",
		"kanban/search",
		{ args: { request } },
		expect.any(AbortSignal),
	);
	await ctx.fiber.dispose();
});

test.each(["results", "revoked", "aborted"])(
	"preserves scoped paging and handles %s after the provider settles",
	async (outcome) => {
		const ctx = new Context();
		const controller = new AbortController();
		const allows = vi.fn(() => true);
		const pending =
			Promise.withResolvers<
				Awaited<ReturnType<SessionQueryEngine["searchSessions"]>>
			>();
		const searchSessions = vi
			.fn<SessionQueryEngine["searchSessions"]>()
			.mockReturnValue(pending.promise);
		ctx.provide("sessionQuery", { searchSessions });
		ctx.provide("remoteAccess", { allows });
		ctx.provide("typert", { register: vi.fn() });
		const search = new KanbanSearch(ctx);
		const request = searchRequestSchema.parse({
			query: "phrase",
			sessionIds: ["allowed"],
		});
		const result = search.search(request, controller.signal);
		if (outcome === "revoked") allows.mockReturnValue(false);
		if (outcome === "aborted") controller.abort();
		const hit: SessionSearchHit = {
			header: {
				id: request.sessionIds[0],
				version: 4,
				isSeeded: false,
				createdAt: 0,
			},
			live: true,
			persisted: false,
			bestMatch: {
				sessionId: request.sessionIds[0],
				// edge case: fixture sequence and cursor values use DSH's branded wire types
				seq: 0 as SessionSearchHit["bestMatch"]["seq"],
				type: "user/message",
				time: 0,
				surface: "current",
				snippet: "matched phrase",
			},
		};
		// edge case: fixture continuation values use DSH's branded cursor type
		pending.resolve({
			items: [hit],
			nextCursor: "more" as SessionSearchCursor,
		});
		if (outcome === "aborted") {
			await expect(result).rejects.toMatchObject({ name: "AbortError" });
		} else {
			expect(await result).toEqual({
				items:
					outcome === "revoked"
						? []
						: [{ sessionId: request.sessionIds[0], snippet: "matched phrase" }],
				hasMore: true,
			});
		}
		expect(searchSessions.mock.calls[0][1]).toEqual({
			signal: controller.signal,
		});
		await ctx.fiber.dispose();
	},
);
