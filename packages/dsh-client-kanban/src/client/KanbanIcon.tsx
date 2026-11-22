/** Navigation and toolbar icon for Kanban. */
export interface KanbanIconProps {
	size?: number;
	strokeWidth?: number;
}

export function KanbanIcon({ size = 18, strokeWidth = 1 }: KanbanIconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<line x1="9" y1="3" x2="9" y2="21" />
			<line x1="15" y1="3" x2="15" y2="21" />
		</svg>
	);
}
