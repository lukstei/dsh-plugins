import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
	DisclosureRow,
	IconApiOutlineRegular,
	TextShimmer,
	useDismissOnOutsidePointer,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ScheduleCatalogEntry } from "@deepseek-ai/dsh-schedule/client";
import type { SessionProjectionMap } from "@deepseek-ai/dsh-session-projection";
import {
	type CSSProperties,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { parseScriptPrompt } from "./parser.ts";
import { SCHEDULE_SCRIPT_CSS } from "./styles.ts";
import {
	SCHEDULE_SCRIPT_EVENT_NAME,
	type ScheduleScriptEventPayload,
	type ScheduleScriptPromptPayload,
	type ScheduleScriptSummary,
	type ScheduleSystemStatus,
	type ScriptExecutionStatus,
} from "./types.ts";

export interface ScheduleCatalogStatusResult {
	readonly status?: ScheduleSystemStatus;
	readonly settled: boolean;
	readonly matchingItem?: ScheduleCatalogEntry;
	readonly parsedPrompt?: ScheduleScriptPromptPayload;
}

export interface ScheduleScriptPromptProps {
	readonly summary?: ScheduleScriptSummary | null;
	readonly initialOpen?: boolean;
	readonly scheduleStatus?: ScheduleSystemStatus;
}

export function useScheduleCatalogStatus(
	ctx: ClientContext,
	sessionId: string,
	scriptPath?: string,
): ScheduleCatalogStatusResult {
	const [catalogStatus, setCatalogStatus] =
		useState<ScheduleCatalogStatusResult>({
			settled: false,
		});

	useEffect(() => {
		setCatalogStatus({ settled: false });

		let active = true;

		const refresh = async () => {
			try {
				const result = await ctx.remote.schedule.catalog();
				if (!active || !result.ok) return;
				const items = result.value;

				let parsedMatch: ScheduleScriptPromptPayload | undefined;
				const matching = items.find((item) => {
					const targetSessionId =
						item.lastDelivery === undefined
							? undefined
							: item.lastDelivery.targetSessionId;
					const isTarget =
						(item.target.kind === "session" &&
							item.target.sessionId === sessionId) ||
						targetSessionId === sessionId;
					const isInvolved = item.involvedSessionIds.some(
						(id) => id === sessionId,
					);
					if (!isTarget && !isInvolved) return false;
					if (typeof item.prompt !== "string") return false;
					const parsed = parseScriptPrompt(item.prompt);
					if (!parsed) return false;
					if (scriptPath && parsed.scriptPath !== scriptPath) return false;
					parsedMatch = parsed;
					return true;
				});

				if (matching) {
					setCatalogStatus({
						status:
							matching.status === "paused"
								? "paused"
								: matching.status === "ended"
									? "ended"
									: "active",
						settled: true,
						matchingItem: matching,
						parsedPrompt: parsedMatch,
					});
				} else {
					setCatalogStatus({
						status: "deleted",
						settled: true,
					});
				}
			} catch {
				// retain prior status on fetch failure
			}
		};

		const changed = ctx.remote.$on("schedule/changed", refresh);
		const reset = ctx.on("connection/reset", refresh);
		void refresh();
		return () => {
			active = false;
			changed();
			reset();
		};
	}, [ctx, sessionId, scriptPath]);

	return catalogStatus;
}

export interface EffectiveScriptState {
	readonly scheduleStatus?: ScheduleSystemStatus;
	readonly scriptStatus: ScriptExecutionStatus;
	readonly displayStatus: "active" | "paused" | "warning" | "error" | "stopped";
	readonly badgeText: string;
}

export function resolveEffectiveScriptState(
	summary: ScheduleScriptSummary,
	scheduleStatus?: ScheduleSystemStatus,
): EffectiveScriptState {
	const scriptStatus: ScriptExecutionStatus =
		summary.scriptStatus ??
		(scheduleStatus === "deleted" || scheduleStatus === "ended"
			? "stopped"
			: "idle");

	if (scriptStatus === "error" || summary.lastError?.fatal) {
		return {
			scheduleStatus,
			scriptStatus,
			displayStatus: "error",
			badgeText: "Error",
		};
	}
	if (scriptStatus === "stopped") {
		return {
			scheduleStatus,
			scriptStatus,
			displayStatus: "stopped",
			badgeText: "Stopped",
		};
	}
	if (scheduleStatus === "deleted" || scheduleStatus === "ended") {
		return {
			scheduleStatus,
			scriptStatus,
			displayStatus: "stopped",
			badgeText: "Stopped",
		};
	}
	if (scheduleStatus === "paused") {
		return {
			scheduleStatus,
			scriptStatus,
			displayStatus: "paused",
			badgeText: "Paused",
		};
	}
	if (
		scriptStatus === "warning" ||
		(Boolean(summary.lastError) && !summary.lastError?.fatal)
	) {
		return {
			scheduleStatus,
			scriptStatus,
			displayStatus: "warning",
			badgeText: "Warning",
		};
	}
	return {
		scheduleStatus,
		scriptStatus,
		displayStatus: "active",
		badgeText: "Active",
	};
}

export function shouldRenderPill(
	summary: ScheduleScriptSummary | null | undefined,
	scheduleStatus?: ScheduleSystemStatus,
): summary is ScheduleScriptSummary {
	if (!summary) return false;
	const hasError =
		summary.scriptStatus === "error" || Boolean(summary.lastError);
	if (
		!hasError &&
		summary.totalRuns === 0 &&
		(scheduleStatus === "deleted" ||
			scheduleStatus === "ended" ||
			summary.scriptStatus === "stopped")
	) {
		return false;
	}
	if (
		hasError ||
		summary.totalRuns > 0 ||
		scheduleStatus === "active" ||
		scheduleStatus === "paused" ||
		summary.scriptPath
	) {
		return true;
	}
	return false;
}

export function TimerIcon({ size = 14 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<circle cx="8" cy="8" r="6.5" />
			<polyline points="8 4.5 8 8 10.5 9.5" />
		</svg>
	);
}

export function formatDuration(durationMs?: number): string {
	if (durationMs === undefined) return "0.0s";
	return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatRelativeTime(timestamp?: number): string {
	if (!timestamp) return "Pending first run";
	const elapsedSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (elapsedSec < 5) return "just now";
	if (elapsedSec < 60) return `${elapsedSec}s ago`;
	const elapsedMin = Math.floor(elapsedSec / 60);
	if (elapsedMin < 60) return `${elapsedMin}m ago`;
	const elapsedHours = Math.floor(elapsedMin / 60);
	if (elapsedHours < 24) return `${elapsedHours}h ago`;
	const elapsedDays = Math.floor(elapsedHours / 24);
	return `${elapsedDays}d ago`;
}

export function formatClockTime(timestamp: number): string {
	const d = new Date(timestamp);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface ScheduleScriptPopoverCardProps {
	readonly summary: ScheduleScriptSummary;
	readonly scheduleStatus?: ScheduleSystemStatus;
	readonly isStatic?: boolean;
	readonly cardRef?: RefObject<HTMLDivElement | null>;
	readonly style?: CSSProperties;
}

export function ScheduleScriptPopoverCard({
	summary,
	scheduleStatus,
	isStatic = false,
	cardRef,
	style,
}: ScheduleScriptPopoverCardProps) {
	const effective = resolveEffectiveScriptState(summary, scheduleStatus);
	const statusKey = effective.displayStatus;
	const statusText = effective.badgeText;
	const isFatal = statusKey === "error";
	const isPaused = statusKey === "paused";
	const isStopped = statusKey === "stopped";
	const isWarning = statusKey === "warning";
	const isCompleted = statusKey === "active";

	const scriptName = summary.scriptPath
		? (summary.scriptPath.split("/").pop() ?? "script.ts")
		: "Background Script";

	return (
		<div
			ref={cardRef}
			style={style}
			className={`dsh-schedule-popover ${isStatic ? "is-static" : ""}`}
			role="dialog"
			aria-label="Schedule script telemetry"
			onClick={(e) => e.stopPropagation()}
		>
			<div className="dsh-schedule-popover-header">
				<div className="dsh-schedule-popover-title">
					<TimerIcon size={14} />
					<span>{scriptName}</span>
				</div>
				<span className="dsh-schedule-status-badge" data-status={statusKey}>
					<span className="dsh-schedule-dot" data-status={statusKey} />
					{statusText}
				</span>
			</div>

			<div className="dsh-schedule-details-grid">
				<div className="dsh-schedule-detail-row">
					<span>Script</span>
					<span
						className="dsh-schedule-mono-badge"
						title={summary.scriptPath ?? "n/a"}
					>
						{summary.scriptPath ?? "n/a"}
					</span>
				</div>
				<div className="dsh-schedule-detail-row">
					<span>Total Runs</span>
					<span className="dsh-schedule-detail-value">{summary.totalRuns}</span>
				</div>
				<div className="dsh-schedule-detail-row">
					<span>Last Duration</span>
					<span className="dsh-schedule-detail-value">
						{formatDuration(summary.lastDurationMs)}
					</span>
				</div>
				<div className="dsh-schedule-detail-row">
					<span>Last Run</span>
					<span
						className="dsh-schedule-detail-value"
						title={
							summary.lastRunAt
								? new Date(summary.lastRunAt).toLocaleString()
								: undefined
						}
					>
						{formatRelativeTime(summary.lastRunAt)}
					</span>
				</div>
				{isWarning && summary.lastError?.message && (
					<div className="dsh-schedule-detail-row">
						<span>Error</span>
						<span
							className="dsh-schedule-detail-value dsh-schedule-error-value"
							title={summary.lastError.message}
						>
							{summary.lastError.message}
						</span>
					</div>
				)}
			</div>

			{summary.cleanupError && (
				<div className="dsh-schedule-command-error-line">
					{summary.cleanupError}
				</div>
			)}
			{isFatal ? (
				<div className="dsh-schedule-callout dsh-schedule-callout-fatal">
					<div className="dsh-schedule-callout-header">✖ Fatal Error</div>
					<div>
						{summary.lastError?.message ||
							"Execution failed with an unhandled exception"}
					</div>
				</div>
			) : isPaused ? (
				<div className="dsh-schedule-callout dsh-schedule-callout-paused">
					<div className="dsh-schedule-callout-header">⏸ Paused</div>
					<div>
						Schedule is paused in Automation Tasks. Resume in UI to continue.
					</div>
				</div>
			) : isStopped ? (
				<div className="dsh-schedule-callout dsh-schedule-callout-stopped">
					<div className="dsh-schedule-callout-header">⏹ Stopped</div>
					<div>
						{summary.scriptStatus === "stopped"
							? `Execution stopped cleanly after #${summary.totalRuns} runs`
							: effective.scheduleStatus === "deleted"
								? "Automation task was deleted in Automation Tasks"
								: "Schedule was stopped in Automation Tasks"}
					</div>
				</div>
			) : isWarning ? (
				<div className="dsh-schedule-callout dsh-schedule-callout-warning">
					<div className="dsh-schedule-callout-header">⚠ Warning</div>
					<div>{summary.lastError?.message}</div>
				</div>
			) : isCompleted ? (
				<div className="dsh-schedule-callout dsh-schedule-callout-completed">
					<div className="dsh-schedule-callout-header">✔ Completed</div>
					<div>Run #{summary.totalRuns} completed successfully</div>
				</div>
			) : null}
		</div>
	);
}

export type UseProjectionHook = <K extends keyof SessionProjectionMap>(
	key: K,
) => SessionProjectionMap[K];

export interface ConnectedScheduleScriptPromptButtonProps {
	readonly ctx: ClientContext;
	readonly sessionId: string;
	readonly useProjection: UseProjectionHook;
}

export function ConnectedScheduleScriptPromptButton({
	ctx,
	sessionId,
	useProjection,
}: ConnectedScheduleScriptPromptButtonProps) {
	const projection = useProjection("dshScheduleScript");
	const catalog = useScheduleCatalogStatus(
		ctx,
		sessionId,
		projection?.scriptPath,
	);
	const summary: ScheduleScriptSummary | undefined =
		projection ??
		(catalog.parsedPrompt !== undefined &&
		(catalog.status === "active" || catalog.status === "paused")
			? {
					scriptStatus: "idle",
					totalRuns: 0,
					scriptPath: catalog.parsedPrompt.scriptPath,
					state: catalog.parsedPrompt.state,
				}
			: undefined);
	return (
		<ScheduleScriptPromptButton
			summary={summary}
			scheduleStatus={catalog.status}
		/>
	);
}

export function ScheduleScriptPromptButton(props: ScheduleScriptPromptProps) {
	const anchorName = `--dsh-schedule-${useId()}`;
	const summary = props.summary;
	const [open, setOpen] = useState(props.initialOpen ?? false);

	const buttonRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	useDismissOnOutsidePointer(buttonRef, open, setOpen, panelRef);

	if (!shouldRenderPill(summary, props.scheduleStatus)) return null;

	const effective = resolveEffectiveScriptState(summary, props.scheduleStatus);
	const statusKey = effective.displayStatus;
	const statusText = effective.badgeText;

	const scriptName = summary.scriptPath
		? (summary.scriptPath.split("/").pop() ?? "script.ts")
		: "Background Script";

	const fullTooltip = `Schedule: ${scriptName} (${statusText} · ${summary.totalRuns} runs)`;

	return (
		<div className="dsh-schedule-root">
			<style href="dsh-schedule-script" precedence="default">
				{SCHEDULE_SCRIPT_CSS}
			</style>

			<button
				ref={buttonRef}
				style={{ anchorName }}
				type="button"
				className={`dsh-schedule-icon-btn ${open ? "is-pressed is-active" : ""}`}
				title={fullTooltip}
				aria-label={fullTooltip}
				aria-expanded={open}
				onClick={(e) => {
					e.stopPropagation();
					setOpen(!open);
				}}
			>
				<TimerIcon size={14} />
				<span className="dsh-schedule-dot-badge" data-status={statusKey} />
			</button>

			{open &&
				typeof document !== "undefined" &&
				createPortal(
					<ScheduleScriptPopoverCard
						summary={summary}
						scheduleStatus={props.scheduleStatus}
						cardRef={panelRef}
						style={{ positionAnchor: anchorName }}
					/>,
					document.body,
				)}
		</div>
	);
}

// Backward-compatible alias
export const ScheduleScriptPill = ScheduleScriptPromptButton;

export interface ScheduleScriptCommandCardProps {
	readonly node: {
		readonly name?: string | null;
		readonly args?: string | null;
		readonly time?: number;
		readonly outcome?: {
			readonly kind: "success" | "error";
			readonly text?: string;
		} | null;
	};
}

/**
 * Renders the command line in the chat process/trajectory.
 * Displays '>_ dsh-schedule-script · Completed at 10:24' with a separate line for recoverable/fatal errors when present.
 */
export function ScheduleScriptCommandCard({
	node,
}: ScheduleScriptCommandCardProps) {
	const cardRef = useRef<HTMLDivElement>(null);

	let payload: ScheduleScriptEventPayload | null = null;
	if (node.args) {
		try {
			payload = JSON.parse(node.args) as ScheduleScriptEventPayload;
		} catch {
			// ignore malformed arguments
		}
	}

	const isRunning = node.outcome === null;
	const isOutcomeError = node.outcome?.kind === "error";

	const completedTime =
		payload && "durationMs" in payload && typeof payload.durationMs === "number"
			? payload.timestamp + payload.durationMs
			: (payload?.timestamp ?? node.time);

	const timeSuffix = completedTime
		? ` at ${formatClockTime(completedTime)}`
		: "";

	const summary = isRunning
		? "Running"
		: isOutcomeError
			? `Failed${timeSuffix}`
			: `Completed${timeSuffix}`;

	const errorText =
		payload && "error" in payload && typeof payload.error === "string"
			? payload.error
			: undefined;

	const isFatal = Boolean(
		isOutcomeError || (payload && "fatal" in payload && payload.fatal),
	);

	useEffect(() => {
		if (!errorText && !isFatal && !isOutcomeError) return;

		const expandDisclosures = () => {
			const el = cardRef.current;
			if (!el) return;

			const activeEl =
				typeof document !== "undefined"
					? (document.activeElement as HTMLElement | null)
					: null;

			// 1. Expand the parent process group ("Analysis completed") if collapsed
			const stepProcess = el.closest("[data-step-process]");
			if (stepProcess) {
				const groupBtn = stepProcess.querySelector<HTMLButtonElement>(
					'button[aria-expanded="false"]',
				);
				if (groupBtn) {
					groupBtn.click();
				}
			}

			// 2. Expand enclosing turn process ("Completed in Xs") if collapsed
			const turnAttr = stepProcess?.getAttribute("data-chat-turn");
			let turnBtn: HTMLButtonElement | null = null;
			if (turnAttr) {
				turnBtn = document.querySelector<HTMLButtonElement>(
					`button[data-turn-process="${turnAttr}"][aria-expanded="false"]`,
				);
			}
			if (!turnBtn) {
				const flow = stepProcess?.parentElement;
				if (flow) {
					turnBtn = flow.querySelector<HTMLButtonElement>(
						'button[data-turn-process][aria-expanded="false"]',
					);
				}
			}
			if (turnBtn) {
				turnBtn.click();
			}

			if (
				activeEl &&
				typeof activeEl.focus === "function" &&
				document.activeElement !== activeEl
			) {
				activeEl.focus();
			}
		};

		expandDisclosures();
		const t1 = setTimeout(expandDisclosures, 50);
		const t2 = setTimeout(expandDisclosures, 200);
		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
		};
	}, [errorText, isFatal, isOutcomeError]);

	const collapsedContent = (
		<>
			<span
				className="dsh-schedule-command-separator"
				data-shimmer-decoration
				aria-hidden
			/>
			<span
				className="dsh-schedule-command-status"
				data-error={isOutcomeError ? "true" : undefined}
				title={
					completedTime ? new Date(completedTime).toLocaleString() : undefined
				}
			>
				<TextShimmer active={isRunning}>{summary}</TextShimmer>
			</span>
		</>
	);

	return (
		<div
			ref={cardRef}
			className="dsh-schedule-command-card"
			data-state={isOutcomeError ? "error" : isRunning ? "running" : "ok"}
		>
			<style href="dsh-schedule-script" precedence="default">
				{SCHEDULE_SCRIPT_CSS}
			</style>
			<DisclosureRow
				icon={<IconApiOutlineRegular size={14} />}
				title={node.name ?? SCHEDULE_SCRIPT_EVENT_NAME}
				running={isRunning}
				open={false}
				expandable={false}
				onToggle={() => {}}
				collapsedContent={collapsedContent}
			/>
			{errorText && (
				<div
					className="dsh-schedule-command-error-line"
					data-fatal={isFatal ? "true" : undefined}
				>
					<span className="dsh-schedule-command-error-bullet" aria-hidden>
						{isFatal ? "✖" : "⚠"}
					</span>
					<span className="dsh-schedule-command-error-text" title={errorText}>
						{errorText}
					</span>
				</div>
			)}
		</div>
	);
}

export const name = "dsh-schedule-script";
export const inject = ["slots", "remote", "remote.schedule"] as const;

export function apply(ctx: ClientContext): void {
	// Register in prompt toolbar (conversation.input.left) at order 85
	ctx.effect(
		() =>
			ctx.slots.inject("conversation.input.left", () =>
				ctx.slots.register(
					{
						name: "conversation.input.left",
						id: "schedule-script.prompt-button",
						order: 85,
						inject: (sessionId: string) => ({
							ctx,
							sessionId,
						}),
					},
					ConnectedScheduleScriptPromptButton,
				),
			),
		"schedule-script: prompt-button",
	);

	// Register in chat trajectory (conversation.chat.commandview)
	ctx.effect(
		() =>
			ctx.slots.inject("conversation.chat.commandview", () =>
				ctx.slots.register(
					{
						name: "conversation.chat.commandview",
						key: SCHEDULE_SCRIPT_EVENT_NAME,
					},
					ScheduleScriptCommandCard,
				),
			),
		"schedule-script: commandview",
	);
}
