import type { Context } from "@deepseek-ai/cordis";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-client-ui-commands/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-model-selection/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {} from "@lukstei/dsh-client-split-view/client-contract";
import type {} from "@zaimokuza/dsh-acp-adapter/remote";
import { launchedSessionId } from "../launch.ts";
import { CONFIG_GLOBAL, type LimitsConfig } from "../limits.ts";
import { type AcpUsageReader, setAcpUsageReader } from "./acp-usage.ts";
import { HandoffRing } from "./ring.ts";

export const inject = [
	"sessions",
	"splitView",
	"slots",
	"commandUi",
	"modelDirectories",
];

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

	// Same effect as the Kanban Done button: record done.
	const markDone = async (id: SessionId): Promise<void> => {
		await sessions.using(id, { source: "splitView" }, async (reference) => {
			await reference.binding.session.command(
				`/kanban ${JSON.stringify({ action: "done", doneAt: Date.now() })}`,
			);
		});
	};

	// Same command the user would type; sent directly so the composer draft stays untouched.
	const run = async (id: SessionId, line: string): Promise<void> => {
		await sessions.using(id, { source: "splitView" }, async (reference) => {
			const result = await reference.binding.session.command(line);
			if (!result.ok) {
				console.warn(`session-handoff: ${line} failed`, result);
			}
		});
	};
	// Safe: the Host validated this value against its Config schema before injecting it.
	const config = (globalThis as unknown as Record<string, LimitsConfig>)[
		CONFIG_GLOBAL
	];
	const loadRoute = async (
		id: SessionId,
	): Promise<{ provider: string; model: string } | undefined> => {
		const { current } = await ctx.modelDirectories.directoryFor(id).load();
		return current === null ? undefined : current;
	};
	const handoff = (id: SessionId): Promise<void> => run(id, "/handoff");

	// A bare composer `/handoff` opens the same model list as `/model`; the pick is
	// submitted back as the argued line the Host command parses (the ring sends the bare line straight to the Host, which keeps the source model).
	ctx.effect(
		() =>
			ctx.commandUi.decorate({
				name: "handoff",
				available: () => true,
				ui: {
					kind: "popupSelect",
					searchMode: "fuzzy-label",
					options: async (session) => {
						const state = await ctx.modelDirectories
							.directoryFor(session.sessionId)
							.load();
						return state.groups.flatMap((group) =>
							group.models.map((model) => ({
								id: `${group.id}/${model.id}`,
								label: model.name,
								group: { name: group.id, label: group.name },
								...(state.current !== null &&
								state.current.provider === group.id &&
								state.current.model === model.id
									? { active: true }
									: {}),
							})),
						);
					},
					onSelect: (option, session) =>
						run(session.sessionId, `/handoff ${option.id}`),
				},
			}),
		"session-handoff: /handoff picker",
	);

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
				ctx.splitView.replaceSession(id, launched);
				void markDone(id);
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

	ctx.effect(
		() =>
			ctx.slots.inject("conversation.input.right", () =>
				ctx.slots.register(
					{
						name: "conversation.input.right",
						id: "session-handoff.ring",
						order: 1000,
						inject: () => ({ onHandoff: handoff, loadRoute, config }),
					},
					HandoffRing,
				),
			),
		"session-handoff: handoff ring",
	);

	// Optional: the ACP adapter's remote exists only while that plugin is mounted. Outside this
	// scope the reader stays unset and the ring falls back to the DSH `contextPressure`.
	// `remote` is requested alongside, as the adapter's own client does for its namespace.
	ctx.inject(["remote", "remote.dshAcp"], (acpCtx) => {
		const remote = acpCtx.remote.dshAcp;
		const reader: AcpUsageReader = async (id) => {
			const result = await remote.agentSessionSnapshot(id);
			if (!result.ok) {
				console.warn("session-handoff: ACP usage unavailable", result);
				return undefined;
			}
			const usage = result.value.contextUsage;
			return usage === null ? undefined : usage;
		};
		setAcpUsageReader(reader);
		return () => setAcpUsageReader(undefined);
	});

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
