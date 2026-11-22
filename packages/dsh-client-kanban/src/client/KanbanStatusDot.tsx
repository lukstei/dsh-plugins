import type { KanbanLane } from "../types.ts";

/**
 * Purpose: Paint the shared six-pixel session status indicator.
 * Contract:
 * - Inputs: A resolved lane or alert state; the caller owns its meaning and label.
 * - Outputs: A decorative dot using the shared status colors and animation.
 * - Throws / Errors: None.
 */
export function KanbanStatusDot({ state }: { state: KanbanLane | "alert" }) {
	return (
		<span className={`dsh-kanban-badge-dot is-${state}`} aria-hidden="true" />
	);
}
