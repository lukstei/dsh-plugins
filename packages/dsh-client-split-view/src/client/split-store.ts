/**
 * Purpose: Manage state, references, and toggle logic for concurrent equal-width vertical session splits.
 * Contract:
 * - Inputs: Session IDs, ISessions controller, layout/workspace navigation callbacks.
 * - Outputs: Observable SplitState with per-pane overlays and the suspended native view.
 * - Errors: Throws immediately on missing services.
 */
import type {
	ISessions,
	SessionReference,
	SessionTarget,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ISplitView, SplitOverlay, SplitState } from "./contract.ts";

export type { SplitOverlay, SplitState } from "./contract.ts";

export const SPLIT_VIEW_STORAGE_KEY = "dsh-client-split-view:state:v1";

export const isMobileViewport = (): boolean => {
	if (typeof window === "undefined") return false;
	return window.innerWidth < 768;
};

type PersistedOverlay =
	| (Extract<SplitOverlay, { kind: "slot" }> & { readonly hostId: string })
	| {
			readonly hostId: string;
			readonly kind: "file";
			readonly file: Omit<Extract<SplitOverlay, { kind: "file" }>, "kind">;
	  }
	| {
			readonly hostId: string;
			readonly kind: "session";
			readonly session: {
				readonly target: SessionTarget;
				readonly title: string;
			};
	  };

interface PersistedSplitState {
	version: 1;
	sessionIds: string[];
	focusedSessionId?: string;
	maximizedSessionId?: string;
	suspended: boolean;
	overlays: PersistedOverlay[];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	const ancestors = new Set<object>();
	const isJson = (entry: unknown): boolean => {
		if (
			entry === null ||
			typeof entry === "string" ||
			typeof entry === "boolean"
		)
			return true;
		if (typeof entry === "number") return Number.isFinite(entry);
		if (typeof entry !== "object" || ancestors.has(entry)) return false;
		if (
			!Array.isArray(entry) &&
			Object.getPrototypeOf(entry) !== Object.prototype
		)
			return false;
		ancestors.add(entry);
		const valid = Object.values(entry).every(isJson);
		ancestors.delete(entry);
		return valid;
	};
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		isJson(value)
	);
}

export class SplitStore implements ISplitView {
	private sessionIds: SessionId[] = [];
	private focusedSessionId: SessionId | undefined;
	private maximizedSessionId: SessionId | undefined;
	private hoveredSessionId: SessionId | undefined;
	private suspended = false;
	private fallbackPanelId: string | null = null;
	private overlays = new Map<SessionId, SplitOverlay>();
	private pointerOrigin: SessionId | undefined;
	private readonly references = new Map<SessionId, SessionReference>();
	private readonly listeners = new Set<() => void>();
	private sessionsProvider?: () => ISessions;
	private activeSessionProvider?: () => SessionId | undefined;
	private navCallbacks?: {
		selectPanel: (id: string | null) => void;
		openSession: (id: SessionId) => void;
	};
	private snapshot: SplitState = {
		sessionIds: [],
		focusedSessionId: undefined,
		maximizedSessionId: undefined,
		hoveredSessionId: undefined,
		suspended: false,
		overlays: new Map(),
	};

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): SplitState => {
		return this.snapshot;
	};

	getReference = (id: SessionId): SessionReference | undefined => {
		return this.references.get(id);
	};

	getOverlay = (id: SessionId): SplitOverlay | undefined => {
		return this.overlays.get(id);
	};

	isSuspended = (): boolean => {
		return this.suspended;
	};

	isSplitActive = (): boolean => {
		return this.sessionIds.length > 0 && !this.suspended;
	};

	private persist = (): void => {
		if (typeof localStorage === "undefined") return;
		try {
			if (this.sessionIds.length >= 1) {
				const overlays: PersistedOverlay[] = [];
				for (const [hostId, overlay] of this.overlays) {
					if (overlay.kind === "slot") {
						overlays.push({ hostId, ...overlay });
					} else if (overlay.kind === "file") {
						overlays.push({
							hostId,
							kind: "file",
							file: {
								address: overlay.address,
								ownerSessionId: overlay.ownerSessionId,
								path: overlay.path,
								title: overlay.title,
							},
						});
					} else if (overlay.kind === "session") {
						overlays.push({
							hostId,
							kind: "session",
							session: {
								target: overlay.target,
								title: overlay.title,
							},
						});
					}
				}
				const state: PersistedSplitState = {
					version: 1,
					sessionIds: [...this.sessionIds],
					focusedSessionId: this.focusedSessionId,
					maximizedSessionId: this.maximizedSessionId,
					suspended: this.suspended,
					overlays,
				};
				localStorage.setItem(SPLIT_VIEW_STORAGE_KEY, JSON.stringify(state));
			} else if (!this.suspended) {
				localStorage.removeItem(SPLIT_VIEW_STORAGE_KEY);
			}
		} catch {
			// defensive storage isolation: ignore quota/security errors
		}
	};

	hydrate = (sessions: ISessions): void => {
		if (typeof localStorage === "undefined") return;
		try {
			const raw = localStorage.getItem(SPLIT_VIEW_STORAGE_KEY);
			if (raw === null) return;
			const data = JSON.parse(raw) as Partial<PersistedSplitState>;
			if (data.version !== 1 || !Array.isArray(data.sessionIds)) return;

			const snapshot = sessions.list.getSnapshot();
			if (snapshot.phase !== "ready") return;

			const existingIds = new Set<string>(snapshot.ids);
			const validIds = data.sessionIds.filter(
				(id): id is SessionId => typeof id === "string" && existingIds.has(id),
			);

			if (validIds.length < 1) {
				localStorage.removeItem(SPLIT_VIEW_STORAGE_KEY);
				return;
			}

			for (const ref of this.references.values()) {
				ref.release();
			}
			this.references.clear();
			for (const hostId of [...this.overlays.keys()]) {
				this.releaseOverlay(hostId);
			}

			const focusedId =
				typeof data.focusedSessionId === "string" &&
				validIds.includes(data.focusedSessionId as SessionId)
					? (data.focusedSessionId as SessionId)
					: validIds[0];
			const isMobile = isMobileViewport();
			const targetIds = isMobile ? [focusedId] : validIds;

			for (const id of targetIds) {
				this.retain(id, sessions);
			}
			this.sessionIds = targetIds;
			this.focusedSessionId = focusedId;
			this.maximizedSessionId =
				!isMobile &&
				targetIds.length > 1 &&
				typeof data.maximizedSessionId === "string" &&
				targetIds.includes(data.maximizedSessionId as SessionId)
					? (data.maximizedSessionId as SessionId)
					: undefined;
			this.suspended = Boolean(data.suspended);

			if (Array.isArray(data.overlays)) {
				for (const overlay of data.overlays) {
					if (
						!overlay ||
						typeof overlay.hostId !== "string" ||
						!targetIds.includes(overlay.hostId as SessionId)
					) {
						continue;
					}
					const hostId = overlay.hostId as SessionId;
					if (overlay.kind === "slot") {
						if (
							typeof overlay.slotName !== "string" ||
							typeof overlay.title !== "string" ||
							!isJsonObject(overlay.props)
						)
							continue;
						const { hostId: _hostId, ...state } = overlay;
						this.overlays.set(hostId, state);
					} else if (overlay.kind === "file") {
						this.overlays.set(hostId, {
							kind: "file",
							address: overlay.file.address,
							ownerSessionId: overlay.file.ownerSessionId,
							path: overlay.file.path,
							title: overlay.file.title,
						});
					} else if (overlay.kind === "session") {
						const target = overlay.session.target;
						const targetId =
							typeof target === "string" ? target : target.childSessionId;
						if (existingIds.has(targetId)) {
							const reference = sessions.retain(target, {
								source: "splitView",
							});
							this.overlays.set(hostId, {
								kind: "session",
								target,
								title: overlay.session.title,
								reference,
							});
						}
					}
				}
			}

			this.emit();
			if (!this.suspended && this.navCallbacks !== undefined) {
				this.navCallbacks.selectPanel("split-view");
			}
		} catch (error) {
			// storage isolation: an unreadable snapshot must not break activation
			console.warn("[split-view] hydrate failed", error);
		}
	};

	private publish = (): void => {
		this.snapshot = {
			sessionIds: [...this.sessionIds],
			focusedSessionId: this.focusedSessionId,
			maximizedSessionId: this.maximizedSessionId,
			hoveredSessionId: this.hoveredSessionId,
			suspended: this.suspended,
			overlays: new Map(this.overlays),
		};
		for (const listener of this.listeners) {
			listener();
		}
	};

	private emit = (): void => {
		this.publish();
		this.persist();
	};

	setCallbacks = (
		selectPanel: (id: string | null) => void,
		openSession: (id: SessionId) => void,
		sessionsProvider: () => ISessions,
		activeSessionProvider: () => SessionId | undefined,
	): void => {
		this.navCallbacks = { selectPanel, openSession };
		this.sessionsProvider = sessionsProvider;
		this.activeSessionProvider = activeSessionProvider;
	};

	/** Remember which pane a pointer interaction originated from. */
	setPointerOrigin = (id: SessionId): void => {
		this.pointerOrigin = id;
	};

	/** Forget the pane origin after a pointer interaction outside every pane. */
	clearPointerOrigin = (): void => {
		this.pointerOrigin = undefined;
	};

	getPointerOrigin = (): SessionId | undefined => {
		return this.pointerOrigin;
	};

	/**
	 * Toggle session into or out of split view.
	 */
	toggleSession = (targetId: SessionId): void => {
		if (this.sessionsProvider === undefined) {
			throw new Error("SplitStore: ISessions provider not configured");
		}
		const effectiveSessions = this.sessionsProvider();
		const effectiveActiveId =
			this.activeSessionProvider !== undefined
				? this.activeSessionProvider()
				: undefined;

		if (isMobileViewport()) {
			this.openSession(targetId);
			return;
		}

		const isPresent = this.sessionIds.includes(targetId);

		if (isPresent) {
			this.removeSession(targetId);
			return;
		}

		// Add targetId
		if (this.sessionIds.length === 0) {
			if (effectiveActiveId !== undefined && effectiveActiveId !== targetId) {
				this.retain(effectiveActiveId, effectiveSessions);
				this.sessionIds.push(effectiveActiveId);
			}
		}

		this.retain(targetId, effectiveSessions);
		this.sessionIds.push(targetId);
		this.focusedSessionId = targetId;
		this.suspended = false;
		this.maximizedSessionId = undefined;

		this.emit();
		if (this.navCallbacks !== undefined) {
			this.navCallbacks.selectPanel("split-view");
		}
	};

	/**
	 * Open a single session in the non-native view, or focus it if already in split.
	 */
	openSession = (targetId: SessionId): void => {
		if (this.sessionsProvider === undefined) {
			throw new Error("SplitStore: ISessions provider not configured");
		}
		const effectiveSessions = this.sessionsProvider();
		const mobile = isMobileViewport();

		const needsReset = mobile
			? this.sessionIds.length !== 1 || this.sessionIds[0] !== targetId
			: !this.sessionIds.includes(targetId);

		if (needsReset) {
			for (const ref of this.references.values()) {
				ref.release();
			}
			this.references.clear();
			for (const hostId of [...this.overlays.keys()]) {
				this.releaseOverlay(hostId);
			}

			this.retain(targetId, effectiveSessions);
			this.sessionIds = [targetId];
		}

		this.focusedSessionId = targetId;
		this.maximizedSessionId = undefined;
		this.suspended = false;

		this.emit();
		if (this.navCallbacks !== undefined) {
			this.navCallbacks.selectPanel("split-view");
		}
	};

	/**
	 * Remove a single session from split view (e.g. from pane header close button).
	 */
	removeSession = (targetId: SessionId): void => {
		if (!this.sessionIds.includes(targetId)) return;
		this.release(targetId);
		this.closeOverlay(targetId);
		this.sessionIds = this.sessionIds.filter((id) => id !== targetId);
		if (this.hoveredSessionId === targetId) {
			this.hoveredSessionId = undefined;
		}
		if (this.maximizedSessionId === targetId || this.sessionIds.length <= 1) {
			this.maximizedSessionId = undefined;
		}

		if (this.sessionIds.length === 0) {
			this.reset();
			if (this.navCallbacks !== undefined) {
				this.navCallbacks.selectPanel(this.fallbackPanelId);
			}
			return;
		}

		if (this.focusedSessionId === targetId) {
			this.focusedSessionId = this.sessionIds[this.sessionIds.length - 1];
		}
		this.emit();
	};

	/**
	 * Replace a single session in split view with another session in-place.
	 */
	replaceSession = (oldId: SessionId, newId: SessionId): void => {
		if (this.sessionsProvider === undefined) {
			throw new Error("SplitStore: ISessions provider not configured");
		}
		if (isMobileViewport()) {
			this.openSession(newId);
			return;
		}
		if (oldId === newId) {
			if (this.sessionIds.includes(newId)) {
				this.setFocus(newId);
			}
			return;
		}
		const index = this.sessionIds.indexOf(oldId);
		if (index === -1) {
			if (this.sessionIds.includes(newId)) {
				this.setFocus(newId);
			} else {
				this.toggleSession(newId);
			}
			return;
		}

		const effectiveSessions = this.sessionsProvider();
		this.retain(newId, effectiveSessions);
		this.release(oldId);
		this.releaseOverlay(oldId);

		const next = [...this.sessionIds];
		const existingNewIndex = next.indexOf(newId);
		if (existingNewIndex !== -1) {
			next.splice(existingNewIndex, 1);
			const targetIndex = next.indexOf(oldId);
			next[targetIndex] = newId;
		} else {
			next[index] = newId;
		}
		this.sessionIds = next;

		if (this.hoveredSessionId === oldId) {
			this.hoveredSessionId = undefined;
		}
		if (this.maximizedSessionId === oldId) {
			this.maximizedSessionId = newId;
		}
		if (this.sessionIds.length <= 1) {
			this.maximizedSessionId = undefined;
		}
		this.focusedSessionId = newId;
		this.suspended = false;

		this.emit();
		if (this.navCallbacks !== undefined) {
			this.navCallbacks.selectPanel("split-view");
		}
	};

	/**
	 * Show one pane's session in the native Conversation view while keeping the split.
	 */
	suspend = (targetId: SessionId): void => {
		if (this.sessionIds.length < 1) return;
		this.suspended = true;
		this.emit();
		if (this.navCallbacks !== undefined) {
			this.navCallbacks.openSession(targetId);
			this.navCallbacks.selectPanel(null);
		}
	};

	/** Return from the native Conversation view to the retained split. */
	resume = (): void => {
		if (!this.suspended) return;
		this.suspended = false;
		this.emit();
		if (this.navCallbacks !== undefined) {
			this.navCallbacks.selectPanel("split-view");
		}
	};

	/** Layer another Session over one pane, releasing any previous overlay. */
	openSessionOverlay = (
		hostId: SessionId,
		target: SessionTarget,
		title: string,
		sessions?: ISessions,
	): void => {
		let effectiveSessions = sessions;
		if (effectiveSessions === undefined) {
			if (this.sessionsProvider === undefined) {
				throw new Error("SplitStore: ISessions provider not configured");
			}
			effectiveSessions = this.sessionsProvider();
		}
		this.releaseOverlay(hostId);
		this.overlays.set(hostId, {
			kind: "session",
			target,
			title,
			reference: effectiveSessions.retain(target, { source: "splitView" }),
		});
		this.emit();
	};

	setFallbackPanelId = (id: string | null): void => {
		this.fallbackPanelId = id;
	};

	/** Layer a registered factory over one pane. */
	openSlotOverlay: ISplitView["openSlotOverlay"] = (
		hostId,
		slotName,
		title,
		props,
	) => {
		if (!isJsonObject(props))
			throw new TypeError("Split overlay props must be a JSON object");
		this.releaseOverlay(hostId);
		// edge case: TypeScript cannot preserve a generic key/props pair when constructing the mapped union.
		const overlay = { kind: "slot", slotName, title, props } as Extract<
			SplitOverlay,
			{ kind: "slot" }
		>;
		this.overlays.set(hostId, overlay);
		this.emit();
	};

	/** Layer one addressed file over one pane. */
	openFileOverlay = (
		hostId: SessionId,
		file: {
			address: string;
			ownerSessionId: SessionId;
			path: string;
			title: string;
			fullPath?: string;
		},
	): void => {
		this.releaseOverlay(hostId);
		this.overlays.set(hostId, { kind: "file", ...file });
		this.emit();
	};

	/** Update resolved full path for a file overlay. */
	updateFileOverlayFullPath = (
		hostId: SessionId,
		address: string,
		fullPath: string,
	): void => {
		const current = this.overlays.get(hostId);
		if (
			current === undefined ||
			current.kind !== "file" ||
			current.address !== address
		) {
			return;
		}

		if (current.fullPath !== fullPath) {
			this.overlays.set(hostId, { ...current, fullPath });
			this.emit();
		}
	};

	/** Publish the fully loaded text of a file overlay for the pane's copy action. */
	updateFileOverlayContents = (
		hostId: SessionId,
		address: string,
		contents: string,
	): void => {
		const current = this.overlays.get(hostId);
		if (
			current === undefined ||
			current.kind !== "file" ||
			current.address !== address ||
			current.contents === contents
		) {
			return;
		}
		this.overlays.set(hostId, { ...current, contents });
		this.emit();
	};

	closeOverlay = (hostId: SessionId): void => {
		if (!this.overlays.has(hostId)) return;
		this.releaseOverlay(hostId);
		this.emit();
	};

	/**
	 * Normal single click: reset split mode and switch back to single view.
	 */
	resetToSingle = (): void => {
		if (this.sessionIds.length > 0 || this.suspended) {
			this.reset();
			if (this.navCallbacks !== undefined) {
				this.navCallbacks.selectPanel(null);
			}
		}
	};

	/**
	 * Toggle maximizing one pane to take all space in the split screen.
	 */
	toggleMaximize = (targetId: SessionId): void => {
		if (
			isMobileViewport() ||
			!this.sessionIds.includes(targetId) ||
			this.sessionIds.length <= 1
		)
			return;
		this.maximizedSessionId =
			this.maximizedSessionId === targetId ? undefined : targetId;
		this.setFocus(targetId);
		this.emit();
	};

	/**
	 * Reorder a session tab to the position of targetId.
	 */
	reorderSession = (sourceId: SessionId, targetId: SessionId): void => {
		if (sourceId === targetId) return;
		const sourceIndex = this.sessionIds.indexOf(sourceId);
		const targetIndex = this.sessionIds.indexOf(targetId);
		if (sourceIndex === -1 || targetIndex === -1) return;
		const next = [...this.sessionIds];
		next.splice(sourceIndex, 1);
		next.splice(targetIndex, 0, sourceId);
		this.sessionIds = next;
		this.emit();
	};

	setFocus = (id: SessionId): void => {
		if (this.focusedSessionId !== id && this.sessionIds.includes(id)) {
			this.focusedSessionId = id;
			this.emit();
		}
	};

	/**
	 * Highlight one pane because its sidebar row is hovered; never persisted.
	 */
	setHoveredSession = (targetId: SessionId | undefined): void => {
		const next =
			targetId !== undefined && this.sessionIds.includes(targetId)
				? targetId
				: undefined;
		if (this.hoveredSessionId === next) return;
		this.hoveredSessionId = next;
		this.publish();
	};

	private retain = (id: SessionId, sessions: ISessions): void => {
		if (!this.references.has(id)) {
			const ref = sessions.retain(id, { source: "splitView" });
			this.references.set(id, ref);
		}
	};

	private release = (id: SessionId): void => {
		const ref = this.references.get(id);
		if (ref !== undefined) {
			ref.release();
			this.references.delete(id);
		}
	};

	private releaseOverlay = (hostId: SessionId): void => {
		const overlay = this.overlays.get(hostId);
		this.overlays.delete(hostId);
		if (overlay !== undefined && overlay.kind === "session") {
			overlay.reference.release();
		}
	};

	/** In-memory teardown releasing references without deleting persisted state. */
	dispose = (): void => {
		for (const ref of this.references.values()) {
			ref.release();
		}
		this.references.clear();
		for (const hostId of [...this.overlays.keys()]) {
			this.releaseOverlay(hostId);
		}
		this.sessionIds = [];
		this.focusedSessionId = undefined;
		this.maximizedSessionId = undefined;
		this.suspended = false;
		this.pointerOrigin = undefined;
		this.snapshot = {
			sessionIds: [],
			focusedSessionId: undefined,
			maximizedSessionId: undefined,
			hoveredSessionId: undefined,
			suspended: false,
			overlays: new Map(),
		};
		for (const listener of this.listeners) {
			listener();
		}
	};

	private reset = (): void => {
		this.dispose();
		try {
			if (typeof localStorage !== "undefined") {
				localStorage.removeItem(SPLIT_VIEW_STORAGE_KEY);
			}
		} catch {
			// ignore
		}
	};
}

export const splitStore = new SplitStore();
