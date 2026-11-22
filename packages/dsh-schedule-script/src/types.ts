import type {} from "@deepseek-ai/dsh-session-projection";
import type {} from "@deepseek-ai/dsh-session-projection/types";
import { z } from "zod";

export const SCHEDULE_SCRIPT_KIND = "dsh-schedule-script" as const;
export const SCHEDULE_SCRIPT_EVENT_NAME = "dsh-schedule-script" as const;

export interface ScriptContext<TState = unknown> {
	state: TState;
	sessionId: string;
}

export interface ScriptResult<TState = unknown> {
	state: TState;
	/** If set, awakens the agent and passes this prompt to the model */
	prompt?: string;
	/** Recoverable error; surfaces in UI row without stopping or prompting LLM */
	error?: string;
	/** Explicitly stop further recurrences */
	stop?: boolean;
}

export type BackgroundScriptMain<TState = unknown> = (
	ctx: ScriptContext<TState>,
) => Promise<ScriptResult<TState>> | ScriptResult<TState>;

export interface ScheduleScriptPromptPayload {
	readonly kind: typeof SCHEDULE_SCRIPT_KIND;
	readonly scriptPath: string;
	readonly state: unknown;
	readonly timeoutMs?: number;
}

export type ScheduleScriptEventPayload =
	| {
			readonly action: "skill";
			readonly timestamp: number;
	  }
	| {
			readonly action: "start";
			readonly scriptPath: string;
			readonly state: unknown;
			readonly timestamp: number;
	  }
	| {
			readonly action: "iteration";
			readonly scheduleId?: string;
			readonly scriptPath: string;
			readonly iteration: number;
			readonly state: unknown;
			readonly durationMs: number;
			readonly timestamp: number;
			readonly prompt?: string;
			readonly error?: string;
	  }
	| {
			readonly action: "error";
			readonly scheduleId?: string;
			readonly scriptPath: string;
			readonly iteration: number;
			readonly error: string;
			readonly timestamp: number;
			readonly fatal?: boolean;
	  }
	| {
			readonly action: "stop";
			readonly scheduleId?: string;
			readonly reason: string;
			readonly timestamp: number;
	  }
	| {
			readonly action: "cleanup";
			readonly error?: string;
			readonly timestamp: number;
	  };

export const scriptExecutionStatusSchema = z.enum([
	"idle",
	"running",
	"warning",
	"error",
	"stopped",
]);
export type ScriptExecutionStatus = z.infer<typeof scriptExecutionStatusSchema>;

export const scheduleSystemStatusSchema = z.enum([
	"active",
	"paused",
	"ended",
	"deleted",
]);
export type ScheduleSystemStatus = z.infer<typeof scheduleSystemStatusSchema>;

export const scheduleScriptSummarySchema = z.object({
	scriptStatus: scriptExecutionStatusSchema,
	skillInvoked: z.boolean().optional(),
	scheduleId: z.string().optional(),
	cleanupPending: z.boolean().optional(),
	cleanupError: z.string().optional(),
	scriptPath: z.string().optional(),
	totalRuns: z.number(),
	lastRunAt: z.number().optional(),
	lastDurationMs: z.number().optional(),
	state: z.unknown().optional(),
	lastPrompt: z
		.object({
			message: z.string(),
			timestamp: z.number(),
		})
		.optional(),
	lastError: z
		.object({
			message: z.string(),
			timestamp: z.number(),
			fatal: z.boolean().default(false),
		})
		.optional(),
});

export type ScheduleScriptSummary = z.infer<typeof scheduleScriptSummarySchema>;

declare module "@deepseek-ai/dsh-session-projection/types" {
	interface SessionProjectionMap {
		dshScheduleScript: ScheduleScriptSummary | null;
	}
}

declare module "@deepseek-ai/dsh-session-projection" {
	interface SessionProjectionMap {
		dshScheduleScript: ScheduleScriptSummary | null;
	}
}
