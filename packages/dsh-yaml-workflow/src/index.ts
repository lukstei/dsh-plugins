/**
 * PURPOSE: Cordis plugin entrypoint and public module re-exports.
 * ALLOWED: Plugin metadata, context command registration, delegating to runner and re-exporting public API.
 * FORBIDDEN: No inline execution loops, no direct filesystem operations.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import type { Session } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { DshWorkflowEffectContext } from "./effects.ts";
import { parseListOutput } from "./parser.ts";
import {
	discardWorkflow,
	listWorkflows,
	requestWorkflow,
	requestWorkflowResume,
	startPendingWorkflows,
	validateWorkflowTarget,
} from "./runner.ts";
import {
	WORKFLOW_SKILL_CONTENT,
	WORKFLOW_SKILL_DESCRIPTION,
	WORKFLOW_SKILL_NAME,
} from "./skill.ts";
import {
	foldWorkflowEvent,
	foldWorkflowState,
	initialWorkflowRunSummary,
	toWorkflowRunSummaryRecord,
} from "./transitions.ts";
import { workflowRunSummarySchema } from "./types.ts";

export type { Agent } from "@deepseek-ai/dsh-agent";
export type {
	CommandDefinition,
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
export type { Session } from "@deepseek-ai/dsh-session";
export * from "./skill.ts";

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
	}
}

export const name = "dsh-workflow-runner";
export const inject = [
	"commands",
	"sessionProjections",
	"subagents",
	"tools",
	"skills",
] as const;

/**
 * Registers /wf and /wf-resume slash commands with Cordis commands service.
 * CONTRACT:
 * - Input: Cordis Context instance with injected 'commands' service.
 * - Output: Promise<void> (registers projection, commands, and tools in context).
 */
export async function apply(ctx: Context): Promise<void> {
	const log = ctx.logger("dsh-workflow-runner");
	const sessionEffects = new WeakMap<Session, DshWorkflowEffectContext>();
	ctx.on("session/event", (session, event) => {
		if (event.type !== "command/done") return;
		const effects = sessionEffects.get(session);
		if (effects !== undefined) startPendingWorkflows(effects);
	});

	const projectionHandle = await ctx.sessionProjections.register({
		key: "workflow",
		stateSchema: workflowRunSummarySchema,
		init: () => initialWorkflowRunSummary(),
		apply: (state, event) => foldWorkflowEvent(state, event),
		wire: {
			viewSchema: workflowRunSummarySchema.nullable(),
			view: toWorkflowRunSummaryRecord,
		},
		stateVersion: 1,
	});

	ctx.effect(() => () => projectionHandle.dispose());

	ctx.effect(() =>
		ctx.skills.register({
			name: WORKFLOW_SKILL_NAME,
			description: WORKFLOW_SKILL_DESCRIPTION,
			source: "runtime",
			content: WORKFLOW_SKILL_CONTENT,
		}),
	);

	ctx.tools.register(
		defineTool({
			name: "save_output",
			description:
				"Save a named workflow output value for the current workflow step.",
			parameters: {
				name: {
					type: "string",
					required: true,
					description: "The name of the output declared in the workflow step.",
				},
				value: {
					type: "string",
					required: true,
					description: "The string value to save as the step output.",
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
				const events = agent.session.snapshotEvents();
				const run = foldWorkflowState(events);
				if (!run) {
					return {
						success: false,
						message: "No active workflow run found",
					};
				}
				if (run.state.status !== "running") {
					return {
						success: false,
						message: "Workflow is not currently running",
					};
				}
				const currentStepIndex = run.state.stepIndex;
				const step = run.workflow.steps[currentStepIndex];
				if (!step || step.kind === "print" || !step.outputs) {
					return {
						success: false,
						message: `Current step ${currentStepIndex + 1} does not declare any outputs`,
					};
				}
				const targetOutput = step.outputs[args.name];
				if (
					!targetOutput ||
					(targetOutput.type !== "string" && targetOutput.type !== "list")
				) {
					return {
						success: false,
						message: `Current step does not declare a string or list output named '${args.name}'`,
					};
				}

				let serializedValue = args.value;
				if (targetOutput.type === "list") {
					const parsed = parseListOutput(args.name, args.value, targetOutput);
					if (parsed.kind === "error") {
						return {
							success: false,
							message: parsed.message,
						};
					}
					serializedValue = JSON.stringify(parsed.value);
				}

				const effects = new DshWorkflowEffectContext({
					ctx,
					agent,
					log,
				});
				effects.recordOutput(
					currentStepIndex,
					args.name,
					serializedValue,
					targetOutput.type,
					undefined,
					run.invocation.runId,
				);

				return {
					success: true,
					message: `Successfully saved output '${args.name}'`,
				};
			},
		}),
		{
			when: ({ agent }: { agent: Agent }) =>
				projectionHandle.stateOf(agent.session).status === "running",
		},
	);

	ctx.tools.register(
		defineTool({
			name: "wf_validate",
			description:
				"Validate a workflow YAML file and optional arguments without executing it.",
			parameters: {
				target: {
					type: "string",
					required: true,
					description:
						"Path or identifier of the workflow YAML file (e.g. 'deploy.yaml' or '.agents/wf/build.yaml').",
				},
				args: {
					type: "string",
					description:
						"Optional key=value arguments or trailing instructions (e.g. 'env=production version=1.0').",
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
				const target = args.target.trim();
				if (target.length === 0) {
					return {
						success: false,
						message: "Target workflow path is required",
					};
				}
				const safeTarget =
					target.includes(" ") &&
					!target.startsWith('"') &&
					!target.startsWith("'")
						? `"${target}"`
						: target;
				const effects = new DshWorkflowEffectContext({
					ctx,
					agent,
					log,
				});
				const rawInput =
					typeof args.args === "string" && args.args.trim().length > 0
						? `${safeTarget} ${args.args}`
						: safeTarget;
				const result = await validateWorkflowTarget(rawInput, effects);
				if (result.kind === "error") {
					return {
						success: false,
						message: result.text,
					};
				}
				return {
					success: true,
					message: result.text ?? "",
				};
			},
		}),
		{
			when: ({ agent }: { agent: Agent }) => {
				const summary = projectionHandle.stateOf(agent.session);
				return summary.status !== "idle" || summary.skillInvoked;
			},
		},
	);

	ctx.commands.register({
		name: "wf",
		description: "Execute prompt workflow from YAML",
		input: { hint: "<workflow.yaml>" },
		handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
			const effects = new DshWorkflowEffectContext({
				ctx,
				agent: invocation.agent,
				log,
			});
			sessionEffects.set(invocation.agent.session, effects);
			return requestWorkflow(
				invocation.rawInput,
				effects,
				invocation.commandId,
			);
		},
	});

	ctx.commands.register({
		name: "wf-resume",
		description: "Resume an interrupted workflow",
		input: { hint: "[instructions]" },
		handler: (invocation: CommandInvocation): Promise<CommandResult> => {
			const effects = new DshWorkflowEffectContext({
				ctx,
				agent: invocation.agent,
				log,
			});
			return requestWorkflowResume(
				effects,
				invocation.rawInput,
				invocation.signal,
			);
		},
	});

	ctx.commands.register({
		name: "wf-abort",
		description: "Discard the active workflow",
		handler: (invocation: CommandInvocation): Promise<CommandResult> => {
			const effects = new DshWorkflowEffectContext({
				ctx,
				agent: invocation.agent,
				log,
			});
			return discardWorkflow({ effects });
		},
	});

	ctx.commands.register({
		name: "wf-list",
		description: "List workflows in common and local directories",
		handler: (invocation: CommandInvocation): Promise<CommandResult> => {
			const effects = new DshWorkflowEffectContext({
				ctx,
				agent: invocation.agent,
				log,
			});
			return listWorkflows(effects);
		},
	});

	ctx.commands.register({
		name: "wf-validate",
		description: "Validate workflow YAML and arguments without execution",
		input: { hint: "<workflow.yaml> [key=value ...]" },
		handler: (invocation: CommandInvocation): Promise<CommandResult> => {
			const effects = new DshWorkflowEffectContext({
				ctx,
				agent: invocation.agent,
				log,
			});
			return validateWorkflowTarget(invocation.rawInput, effects);
		},
	});
}

// Re-export pure parsers and utilities
export {
	formatOutputRetryPrompt,
	formatStepPrompt,
	formatValidationSummary,
	formatWorkflowList,
	formatWorkflowParamDescriptor,
	interpolateTemplate,
	isFlatChoiceMapping,
	parseBoolean,
	parseInvocationInput,
	parseSubagentShorthand,
	parseWorkflowDocument,
	parseWorkflowFile,
	parseWorkflowSummary,
	preprocessWorkflow,
	resolveGate,
	resolveWorkflowArgs,
} from "./parser.ts";

// Re-export pure validation rules and types
export {
	formatValidationErrors,
	ruleDuplicateOutputNames,
	ruleStepOutputReferences,
	ruleSubagentDependencies,
	ruleSubagentOutputRequired,
	ruleTemplateArgs,
	ruleUnusedOutputs,
	ruleWorkflowNameOutputReferences,
	type ValidationError,
	validateWorkflow,
	WORKFLOW_RULES,
	type WorkflowRule,
	type WorkflowValidationContext,
} from "./rules.ts";

// Re-export runtime execution functions
export {
	discardWorkflow,
	executeValidatedWorkflow,
	executeWorkflow,
	listWorkflows,
	resumeWorkflow,
	type ValidatedWorkflow,
	validateWorkflowInvocation,
	validateWorkflowTarget,
} from "./runner.ts";

// Re-export pure transitions and folding
export {
	applyAbort,
	applyGatePause,
	applyStepPause,
	computeStepTransition,
	foldWorkflowState,
	type TransitionParams,
} from "./transitions.ts";

// Re-export domain types and schemas
export {
	type FileOutputBase,
	FileOutputBaseSchema,
	type FormatStepPromptOptions,
	type ParsedInvocation,
	type StepOutputDef,
	StepOutputDefSchema,
	type StepOutputsMap,
	StepOutputsMapSchema,
	type SubagentConfig,
	SubagentConfigSchema,
	type TransitionResult,
	WORKFLOW_EVENT_NAME,
	type WorkflowArg,
	WorkflowArgSchema,
	type WorkflowDocument,
	type WorkflowEffect,
	type WorkflowFile,
	WorkflowFileSchema,
	type WorkflowFileStep,
	WorkflowFileStepSchema,
	type WorkflowFoldResult,
	type WorkflowGroup,
	type WorkflowInitPayloadData,
	type WorkflowInvocation,
	type WorkflowOutputPayloadData,
	type WorkflowParamSummary,
	type WorkflowPayload,
	type WorkflowPrintPayloadData,
	type WorkflowRun,
	type WorkflowState,
	type WorkflowStatePayloadData,
	WorkflowStateSchema,
	type WorkflowStatus,
	WorkflowStatusSchema,
	type WorkflowStep,
	type WorkflowStepPayloadData,
	type WorkflowSummary,
} from "./types.ts";
