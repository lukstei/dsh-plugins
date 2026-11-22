import {
	IconBranchOutlineRegular,
	IconCheckOutlineRegular,
	IconCopyOutlineRegular,
	useClipboardCopy,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import css, { cssText } from "./GitDiffPane.module.css";

/** One presented Git review: its branch, its commit line, and the open action. */
export interface ReviewCardProps {
	/** Branch name. */
	title: string;
	/** Commit line, or the branch's commit range label. */
	description: string;
	onOpen?: () => void;
}

/**
 * Render one review card in the transcript's turn tail.
 * @param props - branch, commit line, and optional open action.
 * @returns the card row.
 */
export function ReviewCard({
	title,
	description,
	onOpen,
}: ReviewCardProps): ReactNode {
	const { copied, onCopy } = useClipboardCopy(title);

	const handleCardClick = () => {
		if (onOpen !== undefined) {
			onOpen();
		}
	};

	const handleCardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (onOpen !== undefined && (e.key === "Enter" || e.key === " ")) {
			e.preventDefault();
			onOpen();
		}
	};

	const handleCopyClick = (e: MouseEvent) => {
		e.stopPropagation();
		const selection = window.getSelection()?.toString();
		if (selection && selection.length > 0) {
			return;
		}
		onCopy();
	};

	const handleCopyKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			e.stopPropagation();
			onCopy();
		}
	};

	return (
		<div
			className={css.reviewCard}
			data-review-card
			data-clickable={onOpen !== undefined ? "true" : undefined}
			onClick={onOpen !== undefined ? handleCardClick : undefined}
			onKeyDown={onOpen !== undefined ? handleCardKeyDown : undefined}
			tabIndex={onOpen !== undefined ? 0 : undefined}
			role={onOpen !== undefined ? "button" : undefined}
		>
			<style>{cssText}</style>
			<span className={css.reviewIcon} aria-hidden>
				<IconBranchOutlineRegular size={20} />
			</span>
			<div className={css.reviewDetails}>
				<div className={css.reviewTitle}>
					{/* biome-ignore lint/a11y/useSemanticElements: Clickable text preserves text selection of branch name */}
					<span
						className={css.reviewBranchCopy}
						data-branch-copy
						data-copied={copied ? "true" : undefined}
						title={
							copied
								? "Copied branch name"
								: `Click to copy branch name: ${title}`
						}
						onClick={handleCopyClick}
						onKeyDown={handleCopyKeyDown}
						tabIndex={0}
						role="button"
						aria-label={
							copied ? "Copied branch name" : `Copy branch name: ${title}`
						}
					>
						<span className={css.reviewBranchName}>{title}</span>
						<span className={css.reviewCopyIcon} aria-hidden>
							{copied ? (
								<IconCheckOutlineRegular size={13} />
							) : (
								<IconCopyOutlineRegular size={13} />
							)}
						</span>
						{copied && <span className={css.reviewCopyFeedback}>Copied!</span>}
					</span>
				</div>
				<span className={css.reviewDescription} title={description}>
					{description}
				</span>
			</div>
		</div>
	);
}
