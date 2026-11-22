/**
 * Purpose: Render full-bleed, equal-width concurrent session splits in the main view.
 * Contract:
 * - Inputs: PropsRuntime, PropsRenderSlots, and PropsRenderFactories from the DSH slots system.
 * - Outputs: Split container with session headers and per-pane overlay tabs (session, slot, file).
 * - Errors: Never throws; renders empty columns if references are unready.
 */
import type {
	SessionListState,
	SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
import { workspaceDisplayTitle } from "@deepseek-ai/dsh-api-workspace-controller/default-workspace";
import type {
	WorkspaceFileBytes,
	WorkspaceFileText,
} from "@deepseek-ai/dsh-api-workspace-files/types";
import type { InputActions } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { MarkdownLabels } from "@deepseek-ai/dsh-client-ui-primitives";
import {
	Button,
	CodeBlock,
	IconCheckOutlineRegular,
	IconChevronDownOutlineRegular,
	IconCloseOutlineRegular,
	IconCompareSplitOutlineRegular,
	IconCopyOutlineRegular,
	IconFullscreenOutlineRegular,
	IconRightUpOutlineRegular,
	languageForPath,
	MarkdownText,
	Menu,
	PathLabel,
	Tooltip,
	useClipboardCopy,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
	PropsRenderFactories,
	PropsRenderSlots,
	PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
	RemoteDecoded,
	RemoteResult,
} from "@deepseek-ai/dsh-typert-protocol";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { imageMimeTypeOf, previewKindOf } from "./file-preview.ts";
import { SplitLayout } from "./SplitLayout.tsx";
import { SplitPaneHeader } from "./SplitPaneHeader.tsx";
import "./contract.ts";
import { quoteToComposer } from "@lukstei/util-review-ui/client/quote.ts";
import { useSelectionQuote } from "@lukstei/util-review-ui/client/useSelectionQuote.ts";
import { type SplitOverlay, splitStore } from "./split-store.ts";

/** English chrome for Markdown rendered inside a split pane. */
const MARKDOWN_LABELS: MarkdownLabels = {
	code: {
		copyLabel: "Copy",
		copiedLabel: "Copied",
		toolbarLabels: {
			codeLabel: "Code",
			wrapLabel: "Wrap",
			unwrapLabel: "Unwrap",
		},
	},
	footnotes: "Footnotes",
};

/** Host services the overlay occupants need, supplied by the plugin's inject face. */
export interface SplitOverlayServices {
	readFile: (
		sessionId: SessionId,
		path: string,
		offset: number,
		signal: AbortSignal,
	) => Promise<RemoteResult<WorkspaceFileText>>;
	readBytes: (
		sessionId: SessionId,
		path: string,
		signal: AbortSignal,
	) => Promise<RemoteResult<RemoteDecoded<WorkspaceFileBytes>>>;
	openNativeResource: (address: string) => void;
}

function deriveAncestry(list: SessionListState, id: SessionId) {
	const chain: Array<{
		id: SessionId;
		displayTitle: string;
		subagent: boolean;
	}> = [];
	const seen = new Set<SessionId>();
	let cursor: SessionId | undefined = id;
	while (cursor !== undefined) {
		if (seen.has(cursor)) break;
		seen.add(cursor);
		const summary: SessionSummary | undefined = list.byId[cursor];
		if (summary === undefined) break;
		chain.unshift({
			id: summary.id,
			displayTitle: summary.displayTitle || "Untitled Task",
			subagent: summary.origin === "subagent",
		});
		if (summary.origin !== "subagent") break;
		cursor = summary.parentId;
	}
	return chain;
}
const isAncestryEqual = (
	a: ReturnType<typeof deriveAncestry>,
	b: ReturnType<typeof deriveAncestry>,
): boolean =>
	a.length === b.length &&
	a.every(
		(item, i) =>
			item.id === b[i].id &&
			item.displayTitle === b[i].displayTitle &&
			item.subagent === b[i].subagent,
	);

const isSubagentsEqual = (
	a: readonly SessionSummary[],
	b: readonly SessionSummary[],
): boolean =>
	a.length === b.length &&
	a.every(
		(item, i) =>
			item.id === b[i].id &&
			item.running === b[i].running &&
			item.displayTitle === b[i].displayTitle,
	);

type PaneHooks = Pick<
	PropsRuntime<"split.pane">,
	"useSession" | "useConversation" | "useSessions"
>;

function useSplitPhase(
	sessionId: SessionId,
	{ useSession, useConversation, useSessions }: PaneHooks,
): { phase: "settling" | "hero" | "active"; hero: boolean } {
	const session = useSession((value) => value);
	const conversation = useConversation((value) => value);
	// smell: conversation phase duplicated because client bundle cannot require non-platform plugin @deepseek-ai/dsh-client-ui-conversation; upgrade when harness exports conversationPhase in platform runtime
	const active =
		conversation.activeTargets.size > 0 ||
		(!session.blank && !session.awaitingFirstTurn) ||
		session.running;
	const shellPhase = active
		? "active"
		: session.promptAttempted
			? "engaging"
			: "blank";
	const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank);
	const settling =
		shellPhase === "blank" &&
		session.openState === "loading" &&
		summaryBlank !== true;
	const hero =
		shellPhase === "blank" &&
		(session.openState === "open" || summaryBlank === true);
	return { phase: settling ? "settling" : hero ? "hero" : "active", hero };
}

type FilePageState =
	| { status: "markdown"; text: string; nextOffset: number | undefined }
	| { status: "text"; text: string; nextOffset: number | undefined };

type FileViewState =
	| { status: "loading" }
	| FilePageState
	| { status: "image"; url: string }
	| { status: "failed"; message: string };

/** Copies a file overlay's text; disabled until every page has loaded. */
function CopyContentsButton({ contents }: { contents: string | undefined }) {
	const { copied, onCopy } = useClipboardCopy(contents ?? "");
	const label =
		contents === undefined
			? "Loading full file…"
			: copied
				? "Copied!"
				: "Copy contents";
	return (
		<Tooltip label={label} portal>
			<button
				type="button"
				className="dsh-split-overlay-close"
				aria-label="Copy contents"
				disabled={contents === undefined}
				onClick={(event) => {
					event.stopPropagation();
					onCopy();
				}}
			>
				{copied ? (
					<IconCheckOutlineRegular size={14} />
				) : (
					<IconCopyOutlineRegular size={14} />
				)}
			</button>
		</Tooltip>
	);
}

/** Inline Markdown/text/image preview for one addressed file; other formats fall back to the Sidebar. */
function SplitFileOverlay({
	hostSessionId,
	overlay,
	readFile,
	readBytes,
	openNativeResource,
	inputActions,
}: Pick<
	SplitOverlayServices,
	"readFile" | "readBytes" | "openNativeResource"
> & {
	hostSessionId: SessionId;
	overlay: Extract<SplitOverlay, { kind: "file" }>;
	inputActions?: Pick<
		InputActions,
		"insertQuote" | "insertText" | "captureInsertion" | "persistDraft"
	>;
}) {
	const { path, ownerSessionId } = overlay;
	const kind = previewKindOf(path);
	const [state, setState] = useState<FileViewState>({ status: "loading" });
	const [loadingMore, setLoadingMore] = useState(false);
	const controllerRef = useRef<AbortController | null>(null);
	const objectUrlRef = useRef<string | undefined>(undefined);
	const containerRef = useRef<HTMLDivElement>(null);
	const { floatingQuote, clearFloatingQuote } = useSelectionQuote({
		containerRef,
		enabled: inputActions !== undefined,
	});

	const fullText =
		(state.status === "markdown" || state.status === "text") &&
		state.nextOffset === undefined
			? state.text
			: undefined;
	useEffect(() => {
		if (fullText !== undefined) {
			splitStore.updateFileOverlayContents(
				hostSessionId,
				overlay.address,
				fullText,
			);
		}
	}, [fullText, hostSessionId, overlay]);

	const handleQuote = (e: React.SyntheticEvent) => {
		e.preventDefault();
		if (!floatingQuote || !inputActions) return;
		quoteToComposer(
			{
				text: floatingQuote.text,
				path: overlay.path,
				lines: floatingQuote.lines,
			},
			inputActions,
		);
		clearFloatingQuote();
	};

	useEffect(() => {
		const controller = new AbortController();
		controllerRef.current = controller;
		setState({ status: "loading" });
		setLoadingMore(false);
		const load = async () => {
			if (kind === "image") {
				const mime = imageMimeTypeOf(path);
				if (mime === undefined) {
					setState({ status: "failed", message: "Unsupported preview" });
					return;
				}
				const bytes = await readBytes(ownerSessionId, path, controller.signal);
				if (controller.signal.aborted) return;
				if (!bytes.ok) {
					setState({ status: "failed", message: bytes.error.message });
					return;
				}
				if (bytes.value.absolutePath) {
					splitStore.updateFileOverlayFullPath(
						hostSessionId,
						overlay.address,
						bytes.value.absolutePath,
					);
				}
				const objectUrl = URL.createObjectURL(
					new Blob([bytes.value.data], { type: mime }),
				);
				objectUrlRef.current = objectUrl;
				setState({ status: "image", url: objectUrl });
				return;
			}
			const page = await readFile(ownerSessionId, path, 1, controller.signal);
			if (controller.signal.aborted) return;
			if (!page.ok) {
				setState({ status: "failed", message: page.error.message });
				return;
			}
			if (page.value.absolutePath) {
				splitStore.updateFileOverlayFullPath(
					hostSessionId,
					overlay.address,
					page.value.absolutePath,
				);
			}
			setState({
				status: kind,
				text: page.value.text,
				nextOffset:
					page.value.eof || page.value.lines === 0
						? undefined
						: page.value.offset + page.value.lines,
			});
		};
		void load();
		return () => {
			controller.abort();
			if (controllerRef.current === controller) controllerRef.current = null;
			if (objectUrlRef.current !== undefined) {
				URL.revokeObjectURL(objectUrlRef.current);
				objectUrlRef.current = undefined;
			}
		};
	}, [
		kind,
		path,
		ownerSessionId,
		hostSessionId,
		readFile,
		readBytes,
		overlay.address,
	]);

	const loadMore = async () => {
		if (loadingMore) return;
		if (state.status !== "text" && state.status !== "markdown") return;
		const nextOffset = state.nextOffset;
		const controller = controllerRef.current;
		if (
			nextOffset === undefined ||
			controller === null ||
			controller.signal.aborted
		) {
			return;
		}
		setLoadingMore(true);
		const page = await readFile(
			ownerSessionId,
			path,
			nextOffset,
			controller.signal,
		);
		if (controller.signal.aborted) return;
		setLoadingMore(false);
		if (!page.ok) {
			setState((previous) =>
				previous.status === "text" || previous.status === "markdown"
					? { ...previous, nextOffset: undefined }
					: previous,
			);
			return;
		}
		setState((previous) =>
			previous.status === "text" || previous.status === "markdown"
				? {
						...previous,
						text: `${previous.text}\n${page.value.text}`,
						nextOffset:
							page.value.eof || page.value.lines === 0
								? undefined
								: page.value.offset + page.value.lines,
					}
				: previous,
		);
	};

	if (state.status === "loading") {
		return <p className="dsh-split-file-note">Loading…</p>;
	}
	if (state.status === "failed") {
		return (
			<div className="dsh-split-file-note">
				<p>{state.message}</p>
				<button
					type="button"
					className="dsh-split-btn"
					onClick={() => openNativeResource(overlay.address)}
				>
					Open in sidebar
				</button>
			</div>
		);
	}
	if (state.status === "image") {
		return (
			<div className="dsh-split-file dsh-split-file-media">
				<img
					className="dsh-split-file-image"
					src={state.url}
					alt={overlay.title}
				/>
			</div>
		);
	}
	const truncated = state.nextOffset !== undefined;
	return (
		<div ref={containerRef} className="dsh-split-file">
			{floatingQuote !== null && inputActions !== undefined && (
				<div
					className="dsh-split-floating-quote"
					style={{
						top: `${floatingQuote.top}px`,
						left: `${floatingQuote.left}px`,
					}}
				>
					<button
						type="button"
						className="dsh-split-floating-quote-btn"
						onPointerDown={(e) => {
							e.preventDefault();
						}}
						onClick={handleQuote}
					>
						Quote
					</button>
				</div>
			)}
			{state.status === "markdown" ? (
				<div className="dsh-split-file-markdown">
					<MarkdownText text={state.text} labels={MARKDOWN_LABELS} />
				</div>
			) : (
				<div className="dsh-split-file-code">
					<CodeBlock
						code={state.text}
						lang={languageForPath(path)}
						lineNumbers
						streaming={truncated}
						copyLabel={MARKDOWN_LABELS.code.copyLabel}
						copiedLabel={MARKDOWN_LABELS.code.copiedLabel}
						toolbarLabels={MARKDOWN_LABELS.code.toolbarLabels}
					/>
				</div>
			)}
			{truncated && (
				<p className="dsh-split-file-note">
					{loadingMore ? "Loading…" : "Showing the first page only."}{" "}
					<button
						type="button"
						className="dsh-split-btn"
						disabled={loadingMore}
						onClick={() => {
							void loadMore();
						}}
					>
						Load more
					</button>{" "}
					<button
						type="button"
						className="dsh-split-btn"
						onClick={() => openNativeResource(overlay.address)}
					>
						Open in sidebar
					</button>
				</p>
			)}
		</div>
	);
}

function SplitSessionOverlay({
	sessionId,
	useSession,
	useConversation,
	useSessions,
	renderFactorySlot,
}: {
	sessionId: SessionId;
	useSession: PaneHooks["useSession"];
	useConversation: PaneHooks["useConversation"];
	useSessions: PaneHooks["useSessions"];
	renderFactorySlot: PropsRenderFactories["renderFactorySlot"];
}) {
	const { phase, hero } = useSplitPhase(sessionId, {
		useSession,
		useConversation,
		useSessions,
	});
	return renderFactorySlot("conversation.content", {
		variant: "embedded",
		phase,
		hero,
	});
}

/** Occupant of `split.overlay`: renders whichever overlay covers the host pane. */
export function SplitOverlayContent({
	hostSessionId,
	sessionId,
	useSession,
	useConversation,
	useSessions,
	renderFactorySlot,
	readFile,
	readBytes,
	openNativeResource,
	inputActions,
}: PropsRuntime<"split.overlay"> &
	PropsRenderFactories &
	SplitOverlayServices) {
	const state = useSyncExternalStore(
		splitStore.subscribe,
		splitStore.getSnapshot,
	);
	const overlay = state.overlays.get(hostSessionId);

	if (overlay === undefined) return null;
	if (overlay.kind === "session") {
		return (
			<SplitSessionOverlay
				sessionId={sessionId}
				useSession={useSession}
				useConversation={useConversation}
				useSessions={useSessions}
				renderFactorySlot={renderFactorySlot}
			/>
		);
	}
	if (overlay.kind === "slot") {
		return renderFactorySlot(overlay.slotName, overlay.props);
	}
	if (overlay.kind === "file") {
		return (
			<SplitFileOverlay
				hostSessionId={hostSessionId}
				overlay={overlay}
				readFile={readFile}
				readBytes={readBytes}
				openNativeResource={openNativeResource}
				inputActions={inputActions}
			/>
		);
	}
	return null;
}

/** @internal */
export interface SplitOverlayHostContextValue {
	sessionId: SessionId;
	renderSlot: PropsRenderSlots<"split.overlay">["renderSlot"];
}

/** @internal */
export const SplitOverlayHostContext =
	createContext<SplitOverlayHostContextValue | null>(null);

/** @internal */
export function SplitOverlayConversationView() {
	const host = useContext(SplitOverlayHostContext);
	if (host === null) return null;
	return (
		<div className="dsh-split-overlay-view">
			{host.renderSlot("split.overlay", { hostSessionId: host.sessionId })}
		</div>
	);
}

const SPLIT_OVERLAY_CONVERSATION_OPTIONS = {
	slots: {
		views: SplitOverlayConversationView,
	},
} as const;

/**
 * Purpose: Session-scoped occupant for an individual split pane including session header.
 * Contract:
 * - Inputs: Standard session props, renderSlot/renderFactorySlot, and SessionProvider.
 * - Outputs: Embedded conversation content or the pane overlay with its tab row.
 */
export function SplitPaneContent({
	sessionId,
	useSession,
	useInput,
	useConversation,
	useSessions,
	useSessionStatus,
	useWorkspaces,
	renderSlot,
	renderFactorySlot,
	SessionProvider,
}: PropsRuntime<"split.pane"> &
	PropsRenderFactories &
	PropsRenderSlots<
		| "split.overlay"
		| "split.pane.status"
		| "split.subagent.status"
		| "split.pane.header.actions"
	>) {
	const overlayHostValue = useMemo<SplitOverlayHostContextValue>(
		() => ({ sessionId, renderSlot }),
		[sessionId, renderSlot],
	);
	const state = useSyncExternalStore(
		splitStore.subscribe,
		splitStore.getSnapshot,
	);
	const overlay = state.overlays.get(sessionId);
	const isFocused = state.focusedSessionId === sessionId;
	const isMaximized = state.maximizedSessionId === sessionId;
	const isHovered = state.hoveredSessionId === sessionId;
	const [isDragOver, setIsDragOver] = useState(false);
	const canDrag =
		state.sessionIds.length > 1 && state.maximizedSessionId === undefined;

	const inputPhase = useInput((s) => s.phase);
	const prevPhaseRef = useRef(inputPhase);
	const pendingCount = useSession((s) => s.pendingSubmissions.length);
	const isRunning = useSession((s) => s.running);
	const prevPendingRef = useRef(pendingCount);
	const prevRunningRef = useRef(isRunning);

	useEffect(() => {
		const isSubmitting =
			(prevPhaseRef.current === "plain" ||
				prevPhaseRef.current === "claimed") &&
			(inputPhase === "sending" ||
				inputPhase === "submitting" ||
				inputPhase === "adjudicating");
		const pendingIncreased = pendingCount > prevPendingRef.current;
		const becameRunning = !prevRunningRef.current && isRunning;
		const isReviewOverlay =
			overlay !== undefined &&
			(overlay.kind === "slot" || overlay.kind === "file");

		if (
			(isSubmitting || pendingIncreased || becameRunning) &&
			isReviewOverlay
		) {
			splitStore.closeOverlay(sessionId);
		}
		prevPhaseRef.current = inputPhase;
		prevPendingRef.current = pendingCount;
		prevRunningRef.current = isRunning;
	}, [inputPhase, pendingCount, isRunning, overlay, sessionId]);

	const { phase, hero } = useSplitPhase(sessionId, {
		useSession,
		useConversation,
		useSessions,
	});

	const statuses = useSessionStatus((s) => s);
	const isSubagentRunning = (item: SessionSummary): boolean => {
		const status = statuses.get(item.id);
		return status !== undefined && status.running !== undefined
			? status.running
			: item.running;
	};

	const ancestry = useSessions(
		(s) => deriveAncestry(s, sessionId),
		isAncestryEqual,
	);
	const currentSummary = useSessions((s) => s.byId[sessionId]);
	const displayTitle = currentSummary?.displayTitle || "Untitled Task";
	const subagents = useSessions(
		(s) =>
			Object.values(s.byId).filter((item): item is SessionSummary =>
				Boolean(
					item && item.origin === "subagent" && item.parentId === sessionId,
				),
			),
		isSubagentsEqual,
	);
	const runningSubagents = subagents.filter(isSubagentRunning);
	const hasRunningSubagents = runningSubagents.length > 0;
	const workspace = useWorkspaces((s) =>
		s.items.find((item) =>
			item.sessionIds.includes(
				ancestry.length === 0 ? sessionId : ancestry[0].id,
			),
		),
	);
	const workspaceTitle =
		workspace === undefined
			? undefined
			: workspaceDisplayTitle(workspace.title, "Default workspace");
	const [subagentMenuOpen, setSubagentMenuOpen] = useState(false);

	const subagentPillLabel =
		subagents.length === 1
			? "1 subagent"
			: hasRunningSubagents
				? `${runningSubagents.length}/${subagents.length} subagents`
				: `${subagents.length} subagents`;

	const subagentPillTooltip =
		subagents.length === 1
			? hasRunningSubagents
				? `Subagent active: ${subagents[0].displayTitle || "Untitled"}. Click to select.`
				: `Subagent finished: ${subagents[0].displayTitle || "Untitled"}. Click to select.`
			: hasRunningSubagents
				? `${runningSubagents.length} active of ${subagents.length} subagents. Click to select.`
				: `${subagents.length} subagents finished. Click to select.`;

	useEffect(() => {
		if (overlay === undefined) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (splitStore.getSnapshot().focusedSessionId !== sessionId) return;
			splitStore.closeOverlay(sessionId);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [overlay, sessionId]);

	return (
		<div
			className={`dsh-split-pane-wrapper ${isDragOver ? "is-drag-over" : ""} ${isHovered ? "is-hovered" : ""} ${currentSummary?.origin === "subagent" || overlay?.kind === "session" ? "is-subagent" : ""}`}
			onDragOver={(event) => {
				if (
					!Array.from(event.dataTransfer.types).includes(
						"application/x-dsh-split-session",
					)
				) {
					return;
				}
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				if (!isDragOver) setIsDragOver(true);
			}}
			onDragLeave={(event) => {
				if (event.currentTarget.contains(event.relatedTarget as Node)) {
					return;
				}
				setIsDragOver(false);
			}}
			onDrop={(event) => {
				setIsDragOver(false);
				(event.currentTarget as HTMLElement)
					.closest(".dsh-split-shell")
					?.classList.remove("is-dragging");
				const sourceId = event.dataTransfer.getData(
					"application/x-dsh-split-session",
				) as SessionId;
				if (sourceId) {
					event.preventDefault();
					splitStore.reorderSession(sourceId, sessionId);
				}
			}}
		>
			<SplitPaneHeader
				focused={isFocused}
				status={renderSlot("split.pane.status", {})}
				workspaceTitle={workspaceTitle}
				ancestry={ancestry}
				displayTitle={displayTitle}
				draggable={canDrag}
				onDragStart={(event) => {
					if (
						event.defaultPrevented ||
						(event.target as HTMLElement).closest("button, [role='menu']")
					) {
						event.preventDefault();
						return;
					}
					(event.currentTarget as HTMLElement)
						.closest(".dsh-split-shell")
						?.classList.add("is-dragging");
					event.dataTransfer.setData(
						"application/x-dsh-split-session",
						sessionId,
					);
					event.dataTransfer.effectAllowed = "move";
				}}
				onDragEnd={(event) => {
					setIsDragOver(false);
					(event.currentTarget as HTMLElement)
						.closest(".dsh-split-shell")
						?.classList.remove("is-dragging");
				}}
				onDoubleClick={(event) => {
					if (
						event.defaultPrevented ||
						(event.target as HTMLElement).closest("button")
					) {
						return;
					}
					splitStore.toggleMaximize(sessionId);
				}}
				actions={
					<>
						{renderSlot("split.pane.header.actions", {})}
						{state.sessionIds.length > 1 && (
							<Tooltip
								label={
									isMaximized
										? "Restore split layout"
										: "Maximize pane in split screen"
								}
								portal
							>
								<Button
									variant="ghost"
									size="sm"
									className={`dsh-split-icon-btn dsh-split-maximize-btn ${isMaximized ? "is-pressed" : ""}`}
									aria-label={
										isMaximized
											? "Restore split layout"
											: "Maximize pane in split screen"
									}
									aria-pressed={isMaximized}
									icon={<IconFullscreenOutlineRegular size={14} />}
									onClick={(event) => {
										event.stopPropagation();
										splitStore.toggleMaximize(sessionId);
									}}
								/>
							</Tooltip>
						)}
						<Tooltip label="Open this session in the native view" portal>
							<Button
								variant="ghost"
								size="sm"
								className="dsh-split-icon-btn"
								aria-label="Open this session in the native view"
								icon={<IconRightUpOutlineRegular size={14} />}
								onClick={(event) => {
									event.stopPropagation();
									const targetSessionId =
										overlay?.kind === "session"
											? typeof overlay.target === "string"
												? overlay.target
												: overlay.target.childSessionId
											: sessionId;
									splitStore.suspend(targetSessionId);
								}}
							/>
						</Tooltip>
						<Tooltip label="Close pane" portal>
							<Button
								variant="ghost"
								size="sm"
								className="dsh-split-icon-btn dsh-split-pane-close"
								aria-label="Close pane"
								icon={<IconCloseOutlineRegular size={14} />}
								onClick={(event) => {
									event.stopPropagation();
									splitStore.removeSession(sessionId);
								}}
							/>
						</Tooltip>
					</>
				}
			>
				{subagents.length > 0 && (
					<Menu
						open={subagentMenuOpen}
						portal
						compact
						align="start"
						onClose={() => setSubagentMenuOpen(false)}
						onSelect={(id) => {
							setSubagentMenuOpen(false);
							const target = subagents.find((item) => item.id === id);
							const targetTitle = target?.displayTitle || "Untitled Task";
							splitStore.openSessionOverlay(
								sessionId,
								id as SessionId,
								`Subagent: ${targetTitle}`,
							);
						}}
						items={subagents.map((item) => {
							const running = isSubagentRunning(item);
							return {
								id: item.id,
								icon: renderSlot("split.subagent.status", {
									state: running ? "active" : "review",
								}),
								label: (
									<span className="dsh-split-subagent-menu-item">
										<span
											className="dsh-split-subagent-menu-title"
											title={item.displayTitle}
										>
											{item.displayTitle || "Untitled Subagent"}
										</span>
										<span className="dsh-split-subagent-menu-status">
											{running ? "Running" : "Finished"}
										</span>
									</span>
								),
							};
						})}
						anchor={
							<Button
								variant="ghost"
								size="sm"
								className={`dsh-split-subagent-pill ${subagentMenuOpen ? "is-active" : ""}`}
								title={subagentPillTooltip}
								aria-haspopup="menu"
								aria-expanded={subagentMenuOpen}
								onClick={(event) => {
									event.stopPropagation();
									setSubagentMenuOpen((open) => !open);
								}}
							>
								{renderSlot("split.subagent.status", {
									state: hasRunningSubagents ? "active" : "review",
								})}
								<span className="dsh-split-subagent-text">
									{subagentPillLabel}
								</span>
								<IconChevronDownOutlineRegular size={12} />
							</Button>
						}
					/>
				)}
			</SplitPaneHeader>
			{overlay !== undefined && (
				<div className="dsh-split-overlay-tab">
					{overlay.kind === "file" ? (
						<PathLabel
							path={overlay.fullPath ?? overlay.path}
							className="dsh-split-overlay-tab-path"
						/>
					) : (
						<span className="dsh-split-overlay-tab-title" title={overlay.title}>
							{overlay.title}
						</span>
					)}
					{overlay.kind === "file" &&
						previewKindOf(overlay.path) !== "image" && (
							<CopyContentsButton contents={overlay.contents} />
						)}
					<button
						type="button"
						className="dsh-split-overlay-close"
						title="Close"
						aria-label="Close overlay"
						onClick={(event) => {
							event.stopPropagation();
							splitStore.closeOverlay(sessionId);
						}}
					>
						<IconCloseOutlineRegular size={14} />
					</button>
				</div>
			)}
			<div className="dsh-split-pane-body" data-phase={phase}>
				<SplitOverlayHostContext.Provider value={overlayHostValue}>
					{overlay === undefined ? (
						renderFactorySlot("conversation.content", {
							variant: "embedded",
							phase,
							hero,
						})
					) : overlay.kind === "session" ? (
						<SessionProvider session={overlay.reference}>
							{renderSlot("split.overlay", { hostSessionId: sessionId })}
						</SessionProvider>
					) : (
						renderFactorySlot(
							"conversation.content",
							{
								variant: "embedded",
								phase,
								hero,
							},
							SPLIT_OVERLAY_CONVERSATION_OPTIONS,
						)
					)}
				</SplitOverlayHostContext.Provider>
			</div>
		</div>
	);
}

/**
 * Purpose: Root-scoped main panel rendering N equal-width vertical splits.
 * Contract:
 * - Inputs: SessionProvider and renderSlot from PropsRenderSlots.
 * - Outputs: Equal-width flexbox container with focused pane border.
 */
export function SplitView({
	SessionProvider,
	renderSlot,
}: PropsRuntime<"main", "split-view"> & PropsRenderSlots<"split.pane">) {
	const { sessionIds, focusedSessionId, maximizedSessionId } =
		useSyncExternalStore(splitStore.subscribe, splitStore.getSnapshot);

	useEffect(
		() => () => {
			const { maximizedSessionId } = splitStore.getSnapshot();
			if (maximizedSessionId !== undefined) {
				splitStore.toggleMaximize(maximizedSessionId);
			}
		},
		[],
	);

	const activeFocusedId =
		focusedSessionId !== undefined && sessionIds.includes(focusedSessionId)
			? focusedSessionId
			: sessionIds[0];

	return (
		<SplitLayout sessionIds={sessionIds}>
			{sessionIds.map((id) => {
				const ref = splitStore.getReference(id);
				if (ref === undefined) return null;
				const isFocused = id === activeFocusedId;
				const isHidden =
					maximizedSessionId !== undefined &&
					maximizedSessionId !== id &&
					sessionIds.includes(maximizedSessionId);
				return (
					<div
						key={id}
						data-split-pane={id}
						className={`dsh-split-col ${isFocused ? "is-focused" : ""}`}
						style={isHidden ? { display: "none" } : undefined}
						onPointerDownCapture={() => {
							splitStore.setFocus(id);
							splitStore.setPointerOrigin(id);
						}}
						onFocusCapture={() => {
							splitStore.setFocus(id);
							splitStore.setPointerOrigin(id);
						}}
					>
						<SessionProvider session={ref}>
							{renderSlot("split.pane", {})}
						</SessionProvider>
					</div>
				);
			})}
		</SplitLayout>
	);
}

/** Header utility that returns from a suspended native view to the retained split. */
export function SplitRestoreHeaderAction(
	_props?: Partial<PropsRuntime<"conversation.session.header.utilities">>,
) {
	const { suspended } = useSyncExternalStore(
		splitStore.subscribe,
		splitStore.getSnapshot,
	);
	if (!suspended) return null;
	return (
		<Button
			variant="primary"
			size="sm"
			className="dsh-split-restore-btn"
			icon={<IconCompareSplitOutlineRegular size={16} />}
			title="Back to split view"
			aria-label="Back to split view"
			onClick={() => splitStore.resume()}
		>
			Back to split
		</Button>
	);
}
