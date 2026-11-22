import type { Context } from "@deepseek-ai/cordis";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {} from "@lukstei/dsh-client-split-view/client-contract";
import { launchedSessionId } from "../launch.ts";

export const inject = ["sessions", "splitView"];

/**
 * Open every session the Host reports as launched as a pane of its own. A slash
 * command cannot reach the client, so the Host publishes the new id in the
 * command's own `command/done` record and this plugin reads that durable window
 * back.
 *
 * The pane is added through the split store, not `uiWorkspace.openSession`: the
 * split view patches that method into a read-only overlay, whose embedded
 * transcript has no composer of its own, so the prompts would keep landing in
 * the session of the pane underneath.
 */
export function apply(ctx: Context): void {
	// Shared Context merges the Host SessionStore with the Client ISessions, so the
	// client object layer is named explicitly.
	const sessions = ctx.sessions as unknown as ISessions;
	const off = new Map<SessionId, () => void>();

	const watch = (id: SessionId): void => {
		const binding = sessions.binding(id);
		if (binding === undefined) return;
		const unsubscribe = binding.eventSource.subscribe(() => {
			const { change } = binding.eventSource.getSnapshot();
			// edge case: `replace` replays the whole window on first open and again
			// after every reconnect gap, so it would re-open panes the user closed;
			// the split view already restores its own panes from local storage.
			if (change.kind !== "append") return;
			for (const entry of change.entries) {
				if (entry.type !== "event") continue;
				const launched = launchedSessionId(entry.event);
				if (launched === undefined) continue;
				ctx.splitView.toggleSession(launched);
				return;
			}
		});
		off.set(id, unsubscribe);
	};

	const sync = (): void => {
		for (const id of sessions.list.getSnapshot().ids) {
			if (off.has(id)) continue;
			watch(id);
		}
		for (const [id, unsubscribe] of off) {
			if (sessions.binding(id) !== undefined) continue;
			unsubscribe();
			off.delete(id);
		}
	};

	const dispose = sessions.list.subscribe(sync);
	sync();
	ctx.effect(
		() => () => {
			dispose();
			for (const unsubscribe of off.values()) unsubscribe();
			off.clear();
		},
		"session-handoff: launch watcher",
	);
}
