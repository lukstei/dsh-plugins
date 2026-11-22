/**
 * Purpose: Publish the reusable Split View contract and Cordis augmentations.
 * Contract:
 * - Types and interfaces for split view state, overlays, and service.
 */
import type {
	SessionReference,
	SessionTarget,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SlotFactoryMap } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";

type FactoryProps<F extends keyof SlotFactoryMap & string> =
	SlotFactoryMap[F] extends { props: infer P extends object } ? P : object;

type FactoryOverlay = {
	[F in keyof SlotFactoryMap & string]: {
		readonly kind: "slot";
		readonly slotName: F;
		readonly title: string;
		readonly props: FactoryProps<F>;
	};
}[keyof SlotFactoryMap & string];

export type SplitOverlay =
	| {
			readonly kind: "session";
			readonly target: SessionTarget;
			readonly title: string;
			readonly reference: SessionReference;
	  }
	| FactoryOverlay
	| {
			readonly kind: "file";
			readonly address: string;
			readonly ownerSessionId: SessionId;
			readonly path: string;
			readonly title: string;
			readonly fullPath?: string;
			/** Complete text of a text/markdown file; set only once every page has loaded. */
			readonly contents?: string;
	  };

export interface SplitState {
	readonly sessionIds: readonly SessionId[];
	readonly focusedSessionId: SessionId | undefined;
	readonly maximizedSessionId: SessionId | undefined;
	/** Pane highlighted because its sidebar row is hovered; transient, never persisted. */
	readonly hoveredSessionId: SessionId | undefined;
	readonly suspended: boolean;
	readonly overlays: ReadonlyMap<SessionId, SplitOverlay>;
}

export interface ISplitView {
	setFallbackPanelId(id: string | null): void;
	openSlotOverlay<F extends keyof SlotFactoryMap & string>(
		hostId: SessionId,
		slotName: F,
		title: string,
		props: NoInfer<FactoryProps<F>>,
	): void;
	closeOverlay(hostId: SessionId): void;
	readonly getSnapshot: () => SplitState;
	readonly subscribe: (listener: () => void) => () => void;
	readonly isSuspended: () => boolean;
	readonly isSplitActive: () => boolean;
	readonly toggleSession: (targetId: SessionId) => void;
	readonly openSession: (targetId: SessionId) => void;
	readonly removeSession: (targetId: SessionId) => void;
	readonly resetToSingle: () => void;
	readonly suspend: (targetId: SessionId) => void;
	readonly resume: () => void;
	readonly setFocus: (id: SessionId) => void;
	readonly toggleMaximize: (sessionId: SessionId) => void;
	readonly setHoveredSession: (targetId: SessionId | undefined) => void;
	readonly reorderSession: (sourceId: SessionId, targetId: SessionId) => void;
}

declare module "@deepseek-ai/cordis" {
	interface Context {
		splitView: ISplitView;
	}
}

declare module "@deepseek-ai/dsh-api-session-controller/client" {
	interface SessionReferenceSourceMap {
		splitView: unknown;
	}
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface SlotMap {
		"split.pane": { kind: "single"; scope: "session" };
		"split.pane.header.actions": { kind: "list"; scope: "session" };
		"split.pane.status": {
			kind: "single";
			scope: "session";
		};
		"split.subagent.status": {
			kind: "single";
			scope: "session";
			owner: { state: "active" | "review" };
		};
		"split.overlay": {
			kind: "single";
			scope: "session";
			owner: {
				hostSessionId: SessionId;
			};
		};
	}
}
