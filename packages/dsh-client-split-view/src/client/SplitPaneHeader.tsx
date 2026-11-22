import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { HTMLAttributes, ReactNode } from "react";

/** Presentational pane chrome shared by the live session controller and Ladle. */
export function SplitPaneHeader({
	focused,
	status,
	workspaceTitle,
	ancestry,
	displayTitle,
	children,
	actions,
	...events
}: Pick<
	HTMLAttributes<HTMLElement>,
	"draggable" | "onDragStart" | "onDragEnd" | "onDoubleClick"
> & {
	focused: boolean;
	status: ReactNode;
	workspaceTitle: string | undefined;
	ancestry: readonly {
		id: SessionId;
		displayTitle: string;
		subagent: boolean;
	}[];
	displayTitle: string;
	children: ReactNode;
	actions: ReactNode;
}) {
	return (
		<header
			{...events}
			className={`dsh-split-pane-header ${focused ? "is-focused" : ""}`}
		>
			<span className="dsh-split-pane-status">{status}</span>
			<div className="dsh-split-header-left">
				<nav className="dsh-split-crumbs" aria-label="Session hierarchy">
					{workspaceTitle !== undefined && (
						<span className="dsh-split-crumb-seg is-workspace">
							<span
								className="dsh-split-crumb is-workspace"
								title={workspaceTitle}
							>
								{workspaceTitle}
							</span>
							<span className="dsh-split-crumb-sep" aria-hidden="true">
								/
							</span>
						</span>
					)}
					{ancestry.map((summary, index) => {
						const isLast = index === ancestry.length - 1;
						const crumbTitle = summary.subagent
							? `Subagent: ${summary.displayTitle}`
							: summary.displayTitle;
						return (
							<span key={summary.id} className="dsh-split-crumb-seg">
								{index > 0 && <span className="dsh-split-crumb-sep">/</span>}
								<span
									className={`dsh-split-crumb ${isLast ? "is-current" : "is-parent"} ${summary.subagent ? "is-subagent" : ""}`}
									title={crumbTitle}
								>
									{crumbTitle}
								</span>
							</span>
						);
					})}
					{ancestry.length === 0 && (
						<span className="dsh-split-crumb is-current" title={displayTitle}>
							{displayTitle}
						</span>
					)}
				</nav>
				<div className="dsh-split-header-actions">{actions}</div>
			</div>
			{children}
		</header>
	);
}
