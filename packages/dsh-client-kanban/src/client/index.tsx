/** Client plugin entrypoint for DSH Kanban. */
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceId } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { SEARCH_RESULT_LIMIT, searchRemote } from "../search.ts";
import type { KanbanPayload, KanbanRecord } from "../types.ts";
import "./dsh.d.ts";
import type {} from "@lukstei/dsh-client-favicon/client-contract";
import type {} from "@lukstei/dsh-client-notify/client-contract";
import { InFlightSidebar } from "./InFlightSidebar.tsx";
import { KanbanIcon } from "./KanbanIcon.tsx";
import { KanbanPane } from "./KanbanPane.tsx";
import { KanbanPaneStatus } from "./KanbanPaneStatus.tsx";
import { KanbanStatusDot } from "./KanbanStatusDot.tsx";
import { KanbanTransitionDropdown } from "./KanbanTransitionDropdown.tsx";
import { createNavigation } from "./navigation.ts";
import { sidebarModeStore } from "./sidebar-mode.ts";
import {
	deriveKanbanBoard,
	extractActiveSubagentParentIds,
	isSessionRelevantToSidebar,
	shouldSeedKanbanDraft,
} from "./store.ts";
import { registerKanbanStyles } from "./styles.ts";

export const inject = [
	"slots",
	"uiWorkspace",
	"sessions",
	"workspaces",
	"uiSession",
	"layout",
	"remote",
] as const;

async function sendKanbanCommand(
	session: { command: (line: string) => Promise<unknown> },
	payload: KanbanPayload,
): Promise<void> {
	await session.command(`/kanban ${JSON.stringify(payload)}`);
}

function clearMatchingSessionDraft(id: SessionId, prompt: string): void {
	if (typeof localStorage === "undefined") return;
	try {
		const key = `dsh.conversation.${id}`;
		const existing = localStorage.getItem(key);
		if (!existing) return;
		const parsed = JSON.parse(existing);
		if (parsed.draft === prompt) {
			localStorage.setItem(
				key,
				JSON.stringify({
					...parsed,
					draft: "",
				}),
			);
		}
	} catch {
		// ignore storage failures
	}
}

/**
 * Purpose: Mount scoped search and register Kanban UI views and session actions.
 * Contract:
 * - Inputs: Cordis client context providing remote, slots, uiWorkspace, sessions, workspaces, and layout services.
 * - Outputs: Promise resolving once the scoped Remote and Kanban UI are active.
 * - Throws / Errors: Fails fast if required services are missing.
 */
export async function apply(ctx: ClientContext): Promise<void> {
	await ctx.remote.$mount(searchRemote);
	await ctx
		.plugin({ inject: [...inject, "remote.kanban"], apply: applyKanban })
		.await();
}

function applyKanban(ctx: ClientContext): void {
	const pluginId = "dsh-client-kanban";
	ctx.provide("sidebarMode", sidebarModeStore);
	// Shared Context merges host SessionStore and client ISessions; narrow to client ISessions interface.
	const sessions = ctx.sessions as unknown as ISessions;
	const workspaces = ctx.workspaces;
	const uiSession = ctx.uiSession;
	const searchSessions = ctx.remote.kanban.search.bind(ctx.remote.kanban);

	// Register stylesheet with automatic cleanup on plugin disposal
	ctx.effect(() => registerKanbanStyles(ctx, pluginId), "kanban: styles");

	const getActiveSessionId = (): SessionId | undefined => {
		const listSnapshot = sessions.list.getSnapshot();
		return listSnapshot.ids.find(
			(id) => (listSnapshot.byId[id]?.retainedBy.mainView ?? 0) > 0,
		);
	};

	const navigation = createNavigation((id) => {
		void ctx.uiWorkspace.openSession(id);
	});

	// Reactive background projection hydration: hydrate sessions relevant to the in-flight sidebar
	ctx.effect(() => {
		const requested = new Set<SessionId>();

		const hydrateMissing = () => {
			const snapshot = sessions.list.getSnapshot();
			const activeId = getActiveSessionId();
			const splitSessionIds = navigation.getSnapshot().sessionIds;
			const sessionStatus = uiSession.sessionStatus.getSnapshot();

			const activeSubagentParentIds = extractActiveSubagentParentIds(
				snapshot.byId,
			);

			const context = {
				activeSessionId: activeId,
				splitSessionIds,
				sessionStatus,
				activeSubagentParentIds,
			};

			for (const id of snapshot.ids) {
				if (requested.has(id)) continue;
				const summary = snapshot.byId[id];
				if (!summary || summary.projectionValues?.kanban === undefined) {
					if (isSessionRelevantToSidebar(id, summary, context)) {
						requested.add(id);
						void sessions.refreshProjections(id).catch((err: unknown) => {
							console.warn(
								`[Kanban] Failed to hydrate projections for ${id}:`,
								err,
							);
						});
					}
				}
			}
		};

		hydrateMissing();
		const offSessions = sessions.list.subscribe(hydrateMissing);
		const offStatus = uiSession.sessionStatus.subscribe(hydrateMissing);
		const offNavigation = navigation.subscribe(hydrateMissing);
		return () => {
			offSessions();
			offStatus();
			offNavigation();
		};
	}, "kanban: hydrate projections");
	ctx.plugin({
		inject: ["splitView"],
		apply(splitCtx) {
			const split = splitCtx.splitView;
			splitCtx.effect(() => {
				split.setFallbackPanelId("kanban");
				const disconnect = navigation.connect(
					{
						getSnapshot: split.getSnapshot,
						openSession: split.openSession,
						toggleSession: split.toggleSession,
						removeSession: (id) => {
							if (split.getSnapshot().sessionIds.includes(id))
								split.removeSession(id);
						},
						startTask: (id) => {
							const active =
								splitCtx.layout.panelInfo.getSnapshot().activePanelId ===
									"split-view" &&
								!split.isSuspended() &&
								split.getSnapshot().sessionIds.length > 0;
							if (active) split.toggleSession(id);
							else split.openSession(id);
						},
						toggleMaximize: split.toggleMaximize,
						setHoveredSession: split.setHoveredSession,
					},
					split.subscribe,
				);
				return () => {
					disconnect();
					split.setFallbackPanelId(null);
				};
			}, "kanban: split navigation");
			splitCtx.effect(
				() =>
					splitCtx.slots.inject("split.pane.status", () =>
						splitCtx.slots.register(
							{
								name: "split.pane.status",
								inject: () => ({
									sessionsList: sessions.list,
									workspacesList: workspaces.list,
									sessionStatus: uiSession.sessionStatus,
								}),
							},
							KanbanPaneStatus,
						),
					),
				"kanban: split pane status",
			);

			splitCtx.effect(
				() =>
					splitCtx.slots.inject("split.subagent.status", () =>
						splitCtx.slots.register(
							{ name: "split.subagent.status" },
							KanbanStatusDot,
						),
					),
				"kanban: split subagent status",
			);
		},
	});

	// Factory for KanbanPane injected dependencies
	const createKanbanProps = (
		activeSessionId: SessionId | undefined,
		openSession: (id: SessionId) => void,
	) => ({
		sessionsList: sessions.list,
		workspacesList: workspaces.list,
		sessionStatus: uiSession.sessionStatus,
		currentSessionId: activeSessionId ?? getActiveSessionId(),
		searchSessions,
		searchResultLimit: SEARCH_RESULT_LIMIT,
		selectPanel: (id: string | null) => ctx.layout.selectPanel(id as never),
		refreshProjections: (id: SessionId) => sessions.refreshProjections(id),
		startTask: async (workspaceId?: WorkspaceId) => {
			const newId = await sessions.create(
				workspaceId ? { workspaceId } : undefined,
			);
			await sessions.using(newId, { source: "kanban" }, async (reference) => {
				await sendKanbanCommand(reference.binding.session, {
					action: "init",
					createdAt: Date.now(),
				});
			});
			navigation.startTask(newId);
		},
		prepareTask: async (prompt: string, workspaceId?: WorkspaceId) => {
			const trimmedPrompt = prompt.trim();
			const firstLine = trimmedPrompt.split("\n")[0].trim();
			const newId = await sessions.create(
				workspaceId ? { workspaceId } : undefined,
			);
			await sessions.using(newId, { source: "kanban" }, async (reference) => {
				if (firstLine) {
					await reference.binding.session.rename(firstLine);
				}
				await sendKanbanCommand(reference.binding.session, {
					action: "init",
					createdAt: Date.now(),
					...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
				});
			});
			if (typeof localStorage !== "undefined" && trimmedPrompt) {
				try {
					localStorage.setItem(
						`dsh.conversation.${newId}`,
						JSON.stringify({
							draft: trimmedPrompt,
							view: null,
							viewRequest: null,
						}),
					);
				} catch {
					// ignore storage failures
				}
			}
			await sessions.refreshProjections(newId);
			await sessions.refresh();
		},
		startPreparedTask: async (id: SessionId, prompt: string) => {
			const trimmed = prompt.trim();
			if (trimmed) {
				clearMatchingSessionDraft(id, trimmed);
				await sessions.using(id, { source: "kanban" }, async (reference) => {
					await reference.binding.session.prompt(
						[{ type: "text", text: trimmed }],
						"queue",
					);
				});
			}
		},
		selectSession: (id: SessionId) => {
			if (typeof localStorage !== "undefined") {
				try {
					const summary = sessions.list.getSnapshot().byId[id];
					const record = summary?.projectionValues?.kanban as
						| KanbanRecord
						| undefined;
					const isRunning = Boolean(
						summary?.running ||
							uiSession.sessionStatus.getSnapshot().get(id)?.running,
					);
					const key = `dsh.conversation.${id}`;
					const existing = localStorage.getItem(key);

					if (shouldSeedKanbanDraft(summary, record, isRunning)) {
						let shouldSeed = !existing;
						if (existing) {
							try {
								const parsed = JSON.parse(existing);
								if (!parsed.draft) shouldSeed = true;
							} catch {
								shouldSeed = true;
							}
						}
						if (shouldSeed) {
							localStorage.setItem(
								key,
								JSON.stringify({
									draft: record?.prompt,
									view: null,
									viewRequest: null,
								}),
							);
						}
					} else if (isRunning && record?.prompt) {
						// edge case: clear draft when running to remove unsubmitted draft leftover from prepareTask
						clearMatchingSessionDraft(id, record.prompt);
					}
				} catch {
					// ignore storage failures
				}
			}
			openSession(id);
		},
		markDone: async (id: SessionId) => {
			await sessions.using(id, { source: "kanban" }, async (reference) => {
				await sendKanbanCommand(reference.binding.session, {
					action: "done",
					doneAt: Date.now(),
				});
			});
			navigation.removeSession(id);
		},
		reopen: async (id: SessionId) => {
			await sessions.using(id, { source: "kanban" }, async (reference) => {
				await sendKanbanCommand(reference.binding.session, {
					action: "reopen",
					reopenedAt: Date.now(),
				});
			});
			await sessions.refreshProjections(id);
			await sessions.refresh();
		},
		deleteSession: async (id: SessionId) => {
			await sessions.using(id, { source: "kanban" }, async (reference) => {
				await sendKanbanCommand(reference.binding.session, {
					action: "delete",
					deletedAt: Date.now(),
				});
			});
			navigation.removeSession(id);
		},
		holdSession: async (id: SessionId) => {
			await sessions.using(id, { source: "kanban" }, async (reference) => {
				await sendKanbanCommand(reference.binding.session, {
					action: "hold",
					heldAt: Date.now(),
				});
			});
			await sessions.refreshProjections(id);
			await sessions.refresh();
		},
		unholdSession: async (id: SessionId) => {
			await sessions.using(id, { source: "kanban" }, async (reference) => {
				await sendKanbanCommand(reference.binding.session, {
					action: "unhold",
					unheldAt: Date.now(),
				});
			});
			await sessions.refreshProjections(id);
			await sessions.refresh();
		},
		pinSession: async (id: SessionId) => {
			await sessions.using(id, { source: "kanban" }, async (reference) => {
				await sendKanbanCommand(reference.binding.session, {
					action: "pin",
					pinnedAt: Date.now(),
				});
			});
			await sessions.refreshProjections(id);
			await sessions.refresh();
		},
		unpinSession: async (id: SessionId) => {
			await sessions.using(id, { source: "kanban" }, async (reference) => {
				await sendKanbanCommand(reference.binding.session, {
					action: "unpin",
					unpinnedAt: Date.now(),
				});
			});
			await sessions.refreshProjections(id);
			await sessions.refresh();
		},
		navigation,
	});

	// Register global main panel view (root-scoped, session-independent)
	ctx.effect(() => {
		return ctx.slots.inject("main", () =>
			ctx.slots.register(
				{
					name: "main",
					key: "kanban",
					inject: () =>
						createKanbanProps(undefined, navigation.maximizeSession),
				},
				KanbanPane,
			),
		);
	}, "kanban: main view");

	// Register Kanban transition dropdown in prompt bar tools
	ctx.effect(() => {
		const kanbanActions = createKanbanProps(undefined, navigation.openSession);
		return ctx.slots.inject("conversation.input.left", () =>
			ctx.slots.register(
				{
					name: "conversation.input.left",
					id: "kanban.transition-dropdown",
					order: 90,
					inject: () => ({
						holdSession: kanbanActions.holdSession,
						unholdSession: kanbanActions.unholdSession,
						markDone: kanbanActions.markDone,
						reopen: kanbanActions.reopen,
						startPreparedTask: kanbanActions.startPreparedTask,
					}),
				},
				KanbanTransitionDropdown,
			),
		);
	}, "kanban: input transition dropdown");

	// Register global top sidebar icon: shown when Kanban bar is closed, hidden when open
	ctx.effect(() => {
		let unregisterPanelIcon: (() => void) | null = null;

		const syncPanelIcon = () => {
			const mode = sidebarModeStore.getSnapshot();
			if (mode !== "kanban") {
				if (!unregisterPanelIcon) {
					unregisterPanelIcon = ctx.slots.register(
						{
							name: "sidebar.panellist",
							id: "kanban",
							order: 20,
							label: () => "Kanban",
						},
						KanbanIcon,
					);
				}
			} else {
				if (unregisterPanelIcon) {
					unregisterPanelIcon();
					unregisterPanelIcon = null;
				}
			}
		};

		syncPanelIcon();
		const unsubscribe = sidebarModeStore.subscribe(syncPanelIcon);

		return () => {
			unsubscribe();
			if (unregisterPanelIcon) {
				unregisterPanelIcon();
				unregisterPanelIcon = null;
			}
		};
	}, "kanban: sidebar icon");

	// Sync main panel selection to sidebar mode: opening kanban main panel opens kanban sidebar
	ctx.effect(() => {
		const syncPanelSelection = () => {
			const info = ctx.layout.panelInfo.getSnapshot();
			if (info.activePanelId === "kanban") {
				sidebarModeStore.setMode("kanban");
			}
		};
		syncPanelSelection();
		return ctx.layout.panelInfo.subscribe(syncPanelSelection);
	}, "kanban: sync layout to sidebar mode");

	// Reactive sidebar view mode switcher: shadows sidebar.workspaces only when in "kanban" mode
	ctx.effect(() => {
		let unregisterSidebar: (() => void) | null = null;

		const syncSidebarRegistration = () => {
			const mode = sidebarModeStore.getSnapshot();
			if (mode === "kanban") {
				if (!unregisterSidebar) {
					unregisterSidebar = ctx.slots.register(
						{
							name: "sidebar.workspaces",
							priority: -10,
							inject: () =>
								createKanbanProps(undefined, navigation.focusSession),
						},
						InFlightSidebar,
					);
				}
			} else {
				if (unregisterSidebar) {
					unregisterSidebar();
					unregisterSidebar = null;
				}
			}
		};

		// Initial sync
		syncSidebarRegistration();

		// Listen to mode changes
		const unsubscribe = sidebarModeStore.subscribe(syncSidebarRegistration);

		return () => {
			unsubscribe();
			if (unregisterSidebar) {
				unregisterSidebar();
				unregisterSidebar = null;
			}
		};
	}, "kanban: sidebar mode controller");

	// Suppress generic command cards for /kanban commands
	ctx.effect(
		() =>
			ctx.slots.inject("conversation.chat.commandview", () =>
				ctx.slots.register(
					{
						name: "conversation.chat.commandview",
						key: "kanban",
					},
					() => null,
				),
			),
		"kanban: commandview",
	);

	ctx.plugin({
		inject: ["faviconBadge"],
		apply(badgeCtx) {
			badgeCtx.effect(() => {
				const update = () => {
					const board = deriveKanbanBoard(
						sessions.list.getSnapshot(),
						workspaces.list.getSnapshot().items,
						uiSession.sessionStatus.getSnapshot(),
					);
					badgeCtx.faviconBadge.setBadge({
						reviewCount: board.totalCounts.inReview,
					});
				};
				update();
				const offList = sessions.list.subscribe(update);
				const offStatus = uiSession.sessionStatus.subscribe(update);
				const offWorkspaces = workspaces.list.subscribe(update);
				return () => {
					offList();
					offStatus();
					offWorkspaces();
					badgeCtx.faviconBadge.setBadge({ reviewCount: 0 });
				};
			}, "kanban: favicon review count");
		},
	});

	ctx.plugin({
		inject: ["appBadge"],
		apply(badgeCtx) {
			badgeCtx.effect(() => {
				const update = () => {
					const board = deriveKanbanBoard(
						sessions.list.getSnapshot(),
						workspaces.list.getSnapshot().items,
						uiSession.sessionStatus.getSnapshot(),
					);
					badgeCtx.appBadge.setRecentReviewCount(
						board.totalCounts.recentInReview,
					);
				};
				update();
				const offList = sessions.list.subscribe(update);
				const offStatus = uiSession.sessionStatus.subscribe(update);
				const offWorkspaces = workspaces.list.subscribe(update);
				// edge case: sessions age out of the recent window without any store event.
				const timer = setInterval(update, 60_000);
				return () => {
					clearInterval(timer);
					offList();
					offStatus();
					offWorkspaces();
					badgeCtx.appBadge.setRecentReviewCount(0);
				};
			}, "kanban: app badge recent review count");
		},
	});
}
