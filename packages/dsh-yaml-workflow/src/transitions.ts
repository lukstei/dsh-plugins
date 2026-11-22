/**
 * PURPOSE: Pure state machine transition functions for workflow execution.
 * ALLOWED: Pure computation, state progression, and declarative side-effect generation.
 * FORBIDDEN: No I/O, no filesystem, no timer/date manipulation, no agent side effects.
 */

import {
	buildSubagentOutputSchema,
	evaluateStepCondition,
	formatStepPrompt,
	formatSubagentPrompt,
	interpolateSubagentConfig,
	interpolateTemplate,
	normalizeSubagentConfig,
	parseSubagentShorthand,
	resolveGate,
} from "./parser.ts";
import type {
	TransitionResult,
	WorkflowDocument,
	WorkflowInvocation,
	WorkflowState,
} from "./types.ts";

export {
	foldWorkflowEvent,
	foldWorkflowState,
	initialWorkflowRunSummary,
	toWorkflowRunSummaryRecord,
} from "./fold.ts";

function assertNever(value: never, label: string): never {
	throw new TypeError(`Unhandled ${label}: ${JSON.stringify(value)}`);
}

export interface TransitionParams {
	readonly doc: WorkflowDocument;
	readonly invocation: WorkflowInvocation;
	readonly state: WorkflowState;
	readonly instructions?: string;
	readonly outputs?: Record<string, string | readonly string[]>;
	readonly resolvedOutputPaths?: Record<string, string>;
}

/**
 * Computes the next state and declarative side effect for the workflow.
 * CONTRACT:
 * - Input: TransitionParams containing doc, invocation, state, and optional instructions.
 * - Output: TransitionResult containing immutable nextState and declarative effect.
 * - Invariant: Pure and deterministic. Does not mutate the input state.
 */
export function computeStepTransition({
	doc,
	invocation,
	state,
	instructions,
	outputs,
	resolvedOutputPaths = {},
}: TransitionParams): TransitionResult {
	if (state.stepIndex >= doc.steps.length) {
		return {
			nextState: {
				...state,
				status: "completed",
			},
			effect: {
				type: "complete",
				totalSteps: doc.steps.length,
			},
		};
	}

	const effectiveOutputs = outputs ?? state.outputs;
	const hasOutputs =
		effectiveOutputs !== undefined && Object.keys(effectiveOutputs).length > 0;
	const step = doc.steps[state.stepIndex];
	const resolvedArgs = invocation.resolvedArgs;
	const workflowName = doc.name
		? interpolateTemplate(doc.name, resolvedArgs)
		: undefined;
	const stepName = interpolateTemplate(
		step.name,
		resolvedArgs,
		effectiveOutputs,
	);
	const stepLabel = `Step ${state.stepIndex + 1} of ${doc.steps.length}: ${stepName}`;

	if (
		step.if &&
		!evaluateStepCondition(step.if, resolvedArgs, effectiveOutputs)
	) {
		return {
			nextState: {
				...state,
				stepIndex: state.stepIndex + 1,
				...(hasOutputs ? { outputs: effectiveOutputs } : {}),
			},
			effect: {
				type: "skip",
				stepIndex: state.stepIndex,
				stepLabel,
			},
		};
	}

	const isResumedStep =
		state.status === "aborted" ||
		(state.status === "paused" && state.pauseReason === "interrupted");

	switch (step.kind) {
		case "prompt": {
			const interpolatedPrompt = interpolateTemplate(
				step.prompt,
				resolvedArgs,
				effectiveOutputs,
			);
			const interpolatedGate = resolveGate(
				step.gate,
				resolvedArgs,
				effectiveOutputs,
				stepName,
			);

			if (step.isSoloGate && interpolatedGate === undefined) {
				return {
					nextState: {
						...state,
						stepIndex: state.stepIndex + 1,
						status: "running",
						...(hasOutputs ? { outputs: effectiveOutputs } : {}),
					},
					effect: {
						type: "skip",
						stepIndex: state.stepIndex,
						stepLabel,
					},
				};
			}

			const outputRequirements = step.outputs
				? Object.entries(step.outputs).map(([name, def]) => ({
						name,
						type: def.type,
						...(def.type === "file" && resolvedOutputPaths?.[name]
							? { resolvedPath: resolvedOutputPaths[name] }
							: {}),
						...(def.type !== "file" && def.description
							? { description: def.description }
							: {}),
						...(def.type === "list" && def.min !== undefined
							? { min: def.min }
							: {}),
						...(def.type === "list" && def.max !== undefined
							? { max: def.max }
							: {}),
					}))
				: undefined;
			return {
				nextState: {
					stepIndex: state.stepIndex + 1,
					status: "running",
					...(hasOutputs ? { outputs: effectiveOutputs } : {}),
				},
				effect: {
					type: "prompt",
					promptText: formatStepPrompt({
						stepIndex: state.stepIndex,
						totalSteps: doc.steps.length,
						stepName,
						workflowName,
						prompt: interpolatedPrompt,
						isResumedStep,
						instructions,
						outputRequirements,
					}),
					stepLabel,
					gate: interpolatedGate,
					...(step.outputs ? { outputs: step.outputs } : {}),
				},
			};
		}
		case "subagent": {
			const interpolatedPrompt = interpolateTemplate(
				step.prompt,
				resolvedArgs,
				effectiveOutputs,
			);
			const interpolatedGate = resolveGate(
				step.gate,
				resolvedArgs,
				effectiveOutputs,
				stepName,
			);

			const hasStepOutputs =
				step.outputs !== undefined && Object.keys(step.outputs).length > 0;

			const outputRequirements = hasStepOutputs
				? Object.entries(step.outputs).map(([name, def]) => ({
						name,
						type: def.type,
						...(def.type === "file" && resolvedOutputPaths?.[name]
							? { resolvedPath: resolvedOutputPaths[name] }
							: {}),
						...(def.type === "string" && def.description
							? { description: def.description }
							: {}),
					}))
				: undefined;

			const outputSchema = hasStepOutputs
				? buildSubagentOutputSchema(step.outputs, resolvedOutputPaths)
				: undefined;

			const promptText = formatSubagentPrompt({
				prompt: interpolatedPrompt,
				outputRequirements,
			});

			const baseConfig = (() => {
				if (step.rawSubagent) {
					const interpolatedShorthand = interpolateTemplate(
						step.rawSubagent,
						resolvedArgs,
						effectiveOutputs,
					);
					const parsed = parseSubagentShorthand(interpolatedShorthand);
					return normalizeSubagentConfig(parsed);
				}
				return step.config;
			})();

			const interpolatedConfig = interpolateSubagentConfig(
				baseConfig,
				resolvedArgs,
				effectiveOutputs,
			);

			return {
				nextState: {
					stepIndex: state.stepIndex + 1,
					status: "running",
					...(hasOutputs ? { outputs: effectiveOutputs } : {}),
				},
				effect: {
					type: "subagent",
					promptText,
					stepLabel,
					config: interpolatedConfig,
					...(step.foreach ? { foreach: step.foreach } : {}),
					gate: interpolatedGate,
					...(step.outputs ? { outputs: step.outputs } : {}),
					...(step.output ? { output: step.output } : {}),
					...(outputSchema ? { outputSchema } : {}),
					...(hasStepOutputs && resolvedOutputPaths
						? { resolvedOutputPaths }
						: {}),
				},
			};
		}
		case "print": {
			const interpolatedText = interpolateTemplate(
				step.text,
				resolvedArgs,
				effectiveOutputs,
			);
			return {
				nextState: {
					stepIndex: state.stepIndex + 1,
					status: "running",
					...(hasOutputs ? { outputs: effectiveOutputs } : {}),
				},
				effect: {
					type: "print",
					text: interpolatedText,
					stepLabel,
				},
			};
		}
		default:
			return assertNever(step, "workflow step");
	}
}

/**
 * Computes a state transition into the paused state at a gate checkpoint.
 * CONTRACT:
 * - Input: state, gate criteria description, stepLabel.
 * - Output: TransitionResult with status 'paused' and a 'gate_pause' effect.
 */
export function applyGatePause(
	state: WorkflowState,
	gate: string,
	stepLabel: string,
): TransitionResult {
	return {
		nextState: {
			...state,
			status: "paused",
			pauseReason: "gate",
		},
		effect: {
			type: "gate_pause",
			gate,
			stepLabel,
		},
	};
}

/**
 * Computes a state transition into the paused state when a step is interrupted.
 * CONTRACT:
 * - Input: state, stepLabel.
 * - Output: TransitionResult with status 'paused', pauseReason 'interrupted', and a 'step_pause' effect.
 */
export function applyStepPause(
	state: WorkflowState,
	stepLabel: string,
): TransitionResult {
	return {
		nextState: {
			...state,
			status: "paused",
			pauseReason: "interrupted",
		},
		effect: {
			type: "step_pause",
			stepIndex: state.stepIndex,
			stepLabel,
		},
	};
}

/**
 * Computes a state transition into the aborted state upon cancellation.
 * CONTRACT:
 * - Input: state, totalSteps, isAfter flag.
 * - Output: TransitionResult with status 'aborted' and an 'abort' effect.
 */
export function applyAbort(
	state: WorkflowState,
	totalSteps: number,
	isAfter: boolean,
): TransitionResult {
	return {
		nextState: {
			...state,
			status: "aborted",
		},
		effect: {
			type: "abort",
			stepIndex: state.stepIndex,
			totalSteps,
			isAfter,
		},
	};
}
