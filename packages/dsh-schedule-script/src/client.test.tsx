// @vitest-environment happy-dom
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import type { SessionProjectionMap } from "@deepseek-ai/dsh-session-projection";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { test, vi } from "vitest";
import {
	ConnectedScheduleScriptPromptButton,
	formatClockTime,
	resolveEffectiveScriptState,
	ScheduleScriptCommandCard,
	ScheduleScriptPopoverCard,
	ScheduleScriptPromptButton,
	useScheduleCatalogStatus,
} from "./client.tsx";
import { initialScheduleScriptSummary } from "./fold.ts";
import { formatScriptPrompt } from "./parser.ts";
import { SCHEDULE_SCRIPT_CSS } from "./styles.ts";
import type { ScheduleScriptSummary } from "./types.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("catalog refreshes on changes and reset, retains failures, and disposes stale responses", async () => {
	const ctx = new Context();
	const changed = new Set<() => void>();
	const item = {
		status: "active",
		target: { kind: "session", sessionId: "one" },
		involvedSessionIds: [],
		prompt: formatScriptPrompt({ scriptPath: "worker.ts", state: {} }),
	};
	const catalog = vi
		.fn<
			() => Promise<
				{ ok: true; value: (typeof item)[] } | { ok: false; error: Error }
			>
		>()
		.mockResolvedValue({ ok: true, value: [item] });
	ctx.provide("remote", {
		schedule: { catalog },
		$on: (_event: string, cb: () => void) => {
			changed.add(cb);
			return () => {
				changed.delete(cb);
			};
		},
	});
	const observe =
		vi.fn<(value: ReturnType<typeof useScheduleCatalogStatus>) => void>();
	function Harness({ sessionId }: { sessionId: string }) {
		observe(useScheduleCatalogStatus(ctx, sessionId));
		return null;
	}
	const root = createRoot(document.createElement("div"));
	const status = () => {
		const last = observe.mock.lastCall;
		assert.ok(last);
		return last[0];
	};
	try {
		await act(async () => root.render(<Harness sessionId="one" />));
		assert.equal(status().status, "active");
		catalog.mockResolvedValueOnce({ ok: false, error: new Error("offline") });
		await act(async () => {
			for (const cb of changed) cb();
		});
		assert.equal(status().status, "active");
		await act(async () => {
			ctx.emit("connection/reset");
		});
		assert.equal(catalog.mock.calls.length, 3);
		const response =
			Promise.withResolvers<Awaited<ReturnType<typeof catalog>>>();
		catalog.mockReturnValueOnce(response.promise);
		await act(async () => root.render(<Harness sessionId="two" />));
		assert.equal(status().settled, false);
		await act(async () => root.unmount());
		const count = observe.mock.calls.length;
		await act(async () => response.resolve({ ok: true, value: [] }));
		assert.equal(observe.mock.calls.length, count);
		assert.equal(changed.size, 0);
		ctx.emit("connection/reset");
		assert.equal(catalog.mock.calls.length, 4);
	} finally {
		await act(async () => root.unmount());
	}
});

test("resolveEffectiveScriptState correctly prioritizes execution and schedule states", () => {
	// Active with completed runs -> "active"
	assert.deepEqual(
		resolveEffectiveScriptState(
			{ scriptStatus: "idle", totalRuns: 6, scriptPath: "watcher.ts" },
			"active",
		),
		{
			scheduleStatus: "active",
			scriptStatus: "idle",
			displayStatus: "active",
			badgeText: "Active",
		},
	);

	// Zero runs with active schedule -> "active"
	assert.deepEqual(
		resolveEffectiveScriptState(
			{ scriptStatus: "idle", totalRuns: 0, scriptPath: "watcher.ts" },
			"active",
		),
		{
			scheduleStatus: "active",
			scriptStatus: "idle",
			displayStatus: "active",
			badgeText: "Active",
		},
	);

	// Paused in automation tasks -> "paused"
	assert.deepEqual(
		resolveEffectiveScriptState(
			{ scriptStatus: "idle", totalRuns: 6, scriptPath: "watcher.ts" },
			"paused",
		),
		{
			scheduleStatus: "paused",
			scriptStatus: "idle",
			displayStatus: "paused",
			badgeText: "Paused",
		},
	);

	// Fatal error overrides paused/active -> "error"
	assert.deepEqual(
		resolveEffectiveScriptState(
			{
				scriptStatus: "error",
				totalRuns: 6,
				scriptPath: "watcher.ts",
				lastError: { message: "Fatal crash", fatal: true, timestamp: 123 },
			},
			"active",
		),
		{
			scheduleStatus: "active",
			scriptStatus: "error",
			displayStatus: "error",
			badgeText: "Error",
		},
	);

	// Recoverable warning -> "warning"
	assert.deepEqual(
		resolveEffectiveScriptState(
			{
				scriptStatus: "warning",
				totalRuns: 6,
				scriptPath: "watcher.ts",
				lastError: {
					message: "Recoverable warning",
					fatal: false,
					timestamp: 123,
				},
			},
			"active",
		),
		{
			scheduleStatus: "active",
			scriptStatus: "warning",
			displayStatus: "warning",
			badgeText: "Warning",
		},
	);

	// Omitted scheduleStatus preserves active state (not coerced to "deleted")
	assert.deepEqual(
		resolveEffectiveScriptState({
			scriptStatus: "idle",
			totalRuns: 6,
			scriptPath: "watcher.ts",
		}),
		{
			scheduleStatus: undefined,
			scriptStatus: "idle",
			displayStatus: "active",
			badgeText: "Active",
		},
	);

	// Clean script stop with deleted schedule -> "stopped"
	assert.deepEqual(
		resolveEffectiveScriptState(
			{ scriptStatus: "stopped", totalRuns: 3, scriptPath: "watcher.ts" },
			"deleted",
		),
		{
			scheduleStatus: "deleted",
			scriptStatus: "stopped",
			displayStatus: "stopped",
			badgeText: "Stopped",
		},
	);
});

test("initialScheduleScriptSummary defaults scriptStatus to idle", () => {
	const initial = initialScheduleScriptSummary();
	assert.equal(initial.scriptStatus, "idle");
	assert.equal(initial.totalRuns, 0);
});

test("ScheduleScriptPopoverCard prioritizes clean script stop over schedule deletion banner", async () => {
	const summary: ScheduleScriptSummary = {
		scriptStatus: "stopped",
		totalRuns: 4,
		scriptPath: "clean-stop.ts",
	};

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(
				<ScheduleScriptPopoverCard
					summary={summary}
					scheduleStatus="deleted"
					isStatic={true}
				/>,
			);
		});

		const callout = document.querySelector(".dsh-schedule-callout-stopped");
		assert.ok(callout);
		assert.match(
			callout.textContent ?? "",
			/Execution stopped cleanly after #4 runs/,
		);
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

test("ConnectedScheduleScriptPromptButton reads useProjection and renders active status for session with completed runs", async () => {
	const ctx = new Context();
	const item = {
		status: "active",
		target: { kind: "session", sessionId: "session-4cda7f89" },
		involvedSessionIds: [],
		prompt: formatScriptPrompt({ scriptPath: "watcher.ts", state: {} }),
	};
	ctx.provide("remote", {
		schedule: { catalog: async () => ({ ok: true, value: [item] }) },
		$on: () => () => {},
	});

	const projection: ScheduleScriptSummary = {
		scriptStatus: "idle",
		totalRuns: 6,
		scriptPath: "watcher.ts",
		lastRunAt: 1794493140038,
		lastDurationMs: 1639,
	};

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(
				<ConnectedScheduleScriptPromptButton
					ctx={ctx}
					sessionId="session-4cda7f89"
					useProjection={<K extends keyof SessionProjectionMap>(
						key: K,
					): SessionProjectionMap[K] =>
						(key === "dshScheduleScript"
							? projection
							: null) as SessionProjectionMap[K]
					}
				/>,
			);
		});

		const btn = document.querySelector(".dsh-schedule-icon-btn");
		assert.ok(btn);
		assert.match(btn.getAttribute("title") ?? "", /Active · 6 runs/);
		const badge = document.querySelector(".dsh-schedule-dot-badge");
		assert.equal(badge?.getAttribute("data-status"), "active");
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

test("popover anchors remain paired with their own trigger across renders", async () => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const summary: ScheduleScriptSummary = {
		scriptStatus: "idle",
		totalRuns: 1,
		scriptPath: "worker.ts",
	};
	const render = () =>
		root.render(
			<>
				<ScheduleScriptPromptButton summary={summary} initialOpen />
				<ScheduleScriptPromptButton summary={summary} initialOpen />
			</>,
		);
	try {
		await act(async () => render());
		const buttons = Array.from(
			container.querySelectorAll<HTMLButtonElement>("button"),
		);
		const panels = Array.from(
			document.querySelectorAll<HTMLDivElement>(".dsh-schedule-popover"),
		);
		const anchors = buttons.map((button) => button.style.anchorName);
		assert.ok(anchors.every((anchor) => anchor.startsWith("--dsh-schedule-")));
		assert.equal(new Set(anchors).size, 2);
		assert.deepEqual(
			panels.map((panel) => panel.style.positionAnchor),
			anchors,
		);
		await act(async () => render());
		assert.deepEqual(
			buttons.map((button) => button.style.anchorName),
			anchors,
		);
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

test("formatClockTime formats timestamp as HH:mm", () => {
	const date = new Date(2026, 10, 13, 10, 24, 0);
	assert.equal(formatClockTime(date.getTime()), "10:24");
});

test("ScheduleScriptCommandCard displays 'Completed at HH:mm' with timestamp", async () => {
	const fixedDate = new Date(2026, 10, 13, 10, 24, 0).getTime();
	const node = {
		name: "dsh-schedule-script",
		args: JSON.stringify({
			action: "iteration",
			timestamp: fixedDate - 2000,
			durationMs: 2000,
		}),
		outcome: { kind: "success" as const },
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(<ScheduleScriptCommandCard node={node} />);
		});
		const status = container.querySelector(".dsh-schedule-command-status");
		assert.ok(status);
		assert.equal(status.textContent, "Completed at 10:24");
		assert.equal(
			status.getAttribute("title"),
			new Date(fixedDate).toLocaleString(),
		);
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

test("ScheduleScriptCommandCard displays 'Running' without time suffix while running", async () => {
	const node = {
		name: "dsh-schedule-script",
		args: JSON.stringify({
			action: "iteration",
			timestamp: Date.now(),
		}),
		outcome: null,
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(<ScheduleScriptCommandCard node={node} />);
		});
		const status = container.querySelector(".dsh-schedule-command-status");
		assert.ok(status);
		assert.equal(status.textContent, "Running");
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

test("ScheduleScriptCommandCard displays 'Failed at HH:mm' when outcome is error", async () => {
	const fixedDate = new Date(2026, 10, 13, 10, 24, 0).getTime();
	const node = {
		name: "dsh-schedule-script",
		args: JSON.stringify({
			action: "error",
			error: "Script crashed",
			timestamp: fixedDate,
		}),
		outcome: { kind: "error" as const },
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(<ScheduleScriptCommandCard node={node} />);
		});
		const status = container.querySelector(".dsh-schedule-command-status");
		assert.ok(status);
		assert.equal(status.textContent, "Failed at 10:24");
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

test("SCHEDULE_SCRIPT_CSS prevents status text from wrapping and truncates with ellipsis", () => {
	assert.match(
		SCHEDULE_SCRIPT_CSS,
		/\.dsh-schedule-command-status\s*\{[^}]*white-space:\s*nowrap;/,
	);
	assert.match(
		SCHEDULE_SCRIPT_CSS,
		/\.dsh-schedule-command-status\s*\{[^}]*text-overflow:\s*ellipsis;/,
	);
	assert.match(
		SCHEDULE_SCRIPT_CSS,
		/\.dsh-schedule-command-status\s*\{[^}]*overflow:\s*hidden;/,
	);
});
