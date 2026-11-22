import type { InputActions } from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
	Button,
	IconNewChatOutlineRegular,
	Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { TypertRemoteNamespace } from "@deepseek-ai/dsh-typert-protocol";
import {
	CodeFileView,
	type CodeQuotePayload,
} from "@lukstei/util-review-ui/client/CodeFileView.tsx";
import { createUnifiedDiff } from "@lukstei/util-review-ui/client/diff.ts";
import { FileList } from "@lukstei/util-review-ui/client/FileList.tsx";
import { FileReview } from "@lukstei/util-review-ui/client/FileReview.tsx";
import styles from "@lukstei/util-review-ui/client/GitDiffPane.module.css";
import { quoteToComposer } from "@lukstei/util-review-ui/client/quote.ts";
import { useLazyFile } from "@lukstei/util-review-ui/client/useLazyFile.ts";
import type { GitDiffView, GitFileDiff } from "@lukstei/util-review-ui/types";
import { type ReactNode, useCallback, useMemo } from "react";

export function FileInspector(props: {
	view: GitDiffView;
	revision: number;
	api: TypertRemoteNamespace<"workspaceReview">;
	sessionId: string;
	inputActions?: Pick<
		InputActions,
		"insertQuote" | "insertText" | "captureInsertion" | "persistDraft"
	>;
	isExpanded?: (path: string) => boolean;
	onToggleExpanded?: (path: string, expanded: boolean) => void;
	initialScrollTop?: number;
	onScroll?: (scrollTop: number) => void;
	wrapped: boolean;
	toggleWrap: () => void;
}): ReactNode {
	const { wrapped, toggleWrap } = props;

	const onQuote = useCallback(
		(quote: CodeQuotePayload) => {
			quoteToComposer(quote, props.inputActions);
		},
		[props.inputActions],
	);

	return (
		<FileList
			label="Changed file list"
			files={props.view.diffs.map((file) => ({ kind: "diff", ...file }))}
			isExpanded={props.isExpanded}
			onToggleExpanded={props.onToggleExpanded}
			initialScrollTop={props.initialScrollTop}
			onScroll={props.onScroll}
			renderFile={(file, heading, expanded, contentId) => {
				if (file.kind !== "diff")
					throw new Error("Git files require diff metadata");
				return (
					<GitFile
						{...props}
						file={file}
						heading={heading}
						contentId={contentId}
						expanded={expanded}
						wrapped={wrapped}
						toggleWrap={toggleWrap}
						onQuote={onQuote}
					/>
				);
			}}
		/>
	);
}

function GitFile({
	view,
	revision,
	api,
	sessionId,
	file,
	heading,
	contentId,
	expanded,
	wrapped,
	toggleWrap,
	onQuote,
}: Parameters<typeof FileInspector>[0] & {
	file: GitFileDiff;
	heading: ReactNode;
	contentId: string;
	expanded: boolean;
	wrapped: boolean;
	toggleWrap: () => void;
	onQuote: (quote: CodeQuotePayload) => void;
}) {
	const load = useCallback(
		(signal: AbortSignal) => {
			void revision;
			return api.file(sessionId, view.snapshot, file.path, signal);
		},
		[api, sessionId, view.snapshot, file.path, revision],
	);
	const { result, retry } = useLazyFile(load, expanded);
	const contents = result.value;

	const patch = useMemo(() => {
		if (contents === null || contents.kind !== "text") return null;
		return createUnifiedDiff(file.path, contents.before, contents.after);
	}, [contents, file.path]);

	return (
		<>
			<FileReview
				heading={heading}
				expanded={expanded}
				wrapped={wrapped}
				toggleWrap={toggleWrap}
				actions={
					<Tooltip label="Quote diff to chat" portal>
						<Button
							size="sm"
							variant="ghost"
							aria-label={`Quote diff ${file.path}`}
							onClick={() => {
								if (patch !== null) {
									onQuote({ text: patch, path: file.path });
								} else {
									onQuote({ text: file.path, path: file.path });
								}
							}}
							icon={<IconNewChatOutlineRegular className={styles.icon} />}
						/>
					</Tooltip>
				}
			/>
			<section
				id={contentId}
				className={styles.fileBody}
				aria-label={`File diff ${file.path}`}
				hidden={!expanded}
			>
				{expanded && (
					<CodeFileView
						path={file.path}
						code={patch}
						diff={true}
						wrapped={wrapped}
						result={result}
						onRetry={retry}
						onQuote={onQuote}
						extra={
							contents !== null && contents.kind === "unavailable" ? (
								<p className={styles.note}>
									{file.path}: {contents.message}
								</p>
							) : null
						}
					/>
				)}
			</section>
		</>
	);
}
