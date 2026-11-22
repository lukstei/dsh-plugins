import {
	Button,
	CodeBlock,
	languageForPath,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { type ReactNode, useRef } from "react";
import styles from "./GitDiffPane.module.css";
import type { LazyFileResult } from "./useLazyFile.ts";
import { useSelectionQuote } from "./useSelectionQuote.ts";

export interface CodeQuotePayload {
	text: string;
	path: string;
	lines?: string;
}

export function CodeFileView({
	path,
	code,
	diff = false,
	wrapped,
	result,
	onRetry,
	extra,
	onQuote,
}: {
	path: string;
	code: string | null;
	diff?: boolean;
	wrapped: boolean;
	result: LazyFileResult<unknown>;
	onRetry: () => void;
	extra?: ReactNode;
	onQuote?: (quote: CodeQuotePayload) => void;
}): ReactNode {
	const containerRef = useRef<HTMLDivElement>(null);
	const { floatingQuote, clearFloatingQuote } = useSelectionQuote({
		containerRef,
		enabled: onQuote !== undefined,
	});

	if (result.status === "loading" || result.status === "idle") {
		return (
			<p className={styles.note} role="status">
				Loading file…
			</p>
		);
	}
	if (result.status === "failed") {
		return (
			<p className={styles.error} role="alert">
				{result.message}{" "}
				<Button size="sm" variant="ghost" onClick={onRetry}>
					Retry
				</Button>
			</p>
		);
	}
	if (code === null) return extra ?? null;

	const handleQuote = (e: React.SyntheticEvent) => {
		e.preventDefault();
		if (!floatingQuote || !onQuote) return;
		onQuote({
			text: floatingQuote.text,
			path,
			lines: floatingQuote.lines,
		});
		clearFloatingQuote();
	};

	return (
		<div ref={containerRef} className={styles.codeViewWrapper}>
			{floatingQuote !== null && onQuote !== undefined && (
				<div
					className={styles.floatingQuote}
					style={{
						top: `${floatingQuote.top}px`,
						left: `${floatingQuote.left}px`,
					}}
				>
					<button
						type="button"
						className={styles.floatingQuoteButton}
						onPointerDown={(e) => {
							e.preventDefault();
						}}
						onClick={handleQuote}
					>
						Quote
					</button>
				</div>
			)}
			{extra}
			<CodeBlock
				code={code}
				lang={languageForPath(path)}
				diff={diff}
				lineNumbers={true}
				wrap={wrapped}
				showHeader={false}
				copyLabel="Copy"
				copiedLabel="Copied!"
			/>
		</div>
	);
}
