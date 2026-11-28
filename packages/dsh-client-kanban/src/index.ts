/** Host plugin entrypoint for DSH Kanban. */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import type { SessionEvent, SessionHeader } from "@deepseek-ai/dsh-session";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";
import { z } from "zod";
import { foldKanbanEvent, initialKanbanState, toKanbanRecord } from "./fold.ts";
import { KanbanSearch } from "./search-host.ts";
import { kanbanLinkSchema, kanbanPayloadSchema } from "./types.ts";

export const name = "dsh-client-kanban";
export const inject = ["commands", "sessionProjections", "tools"] as const;

const defaultConfig = {
	linkTool: {
		enabled: true,
		instructions:
			'Collect important links relevant to the session. Keep link labels concise and unambiguous. Give links directly related to the task negative priorities; give supporting context links zero or positive priorities. For context links, briefly explain their relevance in the label. Examples: "Task PR: lukstei/dsh-plugins #32", "Task Ticket: EXAMPLE-2", "EXAMPLE-333: Acceptance criteria".',
	},
};

export interface Config {
	linkTool?: {
		enabled?: boolean;
		instructions?: string;
	};
}

interface ResolvedConfig {
	linkTool: {
		enabled: boolean;
		instructions: string;
	};
}

export const Config: Schema<Config, ResolvedConfig> = Schema.object({
	linkTool: Schema.object({
		enabled: Schema.boolean()
			.default(defaultConfig.linkTool.enabled)
			.description("Whether kanban_add_link tool is enabled."),
		instructions: Schema.string()
			.default(defaultConfig.linkTool.instructions)
			.description("Instructions for kanban_add_link tool."),
	}).description("Configuration for the kanban_add_link tool."),
});

const kanbanRecordSchema = z.object({
	// edge case: persisted session IDs carry DSH's branded string identity
	sessionId: z.string().transform((v) => SessionId(v)),
	createdAt: z.number(),
	doneAt: z.number().optional(),
	heldAt: z.number().optional(),
	reviewAt: z.number().optional(),
	prompt: z.string().optional(),
	pinnedAt: z.number().optional(),
	links: z.array(kanbanLinkSchema).readonly(),
	lastActivityAt: z.number().optional(),
});

const kanbanStateSchema = kanbanRecordSchema.extend({
	initialized: z.boolean(),
	deleted: z.boolean(),
});

export type KanbanState = z.infer<typeof kanbanStateSchema>;

/**
 * Purpose: Register the Kanban projection, commands, link tool, and scoped search.
 * Contract:
 * - Inputs: Cordis context providing commands, sessionProjections, and tools, and validated plugin configuration.
 * - Outputs: void; collected links persist in the caller's command events.
 * - Throws / Errors: Missing services, invalid tool input, and failed command dispatch propagate.
 */
export async function apply(
	ctx: Context,
	config: ResolvedConfig,
): Promise<void> {
	ctx.plugin(KanbanSearch);

	const kanbanHandle = await ctx.sessionProjections.register<
		"kanban",
		KanbanState
	>({
		key: "kanban",
		stateSchema: kanbanStateSchema,
		init: (header: SessionHeader) => initialKanbanState(header),
		apply: (state: KanbanState, event: SessionEvent) =>
			foldKanbanEvent(state, event),
		wire: { viewSchema: kanbanRecordSchema.nullable(), view: toKanbanRecord },
		stateVersion: 12,
	});

	ctx.effect(() => {
		return () => {
			kanbanHandle.dispose();
		};
	});

	ctx.commands.register({
		name: "kanban",
		description:
			"Enable this session in Kanban or manage lifecycle: /kanban [json-payload]",
		handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
			const raw = invocation.rawInput.trim();
			if (!raw) {
				return {
					kind: "success",
					text: "Session enabled in Kanban",
				};
			}
			let input: unknown;
			try {
				input = JSON.parse(invocation.rawInput);
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				return {
					kind: "error",
					text: "Invalid kanban command payload: expected JSON",
				};
			}
			const payload = kanbanPayloadSchema.safeParse(input);
			if (!payload.success)
				return { kind: "error", text: payload.error.message };
			return {
				kind: "success",
				text: `Kanban action '${payload.data.action}' recorded`,
			};
		},
	});

	if (!config.linkTool.enabled) return;
	ctx.tools.register(
		defineTool({
			name: "kanban_add_link",
			description: `Collect a confirmed HTTP(S) URL or DSH session link (dsh://sessions/{session-id}) for the current session. Reusing a URL updates its label and priority without duplicating it. Does not change Kanban status. ${config.linkTool.instructions}`,
			parameters: {
				label: {
					type: "string",
					required: true,
					description: "Short descriptive label for the link.",
				},
				url: {
					type: "string",
					required: true,
					description:
						"Confirmed absolute HTTP or HTTPS URL, or dsh://sessions/{session-id}.",
				},
				priority: {
					type: "number",
					default: 0,
					description:
						"Sort priority: lower numbers appear first. Negative values are high priority; positive values are low priority. Defaults to 0.",
				},
			},
			output: {
				schema: {
					type: "object",
					properties: {
						label: { type: "string", required: true },
						url: { type: "string", required: true },
						priority: { type: "number", required: true },
					},
					additionalProperties: false,
				},
				render: (_args, value) => [
					{
						type: "text",
						text: `Saved session link: ${value.label} (${value.url})`,
					},
				],
			},
			async execute(args, exec) {
				exec.signal.throwIfAborted();
				if (!exec.agent) {
					throw new Error("Session link collection requires a caller agent");
				}
				const link = kanbanLinkSchema.parse(args);
				const state = kanbanHandle.stateOf(exec.agent.session);
				if (state.deleted)
					throw new Error("Cannot add links to a deleted Kanban task");
				const execution = await ctx.commands.execute(
					exec.agent,
					`/kanban ${JSON.stringify({ action: "add-link", ...link })}`,
					[],
					exec.signal,
				);
				if (!execution || execution.result.kind === "error") {
					throw new Error(
						execution
							? execution.result.text
							: "Failed to execute /kanban command",
					);
				}
				return link;
			},
		}),
		{
			when: ({ agent }: { agent: Agent }) => {
				const state = kanbanHandle.stateOf(agent.session);
				return state.initialized && !state.deleted;
			},
		},
	);
}
