import { isDeepStrictEqual } from "node:util";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandId } from "@deepseek-ai/dsh-commands";
import type { Session } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { executeScript } from "./executor.ts";
import {
	foldScheduleScriptEvent,
	initialScheduleScriptSummary,
	toScheduleScriptRecord,
} from "./fold.ts";
import {
	formatRemainingBatch,
	formatScriptPrompt,
	formatWakingPrompt,
	parseReminderBatch,
	parseScriptPrompt,
} from "./parser.ts";
import {
	SCHEDULE_SCRIPT_SKILL_CONTENT,
	SCHEDULE_SCRIPT_SKILL_DESCRIPTION,
	SCHEDULE_SCRIPT_SKILL_NAME,
} from "./skill.ts";
import {
	SCHEDULE_SCRIPT_EVENT_NAME,
	type ScheduleScriptEventPayload,
	type ScheduleScriptPromptPayload,
	scheduleScriptSummarySchema,
} from "./types.ts";

export * from "./executor.ts";
export * from "./fold.ts";
export { formatScriptPrompt } from "./parser.ts";
export * from "./skill.ts";
export * from "./types.ts";

export interface ScheduleCatalogEntry {
	readonly id: string;
	readonly title?: string;
	readonly prompt?: string;
	readonly status?: "active" | "paused" | "ended";
	readonly target?: {
		readonly kind: string;
		readonly sessionId?: string;
	};
	readonly involvedSessionIds?: readonly string[];
}

export interface ScheduleListRequest {
	readonly active?: boolean;
	readonly limit?: number;
	readonly offset?: number;
}

export interface ScheduleListResult {
	readonly items: readonly ScheduleCatalogEntry[];
	readonly shown: number;
	readonly total: number;
	readonly limit: number;
	readonly offset: number;
}

export interface ScheduleCreateRequest {
	readonly title: string;
	readonly prompt: string;
	readonly timing: { readonly kind: "every"; readonly every_seconds: number };
	readonly target: { readonly kind: "session"; readonly sessionId: string };
}

export interface ScheduleEditRequest {
	readonly id: string;
	readonly action: "delete" | "update";
}

export interface ScheduleService {
	create: (req: ScheduleCreateRequest) => Promise<unknown>;
	list: (req?: ScheduleListRequest) => Promise<ScheduleListResult>;
	edit: (req: ScheduleEditRequest) => Promise<unknown>;
}

declare module "@deepseek-ai/cordis" {
	interface Context {
		skills: {
			register: (spec: {
				name: string;
				description: string;
				source: string;
				content: string;
			}) => () => void;
		};
		schedule: ScheduleService;
	}
}

export const name = "dsh-schedule-script";
export const inject = [
	"commands",
	"sessionProjections",
	"tools",
	"skills",
	"schedule",
] as const;

export async function apply(ctx: Context): Promise<void> {
	const projectionHandle = await ctx.sessionProjections.register({
		key: "dshScheduleScript",
		stateSchema: scheduleScriptSummarySchema,
		init: () => initialScheduleScriptSummary(),
		apply: (state, event) => foldScheduleScriptEvent(state, event),
		wire: {
			viewSchema: scheduleScriptSummarySchema.nullable(),
			view: toScheduleScriptRecord,
		},
		stateVersion: 1,
	});

	ctx.effect(() => () => projectionHandle.dispose());

	function isScheduleScriptActive(session: Session): boolean {
		const summary = projectionHandle.stateOf(session);
		return (
			Boolean(summary.skillInvoked) ||
			summary.totalRuns > 0 ||
			summary.scriptPath !== undefined
		);
	}

	function appendScriptEvent(
		session: Session,
		payload: ScheduleScriptEventPayload,
		idSuffix: string,
	): void {
		const commandId = `schedule-script-${idSuffix}` as CommandId;
		session.append("command/run", {
			commandId,
			name: SCHEDULE_SCRIPT_EVENT_NAME,
			args: JSON.stringify(payload),
			source: { kind: "user" },
		});
		session.append("command/done", {
			commandId,
			kind:
				payload.action === "error" && payload.fatal !== false
					? "error"
					: "success",
		});
	}

	// Register embedded skill directly via injected skills service
	ctx.effect(() => {
		const unregister = ctx.skills.register({
			name: SCHEDULE_SCRIPT_SKILL_NAME,
			description: SCHEDULE_SCRIPT_SKILL_DESCRIPTION,
			source: "runtime",
			content: SCHEDULE_SCRIPT_SKILL_CONTENT,
		});
		return () => unregister();
	});

	ctx.on("tools/post-execute", async (exec, result, next) => {
		const decision = await next();
		if (exec.name === "skill" && exec.agent?.session && !result.isError) {
			try {
				const args =
					typeof exec.arguments === "string"
						? JSON.parse(exec.arguments)
						: exec.arguments;
				if (args?.name === SCHEDULE_SCRIPT_SKILL_NAME) {
					appendScriptEvent(
						exec.agent.session,
						{
							action: "skill",
							timestamp: Date.now(),
						},
						`skill-${Date.now()}`,
					);
				}
			} catch {
				// ignore malformed arguments
			}
		}
		return decision;
	});

	ctx.effect(() => {
		return () => projectionHandle.dispose();
	});

	async function activeScriptTasks(sessionId: string) {
		const tasks = new Map<string, ScheduleScriptPromptPayload>();
		let offset = 0;
		let total: number;
		do {
			const page = await ctx.schedule.list({ active: true, offset });
			for (const item of page.items) {
				if (
					item.target !== undefined &&
					item.target.kind === "session" &&
					item.target.sessionId === sessionId &&
					item.prompt !== undefined
				) {
					const payload = parseScriptPrompt(item.prompt);
					if (payload !== null) tasks.set(item.id, payload);
				}
			}
			offset = page.offset + page.limit;
			total = page.total;
		} while (offset < total);
		return tasks;
	}

	function verifyBatch(
		batch: NonNullable<ReturnType<typeof parseReminderBatch>>,
		tasks: Map<string, ScheduleScriptPromptPayload>,
	) {
		const remaining = [...batch.remainingReminders];
		const jobs = new Map<string, ScheduleScriptPromptPayload>();
		for (const job of batch.scripts) {
			const payload = tasks.get(job.scheduleId);
			if (payload === undefined || !isDeepStrictEqual(payload, job.payload)) {
				remaining.push(job.reminder);
			} else {
				jobs.set(job.scheduleId, payload);
			}
		}
		return { jobs, remaining };
	}

	async function deleteTerminalSchedule(session: Session, scheduleId: string) {
		let error: string | undefined;
		try {
			await ctx.schedule.edit({ id: scheduleId, action: "delete" });
		} catch (failure: unknown) {
			error = `Failed to delete schedule ${scheduleId}: ${failure instanceof Error ? failure.message : String(failure)}`;
		}
		appendScriptEvent(
			session,
			{
				action: "cleanup",
				timestamp: Date.now(),
				...(error !== undefined ? { error } : {}),
			},
			`cleanup-${Date.now()}`,
		);
	}

	async function runVerifiedJob(
		session: Session,
		scheduleId: string,
		payload: ScheduleScriptPromptPayload,
		signal: AbortSignal,
	): Promise<string | undefined> {
		const summary = projectionHandle.stateOf(session);
		const ownsState =
			summary.scheduleId === undefined
				? summary.scriptPath === payload.scriptPath
				: summary.scheduleId === scheduleId;
		if (
			ownsState &&
			(summary.scriptStatus === "stopped" || summary.scriptStatus === "error")
		) {
			await deleteTerminalSchedule(session, scheduleId);
			return;
		}
		const iteration = summary.totalRuns + 1;
		const startTime = Date.now();
		let prompt: string | undefined;
		let stopReason: string | undefined;
		try {
			const result = await executeScript(
				payload.scriptPath,
				{
					state:
						ownsState && summary.state !== undefined
							? summary.state
							: payload.state,
					sessionId: session.id,
				},
				payload.timeoutMs === undefined ? 30000 : payload.timeoutMs,
				session.header.cwd,
				signal,
			);
			appendScriptEvent(
				session,
				{
					action: "iteration",
					scheduleId,
					scriptPath: payload.scriptPath,
					iteration,
					state: result.state,
					durationMs: Date.now() - startTime,
					timestamp: startTime,
					prompt: result.prompt,
					error: result.error,
				},
				`run-${iteration}`,
			);
			if (result.prompt)
				prompt = `[Scheduled Task: ${payload.scriptPath}]\n${result.prompt}`;
			if (result.stop) stopReason = "script_completed";
		} catch (error: unknown) {
			signal.throwIfAborted();
			const message = error instanceof Error ? error.message : String(error);
			appendScriptEvent(
				session,
				{
					action: "error",
					scheduleId,
					scriptPath: payload.scriptPath,
					iteration,
					error: message,
					timestamp: Date.now(),
					fatal: true,
				},
				`err-${iteration}`,
			);
			stopReason = `critical_error: ${message}`;
		}
		if (stopReason !== undefined) {
			appendScriptEvent(
				session,
				{
					action: "stop",
					scheduleId,
					reason: stopReason,
					timestamp: Date.now(),
				},
				`stop-${iteration}`,
			);
			await deleteTerminalSchedule(session, scheduleId);
		}
		return prompt;
	}

	ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
		const targetIndex = messages.findIndex(
			(m) =>
				m.content.length > 0 &&
				m.content[0].type === "text" &&
				m.content[0].text.startsWith("[SCHEDULE REMINDER BATCH]"),
		);
		if (targetIndex === -1) return next();
		const first = messages[targetIndex].content[0];
		if (first.type !== "text") return next();
		const batch = parseReminderBatch(first.text);
		if (batch === null) return next();
		const tasks = await activeScriptTasks(agent.session.id);
		const { jobs, remaining } = verifyBatch(batch, tasks);
		if (jobs.size === 0) return next();
		const prompts: string[] = [];
		if (tasks.size > 1) {
			prompts.push(
				"Multiple active script schedules target this session. Pause or delete all but one before scripts can run.",
			);
		} else {
			for (const [scheduleId, payload] of jobs) {
				const prompt = await runVerifiedJob(
					agent.session,
					scheduleId,
					payload,
					signal,
				);
				if (prompt !== undefined) prompts.push(prompt);
			}
		}
		const remainingText =
			remaining.length > 0
				? formatRemainingBatch(remaining, first.text)
				: undefined;
		const text = formatWakingPrompt(prompts, remainingText);
		if (text) {
			messages[targetIndex] = {
				...messages[targetIndex],
				content: [
					{ type: "text", text },
					...messages[targetIndex].content.slice(1),
				],
			};
			return next();
		}
		if (messages.length > 1) {
			messages.splice(targetIndex, 1);
			return next();
		}
		return { kind: "reject" };
	});

	ctx.tools.register(
		defineTool({
			name: "test_schedule_script",
			description:
				"Test-run a background script once in an isolated subprocess exactly as the scheduler would invoke it. ALWAYS test your script with this tool before calling schedule_script.",
			parameters: {
				script_path: {
					type: "string",
					required: true,
					description:
						"Path to the TypeScript script to test (e.g. .agents/scripts/sync.ts)",
				},
				state: {
					type: "object",
					required: true,
					additionalProperties: true,
					description: "Initial state to test with (mandatory)",
				},
				timeout_ms: {
					type: "number",
					default: 30000,
					description: "Execution timeout in milliseconds (default: 30000)",
				},
			},
			output: {
				schema: {
					type: "object",
					properties: {
						success: { type: "boolean", required: true },
						message: { type: "string", required: true },
						state: { type: "json" },
						prompt: { type: "string" },
						error: { type: "string" },
						stop: { type: "boolean" },
						duration_ms: { type: "number" },
					},
					additionalProperties: false,
				},
				render(_args, val) {
					return [{ type: "text", text: val.message }];
				},
			},
			async execute(args, exec) {
				const agent = exec.agent;
				if (!agent) {
					return { success: false, message: "No active agent session" };
				}

				const testState = args.state;
				const timeoutMs = args.timeout_ms ?? 30000;
				const startTime = Date.now();

				try {
					const result = await executeScript(
						args.script_path,
						{
							state: testState,
							sessionId: agent.session.id,
						},
						timeoutMs,
						agent.session.header.cwd,
					);

					const durationMs = Date.now() - startTime;
					let summaryMsg = `Test execution succeeded in ${durationMs}ms.`;
					if (result.prompt) {
						summaryMsg += ` Prompt emitted: "${result.prompt}".`;
					} else {
						summaryMsg += " Silent poll (no prompt emitted).";
					}
					if (result.error) {
						summaryMsg += ` Recoverable warning: "${result.error}".`;
					}
					if (result.stop) {
						summaryMsg += " Script requested stop.";
					}

					const payload: {
						success: boolean;
						message: string;
						state?: Parameters<typeof JSON.stringify>[0];
						prompt?: string;
						error?: string;
						stop?: boolean;
						duration_ms: number;
					} = {
						success: true,
						message: summaryMsg,
						duration_ms: durationMs,
					};
					if (result.state !== undefined) {
						payload.state = (result.state ?? null) as Parameters<
							typeof JSON.stringify
						>[0];
					}
					if (result.prompt !== undefined) {
						payload.prompt = result.prompt;
					}
					if (result.error !== undefined) {
						payload.error = result.error;
					}
					if (result.stop !== undefined) {
						payload.stop = result.stop;
					}
					return payload;
				} catch (err: unknown) {
					const durationMs = Date.now() - startTime;
					const errorMsg = err instanceof Error ? err.message : String(err);
					return {
						success: false,
						message: `Test execution failed (${durationMs}ms): ${errorMsg}`,
						error: errorMsg,
						duration_ms: durationMs,
					};
				}
			},
		}),
		{
			when: ({ agent }: { agent: Agent }) =>
				isScheduleScriptActive(agent.session),
		},
	);

	const creatingSessions = new Set<string>();
	ctx.tools.register(
		defineTool({
			name: "schedule_script",
			description:
				"Schedule a TypeScript script to run periodically in the background. It executes in an isolated Node subprocess and consumes 0 LLM tokens on silent iterations.",
			parameters: {
				script_path: {
					type: "string",
					required: true,
					description:
						"Absolute or relative path to the TypeScript script (e.g. .agents/scripts/sync.ts)",
				},
				title: {
					type: "string",
					required: true,
					description:
						"Concise human-readable name for the schedule in the user's language (e.g. 'Sync database every 5m')",
				},
				interval_seconds: {
					type: "number",
					default: 60,
					description: "Recurrence interval in seconds (minimum 60)",
				},
				state: {
					type: "object",
					required: true,
					additionalProperties: true,
					description:
						"Initial state to pass to the script's main({ state }) (mandatory)",
				},
			},
			output: {
				schema: {
					type: "object",
					properties: {
						success: { type: "boolean", required: true },
						message: { type: "string", required: true },
					},
					additionalProperties: false,
				},
				render(_args, val) {
					return [{ type: "text", text: val.message }];
				},
			},
			async execute(args, exec) {
				const agent = exec.agent;
				if (!agent) {
					return { success: false, message: "No active agent session" };
				}
				if (creatingSessions.has(agent.session.id))
					return {
						success: false,
						message:
							"A script schedule is already being created for this session.",
					};
				creatingSessions.add(agent.session.id);
				try {
					const existing = await activeScriptTasks(agent.session.id);
					if (existing.size > 0) {
						return {
							success: false,
							message:
								"This session already has an active script schedule. Pause or delete it before scheduling another.",
						};
					}
					const interval = Math.max(60, Number(args.interval_seconds) || 60);
					const promptText = formatScriptPrompt({
						scriptPath: args.script_path,
						state: args.state,
					});

					await ctx.schedule.create({
						title: args.title,
						prompt: promptText,
						timing: { kind: "every", every_seconds: interval },
						target: { kind: "session", sessionId: agent.session.id },
					});

					appendScriptEvent(
						agent.session,
						{
							action: "start",
							scriptPath: args.script_path,
							state: args.state,
							timestamp: Date.now(),
						},
						`start-${Date.now()}`,
					);

					return {
						success: true,
						message: `Scheduled background script '${args.script_path}' every ${interval}s via Automation tasks (Title: ${args.title})`,
					};
				} finally {
					creatingSessions.delete(agent.session.id);
				}
			},
		}),
		{
			when: ({ agent }: { agent: Agent }) =>
				isScheduleScriptActive(agent.session),
		},
	);
}
