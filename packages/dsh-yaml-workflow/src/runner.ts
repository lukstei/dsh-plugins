/**
 * PURPOSE: Stateless workflow execution loop and orchestrator.
 * ALLOWED: Interpreting pure transitions, coordinating steps via WorkflowEffectContext, abort handling.
 * FORBIDDEN: Direct command registration, direct filesystem access, Cordis runtime coupling.
 */

import crypto from "node:crypto";
import path from "node:path";
import type { CommandResult } from "@deepseek-ai/dsh-commands";
import type { WorkflowEffectContext } from "./effects.ts";
import {
	formatOutputRetryPrompt,
	formatValidationSummary,
	formatWorkflowList,
	interpolateSubagentConfig,
	interpolateTemplate,
	normalizeSubagentConfig,
	type OutputRetryMissingItem,
	parseInvocationInput,
	parseListOutput,
	parseSubagentShorthand,
	parseWorkflowDocument,
	parseWorkflowSummary,
	resolveGate,
	resolveWorkflowArgs,
} from "./parser.ts";
import { nextWorkflowRequest } from "./requests.ts";
import { formatValidationErrors, validateWorkflow } from "./rules.ts";
import {
	applyAbort,
	applyGatePause,
	applyStepPause,
	computeStepTransition,
	foldWorkflowState,
} from "./transitions.ts";
import type {
	SubagentConfig,
	SubagentDispatchResult,
	WorkflowDocument,
	WorkflowEffect,
	WorkflowInvocation,
	WorkflowRun,
	WorkflowState,
	WorkflowStep,
	WorkflowStepOutputsMap,
	WorkflowSummary,
} from "./types.ts";

/**
 * Narrowed error result for command validation failures.
 */
type CommandErrorResult = Extract<CommandResult, { kind: "error" }>;

/**
 * Validated workflow ready for execution.
 */
export interface ValidatedWorkflow {
	readonly kind: "valid";
	readonly doc: WorkflowDocument;
	readonly invocation: WorkflowInvocation;
	readonly state: WorkflowState;
}

const executingSessions = new Set<string>();

/**
 * Purpose: Validates and durably accepts a workflow command without retaining its YAML.
 * Contract:
 * - Inputs: command input, effects, and the originating /wf command ID.
 * - Outputs: immediate validation diagnostics or a queued acknowledgement.
 * - Throws / Errors: unexpected event-write failures propagate.
 */
export async function requestWorkflow(
	rawInput: string,
	effects: WorkflowEffectContext,
	runId: string,
): Promise<CommandResult> {
	const validated = await validateWorkflowInvocation(rawInput, effects, runId);
	if (validated.kind === "error") return validated;
	effects.emit({ action: "request", rawInput, runId });
	return { kind: "success", text: "Workflow queued" };
}

/**
 * Purpose: Drains accepted requests after the preceding workflow finishes cleanup.
 * Contract:
 * - Inputs: effects for a live session whose command lifecycle is recorded.
 * - Outputs: requests execute FIFO; running or paused workflows keep requests pending.
 * - Throws / Errors: unexpected event-write failures propagate; validation failures are recorded.
 */
export async function drainWorkflowRequests(
	effects: WorkflowEffectContext,
): Promise<void> {
	if (executingSessions.has(effects.sessionId)) return;
	executingSessions.add(effects.sessionId);
	try {
		while (true) {
			const events = effects.snapshotEvents();
			const active = foldWorkflowState(events);
			if (
				active !== null &&
				(active.state.status === "running" || active.state.status === "paused")
			)
				return;
			const request = nextWorkflowRequest(events);
			if (request === undefined) return;
			const startupAbortController = new AbortController();
			const cleanupStartupAbort = effects.watchAbort(startupAbortController);
			let validated: ValidatedWorkflow | CommandErrorResult;
			try {
				await effects.whenIdle();
				validated = await validateWorkflowInvocation(
					request.rawInput,
					effects,
					request.runId,
				);
			} catch (error: unknown) {
				validated = { kind: "error", text: extractErrorMessage(error) };
			} finally {
				cleanupStartupAbort();
			}
			if (validated.kind === "error") {
				effects.emit({ action: "request-failed", runId: request.runId });
				effects.emit({
					action: "step",
					id: `wf-request-${request.runId}-failed`,
					stepIndex: 0,
					label: `Queued workflow failed: ${validated.text}`,
					kind: "error",
					runId: request.runId,
				});
			} else {
				await executeValidatedWorkflowDirect(
					validated,
					effects,
					startupAbortController.signal,
				);
			}
		}
	} finally {
		executingSessions.delete(effects.sessionId);
	}
}

/**
 * Purpose: Wakes pending workflows and reports unexpected background failures.
 * Contract:
 * - Inputs: effects for the session whose admission or execution just settled.
 * - Outputs: starts at most one drain; failures are logged.
 * - Throws / Errors: asynchronous errors are reported through logInfo.
 */
export function startPendingWorkflows(effects: WorkflowEffectContext): void {
	void drainWorkflowRequests(effects).catch((error: unknown) => {
		effects.logInfo(`Workflow queue failed: ${extractErrorMessage(error)}`);
	});
}

async function withWorkflowExecution(
	effects: WorkflowEffectContext,
	execute: () => Promise<CommandResult>,
): Promise<CommandResult> {
	if (executingSessions.has(effects.sessionId)) {
		return {
			kind: "error",
			text: "A workflow is already executing in this session",
		};
	}
	executingSessions.add(effects.sessionId);
	try {
		return await execute();
	} finally {
		executingSessions.delete(effects.sessionId);
		startPendingWorkflows(effects);
	}
}

/**
 * Handles workflow abortion by computing aborted transition and emitting state.
 */
function handleAbort(
	effects: WorkflowEffectContext,
	state: WorkflowState,
	stepIndex: number,
	totalSteps: number,
	runId: string,
): CommandResult {
	effects.emit({
		action: "state",
		...applyAbort(state, totalSteps, false).nextState,
		runId,
	});
	return {
		kind: "error",
		text: `Workflow aborted at step ${stepIndex + 1}/${totalSteps}`,
	};
}

/**
 * Checks whether an abort signal was triggered specifically to pause the workflow.
 */
function isPauseSignal(signal: AbortSignal): boolean {
	const reason = signal.reason as { kind?: string } | undefined;
	return reason?.kind === "pause";
}

/**
 * Handles workflow pause (e.g. user interrupted via Stop Generating) by computing paused transition and emitting state.
 */
function handlePause(
	effects: WorkflowEffectContext,
	state: WorkflowState,
	stepIndex: number,
	stepLabel: string,
	totalSteps: number,
	runId: string,
): CommandResult {
	const pauseTransition = applyStepPause(state, stepLabel);
	effects.emit({
		action: "state",
		...pauseTransition.nextState,
		runId,
	});
	return {
		kind: "success",
		text: `Workflow paused at step ${stepIndex + 1}/${totalSteps}. Resume with /wf-resume`,
	};
}

/**
 * Handles workflow termination (either pause on user stop or hard abort) by computing transition and emitting state.
 */
function handleTermination(
	signal: AbortSignal,
	effects: WorkflowEffectContext,
	state: WorkflowState,
	stepIndex: number,
	stepLabel: string,
	totalSteps: number,
	runId: string,
): CommandResult {
	if (isPauseSignal(signal)) {
		return handlePause(effects, state, stepIndex, stepLabel, totalSteps, runId);
	}
	return handleAbort(effects, state, stepIndex, totalSteps, runId);
}

/**
 * Emits completion state and returns success result.
 */
function completeWorkflow(
	effects: WorkflowEffectContext,
	totalSteps: number,
	outputs: Record<string, string | readonly string[]> | undefined,
	runId: string,
): CommandResult {
	const hasOutputs = outputs !== undefined && Object.keys(outputs).length > 0;
	effects.emit({
		action: "state",
		stepIndex: totalSteps,
		status: "completed",
		...(hasOutputs ? { outputs } : {}),
		runId,
	});
	return {
		kind: "success",
		text: `Completed workflow (${totalSteps} steps)`,
	};
}

/**
 * Safely extracts error message string from unknown error.
 */
function extractErrorMessage(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)) || "Unknown error";
}

/**
 * Emits aborted state, logs error, and returns CommandErrorResult on unhandled execution failure.
 */
function handleExecutionFailure(
	effects: WorkflowEffectContext,
	state: WorkflowState,
	action: "execution" | "resume",
	err: unknown,
	totalSteps: number,
	runId: string,
): CommandErrorResult {
	const message = extractErrorMessage(err);
	const failedStepIndex = Math.min(state.stepIndex, totalSteps - 1);
	const displayStep = failedStepIndex + 1;
	const { pauseReason: _pauseReason, ...cleanState } = state;
	effects.emit({
		action: "state",
		...cleanState,
		stepIndex: failedStepIndex,
		status: "aborted",
		error: message,
		runId,
	});
	effects.logInfo(
		`Workflow ${action} failed at step ${displayStep}/${totalSteps}: ${message}`,
	);
	return {
		kind: "error",
		text: `Workflow ${action} failed at step ${displayStep}/${totalSteps}: ${message}`,
	};
}

/**
 * Type predicate ensuring an unknown value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Detects whether an error indicates Cordis context inactivation during fiber unload.
 */
function isInactiveContextError(err: unknown): boolean {
	if (isRecord(err) && err.code === "INACTIVE_EFFECT") {
		return true;
	}
	// edge case: Cordis throws a generic Error containing "inactive context" when session or fiber unloads mid-turn
	return extractErrorMessage(err).includes("inactive context");
}

/**
 * Detects whether an error represents a tool, subagent, or user-initiated cancellation.
 */
function isAbortError(err: unknown): boolean {
	if (!err) return false;
	if (err instanceof Error && err.name === "AbortError") return true;
	if (isRecord(err)) {
		const code = err.code;
		return (
			code === "ABORTED" ||
			code === "TOOL_ABORTED" ||
			code === "TOOL_ABORTED_BEFORE_DISPATCH"
		);
	}
	return false;
}

/**
 * Resolves declared file output paths against template arguments and workflow effect context.
 */
function resolveStepOutputFilePaths(
	outputsDef: WorkflowStepOutputsMap | undefined,
	args: Record<string, string>,
	currentOutputs: Readonly<Record<string, string | readonly string[]>>,
	effects: WorkflowEffectContext,
): Record<string, string> {
	const resolved: Record<string, string> = {};
	if (!outputsDef) return resolved;
	for (const [name, def] of Object.entries(outputsDef)) {
		if (def.type === "file") {
			const interpolatedPath = interpolateTemplate(
				def.path,
				args,
				currentOutputs,
			);
			resolved[name] = effects.resolveOutputPath(interpolatedPath, def.base);
		}
	}
	return resolved;
}

/**
 * Unifies error classification, pause handling, abort handling, and failure delegation during workflow execution.
 */
function handleWorkflowExecutionError({
	effects,
	state,
	doc,
	signal,
	err,
	action,
	runId,
}: {
	effects: WorkflowEffectContext;
	state: WorkflowState;
	doc: WorkflowDocument;
	signal: AbortSignal;
	err: unknown;
	action: "execution" | "resume";
	runId: string;
}): CommandResult {
	const currentIdx = Math.min(state.stepIndex, doc.steps.length - 1);
	const stepName = doc.steps[currentIdx].name;
	if (signal.aborted || isAbortError(err)) {
		return handleTermination(
			signal,
			effects,
			state,
			currentIdx,
			stepName,
			doc.steps.length,
			runId,
		);
	}
	if (isInactiveContextError(err)) {
		return handlePause(
			effects,
			state,
			currentIdx,
			stepName,
			doc.steps.length,
			runId,
		);
	}
	return handleExecutionFailure(
		effects,
		state,
		action,
		err,
		doc.steps.length,
		runId,
	);
}

/**
 * Validates session ID and awaits agent idle state before workflow resumption or discarding.
 */
async function ensureIdleSession(
	effects: WorkflowEffectContext,
	action: "resume" | "discard",
): Promise<CommandErrorResult | undefined> {
	if (!effects.sessionId) {
		return {
			kind: "error",
			text: `Workflow ${action} failed: agent session ID is required`,
		};
	}
	try {
		await effects.whenIdle();
	} catch (err: unknown) {
		const message = extractErrorMessage(err);
		effects.logInfo(`Workflow ${action} failed: ${message}`);
		return {
			kind: "error",
			text: `Workflow ${action} failed: ${message}`,
		};
	}
	return undefined;
}

/**
 * Runs a validation step and catches errors into a formatted CommandErrorResult.
 */
function runValidationStep<T>(
	fn: () => T,
	prefix: string,
	targetPath: string,
): { readonly result: T } | CommandErrorResult {
	try {
		return { result: fn() };
	} catch (err: unknown) {
		return {
			kind: "error",
			text: `${prefix} '${targetPath}': ${extractErrorMessage(err)}`,
		};
	}
}

/**
 * Drives sequential workflow step execution, interpreting pure state machine transitions.
 * CONTRACT:
 * - Input: effects, doc, invocation, initial state, optional signal, and instructions.
 * - Output: Promise resolving to CommandResult (success, gate pause, or abort error).
 */
async function runWorkflowSteps({
	effects,
	doc,
	invocation,
	stateRef,
	signal,
	instructions,
}: {
	effects: WorkflowEffectContext;
	doc: WorkflowDocument;
	invocation: WorkflowInvocation;
	stateRef: { current: WorkflowState };
	signal: AbortSignal;
	instructions?: string;
}): Promise<CommandResult> {
	const steps = doc.steps;
	const runId = invocation.runId;
	const initialState = stateRef.current;
	let state: WorkflowState = initialState;
	const outputs: Record<string, string | readonly string[]> = {
		...initialState.outputs,
	};
	let pendingInstructions: string | undefined = instructions;

	const hasScratchOutput = steps.some(
		(s) =>
			(s.kind === "prompt" || s.kind === "subagent") &&
			s.outputs !== undefined &&
			Object.values(s.outputs).some(
				(o) => o.type === "file" && o.base === "scratch",
			),
	);
	if (hasScratchOutput) {
		await effects.ensureScratchDirectory();
	}

	while (state.stepIndex < steps.length) {
		const currentStepIndex = state.stepIndex;
		if (signal.aborted) {
			return handleTermination(
				signal,
				effects,
				stateRef.current,
				currentStepIndex,
				steps[currentStepIndex].name,
				steps.length,
				runId,
			);
		}
		const step = steps[currentStepIndex];

		if (step.kind === "subagent") {
			let waveEnd = currentStepIndex;
			while (waveEnd < steps.length) {
				const s = steps[waveEnd];
				if (s.kind !== "subagent") break;
				const sGate = resolveGate(
					s.gate,
					invocation.resolvedArgs,
					outputs,
					s.name,
				);
				if (sGate !== undefined) {
					waveEnd++;
					break;
				}
				waveEnd++;
			}

			interface ActiveWaveStep {
				readonly stepIndex: number;
				readonly itemIndex?: number;
				readonly totalItems?: number;
				readonly step: Extract<WorkflowStep, { kind: "subagent" }>;
				readonly effect: Extract<WorkflowEffect, { type: "subagent" }>;
				readonly resolvedOutputPaths: Record<string, string>;
			}

			const activeWaveSteps: ActiveWaveStep[] = [];
			for (let idx = currentStepIndex; idx < waveEnd; idx++) {
				// type-safe: waveEnd bounds guarantee steps[idx].kind === "subagent"
				const waveStep = steps[idx] as Extract<
					WorkflowStep,
					{ kind: "subagent" }
				>;

				if (waveStep.foreach !== undefined) {
					const stepOutputPaths = resolveStepOutputFilePaths(
						waveStep.outputs,
						invocation.resolvedArgs,
						outputs,
						effects,
					);
					const transition = computeStepTransition({
						doc,
						invocation,
						state: { ...state, stepIndex: idx },
						instructions: pendingInstructions,
						outputs,
						resolvedOutputPaths: stepOutputPaths,
					});

					if (transition.effect.type === "skip") {
						continue;
					}

					const listName = waveStep.foreach.slice(10, -2);
					const rawVal = outputs[listName];
					if (!Array.isArray(rawVal)) {
						return handleExecutionFailure(
							effects,
							stateRef.current,
							"execution",
							new Error(
								`Step ${idx + 1} foreach output '${listName}' is missing or not an array`,
							),
							steps.length,
							runId,
						);
					}
					const listItems: readonly string[] = rawVal;

					if (listItems.length === 0) {
						if (waveStep.output !== undefined) {
							effects.recordOutput(
								idx,
								waveStep.output,
								"[]",
								"list",
								undefined,
								runId,
							);
							outputs[waveStep.output] = [];
						}
						if (waveStep.outputs !== undefined) {
							for (const name of Object.keys(waveStep.outputs)) {
								effects.recordOutput(idx, name, "[]", "list", undefined, runId);
								outputs[name] = [];
							}
						}
						continue;
					}

					// type-safe: transition.effect is guaranteed to be subagent effect when transition.effect.type !== "skip"
					const baseSubagentEffect = transition.effect as Extract<
						WorkflowEffect,
						{ type: "subagent" }
					>;

					for (let itemIdx = 0; itemIdx < listItems.length; itemIdx++) {
						const itemVal = listItems[itemIdx];
						const itemPromptText = interpolateTemplate(
							baseSubagentEffect.promptText,
							invocation.resolvedArgs,
							outputs,
							{ item: itemVal },
						);

						const itemLabel = `Step ${idx + 1} (${itemIdx + 1}/${listItems.length}): ${waveStep.name} [${itemVal}]`;

						const subagentEffect: Extract<
							WorkflowEffect,
							{ type: "subagent" }
						> = {
							...baseSubagentEffect,
							promptText: itemPromptText,
							stepLabel: itemLabel,
						};

						activeWaveSteps.push({
							stepIndex: idx,
							itemIndex: itemIdx,
							totalItems: listItems.length,
							step: waveStep,
							effect: subagentEffect,
							resolvedOutputPaths: stepOutputPaths,
						});
					}
				} else {
					const stepOutputPaths = resolveStepOutputFilePaths(
						waveStep.outputs,
						invocation.resolvedArgs,
						outputs,
						effects,
					);

					const transition = computeStepTransition({
						doc,
						invocation,
						state: { ...state, stepIndex: idx },
						instructions: pendingInstructions,
						outputs,
						resolvedOutputPaths: stepOutputPaths,
					});

					if (transition.effect.type === "skip") {
						continue;
					}

					// type-safe: computeStepTransition produces subagent effect for non-skipped subagent steps
					const subagentEffect = transition.effect as Extract<
						WorkflowEffect,
						{ type: "subagent" }
					>;

					activeWaveSteps.push({
						stepIndex: idx,
						step: waveStep,
						effect: subagentEffect,
						resolvedOutputPaths: stepOutputPaths,
					});
				}
			}

			if (activeWaveSteps.length === 0) {
				state = {
					...state,
					stepIndex: waveEnd,
					...(Object.keys(outputs).length > 0
						? { outputs: { ...outputs } }
						: {}),
				};
				stateRef.current = state;
				if (state.stepIndex < steps.length) {
					effects.emit({
						action: "state",
						...state,
						runId,
					});
				}
				continue;
			}

			for (const item of activeWaveSteps) {
				const stepId =
					item.itemIndex !== undefined
						? `wf-step-${runId}-${item.stepIndex}-${item.itemIndex}`
						: `wf-step-${runId}-${item.stepIndex}`;
				effects.emit({
					action: "step",
					id: stepId,
					stepIndex: item.stepIndex,
					label: item.effect.stepLabel,
					kind: "success",
					runId,
				});
			}

			const waveAbortController = new AbortController();
			const waveSignal = AbortSignal.any([signal, waveAbortController.signal]);

			let waveResults: Array<
				ActiveWaveStep & { readonly subagentResult: SubagentDispatchResult }
			>;

			let failingStepIndex = activeWaveSteps[0].stepIndex;
			try {
				waveResults = await Promise.all(
					activeWaveSteps.map(async (item) => {
						try {
							const subagentResult = await effects.dispatchSubagent(
								item.effect,
								waveSignal,
							);
							return { ...item, subagentResult };
						} catch (err: unknown) {
							if (!waveAbortController.signal.aborted) {
								failingStepIndex = item.stepIndex;
							}
							waveAbortController.abort({ kind: "error" });
							throw err;
						}
					}),
				);
			} catch (err: unknown) {
				return handleWorkflowExecutionError({
					effects,
					state: {
						...stateRef.current,
						stepIndex: failingStepIndex,
					},
					doc,
					signal,
					err,
					action: "execution",
					runId,
				});
			}

			if (signal.aborted) {
				const firstActive = activeWaveSteps[0];
				return handleTermination(
					signal,
					effects,
					stateRef.current,
					firstActive.stepIndex,
					firstActive.step.name,
					steps.length,
					runId,
				);
			}

			const processedStepIndices = new Set<number>();
			for (const item of activeWaveSteps) {
				if (processedStepIndices.has(item.stepIndex)) continue;
				processedStepIndices.add(item.stepIndex);

				const stepItems = waveResults.filter(
					(r) => r.stepIndex === item.stepIndex,
				);
				const isForeach = item.step.foreach !== undefined;

				if (isForeach) {
					if (item.step.output) {
						const collected = stepItems.map((r) => r.subagentResult.outputText);
						effects.recordOutput(
							item.stepIndex,
							item.step.output,
							JSON.stringify(collected),
							"list",
							undefined,
							runId,
						);
						outputs[item.step.output] = collected;
					} else if (item.step.outputs !== undefined) {
						for (const name of Object.keys(item.step.outputs)) {
							const collectedValues: string[] = [];
							for (const r of stepItems) {
								if (!isRecord(r.subagentResult.structured)) {
									return handleExecutionFailure(
										effects,
										{ ...stateRef.current, stepIndex: item.stepIndex },
										"execution",
										new Error(
											`Step ${item.stepIndex + 1} subagent failed to produce required structured outputs`,
										),
										steps.length,
										runId,
									);
								}
								const val = r.subagentResult.structured[name];
								if (typeof val !== "string" || val.length === 0) {
									return handleExecutionFailure(
										effects,
										{ ...stateRef.current, stepIndex: item.stepIndex },
										"execution",
										new Error(
											`Step ${item.stepIndex + 1} subagent structured output '${name}' is missing or empty`,
										),
										steps.length,
										runId,
									);
								}
								collectedValues.push(val);
							}
							effects.recordOutput(
								item.stepIndex,
								name,
								JSON.stringify(collectedValues),
								"list",
								undefined,
								runId,
							);
							outputs[name] = collectedValues;
						}
					}
					stateRef.current = {
						...stateRef.current,
						outputs: { ...outputs },
					};
				} else {
					const singleResult = stepItems[0];
					const subagentResult = singleResult.subagentResult;
					const outputText = subagentResult.outputText;

					if (
						item.step.outputs !== undefined &&
						Object.keys(item.step.outputs).length > 0
					) {
						if (!isRecord(subagentResult.structured)) {
							return handleExecutionFailure(
								effects,
								{ ...stateRef.current, stepIndex: item.stepIndex },
								"execution",
								new Error(
									`Step ${item.stepIndex + 1} subagent failed to produce required structured outputs`,
								),
								steps.length,
								runId,
							);
						}

						const structured = subagentResult.structured;
						const pendingStringOutputs: Array<{ name: string; val: string }> =
							[];
						for (const [name, def] of Object.entries(item.step.outputs)) {
							const val = structured[name];
							if (typeof val !== "string" || val.length === 0) {
								return handleExecutionFailure(
									effects,
									{ ...stateRef.current, stepIndex: item.stepIndex },
									"execution",
									new Error(
										`Step ${item.stepIndex + 1} subagent structured output '${name}' is missing or empty`,
									),
									steps.length,
									runId,
								);
							}

							if (def.type === "string") {
								pendingStringOutputs.push({ name, val });
							} else {
								const expectedResolved = item.resolvedOutputPaths[name];
								if (path.resolve(val) !== path.resolve(expectedResolved)) {
									return handleExecutionFailure(
										effects,
										{ ...stateRef.current, stepIndex: item.stepIndex },
										"execution",
										new Error(
											`Step ${item.stepIndex + 1} subagent file output '${name}' returned path '${val}', expected '${expectedResolved}'`,
										),
										steps.length,
										runId,
									);
								}
							}
						}

						for (const [name, def] of Object.entries(item.step.outputs)) {
							if (def.type === "file") {
								const resolved = item.resolvedOutputPaths[name];
								const exists = await effects.checkFileWritten(resolved);
								if (!exists) {
									return handleExecutionFailure(
										effects,
										{ ...stateRef.current, stepIndex: item.stepIndex },
										"execution",
										new Error(
											`Step ${item.stepIndex + 1} subagent output verification failed: declared outputs were missing or unwritten`,
										),
										steps.length,
										runId,
									);
								}
							}
						}

						for (const { name, val } of pendingStringOutputs) {
							effects.recordOutput(
								item.stepIndex,
								name,
								val,
								"string",
								undefined,
								runId,
							);
							outputs[name] = val;
						}

						for (const [name, def] of Object.entries(item.step.outputs)) {
							if (def.type === "file") {
								const resolved = item.resolvedOutputPaths[name];
								effects.recordOutput(
									item.stepIndex,
									name,
									resolved,
									def.type,
									def.base,
									runId,
								);
								outputs[name] = resolved;
							}
						}

						stateRef.current = {
							...stateRef.current,
							outputs: { ...outputs },
						};
					} else if (item.effect.output) {
						effects.recordOutput(
							item.stepIndex,
							item.effect.output,
							outputText,
							"string",
							undefined,
							runId,
						);
						outputs[item.effect.output] = outputText;
						stateRef.current = {
							...stateRef.current,
							outputs: { ...outputs },
						};
					}
				}
			}

			const lastActive = activeWaveSteps[activeWaveSteps.length - 1];
			if (lastActive.effect.gate !== undefined) {
				const pauseTransition = applyGatePause(
					state,
					lastActive.effect.gate,
					lastActive.effect.stepLabel,
				);
				state = {
					...pauseTransition.nextState,
					stepIndex: lastActive.stepIndex,
					outputs: { ...outputs },
				};
				stateRef.current = state;
				effects.emit({
					action: "state",
					...state,
					runId,
				});
				effects.emit({
					action: "step",
					id: `wf-step-${runId}-${lastActive.stepIndex}-gate`,
					stepIndex: lastActive.stepIndex,
					label: `Paused at gate: ${lastActive.effect.gate}`,
					kind: "success",
					runId,
				});
				return {
					kind: "success",
					text: `Workflow paused at gate: "${lastActive.effect.gate}". Resume with /wf-resume`,
				};
			}

			state = {
				...state,
				stepIndex: waveEnd,
				status: "running",
				outputs: { ...outputs },
			};
			stateRef.current = state;
			if (state.stepIndex < steps.length) {
				effects.emit({
					action: "state",
					...state,
					runId,
				});
			}
			continue;
		}

		const resolvedOutputPaths = resolveStepOutputFilePaths(
			step.kind === "prompt" ? step.outputs : undefined,
			invocation.resolvedArgs,
			outputs,
			effects,
		);

		const transition = computeStepTransition({
			doc,
			invocation,
			state,
			instructions: pendingInstructions,
			outputs,
			resolvedOutputPaths,
		});

		if (transition.effect.type === "skip") {
			state = transition.nextState;
			stateRef.current = state;
			if (state.stepIndex < steps.length) {
				effects.emit({
					action: "state",
					...state,
					runId,
				});
			}
			continue;
		}

		if (transition.effect.type === "prompt") {
			pendingInstructions = undefined;
			const { effect, nextState } = transition;
			effects.emit({
				action: "step",
				id: `wf-step-${runId}-${currentStepIndex}`,
				stepIndex: currentStepIndex,
				label: effect.stepLabel,
				kind: "success",
				runId,
			});

			await effects.dispatchPrompt(effect);

			if (signal.aborted) {
				return handleTermination(
					signal,
					effects,
					stateRef.current,
					currentStepIndex,
					effect.stepLabel,
					steps.length,
					runId,
				);
			}

			if (
				step.kind === "prompt" &&
				step.outputs !== undefined &&
				Object.keys(step.outputs).length > 0
			) {
				const declaredOutputs = step.outputs;
				const verifiedValues: Record<string, string | readonly string[]> = {};
				let allVerified = false;

				for (let attempt = 1; attempt <= 3; attempt++) {
					const missing: OutputRetryMissingItem[] = [];
					for (const [name, def] of Object.entries(declaredOutputs)) {
						if (verifiedValues[name] !== undefined) {
							continue;
						}
						if (def.type === "file") {
							const resolved = resolvedOutputPaths[name];
							const exists = await effects.checkFileWritten(resolved);
							if (exists) {
								verifiedValues[name] = resolved;
							} else {
								missing.push({ name, type: "file", resolvedPath: resolved });
							}
						} else if (def.type === "list") {
							const captured = effects.getCapturedOutput(
								currentStepIndex,
								name,
							);
							if (captured !== undefined) {
								const parsed = parseListOutput(name, captured, def);
								if (parsed.kind === "success") {
									verifiedValues[name] = parsed.value;
								} else {
									missing.push({ name, type: "list" });
								}
							} else {
								missing.push({ name, type: "list" });
							}
						} else {
							const captured = effects.getCapturedOutput(
								currentStepIndex,
								name,
							);
							if (captured !== undefined) {
								verifiedValues[name] = captured;
							} else {
								missing.push({ name, type: "string" });
							}
						}
					}

					if (missing.length === 0) {
						allVerified = true;
						break;
					}

					if (attempt < 3) {
						const stepName = interpolateTemplate(
							step.name,
							invocation.resolvedArgs,
							outputs,
						);
						const retryPromptText = formatOutputRetryPrompt({
							stepIndex: currentStepIndex,
							totalSteps: steps.length,
							stepName,
							missingOutputs: missing,
							attempt,
						});
						await effects.dispatchPrompt({
							type: "prompt",
							promptText: retryPromptText,
							stepLabel: `${effect.stepLabel} (Output Retry ${attempt}/3)`,
						});
						if (signal.aborted) {
							return handleTermination(
								signal,
								effects,
								stateRef.current,
								currentStepIndex,
								effect.stepLabel,
								steps.length,
								runId,
							);
						}
					}
				}

				if (!allVerified) {
					return handleExecutionFailure(
						effects,
						stateRef.current,
						"execution",
						new Error(
							`Step ${currentStepIndex + 1} output verification failed after 3 attempts`,
						),
						steps.length,
						runId,
					);
				}

				for (const [name, def] of Object.entries(declaredOutputs)) {
					const val = verifiedValues[name];
					if (def.type === "file") {
						// type-safe: verifiedValues[name] for def.type === "file" is guaranteed to be a string resolved path
						effects.recordOutput(
							currentStepIndex,
							name,
							val as string,
							def.type,
							def.base,
							runId,
						);
					}
					outputs[name] = val;
				}
				stateRef.current = {
					...stateRef.current,
					outputs: { ...outputs },
				};
			}

			const hasOutputs = Object.keys(outputs).length > 0;
			if (effect.gate !== undefined) {
				const pauseTransition = applyGatePause(
					state,
					effect.gate,
					effect.stepLabel,
				);
				state = {
					...pauseTransition.nextState,
					...(hasOutputs ? { outputs } : {}),
				};
				stateRef.current = state;
				effects.emit({
					action: "state",
					...state,
					runId,
				});
				effects.emit({
					action: "step",
					id: `wf-step-${runId}-${currentStepIndex}-gate`,
					stepIndex: currentStepIndex,
					label: `Paused at gate: ${effect.gate}`,
					kind: "success",
					runId,
				});
				return {
					kind: "success",
					text: `Workflow paused at gate: "${effect.gate}". Resume with /wf-resume`,
				};
			}

			state = {
				...nextState,
				...(hasOutputs ? { outputs } : {}),
			};
			stateRef.current = state;
		} else {
			// type is narrowed to "print" during step loop transitions
			const effect = transition.effect as Extract<
				typeof transition.effect,
				{ type: "print" }
			>;
			effects.emit({
				action: "print",
				id: `wf-print-${runId}-${currentStepIndex}`,
				text: effect.text,
				runId,
			});
			if (signal.aborted) {
				return handleTermination(
					signal,
					effects,
					stateRef.current,
					currentStepIndex,
					steps[currentStepIndex].name,
					steps.length,
					runId,
				);
			}
			const hasOutputs = Object.keys(outputs).length > 0;
			state = {
				...transition.nextState,
				...(hasOutputs ? { outputs } : {}),
			};
			stateRef.current = state;
		}

		if (state.stepIndex < steps.length) {
			effects.emit({ action: "state", ...state, runId });
		}
	}

	return completeWorkflow(effects, steps.length, outputs, runId);
}

/**
 * Loads and parses a workflow document from effects, returning the parsed document or an error CommandResult.
 */
async function loadAndParseWorkflow(
	targetPath: string,
	effects: WorkflowEffectContext,
): Promise<{ doc: WorkflowDocument } | CommandErrorResult> {
	let content: string;
	try {
		content = await effects.readWorkflow(targetPath);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			kind: "error",
			text: `Failed to load workflow '${targetPath}': ${message}`,
		};
	}

	const docStep = runValidationStep(
		() => parseWorkflowDocument(content),
		"Failed to parse workflow",
		targetPath,
	);
	if ("kind" in docStep) {
		return docStep;
	}
	return { doc: docStep.result };
}

/**
 * Result of loading, argument resolution, and AST/runtime validation.
 */
interface WorkflowValidationSuccess {
	readonly kind: "valid";
	readonly doc: WorkflowDocument;
	readonly targetPath: string;
	readonly rawInput: string;
	readonly resolvedArgs?: Record<string, string>;
}

/**
 * Validates subagent step configurations against the live environment.
 * CONTRACT:
 * - Inputs: WorkflowDocument, effects context, targetPath, optional arguments, optional AbortSignal.
 * - Outputs: Formatted error message string on failure, or undefined if valid.
 */
async function validateWorkflowSubagents(
	doc: WorkflowDocument,
	effects: WorkflowEffectContext,
	targetPath: string,
	args?: Record<string, string>,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const effectiveArgs: Record<string, string> = { ...(args ?? {}) };
	if (args === undefined) {
		for (const [key, def] of Object.entries(doc.args)) {
			if (def.default !== undefined) {
				effectiveArgs[key] = String(def.default);
			}
		}
	}

	for (let i = 0; i < doc.steps.length; i++) {
		const step = doc.steps[i];
		if (step.kind !== "subagent") continue;

		let configToValidate: SubagentConfig;
		try {
			if (step.rawSubagent) {
				const interpolated = interpolateTemplate(
					step.rawSubagent,
					effectiveArgs,
				);
				if (interpolated.includes("{{")) continue;
				const parsed = parseSubagentShorthand(interpolated);
				configToValidate = normalizeSubagentConfig(parsed);
			} else {
				const interpolatedConfig = interpolateSubagentConfig(
					step.config,
					effectiveArgs,
				);
				if (
					Object.values(interpolatedConfig).some(
						(v) => typeof v === "string" && v.includes("{{"),
					)
				) {
					continue;
				}
				configToValidate = interpolatedConfig;
			}
		} catch (err: unknown) {
			if (
				args === undefined &&
				String(err).includes("Unresolved workflow argument")
			) {
				continue;
			}
			const message = err instanceof Error ? err.message : String(err);
			return `Validation error in workflow '${targetPath}': Subagent step ${i + 1} ('${step.name}'): ${message}`;
		}

		const routeResult = await effects.validateSubagentRoute(
			configToValidate,
			signal,
		);
		if (!routeResult.valid) {
			return `Validation error in workflow '${targetPath}': Subagent step ${i + 1} ('${step.name}'): ${routeResult.message}`;
		}
	}

	return undefined;
}

/**
 * Loads, parses, resolves arguments, runs pure AST rules, and validates subagent routes.
 * CONTRACT:
 * - Inputs: rawInput string, effects context, options (requireArgs, usageText, optional signal).
 * - Outputs: WorkflowValidationSuccess or CommandErrorResult.
 */
async function loadAndValidateWorkflowCore(
	rawInput: string,
	effects: WorkflowEffectContext,
	options: {
		requireArgs: boolean;
		usageText: string;
		signal?: AbortSignal;
	},
): Promise<WorkflowValidationSuccess | CommandErrorResult> {
	const parsed = parseInvocationInput(rawInput);
	if (!parsed.targetPath) {
		return { kind: "error", text: options.usageText };
	}

	const loaded = await loadAndParseWorkflow(parsed.targetPath, effects);
	if ("kind" in loaded) {
		return loaded;
	}
	const doc = loaded.doc;

	const hasExplicitArgs =
		Object.keys(parsed.explicitArgs).length > 0 ||
		parsed.implicitInstructions.length > 0;

	let resolvedArgs: Record<string, string> | undefined;

	if (hasExplicitArgs || options.requireArgs) {
		const argsStep = runValidationStep(
			() =>
				resolveWorkflowArgs({
					declarations: doc.args,
					explicitArgs: parsed.explicitArgs,
					implicitInstructions: parsed.implicitInstructions,
				}),
			"Argument error in workflow",
			parsed.targetPath,
		);
		if ("kind" in argsStep) {
			return argsStep;
		}
		resolvedArgs = argsStep.result;
	}

	const validationErrors = validateWorkflow({ doc, args: resolvedArgs });
	if (validationErrors.length > 0) {
		return {
			kind: "error",
			text: formatValidationErrors(parsed.targetPath, validationErrors),
		};
	}

	const subagentError = await validateWorkflowSubagents(
		doc,
		effects,
		parsed.targetPath,
		resolvedArgs,
		options.signal,
	);
	if (subagentError) {
		return {
			kind: "error",
			text: subagentError,
		};
	}

	return {
		kind: "valid",
		doc,
		targetPath: parsed.targetPath,
		rawInput,
		resolvedArgs,
	};
}

/**
 * Validates a workflow invocation input, reading and parsing the file and arguments.
 * CONTRACT:
 * - Input: targetPath string, effects context, optional runId, optional signal.
 * - Output: Promise resolving to ValidatedWorkflow or error CommandResult.
 * - Errors: returns error CommandResult if session ID missing, file not found, or syntax invalid.
 */
export async function validateWorkflowInvocation(
	targetPath: string,
	effects: WorkflowEffectContext,
	runId?: string,
	signal?: AbortSignal,
): Promise<ValidatedWorkflow | CommandErrorResult> {
	const sessionId = effects.sessionId;
	if (!sessionId) {
		return {
			kind: "error",
			text: "Workflow execution failed: agent session ID is required",
		};
	}

	const result = await loadAndValidateWorkflowCore(targetPath, effects, {
		requireArgs: true,
		usageText: "Usage: /wf <workflow.yaml>",
		signal,
	});
	if (result.kind === "error") {
		return result;
	}

	const invocation: WorkflowInvocation = {
		targetPath: result.targetPath,
		rawInput: targetPath,
		resolvedArgs: result.resolvedArgs ?? {},
		runId: runId ?? crypto.randomUUID(),
	};

	const state: WorkflowState = {
		stepIndex: 0,
		status: "running",
	};

	return {
		kind: "valid",
		doc: result.doc,
		invocation,
		state,
	};
}

/**
 * Validates a workflow file and optional invocation arguments without executing it.
 * CONTRACT:
 * - Input: rawInput string containing workflow target path and optional arguments, effects context.
 * - Output: Promise resolving to CommandResult (success with summary or error with diagnostics).
 * - Invariant: Zero state mutations, zero session events, does not require active session ID or idle workflow runner.
 */
export async function validateWorkflowTarget(
	rawInput: string,
	effects: WorkflowEffectContext,
): Promise<CommandResult> {
	const result = await loadAndValidateWorkflowCore(rawInput, effects, {
		requireArgs: false,
		usageText: "Usage: /wf-validate <workflow.yaml> [key=value ...]",
	});
	if (result.kind === "error") {
		return result;
	}

	return {
		kind: "success",
		text: formatValidationSummary(
			result.targetPath,
			result.doc,
			result.resolvedArgs,
		),
	};
}

/**
 * Executes a pre-validated workflow, emitting initialization events and driving steps.
 * CONTRACT:
 * - Input: validated workflow descriptor, effects context, optional signal.
 * - Output: Promise resolving to CommandResult.
 */
export async function executeValidatedWorkflow(
	validated: ValidatedWorkflow,
	effects: WorkflowEffectContext,
	signal?: AbortSignal,
): Promise<CommandResult> {
	const activeRun = foldWorkflowState(effects.snapshotEvents());
	if (activeRun !== null && activeRun.state.status === "running") {
		return {
			kind: "error",
			text: `Cannot start workflow: '${activeRun.workflow.name ?? activeRun.invocation.targetPath}' is already running`,
		};
	}
	return withWorkflowExecution(effects, () =>
		executeValidatedWorkflowDirect(validated, effects, signal),
	);
}

async function executeValidatedWorkflowDirect(
	validated: ValidatedWorkflow,
	effects: WorkflowEffectContext,
	signal?: AbortSignal,
): Promise<CommandResult> {
	const { doc, invocation, state } = validated;
	const runId = invocation.runId;
	const workflowAbortController = new AbortController();
	const combinedSignal = signal
		? AbortSignal.any([signal, workflowAbortController.signal])
		: workflowAbortController.signal;
	const cleanupAbort = effects.watchAbort(workflowAbortController);

	const stateRef = { current: state };
	try {
		const rawTitle = doc.title ?? doc.name;
		if (rawTitle && !effects.hasTitle()) {
			const sessionTitle = interpolateTemplate(
				rawTitle,
				invocation.resolvedArgs,
			);
			if (sessionTitle.trim().length > 0) {
				effects.setTitle(sessionTitle);
			}
		}

		effects.emit({
			action: "init",
			workflow: doc,
			invocation,
			runId,
		});

		await effects.whenIdle();
		if (combinedSignal.aborted) {
			return handleTermination(
				combinedSignal,
				effects,
				stateRef.current,
				stateRef.current.stepIndex,
				doc.steps[stateRef.current.stepIndex].name,
				doc.steps.length,
				runId,
			);
		}

		effects.setStatus("running");
		return await runWorkflowSteps({
			effects,
			doc,
			invocation,
			stateRef,
			signal: combinedSignal,
		});
	} catch (err: unknown) {
		return handleWorkflowExecutionError({
			effects,
			state: stateRef.current,
			doc,
			signal: combinedSignal,
			err,
			action: "execution",
			runId,
		});
	} finally {
		cleanupAbort();
		effects.setStatus("idle");
	}
}

/**
 * Loads and initiates a workflow YAML file, executing steps sequentially.
 * CONTRACT:
 * - Input: effects context, targetPath string, and optional signal.
 * - Output: Promise resolving to CommandResult (success, gate pause, or abort error).
 * - Errors: returns error CommandResult if session ID missing, file not found, or syntax invalid.
 */
export async function executeWorkflow({
	effects,
	targetPath,
	signal,
	runId,
}: {
	effects: WorkflowEffectContext;
	targetPath: string;
	signal?: AbortSignal;
	runId?: string;
}): Promise<CommandResult> {
	const validated = await validateWorkflowInvocation(
		targetPath,
		effects,
		runId,
		signal,
	);
	if (validated.kind === "error") {
		return validated;
	}
	return executeValidatedWorkflow(validated, effects, signal);
}

/**
 * Resumes an interrupted or gate-paused workflow from session event log.
 * CONTRACT:
 * - Inputs: effects context, optional signal, and additional resumption instructions.
 * - Outputs: Promise resolving to CommandResult (success or error).
 * - Throws: None (errors returned as CommandResult error objects).
 */
export function resumeWorkflow(options: {
	effects: WorkflowEffectContext;
	signal?: AbortSignal;
	instructions?: string;
}): Promise<CommandResult> {
	return withWorkflowExecution(options.effects, () =>
		resumeWorkflowDirect(options),
	);
}

/**
 * Purpose: Acknowledges a valid resume without retaining the submitting UI request.
 * Contract:
 * - Inputs: session effects, additional instructions, and the admission request signal.
 * - Outputs: validation errors or acknowledgement before resumed execution finishes.
 * - Throws / Errors: unexpected background failures are logged.
 */
export async function requestWorkflowResume(
	effects: WorkflowEffectContext,
	instructions: string,
	signal: AbortSignal,
): Promise<CommandResult> {
	if (executingSessions.has(effects.sessionId)) {
		return {
			kind: "error",
			text: "A workflow is already executing in this session",
		};
	}
	const prepared = await prepareWorkflowResume(effects);
	if (prepared.kind === "error") return prepared;
	signal.throwIfAborted();
	if (executingSessions.has(effects.sessionId)) {
		return {
			kind: "error",
			text: "A workflow is already executing in this session",
		};
	}
	void withWorkflowExecution(effects, () =>
		executeWorkflowResume({ effects, instructions, run: prepared.run }),
	).catch((error: unknown) => {
		effects.logInfo(`Workflow resume failed: ${extractErrorMessage(error)}`);
	});
	return { kind: "success", text: "Workflow resume accepted" };
}

async function prepareWorkflowResume(
	effects: WorkflowEffectContext,
): Promise<
	{ readonly kind: "ready"; readonly run: WorkflowRun } | CommandErrorResult
> {
	const sessionError = await ensureIdleSession(effects, "resume");
	if (sessionError) {
		return sessionError;
	}

	const run = foldWorkflowState(effects.snapshotEvents());
	if (!run) {
		return {
			kind: "error",
			text: "No interrupted workflow found to resume",
		};
	}
	if (run.state.status === "completed") {
		return {
			kind: "error",
			text: "Workflow has already completed",
		};
	}

	return { kind: "ready", run };
}

async function resumeWorkflowDirect(options: {
	effects: WorkflowEffectContext;
	signal?: AbortSignal;
	instructions?: string;
}): Promise<CommandResult> {
	const prepared = await prepareWorkflowResume(options.effects);
	if (prepared.kind === "error") return prepared;
	return executeWorkflowResume({ ...options, run: prepared.run });
}

async function executeWorkflowResume({
	effects,
	signal,
	instructions,
	run,
}: {
	effects: WorkflowEffectContext;
	signal?: AbortSignal;
	instructions?: string;
	run: WorkflowRun;
}): Promise<CommandResult> {
	const { workflow: doc, invocation, state } = run;
	const isInterruptedPause =
		state.status === "paused" && state.pauseReason === "interrupted";
	const nextStepIndex =
		state.status === "paused" && !isInterruptedPause
			? state.stepIndex + 1
			: state.stepIndex;

	const workflowAbortController = new AbortController();
	const combinedSignal = signal
		? AbortSignal.any([signal, workflowAbortController.signal])
		: workflowAbortController.signal;
	const cleanupAbort = effects.watchAbort(workflowAbortController);

	const { error: _error, ...cleanState } = state;
	const resumeState: WorkflowState = {
		...cleanState,
		stepIndex: nextStepIndex,
	};
	const stateRef = { current: resumeState };

	try {
		if (nextStepIndex >= doc.steps.length) {
			return completeWorkflow(
				effects,
				doc.steps.length,
				state.outputs,
				invocation.runId,
			);
		}

		if (combinedSignal.aborted) {
			return handleTermination(
				combinedSignal,
				effects,
				stateRef.current,
				nextStepIndex,
				doc.steps[nextStepIndex].name,
				doc.steps.length,
				invocation.runId,
			);
		}

		const { pauseReason: _pauseReason, ...runningState } = cleanState;
		effects.emit({
			action: "state",
			...runningState,
			stepIndex: nextStepIndex,
			status: "running",
			runId: invocation.runId,
		});

		effects.logInfo(
			`Resuming workflow '${doc.name ?? invocation.targetPath}' at step ${nextStepIndex + 1}/${doc.steps.length}${instructions ? ` with instructions: ${instructions}` : ""}`,
		);

		effects.setStatus("running");
		return await runWorkflowSteps({
			effects,
			doc,
			invocation,
			stateRef,
			signal: combinedSignal,
			instructions: instructions ? instructions.trim() : undefined,
		});
	} catch (err: unknown) {
		return handleWorkflowExecutionError({
			effects,
			state: stateRef.current,
			doc,
			signal: combinedSignal,
			err,
			action: "resume",
			runId: invocation.runId,
		});
	} finally {
		cleanupAbort();
		effects.setStatus("idle");
	}
}

/**
 * Purpose: Discards an active, paused, or interrupted workflow, marking it aborted.
 * Contract:
 * - Inputs: effects context for the target session.
 * - Outputs: Promise resolving to CommandResult (success or error).
 * - Throws: None.
 */
export function discardWorkflow(options: {
	effects: WorkflowEffectContext;
}): Promise<CommandResult> {
	return withWorkflowExecution(options.effects, () =>
		discardWorkflowDirect(options),
	);
}

async function discardWorkflowDirect({
	effects,
}: {
	effects: WorkflowEffectContext;
}): Promise<CommandResult> {
	const sessionError = await ensureIdleSession(effects, "discard");
	if (sessionError) {
		return sessionError;
	}

	const run = foldWorkflowState(effects.snapshotEvents());
	if (!run) {
		return {
			kind: "error",
			text: "No active workflow to discard",
		};
	}
	if (run.state.status === "running") {
		return {
			kind: "error",
			text: "Cannot discard an actively running workflow; stop execution first",
		};
	}
	if (run.state.status === "completed" || run.state.status === "aborted") {
		return {
			kind: "error",
			text: "Workflow is not active or has already ended",
		};
	}

	const { workflow: doc, state, invocation } = run;
	const runId = invocation.runId;
	const stepName = `: ${doc.steps[state.stepIndex].name}`;
	const transition = applyAbort(state, doc.steps.length, false);
	effects.emit({
		action: "state",
		...transition.nextState,
		runId,
	});
	effects.emit({
		action: "step",
		id: `wf-step-${runId}-${state.stepIndex}-discarded`,
		stepIndex: state.stepIndex,
		label: `Workflow discarded at step ${state.stepIndex + 1} of ${doc.steps.length}${stepName}`,
		kind: "error",
		runId,
	});
	effects.logInfo(
		`Workflow '${doc.name ?? run.invocation.targetPath}' discarded by user at step ${state.stepIndex + 1}/${doc.steps.length}`,
	);

	return {
		kind: "success",
		text: `Workflow discarded at step ${state.stepIndex + 1}/${doc.steps.length}`,
	};
}

/**
 * Purpose: Lists and summarizes available workflows in local and common directories.
 * Contract:
 * - Inputs: WorkflowEffectContext instance.
 * - Outputs: Promise resolving to CommandResult ({ kind: "success", text: string }).
 * - Throws: None (errors handled gracefully).
 */
export async function listWorkflows(
	effects: WorkflowEffectContext,
): Promise<CommandResult> {
	const [localFiles, commonFiles] = await Promise.all([
		effects.listWorkflowFiles("local"),
		effects.listWorkflowFiles("common"),
	]);

	const parseSummaries = (
		files: ReadonlyArray<{ readonly target: string; readonly content: string }>,
	): WorkflowSummary[] => {
		const summaries: WorkflowSummary[] = [];
		for (const file of files) {
			const summary = parseWorkflowSummary(file.target, file.content);
			if (summary) {
				summaries.push(summary);
			}
		}
		return summaries;
	};

	const localSummaries = parseSummaries(localFiles);
	const commonSummaries = parseSummaries(commonFiles);

	return {
		kind: "success",
		text: formatWorkflowList([
			{ title: "Local Workflows (.agents/wf)", workflows: localSummaries },
			{ title: "Common Workflows (~/.agents/wf)", workflows: commonSummaries },
		]),
	};
}
