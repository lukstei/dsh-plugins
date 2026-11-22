import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import { useState } from "react";
import type { KanbanRecord } from "../types.ts";

/**
 * Purpose: Show collected session links in a shared icon-triggered popover.
 * Contract:
 * - Inputs: Validated projected links sorted by priority and collection order for ties.
 * - Outputs: An accessible link menu, hidden for an empty collection.
 * - Throws / Errors: Browser navigation errors propagate.
 */
export function SessionLinks({
	links,
}: {
	readonly links: KanbanRecord["links"];
}) {
	const [open, setOpen] = useState(false);
	return (
		links.length > 0 && (
			<Menu
				open={open}
				portal
				compact
				align="end"
				className="dsh-session-links"
				listClassName="dsh-session-links-menu"
				onClose={() => setOpen(false)}
				onSelect={(url) => {
					window.open(url, "_blank", "noopener,noreferrer");
					setOpen(false);
				}}
				items={links.map((link) => ({
					id: link.url,
					label: <span className="dsh-session-link">{link.label}</span>,
				}))}
				anchor={
					<button
						type="button"
						className="dsh-inflight-btn-action dsh-session-links-trigger"
						aria-label={`Session links (${links.length})`}
						title="Session links"
						aria-haspopup="menu"
						aria-expanded={open}
						onClick={(event) => {
							event.stopPropagation();
							setOpen(!open);
						}}
						onDragStart={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
							<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
						</svg>
					</button>
				}
			/>
		)
	);
}
