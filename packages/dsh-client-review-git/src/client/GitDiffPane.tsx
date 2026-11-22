import type { ScopeStandardProps } from "@deepseek-ai/dsh-client-ui-slots";
import type { TypertRemoteNamespace } from "@deepseek-ai/dsh-typert-protocol";
import styles, {
	cssText,
} from "@lukstei/util-review-ui/client/GitDiffPane.module.css";
import type {
	BranchReviewScope,
	ReviewSelection,
} from "@lukstei/util-review-ui/types";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import type {} from "../../lib/typert.remote-client.js";
import { FileInspector } from "./FileInspector.tsx";
import { ReviewToolbar } from "./ReviewToolbar.tsx";
import { resolveReviewBaseline } from "./reviewSelection.ts";
import { useLoad } from "./useLoad.ts";
import { useReviewViewState } from "./useReviewViewState.ts";

type Api = TypertRemoteNamespace<"workspaceReview">;

export function GitDiffPane(
	props: Pick<ScopeStandardProps<"session">, "sessionId"> &
		Partial<Pick<ScopeStandardProps<"session">, "inputActions">> & {
			api: Api;
			scope?: BranchReviewScope;
		},
): ReactNode {
	return <ReviewPane key={props.sessionId} {...props} />;
}

function ReviewPane({
	sessionId,
	api,
	inputActions,
	scope: initialScope,
}: Parameters<typeof GitDiffPane>[0]) {
	const [revision, setRevision] = useState(0);
	const reviewState = useReviewViewState(sessionId, initialScope);
	const {
		selectedRepoCwd,
		setSelectedRepoCwd,
		scope,
		setScope: select,
	} = reviewState;

	const load = useCallback(
		(signal: AbortSignal) => {
			// smell: loader identity carries refresh invalidation when request arguments stay unchanged.
			void revision;
			return api.catalog(sessionId, signal);
		},
		[api, sessionId, revision],
	);
	const catalogResult = useLoad(load);
	const [previousCatalog, setPreviousCatalog] = useState<Extract<
		typeof catalogResult,
		{ status: "ready" }
	> | null>(null);
	useEffect(() => {
		if (catalogResult.status === "ready") setPreviousCatalog(catalogResult);
	}, [catalogResult]);
	const catalog =
		catalogResult.status === "ready" || previousCatalog === null
			? catalogResult
			: previousCatalog;
	const activeRepository =
		catalog.status === "ready" && catalog.value.kind === "git"
			? (catalog.value.repositories.find((r) => r.cwd === selectedRepoCwd) ??
				catalog.value.repository)
			: null;
	const onSelectRepository = (cwd: string) => {
		setSelectedRepoCwd(cwd);
		if (scope !== null) {
			select(null);
		}
	};
	const base = resolveReviewBaseline(
		scope,
		catalog.status === "ready" ? catalog.value : null,
	);
	const selection = useMemo<ReviewSelection | null>(
		() =>
			scope === null || scope.kind !== "branch" ? scope : { ...scope, base },
		[scope, base],
	);
	const refresh = () => setRevision((value) => value + 1);

	return (
		<div className={styles.root}>
			<style>{cssText}</style>
			<ReviewToolbar
				catalog={catalog.status === "ready" ? catalog.value : null}
				activeRepository={activeRepository}
				onSelectRepository={onSelectRepository}
				selection={scope}
				base={base}
				revision={revision}
				select={select}
				api={api}
				sessionId={sessionId}
				refresh={refresh}
			/>
			<div className={styles.body}>
				{catalogResult.status === "failed" && previousCatalog !== null && (
					<p className={styles.error} role="alert">
						{catalogResult.message}
					</p>
				)}
				{catalog.status === "loading" ? (
					<p className={styles.note} role="status">
						Loading repository…
					</p>
				) : catalog.status === "failed" ? (
					<p className={styles.error} role="alert">
						{catalog.message}
					</p>
				) : catalog.value.kind === "unavailable" ? (
					<p className={styles.note}>
						Git unavailable: {catalog.value.message}.
					</p>
				) : (
					<>
						{activeRepository !== null &&
							activeRepository.gitbutlerError !== null && (
								<p className={styles.note}>
									GitButler metadata unavailable:{" "}
									{activeRepository.gitbutlerError}
								</p>
							)}
						{activeRepository !== null &&
							activeRepository.branches.length === 0 && (
								<p className={styles.note}>No branches found.</p>
							)}
						{selection === null ? (
							<p className={styles.note}>Choose a review scope.</p>
						) : selection.kind === "branch" && selection.base === "" ? (
							<p className={styles.note}>
								Choose the repository's default branch to compare.
							</p>
						) : (
							<Comparison
								key={JSON.stringify(selection)}
								revision={revision}
								api={api}
								sessionId={sessionId}
								selection={selection}
								inputActions={inputActions}
								isExpanded={reviewState.isPathExpanded}
								onToggleExpanded={reviewState.setPathExpanded}
								initialScrollTop={reviewState.scrollTop}
								onScroll={reviewState.setScrollTop}
								wrapped={reviewState.wrapped}
								toggleWrap={reviewState.toggleWrapped}
							/>
						)}
					</>
				)}
			</div>
		</div>
	);
}

function Comparison({
	revision,
	api,
	sessionId,
	selection,
	inputActions,
	isExpanded,
	onToggleExpanded,
	initialScrollTop,
	onScroll,
	wrapped,
	toggleWrap,
}: {
	api: Api;
	revision: number;
	sessionId: string;
	selection: ReviewSelection;
	inputActions?: Parameters<typeof GitDiffPane>[0]["inputActions"];
	isExpanded?: (path: string) => boolean;
	onToggleExpanded?: (path: string, expanded: boolean) => void;
	initialScrollTop?: number;
	onScroll?: (scrollTop: number) => void;
	wrapped: boolean;
	toggleWrap: () => void;
}) {
	const load = useCallback(
		async (signal: AbortSignal) => {
			const result = await api.view(sessionId, selection, signal);
			return result.ok
				? { ok: true as const, value: { revision, result: result.value } }
				: result;
		},
		[api, sessionId, selection, revision],
	);
	const current = useLoad(load);
	const [previous, setPrevious] = useState<Extract<
		typeof current,
		{ status: "ready" }
	> | null>(null);
	useEffect(() => {
		if (current.status === "ready") setPrevious(current);
	}, [current]);
	const result =
		current.status === "ready" || previous === null ? current : previous;
	if (result.status === "loading")
		return (
			<p className={styles.note} role="status">
				Loading diff…
			</p>
		);
	if (result.status === "failed")
		return (
			<p className={styles.error} role="alert">
				{result.message}
			</p>
		);
	if (result.value.result.kind !== "diff")
		throw new Error("Git scopes must produce a diff");
	return (
		<>
			{current.status === "failed" && (
				<p className={styles.error} role="alert">
					{current.message}
				</p>
			)}
			{result.value.result.view.diffs.length === 0 ? (
				<p className={styles.note}>No file differences found.</p>
			) : (
				<FileInspector
					revision={result.value.revision}
					view={result.value.result.view}
					api={api}
					sessionId={sessionId}
					inputActions={inputActions}
					isExpanded={isExpanded}
					onToggleExpanded={onToggleExpanded}
					initialScrollTop={initialScrollTop}
					onScroll={onScroll}
					wrapped={wrapped}
					toggleWrap={toggleWrap}
				/>
			)}
		</>
	);
}
