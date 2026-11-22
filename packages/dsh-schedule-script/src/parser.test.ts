import { describe, expect, it } from "vitest";
import {
	formatRemainingBatch,
	formatScriptPrompt,
	formatWakingPrompt,
	parseReminderBatch,
	parseScriptPrompt,
} from "./parser.ts";
import { SCHEDULE_SCRIPT_KIND } from "./types.ts";

describe("parser", () => {
	it("formatScriptPrompt produces JSON with SCHEDULE_SCRIPT_KIND and mandatory state", () => {
		const json = formatScriptPrompt({
			scriptPath: "/path/to/poll.ts",
			state: { key: "val" },
			timeoutMs: 5000,
		});
		const parsed = JSON.parse(json);
		expect(parsed.kind).toBe(SCHEDULE_SCRIPT_KIND);
		expect(parsed.scriptPath).toBe("/path/to/poll.ts");
		expect(parsed.state).toEqual({ key: "val" });
		expect(parsed.timeoutMs).toBe(5000);
	});

	it("parseScriptPrompt extracts payload from valid prompt JSON with mandatory state", () => {
		const prompt = JSON.stringify({
			kind: SCHEDULE_SCRIPT_KIND,
			scriptPath: "/test/script.ts",
			state: { a: 1 },
			timeoutMs: 15000,
		});
		const result = parseScriptPrompt(prompt);
		expect(result).not.toBeNull();
		expect(result?.scriptPath).toBe("/test/script.ts");
		expect(result?.state).toEqual({ a: 1 });
		expect(result?.timeoutMs).toBe(15000);
	});

	it("parseScriptPrompt returns null when mandatory state is missing", () => {
		const prompt = JSON.stringify({
			kind: SCHEDULE_SCRIPT_KIND,
			scriptPath: "/test/script.ts",
		});
		expect(parseScriptPrompt(prompt)).toBeNull();
	});

	it("parseScriptPrompt ignores non-numeric or non-positive timeoutMs", () => {
		const prompt = JSON.stringify({
			kind: SCHEDULE_SCRIPT_KIND,
			scriptPath: "/test/script.ts",
			state: { ok: true },
			timeoutMs: "forever",
		});
		const result = parseScriptPrompt(prompt);
		expect(result).not.toBeNull();
		expect(result?.scriptPath).toBe("/test/script.ts");
		expect(result?.state).toEqual({ ok: true });
		expect(result?.timeoutMs).toBeUndefined();
	});

	it("parseScriptPrompt returns null for non-script JSON or arbitrary text", () => {
		expect(parseScriptPrompt("Please check the server logs")).toBeNull();
		expect(
			parseScriptPrompt(JSON.stringify({ kind: "other-task", path: "/x" })),
		).toBeNull();
		expect(parseScriptPrompt("")).toBeNull();
	});

	it("parseReminderBatch parses script reminders and ignores trailing timezone metadata", () => {
		const prompt = formatScriptPrompt({
			scriptPath: "/agents/poll.ts",
			state: {},
		});
		const batchText = [
			"[SCHEDULE REMINDER BATCH]",
			"This is a scheduled message from the user",
			`reminders_json: [{"schedule_id":"s-100","occurrence_at":"2026-11-10T22:00:00Z","reminder_prompt":${JSON.stringify(prompt)}}]`,
			"Time sampled while preparing turn 38, step 1: 2026-11-10T22:42:49+01:00[Europe/Vienna]",
		].join("\n");

		const result = parseReminderBatch(batchText);
		expect(result).not.toBeNull();
		expect(result?.scripts).toHaveLength(1);
		expect(result?.scripts[0].scheduleId).toBe("s-100");
		expect(result?.scripts[0].payload.scriptPath).toBe("/agents/poll.ts");
		expect(result?.scripts[0].payload.state).toEqual({});
		expect(result?.remainingReminders).toHaveLength(0);
	});

	it("parseReminderBatch partitions mixed batches into scripts and standard reminders", () => {
		const scriptPrompt = formatScriptPrompt({
			scriptPath: "/agents/poll.ts",
			state: {},
		});
		const batchText = [
			"[SCHEDULE REMINDER BATCH]",
			"This is a scheduled message from the user",
			`reminders_json: [{"schedule_id":"s-script","reminder_prompt":${JSON.stringify(scriptPrompt)}},{"schedule_id":"s-human","reminder_prompt":"Check server disk space"}]`,
			"Time sampled while preparing turn 38, step 1: 2026-11-10T22:42:49+01:00[Europe/Vienna]",
		].join("\n");

		const result = parseReminderBatch(batchText);
		expect(result).not.toBeNull();
		expect(result?.scripts).toHaveLength(1);
		expect(result?.scripts[0].scheduleId).toBe("s-script");
		expect(result?.remainingReminders).toHaveLength(1);
		expect(result?.remainingReminders[0].schedule_id).toBe("s-human");
		expect(result?.remainingReminders[0].reminder_prompt).toBe(
			"Check server disk space",
		);
	});

	it("parseReminderBatch returns null when no script tasks exist in batch", () => {
		const batchText = [
			"[SCHEDULE REMINDER BATCH]",
			"This is a scheduled message from the user",
			'reminders_json: [{"schedule_id":"s-1","reminder_prompt":"Review PR #42"}]',
		].join("\n");

		expect(parseReminderBatch(batchText)).toBeNull();
	});

	it("formatRemainingBatch replaces reminders_json line preserving surrounding framing", () => {
		const original = [
			"[SCHEDULE REMINDER BATCH]",
			"This is a scheduled message from the user",
			'reminders_json: [{"schedule_id":"s-1","reminder_prompt":"old"}]',
			"Time sampled while preparing turn 38, step 1: 2026-11-10T22:42:49+01:00[Europe/Vienna]",
		].join("\n");

		const remaining = [
			{ schedule_id: "s-human", reminder_prompt: "User reminder" },
		];
		const updated = formatRemainingBatch(remaining, original);

		expect(updated).toContain(
			'reminders_json: [{"schedule_id":"s-human","reminder_prompt":"User reminder"}]',
		);
		expect(updated).toContain("[SCHEDULE REMINDER BATCH]");
		expect(updated).toContain("[Europe/Vienna]");
	});

	it("formatWakingPrompt combines script prompts and remaining batch text", () => {
		const combined = formatWakingPrompt(
			["[Scheduled Task: poll.ts]\nNew alerts detected"],
			"[SCHEDULE REMINDER BATCH]\nreminders_json: [...]",
		);
		expect(combined).toContain("[Scheduled Task: poll.ts]");
		expect(combined).toContain("New alerts detected");
		expect(combined).toContain("[SCHEDULE REMINDER BATCH]");
	});
});
