import type { SessionId } from "@deepseek-ai/dsh-session/types";

/**
 * Purpose: Keep optional navigation scoped to one Kanban activation.
 * Contract:
 * - Inputs: Native workspace session navigation.
 * - Outputs: Observable membership and replaceable navigation actions.
 * - Throws / Errors: Navigation errors propagate.
 */
export function createNavigation(open: (id: SessionId) => void) {
	const empty: {
		sessionIds: readonly SessionId[];
		focusedSessionId: SessionId | undefined;
		maximizedSessionId: SessionId | undefined;
		suspended: boolean;
	} = {
		sessionIds: [],
		focusedSessionId: undefined,
		maximizedSessionId: undefined,
		suspended: false,
	};
	const base = {
		getSnapshot: () => empty,
		openSession: open,
		toggleSession: open,
		removeSession: (_id: SessionId) => {},
		startTask: open,
		toggleMaximize: (_id: SessionId) => {},
		setHoveredSession: (_id: SessionId | undefined) => {},
	};
	let current = base;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const toggleSession = (id: SessionId) => {
		const { maximizedSessionId } = current.getSnapshot();
		if (maximizedSessionId !== undefined && maximizedSessionId !== id) {
			current.toggleMaximize(maximizedSessionId);
		}
		current.toggleSession(id);
	};
	const startTask = (id: SessionId) => {
		current.startTask(id);
	};
	const focusSession = (id: SessionId) => {
		const snapshot = current.getSnapshot();
		if (snapshot.maximizedSessionId === id && !snapshot.suspended) return;
		if (snapshot.sessionIds.length > 0 && !snapshot.sessionIds.includes(id)) {
			toggleSession(id);
		} else {
			current.openSession(id);
		}
	};
	const maximizeSession = (id: SessionId) => {
		focusSession(id);
		const snapshot = current.getSnapshot();
		if (snapshot.sessionIds.length > 1 && snapshot.maximizedSessionId !== id) {
			current.toggleMaximize(id);
		}
	};
	return {
		getSnapshot: () => current.getSnapshot(),
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		openSession: (id: SessionId) => current.openSession(id),
		focusSession,
		maximizeSession,
		toggleSession,
		removeSession: (id: SessionId) => current.removeSession(id),
		setHoveredSession: (id: SessionId | undefined) =>
			current.setHoveredSession(id),
		startTask,
		toggleMaximize: (id: SessionId) => current.toggleMaximize(id),
		connect: (
			integration: typeof base,
			subscribe: (cb: () => void) => () => void,
		) => {
			current = integration;
			const off = subscribe(notify);
			notify();
			return () => {
				off();
				current = base;
				notify();
			};
		},
	};
}
