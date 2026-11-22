import {
	Button,
	IconWrapLinesOutlineRegular,
	Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import styles from "./GitDiffPane.module.css";

export function FileReview({
	heading,
	actions,
	expanded,
	wrapped,
	toggleWrap,
}: {
	heading: ReactNode;
	actions: ReactNode;
	expanded: boolean;
	wrapped: boolean;
	toggleWrap: () => void;
}) {
	return (
		<div className={styles.fileHeading} data-expanded={expanded}>
			<div className={styles.fileToolbar}>
				{heading}
				{expanded && (
					<div className={styles.commentActions}>
						{actions}
						<Tooltip label="Wrap lines" side="bottom" align="end" portal>
							<Button
								size="sm"
								className={styles.fileAction}
								variant={wrapped ? "toolbar" : "ghost"}
								aria-label="Wrap lines"
								aria-pressed={wrapped}
								icon={<IconWrapLinesOutlineRegular className={styles.icon} />}
								onClick={toggleWrap}
							/>
						</Tooltip>
					</div>
				)}
			</div>
		</div>
	);
}
