import { Context } from "@deepseek-ai/cordis";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionStatus } from "@deepseek-ai/dsh-client-ui-session/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { afterEach, expect, test, vi } from "vitest";
import { renderFaviconBadgeUri } from "../src/client/favicon.ts";
import * as plugin from "../src/client/index.tsx";

afterEach(() => vi.unstubAllGlobals());

test.each([true, false])(
	"standalone status and icon lifecycle, existing icon: %s",
	async (existing) => {
		const ctx = new Context();
		const links: {
			href: string;
			rel: string;
			type: string;
			getAttribute: () => string;
			setAttribute: (key: string, value: string) => void;
			remove: () => void;
		}[] = [];
		const makeLink = () => {
			const link = {
				href: "original.ico",
				rel: "shortcut icon",
				type: "image/png",
				getAttribute: () => "original.ico",
				setAttribute: (_key: string, value: string) => {
					link.href = value;
				},
				remove: () => {
					links.splice(links.indexOf(link), 1);
				},
			};
			return link;
		};
		if (existing) links.push(makeLink());
		vi.stubGlobal("document", {
			querySelectorAll: () => [...links],
			createElement: makeLink,
			head: {
				appendChild: (link: ReturnType<typeof makeLink>) => links.push(link),
			},
		});
		// edge case: test IDs stand in for server-issued branded IDs.
		const parent = "parent" as SessionId;
		const child = "child" as SessionId;
		const summaries: SessionSummary[] = [parent, child].map((id) => ({
			id,
			displayTitle: id,
			running: true,
			blank: false,
			updatedAt: 1,
			retainedBy: {},
		}));
		const statuses = new Map<SessionId, SessionStatus>();
		const listListeners = new Set<() => void>();
		const statusListeners = new Set<() => void>();
		ctx.provide("sessions", {
			list: {
				getSnapshot: () => ({
					ids: summaries.map((s) => s.id),
					byId: Object.fromEntries(summaries.map((s) => [s.id, s])),
				}),
				subscribe: (cb: () => void) => {
					listListeners.add(cb);
					return () => listListeners.delete(cb);
				},
			},
		});
		ctx.provide("uiSession", {
			sessionStatus: {
				getSnapshot: () => statuses,
				subscribe: (cb: () => void) => {
					statusListeners.add(cb);
					return () => statusListeners.delete(cb);
				},
			},
		});
		const emit = () => {
			for (const cb of statusListeners) cb();
		};
		const fiber = ctx.plugin(plugin);
		await fiber.await();
		expect(links).toHaveLength(1);
		expect(links[0].href).toBe(
			renderFaviconBadgeUri({ review: 0, running: 2 }),
		);
		ctx.faviconBadge.setBadge({ reviewCount: 3 });
		expect(links[0].href).toBe(
			renderFaviconBadgeUri({ review: 3, running: 2 }),
		);
		for (const kind of ["permission", "question"]) {
			statuses.set(child, {
				running: false,
				pendingInteraction: { key: kind, kind, sessionId: child },
				completionUnread: false,
			});
			emit();
			expect(links[0].href).toBe(
				renderFaviconBadgeUri({ review: 3, running: 1, alert: 1 }),
			);
		}
		// A child appears in both platform sources: count each identity only once.
		statuses.set(parent, {
			running: true,
			pendingInteraction: undefined,
			completionUnread: false,
		});
		emit();
		expect(links[0].href).toBe(
			renderFaviconBadgeUri({ review: 3, running: 1, alert: 1 }),
		);
		for (const id of [parent, child])
			statuses.set(id, {
				running: false,
				pendingInteraction: undefined,
				completionUnread: false,
			});
		ctx.faviconBadge.setBadge({ reviewCount: 0 });
		expect(links).toHaveLength(existing ? 1 : 0);
		if (existing)
			expect(links[0]).toMatchObject({
				href: "original.ico",
				rel: "shortcut icon",
				type: "image/png",
			});
		statuses.set(parent, {
			running: true,
			pendingInteraction: undefined,
			completionUnread: false,
		});
		emit();
		expect(links).toHaveLength(1);
		await fiber.dispose();
		expect(links).toHaveLength(existing ? 1 : 0);
		expect(listListeners.size + statusListeners.size).toBe(0);
		const again = ctx.plugin(plugin);
		await again.await();
		expect(links).toHaveLength(1);
		await again.dispose();
		expect(links).toHaveLength(existing ? 1 : 0);
	},
);
