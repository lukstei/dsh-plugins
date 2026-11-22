/** Reactive store managing sidebar view mode between native Workspaces and In-Flight Kanban. */

export type SidebarViewMode = "workspaces" | "kanban";

const STORAGE_KEY = "dsh-sidebar-view-mode";

export class SidebarModeStore {
	private mode: SidebarViewMode;
	private readonly listeners = new Set<() => void>();

	constructor() {
		try {
			const stored =
				typeof localStorage !== "undefined"
					? localStorage.getItem(STORAGE_KEY)
					: null;
			this.mode = stored === "kanban" ? "kanban" : "workspaces";
		} catch {
			this.mode = "workspaces";
		}
	}

	/**
	 * Purpose: Read current sidebar view mode snapshot.
	 * Contract:
	 * - Inputs: None.
	 * - Outputs: Current SidebarViewMode ('workspaces' or 'kanban').
	 * - Throws / Errors: Never throws.
	 */
	getSnapshot = (): SidebarViewMode => {
		return this.mode;
	};

	/**
	 * Purpose: Switch sidebar view mode and notify subscribers.
	 * Contract:
	 * - Inputs: New SidebarViewMode.
	 * - Outputs: void.
	 * - Throws / Errors: Never throws.
	 */
	setMode = (nextMode: SidebarViewMode): void => {
		if (this.mode === nextMode) return;
		this.mode = nextMode;
		try {
			if (typeof localStorage !== "undefined") {
				localStorage.setItem(STORAGE_KEY, nextMode);
			}
		} catch {
			// ignore storage errors
		}
		for (const listener of this.listeners) {
			listener();
		}
	};

	/**
	 * Purpose: Subscribe to sidebar view mode changes.
	 * Contract:
	 * - Inputs: Callback listener function.
	 * - Outputs: Unsubscribe function.
	 * - Throws / Errors: Never throws.
	 */
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
}

export const sidebarModeStore = new SidebarModeStore();
