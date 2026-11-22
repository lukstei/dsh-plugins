/**
 * PURPOSE: Pure selection of pending workflow requests from command history.
 * ALLOWED: Schema validation and deterministic event folding.
 * FORBIDDEN: I/O and framework services.
 */

import { z } from "zod";
import { WORKFLOW_EVENT_NAME } from "./fold.ts";

const commandEnvelope = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("command/run"),
		data: z.object({
			commandId: z.string(),
			name: z.string(),
			args: z.string().optional(),
		}),
	}),
	z.object({
		type: z.literal("command/done"),
		data: z.object({
			commandId: z.string(),
			kind: z.enum(["success", "error"]),
		}),
	}),
]);
const requestPayload = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("request"),
		runId: z.string(),
		rawInput: z.string(),
	}),
	z.object({ action: z.enum(["init", "request-failed"]), runId: z.string() }),
]);

/**
 * Purpose: Selects the first accepted workflow request in command-arrival order.
 * Contract:
 * - Inputs: chronological command events, including each request's originating /wf command.
 * - Outputs: the next unconsumed request, or undefined while an earlier command validates.
 * - Throws / Errors: malformed command payloads are ignored.
 */
export function nextWorkflowRequest(
	events: readonly { readonly type: string; readonly data?: unknown }[],
): { readonly runId: string; readonly rawInput: string } | undefined {
	const commands = new Map<string, "validating" | "success" | "error">();
	const requests = new Map<
		string,
		{ readonly runId: string; readonly rawInput: string }
	>();
	for (const event of events) {
		if (event.type !== "command/run" && event.type !== "command/done") continue;
		const envelope = commandEnvelope.safeParse(event);
		if (!envelope.success) continue;
		const { type, data: command } = envelope.data;
		if (type === "command/done") {
			if (commands.has(command.commandId))
				commands.set(command.commandId, command.kind);
		} else if (command.name === "wf") {
			commands.set(command.commandId, "validating");
		} else if (
			command.name === WORKFLOW_EVENT_NAME &&
			command.args !== undefined
		) {
			let data: unknown;
			try {
				data = JSON.parse(command.args);
			} catch {
				continue;
			}
			const payload = requestPayload.safeParse(data);
			if (!payload.success) continue;
			if (payload.data.action === "request")
				requests.set(payload.data.runId, payload.data);
			else requests.delete(payload.data.runId);
		}
	}
	for (const [runId, status] of commands) {
		if (status === "validating") return undefined;
		if (status === "error") continue;
		const request = requests.get(runId);
		if (request !== undefined) return request;
	}
	return undefined;
}
