import type { Story } from "@ladle/react";
import { useState } from "react";
import {
	ScheduleScriptCommandCard,
	ScheduleScriptPopoverCard,
	ScheduleScriptPromptButton,
} from "../client.tsx";
import type { ScheduleScriptSummary } from "../types.ts";

const now = Date.now();

export const activeSuccessSummary: ScheduleScriptSummary = {
	scriptStatus: "idle",
	scriptPath: ".agents/scratch/session-example/test-script.ts",
	totalRuns: 6,
	lastDurationMs: 104,
	lastRunAt: now - 35 * 1000,
	state: { count: 6 },
};

export const scheduledPendingSummary: ScheduleScriptSummary = {
	scriptStatus: "idle",
	scriptPath: ".agents/scripts/sync-database.ts",
	totalRuns: 0,
	lastDurationMs: undefined,
	lastRunAt: undefined,
};

export const recoverableWarningSummary: ScheduleScriptSummary = {
	scriptStatus: "warning",
	scriptPath: ".agents/scratch/session-example/test-script.ts",
	totalRuns: 7,
	lastDurationMs: 106,
	lastRunAt: now - 75 * 1000,
	state: { count: 7 },
	lastError: {
		message:
			"Recoverable error on run 2: transient API failure, will retry next interval",
		timestamp: now - 75 * 1000,
		fatal: false,
	},
};

export const fatalErrorSummary: ScheduleScriptSummary = {
	scriptStatus: "error",
	scriptPath: ".agents/scratch/session-example/test-script.ts",
	totalRuns: 8,
	lastDurationMs: 112,
	lastRunAt: now - 180 * 1000,
	state: { count: 8 },
	lastError: {
		message:
			"Unrecoverable error on run 3: fatal exception thrown during execution (count=3)",
		timestamp: now - 180 * 1000,
		fatal: true,
	},
};

export const stoppedCleanlySummary: ScheduleScriptSummary = {
	scriptStatus: "stopped",
	scriptPath: ".agents/scripts/export-metrics.ts",
	totalRuns: 3,
	lastDurationMs: 95,
	lastRunAt: now - 450 * 1000,
	state: { count: 3, done: true },
};

export const pausedSummary: ScheduleScriptSummary = {
	scriptStatus: "idle",
	scriptPath: ".agents/skills/price-watcher/scripts/watcher.ts",
	totalRuns: 2,
	lastDurationMs: 870,
	lastRunAt: now - 120 * 1000,
	state: { description: "Example phone (base model only, good condition)" },
};

export const deletedAutomationSummary: ScheduleScriptSummary = {
	scriptStatus: "idle",
	scriptPath: ".agents/scripts/cleanup-logs.ts",
	totalRuns: 4,
	lastDurationMs: 140,
	lastRunAt: now - 600 * 1000,
	state: { cleaned: 4 },
};

/** Standalone card for an actively running background script with successful runs. */
export const ActiveSuccess: Story = () => (
	<div style={{ width: "320px", padding: "16px" }}>
		<ScheduleScriptPopoverCard summary={activeSuccessSummary} isStatic />
	</div>
);

/** Initial script waiting for its first interval. */
export const InitialPending: Story = () => (
	<div style={{ width: "320px", padding: "16px" }}>
		<ScheduleScriptPopoverCard summary={scheduledPendingSummary} isStatic />
	</div>
);

/** Script encountering a recoverable warning; continues recurring without interrupting LLM. */
export const RecoverableWarning: Story = () => (
	<div style={{ width: "320px", padding: "16px" }}>
		<ScheduleScriptPopoverCard summary={recoverableWarningSummary} isStatic />
	</div>
);

/** Script terminated due to an unhandled exception. */
export const FatalError: Story = () => (
	<div style={{ width: "320px", padding: "16px" }}>
		<ScheduleScriptPopoverCard summary={fatalErrorSummary} isStatic />
	</div>
);

/** Script that called stop: true and cleanly exited. */
export const StoppedCleanly: Story = () => (
	<div style={{ width: "320px", padding: "16px" }}>
		<ScheduleScriptPopoverCard summary={stoppedCleanlySummary} isStatic />
	</div>
);

/** Script paused by user in Automation Tasks UI (amber warning dot, paused callout). */
export const PausedInUi: Story = () => (
	<div style={{ width: "320px", padding: "16px" }}>
		<ScheduleScriptPopoverCard
			summary={pausedSummary}
			scheduleStatus="paused"
			isStatic
		/>
	</div>
);

/** Automation task deleted from UI while keeping session run history (gray stopped dot). */
export const DeletedFromUi: Story = () => (
	<div style={{ width: "320px", padding: "16px" }}>
		<ScheduleScriptPopoverCard
			summary={deletedAutomationSummary}
			scheduleStatus="deleted"
			isStatic
		/>
	</div>
);

/** Interactive button embedded inside a simulated prompt area toolbar. */
export const InteractivePromptToolbar: Story = () => {
	const [activeState, setActiveState] = useState<
		"success" | "warning" | "error" | "pending"
	>("success");

	const summaryMap: Record<string, ScheduleScriptSummary> = {
		success: activeSuccessSummary,
		warning: recoverableWarningSummary,
		error: fatalErrorSummary,
		pending: scheduledPendingSummary,
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "24px",
				paddingTop: "320px",
			}}
		>
			<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
				<span
					style={{
						fontSize: "12px",
						color: "var(--dsw-alias-label-secondary)",
					}}
				>
					Simulate State:
				</span>
				{(["success", "warning", "error", "pending"] as const).map((key) => (
					<button
						key={key}
						type="button"
						onClick={() => setActiveState(key)}
						style={{
							padding: "4px 8px",
							fontSize: "12px",
							borderRadius: "4px",
							border: "1px solid var(--dsw-alias-border-l1)",
							background:
								activeState === key
									? "var(--dsw-alias-interactive-bg-active)"
									: "var(--dsw-alias-bg-base)",
							color: "var(--dsw-alias-label-primary)",
							cursor: "pointer",
							fontWeight: activeState === key ? 600 : 400,
						}}
					>
						{key}
					</button>
				))}
			</div>

			{/* Simulated Prompt Bar container */}
			<div
				style={{
					border: "1px solid var(--dsw-alias-border-l1)",
					borderRadius: "8px",
					padding: "8px 12px",
					background: "var(--dsw-alias-bg-base)",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					width: "100%",
					maxWidth: "600px",
					boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
					<ScheduleScriptPromptButton
						summary={summaryMap[activeState]}
						initialOpen={true}
					/>
					<span
						style={{
							fontSize: "12px",
							color: "var(--dsw-alias-label-tertiary)",
						}}
					>
						(Click icon above to toggle telemetry popup)
					</span>
				</div>
				<span
					style={{ fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" }}
				>
					Prompt Input Bar
				</span>
			</div>
		</div>
	);
};

/** All 5 variants displayed simultaneously for visual review and comparison. */
export const AllStatesComparison: Story = () => (
	<div
		style={{
			display: "grid",
			gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
			gap: "20px",
			padding: "16px 0",
		}}
	>
		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "8px",
					opacity: 0.7,
				}}
			>
				1. Active / Success
			</div>
			<ScheduleScriptPopoverCard summary={activeSuccessSummary} isStatic />
		</div>
		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "8px",
					opacity: 0.7,
				}}
			>
				2. Initial / Pending
			</div>
			<ScheduleScriptPopoverCard summary={scheduledPendingSummary} isStatic />
		</div>
		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "8px",
					opacity: 0.7,
				}}
			>
				3. Warning (Recoverable)
			</div>
			<ScheduleScriptPopoverCard summary={recoverableWarningSummary} isStatic />
		</div>
		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "8px",
					opacity: 0.7,
				}}
			>
				4. Fatal Error
			</div>
			<ScheduleScriptPopoverCard summary={fatalErrorSummary} isStatic />
		</div>
		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "8px",
					opacity: 0.7,
				}}
			>
				5. Stopped Cleanly
			</div>
			<ScheduleScriptPopoverCard summary={stoppedCleanlySummary} isStatic />
		</div>
	</div>
);

/** Command rows rendered inside the chat step process / trajectory. */
export const ChatTrajectoryCommandRows: Story = () => (
	<div
		style={{
			display: "flex",
			flexDirection: "column",
			gap: "16px",
			maxWidth: "600px",
			padding: "24px",
			background: "var(--dsw-alias-bg-base)",
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: "8px",
		}}
	>
		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "4px",
					opacity: 0.7,
				}}
			>
				1. Silent iteration (completed without error):
			</div>
			<ScheduleScriptCommandCard
				node={{
					name: "dsh-schedule-script",
					outcome: { kind: "success" },
					args: JSON.stringify({
						action: "iteration",
						scriptPath: ".agents/scripts/poller.ts",
						iteration: 1,
						durationMs: 95,
						timestamp: now,
					}),
				}}
			/>
		</div>

		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "4px",
					opacity: 0.7,
				}}
			>
				2. Recoverable warning (separate line shown with error):
			</div>
			<ScheduleScriptCommandCard
				node={{
					name: "dsh-schedule-script",
					outcome: { kind: "success" },
					args: JSON.stringify({
						action: "iteration",
						scriptPath: ".agents/scripts/dummy-error.ts",
						iteration: 2,
						durationMs: 110,
						timestamp: now,
						error:
							"Simulated recoverable error on run #2: connection timeout to upstream service",
					}),
				}}
			/>
		</div>

		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "4px",
					opacity: 0.7,
				}}
			>
				3. Fatal exception (outcome failed, separate error line):
			</div>
			<ScheduleScriptCommandCard
				node={{
					name: "dsh-schedule-script",
					outcome: { kind: "error" },
					args: JSON.stringify({
						action: "error",
						scriptPath: ".agents/scripts/dummy-error.ts",
						iteration: 3,
						timestamp: now,
						fatal: true,
						error: "SyntaxError: Unexpected token 'export' in line 1",
					}),
				}}
			/>
		</div>

		<div>
			<div
				style={{
					fontSize: "12px",
					fontWeight: 600,
					marginBottom: "4px",
					opacity: 0.7,
				}}
			>
				4. In-flight execution:
			</div>
			<ScheduleScriptCommandCard
				node={{
					name: "dsh-schedule-script",
					outcome: null,
					args: JSON.stringify({
						action: "iteration",
						scriptPath: ".agents/scripts/poller.ts",
						iteration: 4,
						timestamp: now,
					}),
				}}
			/>
		</div>
	</div>
);
