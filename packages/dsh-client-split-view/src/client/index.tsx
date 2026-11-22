/** Client plugin entrypoint for DSH Split View. */
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type { SessionTarget } from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-api-workspace-files/remote";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import {
	parseFileAddress,
	workspaceTitleOf,
} from "@deepseek-ai/dsh-util-workspace-path";
import "./contract.ts";
import "./dsh.d.ts";
import {
	SplitOverlayContent,
	type SplitOverlayServices,
	SplitPaneContent,
	SplitRestoreHeaderAction,
	SplitView,
} from "./SplitPane.tsx";
import { splitStore } from "./split-store.ts";
import { registerSplitStyles } from "./styles.ts";

export type { ISplitView, SplitOverlay, SplitState } from "./contract.ts";
export { SplitStore, splitStore } from "./split-store.ts";

export const name = "dsh-client-split-view";

export const inject = [
	"slots",
	"sessions",
	"uiWorkspace",
	"uiSession",
	"layout",
	"remote",
	"sidebarRight",
	"remote.workspaceFiles",
] as const;

export function apply(ctx: ClientContext): void {
	const sessions = ctx.sessions;

	const getActiveSessionId = (): SessionId | undefined => {
		if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) {
			return undefined;
		}
		const list = sessions.list.getSnapshot();
		return list.ids.find((id) => (list.byId[id]?.retainedBy.mainView ?? 0) > 0);
	};

	splitStore.setCallbacks(
		(id) => ctx.layout.selectPanel(id as never),
		(id) => ctx.uiWorkspace.openSession(id),
		() => ctx.sessions,
		getActiveSessionId,
	);

	ctx.provide("splitView", splitStore);

	// Services the pane overlay occupant needs from the plugin's Host-facing scope
	const cachedOverlayServices: SplitOverlayServices = {
		readFile: (sessionId, path, offset, signal) =>
			ctx.remote.workspaceFiles.read(sessionId, path, { offset }, signal),
		readBytes: (sessionId, path, signal) =>
			ctx.remote.workspaceFiles.readBytes(sessionId, path, {}, signal),
		openNativeResource: (address) => {
			ctx.sidebarRight.openResource(address);
		},
	};
	const overlayServices = (): SplitOverlayServices => cachedOverlayServices;

	// Register split main panel view, its pane content, and the pane overlay occupant.
	// Registration precedes hydration: a re-applied fiber restores a ready session
	// list synchronously, and selecting the panel before it exists throws.
	ctx.effect(() => {
		return ctx.slots.inject("main", () => {
			const unregisterMain = ctx.slots.register(
				{
					name: "main",
					key: "split-view",
					children: {
						"split.pane": { kind: "single", scope: "session" },
					},
				},
				SplitView,
			);
			const unregisterPane = ctx.slots.register(
				{
					name: "split.pane",
					children: {
						"split.overlay": { kind: "single", scope: "session" },
						"split.pane.status": { kind: "single", scope: "session" },
						"split.pane.header.actions": { kind: "list", scope: "session" },
						"split.subagent.status": { kind: "single", scope: "session" },
					},
				},
				SplitPaneContent,
			);
			const unregisterOverlay = ctx.slots.register(
				{
					name: "split.overlay",
					inject: overlayServices,
				},
				SplitOverlayContent,
			);
			return () => {
				unregisterOverlay();
				unregisterPane();
				unregisterMain();
			};
		});
	}, "split-view: main view");

	// Hydrate persisted split view state once session list becomes ready
	ctx.effect(() => {
		let hydrated = false;
		const attemptHydration = () => {
			if (hydrated) return;
			const snapshot = sessions.list.getSnapshot();
			if (snapshot.phase !== "ready") return;
			hydrated = true;
			splitStore.hydrate(ctx.sessions);
		};
		attemptHydration();
		return sessions.list.subscribe(attemptHydration);
	}, "split-view: hydrate on session readiness");

	ctx.effect(
		() => () => {
			splitStore.dispose();
		},
		"split-view: store lifecycle",
	);

	ctx.effect(
		() => registerSplitStyles(ctx, "dsh-client-split-view"),
		"split-view: styles",
	);

	// Route pane-originated navigation into pane overlays instead of the Sidebar
	ctx.effect(() => {
		const uiWorkspace = ctx.uiWorkspace;
		const sidebarRight = ctx.sidebarRight;
		const originalOpenSession = uiWorkspace.openSession;
		const originalStartSession = uiWorkspace.startSession;
		const originalOpenResource = sidebarRight.openResource;
		const splitHost = (): SessionId | undefined => {
			if (splitStore.isSuspended()) return undefined;
			const activePanelId = ctx.layout.panelInfo.getSnapshot().activePanelId;
			if (activePanelId !== "split-view") {
				return undefined;
			}
			const origin = splitStore.getPointerOrigin();
			if (origin === undefined) return undefined;
			return splitStore.getSnapshot().sessionIds.includes(origin)
				? origin
				: undefined;
		};

		uiWorkspace.openSession = (target: SessionTarget) => {
			const hostId = splitHost();
			if (hostId !== undefined) {
				const targetId =
					typeof target === "string" ? target : target.childSessionId;
				const title =
					sessions.list.getSnapshot().byId[targetId]?.displayTitle ||
					"Untitled Task";
				splitStore.openSessionOverlay(hostId, target, title, sessions);
				return;
			}
			originalOpenSession.call(uiWorkspace, target);
		};

		uiWorkspace.startSession = (
			workspaceId?: Parameters<typeof originalStartSession>[0],
			options?: Parameters<typeof originalStartSession>[1],
		) => {
			const activePanelId = ctx.layout.panelInfo.getSnapshot().activePanelId;
			if (activePanelId !== "split-view" || splitStore.isSuspended()) {
				originalStartSession.call(uiWorkspace, workspaceId, options);
				return;
			}
			void sessions
				.create({
					// edge case: nominal WorkspaceId brand differs across nested packages in node_modules
					...(workspaceId
						? {
								workspaceId: workspaceId as unknown as NonNullable<
									Parameters<typeof sessions.create>[0]
								>["workspaceId"],
							}
						: undefined),
					...options,
				})
				.then((newId) => {
					splitStore.toggleSession(newId);
				});
		};

		sidebarRight.openResource = (address, options) => {
			const hostId = splitHost();
			if (hostId !== undefined) {
				const parsed = parseFileAddress(address);
				if (parsed !== undefined) {
					const isAbsolute =
						parsed.scope === "absolute" ||
						parsed.path.startsWith("/") ||
						/^[A-Za-z]:[\\/]/.test(parsed.path);
					splitStore.openFileOverlay(hostId, {
						address,
						ownerSessionId:
							parsed.scope === "session" ? SessionId(parsed.sessionId) : hostId,
						path: parsed.path,
						title: workspaceTitleOf(parsed.path) || "File",
						fullPath: isAbsolute ? parsed.path : undefined,
					});
					return;
				}
			}
			originalOpenResource.call(sidebarRight, address, options);
		};

		// A pointer or focus interaction outside every pane ends the pane origin
		const forgetOrigin = (event: Event) => {
			const target = event.target;
			if (
				target instanceof Element &&
				(target.closest("[data-split-pane]") !== null ||
					target.closest(
						"[role='menu'], [role='dialog'], [data-radix-popper-content-wrapper]",
					) !== null)
			) {
				return;
			}
			splitStore.clearPointerOrigin();
		};
		if (typeof document !== "undefined") {
			document.addEventListener("pointerdown", forgetOrigin, true);
			document.addEventListener("focusin", forgetOrigin, true);
		}

		return () => {
			uiWorkspace.openSession = originalOpenSession;
			uiWorkspace.startSession = originalStartSession;
			sidebarRight.openResource = originalOpenResource;
			if (typeof document !== "undefined") {
				document.removeEventListener("pointerdown", forgetOrigin, true);
				document.removeEventListener("focusin", forgetOrigin, true);
			}
		};
	}, "split-view: navigation");

	// Register split main panel view, its pane content, and the pane overlay occupant
	ctx.effect(
		() =>
			ctx.slots.inject("conversation.session.header.utilities", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.utilities",
						id: "split-view-restore",
						order: 100,
					},
					SplitRestoreHeaderAction,
				),
			),
		"split-view: restore control",
	);
}
