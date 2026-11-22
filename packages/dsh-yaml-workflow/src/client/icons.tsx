/**
 * PURPOSE: Shared SVG icon primitives for workflow runner UI components.
 * ALLOWED: Pure SVG rendering.
 * FORBIDDEN: State, network, styles.
 */

import type React from "react";

export function CopyIcon(): React.JSX.Element {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</svg>
	);
}

export function CheckIcon(): React.JSX.Element {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<polyline points="20 6 9 17 4 12" />
		</svg>
	);
}

/**
 * Purpose: Renders a 12x12 play polygon icon for the workflow resume button.
 * Contract:
 * - Inputs: None.
 * - Outputs: React JSX SVG element.
 * - Throws: None.
 */
export function ResumePlayIcon(): React.JSX.Element {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<polygon points="6 4 20 12 6 20 6 4" />
		</svg>
	);
}

/**
 * Purpose: Renders a 12x12 cross icon for the workflow discard button.
 * Contract:
 * - Inputs: None.
 * - Outputs: React JSX SVG element.
 * - Throws: None.
 */
export function DiscardIcon(): React.JSX.Element {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}
