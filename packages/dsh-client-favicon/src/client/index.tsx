import type { Context } from "@deepseek-ai/cordis";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "./contract.ts";
import { renderFaviconBadgeUri } from "./favicon.ts";

export const inject = ["sessions", "uiSession"] as const;

export function apply(ctx: Context): void {
	// edge case: shared Context merges host and client session services.
	const sessions = ctx.sessions as unknown as ISessions;
	const originals = [
		...document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"),
	].map((link) => ({
		link,
		href: link.getAttribute("href"),
	}));
	let created: HTMLLinkElement | null = null;
	let reviewCount = 0;
	const restore = () => {
		for (const { link, href } of originals) {
			if (href === null) link.removeAttribute("href");
			else link.setAttribute("href", href);
		}
		if (created !== null) {
			created.remove();
			created = null;
		}
	};
	const update = () => {
		const list = sessions.list.getSnapshot();
		const statuses = ctx.uiSession.sessionStatus.getSnapshot();
		const ids = new Set([...list.ids, ...statuses.keys()]);
		let running = 0;
		let alerts = 0;
		for (const id of ids) {
			const status = statuses.get(id);
			const summary = list.byId[id];
			if (status !== undefined && status.pendingInteraction !== undefined)
				alerts++;
			const isRunning =
				status !== undefined && status.running !== undefined
					? status.running
					: summary !== undefined && summary.running;
			if (isRunning) running++;
		}
		if (running === 0 && alerts === 0 && reviewCount === 0) {
			restore();
			return;
		}
		const uri = renderFaviconBadgeUri({
			running,
			review: reviewCount,
			alert: alerts,
		});
		if (originals.length > 0) {
			for (const { link } of originals) link.href = uri;
		} else {
			if (created === null) {
				created = document.createElement("link");
				created.rel = "icon";
				created.type = "image/svg+xml";
				document.head.appendChild(created);
			}
			created.href = uri;
		}
	};
	ctx.provide("faviconBadge", {
		setBadge: (badge) => {
			reviewCount = badge.reviewCount;
			update();
		},
	});
	ctx.effect(() => {
		update();
		const offList = sessions.list.subscribe(update);
		const offStatus = ctx.uiSession.sessionStatus.subscribe(update);
		return () => {
			offList();
			offStatus();
			restore();
		};
	}, "favicon: status badges");
}
