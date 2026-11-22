import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { SCHEDULE_SCRIPT_SKILL_NAME } from "./skill.ts";
import {
	SCHEDULE_SCRIPT_EVENT_NAME,
	type ScheduleScriptEventPayload,
	type ScheduleScriptSummary,
} from "./types.ts";

export function initialScheduleScriptSummary(): ScheduleScriptSummary {
	return {
		scriptStatus: "idle",
		skillInvoked: false,
		totalRuns: 0,
	};
}

export function foldScheduleScriptEvent(
	state: ScheduleScriptSummary,
	event: SessionEvent,
): ScheduleScriptSummary {
	if (event.type === "tool/call") {
		if (event.data.name === "skill") {
			try {
				const raw =
					(event.data as { arguments?: unknown; args?: unknown }).arguments ??
					(event.data as { arguments?: unknown; args?: unknown }).args;
				const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
				if (
					parsed &&
					typeof parsed === "object" &&
					(parsed as { name?: string }).name === SCHEDULE_SCRIPT_SKILL_NAME
				) {
					if (state.skillInvoked) return state;
					return {
						...state,
						skillInvoked: true,
					};
				}
			} catch {
				// ignore malformed arguments
			}
		}
		return state;
	}
	if (event.type !== "command/run") return state;
	if (
		event.data.name !== SCHEDULE_SCRIPT_EVENT_NAME ||
		typeof event.data.args !== "string"
	) {
		return state;
	}

	try {
		const payload = JSON.parse(event.data.args) as ScheduleScriptEventPayload;
		if (payload.action === "skill") {
			return {
				...state,
				skillInvoked: true,
			};
		}
		if (payload.action === "start") {
			const {
				lastError: _,
				scheduleId: _id,
				cleanupPending: _pending,
				cleanupError: _cleanup,
				...rest
			} = state;
			return {
				...rest,
				scriptStatus: "idle",
				scriptPath: payload.scriptPath,
				state: payload.state,
			};
		}
		if (payload.action === "iteration") {
			const { lastError: _, ...rest } = state;
			const next: ScheduleScriptSummary = {
				...rest,
				scriptStatus: payload.error ? "warning" : "idle",
				scriptPath: payload.scriptPath,
				totalRuns: state.totalRuns + 1,
				lastRunAt: payload.timestamp,
				lastDurationMs: payload.durationMs,
			};
			if (payload.scheduleId !== undefined)
				next.scheduleId = payload.scheduleId;
			if (payload.state !== undefined) {
				next.state = payload.state;
			}
			if (payload.prompt) {
				next.lastPrompt = {
					message: payload.prompt,
					timestamp: payload.timestamp,
				};
			}
			if (payload.error) {
				next.lastError = {
					message: payload.error,
					timestamp: payload.timestamp,
					fatal: false,
				};
			}
			return next;
		}
		if (payload.action === "error") {
			return {
				...state,
				scriptStatus: payload.fatal === false ? "warning" : "error",
				...(payload.scheduleId !== undefined
					? { scheduleId: payload.scheduleId }
					: {}),
				scriptPath: payload.scriptPath,
				lastError: {
					message: payload.error,
					timestamp: payload.timestamp,
					fatal: payload.fatal !== false,
				},
			};
		}
		if (payload.action === "stop") {
			return {
				...state,
				scriptStatus: state.scriptStatus === "error" ? "error" : "stopped",
				cleanupPending: true,
				...(payload.scheduleId !== undefined
					? { scheduleId: payload.scheduleId }
					: {}),
			};
		}
		if (payload.action === "cleanup") {
			const { cleanupError: _, ...rest } = state;
			return {
				...rest,
				cleanupPending: payload.error !== undefined,
				...(payload.error !== undefined ? { cleanupError: payload.error } : {}),
			};
		}
	} catch {
		// ignore malformed payloads
	}

	return state;
}

export function toScheduleScriptRecord(
	summary: ScheduleScriptSummary,
): ScheduleScriptSummary | null {
	return summary.skillInvoked ||
		summary.totalRuns > 0 ||
		summary.scriptPath !== undefined
		? summary
		: null;
}
