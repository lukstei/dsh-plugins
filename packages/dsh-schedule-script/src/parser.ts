import {
	SCHEDULE_SCRIPT_KIND,
	type ScheduleScriptPromptPayload,
} from "./types.ts";

interface RawReminder {
	readonly schedule_id: string;
	readonly occurrence_at?: string;
	readonly reminder_prompt: string;
	readonly [key: string]: unknown;
}

interface ParsedScriptJob {
	readonly scheduleId: string;
	readonly reminder: RawReminder;
	readonly payload: ScheduleScriptPromptPayload;
}

interface ParsedBatch {
	readonly scripts: readonly ParsedScriptJob[];
	readonly remainingReminders: readonly RawReminder[];
}

export function formatScriptPrompt(
	payload: Omit<ScheduleScriptPromptPayload, "kind">,
): string {
	return JSON.stringify({
		kind: SCHEDULE_SCRIPT_KIND,
		scriptPath: payload.scriptPath,
		state: payload.state,
		...(payload.timeoutMs ? { timeoutMs: payload.timeoutMs } : {}),
	});
}

export function parseScriptPrompt(
	promptText: string,
): ScheduleScriptPromptPayload | null {
	if (!promptText) return null;
	try {
		const parsed = JSON.parse(promptText.trim());
		if (
			parsed &&
			typeof parsed === "object" &&
			parsed.kind === SCHEDULE_SCRIPT_KIND &&
			typeof parsed.scriptPath === "string" &&
			"state" in parsed &&
			parsed.state !== undefined
		) {
			const timeoutMs =
				typeof parsed.timeoutMs === "number" &&
				Number.isFinite(parsed.timeoutMs) &&
				parsed.timeoutMs > 0
					? parsed.timeoutMs
					: undefined;
			return {
				kind: SCHEDULE_SCRIPT_KIND,
				scriptPath: parsed.scriptPath,
				state: parsed.state,
				...(timeoutMs ? { timeoutMs } : {}),
			};
		}
	} catch {
		// Not JSON or does not match shape
	}
	return null;
}

export function parseReminderBatch(messageText: string): ParsedBatch | null {
	const line = messageText
		.split("\n")
		.find((l) => l.startsWith("reminders_json:"));
	if (!line) return null;

	const jsonText = line.slice("reminders_json:".length).trim();
	let rawItems: unknown;
	try {
		rawItems = JSON.parse(jsonText);
	} catch {
		return null;
	}
	if (!Array.isArray(rawItems)) return null;

	const scripts: ParsedScriptJob[] = [];
	const remainingReminders: RawReminder[] = [];

	for (const item of rawItems) {
		if (
			!item ||
			typeof item !== "object" ||
			typeof (item as Record<string, unknown>).reminder_prompt !== "string" ||
			typeof (item as Record<string, unknown>).schedule_id !== "string"
		) {
			continue;
		}
		const reminder = item as RawReminder;
		const scriptPayload = parseScriptPrompt(reminder.reminder_prompt);
		if (scriptPayload) {
			scripts.push({
				scheduleId: reminder.schedule_id,
				reminder,
				payload: scriptPayload,
			});
		} else {
			remainingReminders.push(reminder);
		}
	}

	if (scripts.length === 0) return null;

	return {
		scripts,
		remainingReminders,
	};
}

export function formatRemainingBatch(
	remainingReminders: readonly RawReminder[],
	originalText: string,
): string {
	const lineIdx = originalText.indexOf("reminders_json:");
	if (lineIdx === -1) return originalText;

	const lineEnd = originalText.indexOf("\n", lineIdx);
	const prefix = originalText.slice(0, lineIdx);
	const suffix = lineEnd === -1 ? "" : originalText.slice(lineEnd);
	return `${prefix}reminders_json: ${JSON.stringify(remainingReminders)}${suffix}`;
}

export function formatWakingPrompt(
	scriptPrompts: readonly string[],
	remainingBatchText?: string,
): string {
	const parts = scriptPrompts.filter(Boolean);
	if (remainingBatchText?.trim()) {
		parts.push(remainingBatchText);
	}
	return parts.join("\n\n");
}
