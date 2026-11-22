/**
 * PURPOSE: Pure workflow validation rules and composite validator.
 * ALLOWED: Pure computation, AST traversal, string analysis, schema enforcement.
 * FORBIDDEN: No I/O, no filesystem, no runtime state, no agent orchestration.
 */

import { interpolateTemplate, isFlatChoiceMapping } from "./parser.ts";
import type { WorkflowDocument, WorkflowStep } from "./types.ts";

export interface ValidationError {
	readonly rule: string;
	readonly category: "template" | "output";
	readonly message: string;
	readonly stepIndex?: number;
}

export interface WorkflowValidationContext {
	readonly doc: WorkflowDocument;
	readonly args?: Record<string, string>;
}

export type WorkflowRule = (
	context: WorkflowValidationContext,
) => readonly ValidationError[];

const OUTPUT_REF_REGEX = /\{\{outputs\.([a-zA-Z0-9_-]+)\}\}/g;

function extractDeclaredOutputs(steps: readonly WorkflowStep[]): Map<
	string,
	{
		stepIndex: number;
		kind: WorkflowStep["kind"];
		type: "file" | "string" | "list";
	}
> {
	const map = new Map<
		string,
		{
			stepIndex: number;
			kind: WorkflowStep["kind"];
			type: "file" | "string" | "list";
		}
	>();
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (step.kind === "subagent" && step.output && !map.has(step.output)) {
			const outputType = step.foreach !== undefined ? "list" : "string";
			map.set(step.output, { stepIndex: i, kind: step.kind, type: outputType });
		}
		if ((step.kind === "prompt" || step.kind === "subagent") && step.outputs) {
			for (const [name, def] of Object.entries(step.outputs)) {
				if (!map.has(name)) {
					const outputType =
						step.kind === "subagent" && step.foreach !== undefined
							? "list"
							: def.type;
					map.set(name, { stepIndex: i, kind: step.kind, type: outputType });
				}
			}
		}
	}
	return map;
}

function extractStepStrings(
	step: WorkflowStep,
	options: { includeForeach?: boolean } = { includeForeach: true },
): string[] {
	const strings: string[] = [step.name];
	if (step.if) strings.push(step.if);

	if (step.kind === "prompt" || step.kind === "subagent") {
		strings.push(step.prompt);
		if (typeof step.gate === "string") strings.push(step.gate);
		if (
			step.kind === "subagent" &&
			step.foreach &&
			options.includeForeach !== false
		) {
			strings.push(step.foreach);
		}
		if (step.kind === "subagent") {
			if (step.rawSubagent) strings.push(step.rawSubagent);
			if (step.config.provider) strings.push(step.config.provider);
			if (step.config.llmProvider) strings.push(step.config.llmProvider);
			if (step.config.preset) strings.push(step.config.preset);
			if (step.config.model) strings.push(step.config.model);
			if (step.config.thinking) strings.push(step.config.thinking);
		}
		if (step.outputs) {
			for (const def of Object.values(step.outputs)) {
				if (def.type === "file") {
					strings.push(def.path);
				}
			}
		}
	} else {
		strings.push(step.text);
	}
	return strings;
}

/**
 * Purpose: Enforces that subagent steps do not declare direct 'list' outputs and foreach subagents only declare 'string' outputs.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of invalid subagent output type errors.
 */
export const ruleSubagentOutputTypes: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];

	for (let i = 0; i < context.doc.steps.length; i++) {
		const step = context.doc.steps[i];
		if (step.kind !== "subagent" || !step.outputs) continue;

		for (const [name, def] of Object.entries(step.outputs)) {
			if (def.type === "list") {
				errors.push({
					rule: "subagent-output-list-disallowed",
					category: "output",
					message: `Subagent step ${i + 1} ('${step.name}') output '${name}' cannot be of type 'list'. Subagents cannot produce list outputs directly.`,
					stepIndex: i,
				});
			} else if (step.foreach !== undefined && def.type === "file") {
				errors.push({
					rule: "foreach-subagent-output-file-disallowed",
					category: "output",
					message: `Subagent step ${i + 1} ('${step.name}') has foreach and cannot declare file output '${name}'. Foreach subagents only support string outputs.`,
					stepIndex: i,
				});
			}
		}
	}

	return errors;
};

/**
 * Purpose: Enforces that all subagent steps declare at least one output via 'output' or 'outputs'.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of subagent output missing errors.
 */
export const ruleSubagentOutputRequired: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];

	for (let i = 0; i < context.doc.steps.length; i++) {
		const step = context.doc.steps[i];
		if (step.kind === "subagent") {
			const hasOutput =
				Boolean(step.output?.trim()) ||
				(step.outputs !== undefined && Object.keys(step.outputs).length > 0);
			if (!hasOutput) {
				errors.push({
					rule: "subagent-output-required",
					category: "output",
					message: `Subagent step ${i + 1} ('${step.name}') must declare at least one output via 'output' or 'outputs'.`,
					stepIndex: i,
				});
			}
		}
	}

	return errors;
};

/**
 * Purpose: Enforces that all output names across all steps in the document are globally unique.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of duplicate output name errors.
 */
export const ruleDuplicateOutputNames: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < context.doc.steps.length; i++) {
		const step = context.doc.steps[i];
		if (step.kind === "subagent" && step.output) {
			if (seen.has(step.output)) {
				errors.push({
					rule: "duplicate-output-name",
					category: "output",
					message: `Duplicate output name '${step.output}' declared at step ${i + 1}. Output names must be globally unique.`,
					stepIndex: i,
				});
			} else {
				seen.add(step.output);
			}
		}
		if (step.kind === "prompt" || step.kind === "subagent") {
			if (step.outputs) {
				for (const name of Object.keys(step.outputs)) {
					if (seen.has(name)) {
						errors.push({
							rule: "duplicate-output-name",
							category: "output",
							message: `Duplicate output name '${name}' declared at step ${i + 1}. Output names must be globally unique.`,
							stepIndex: i,
						});
					} else {
						seen.add(name);
					}
				}
			}
		}
	}

	return errors;
};

/**
 * Purpose: Ensures workflow document name and title do not reference outputs before steps execute.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of workflow name and title output reference errors.
 */
export const ruleWorkflowNameOutputReferences: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];
	const seenRefs = new Set<string>();

	const checkOutputRefs = (text: string, field: "name" | "title") => {
		const matches = text.matchAll(OUTPUT_REF_REGEX);
		for (const match of matches) {
			const refName = match[1];
			const key = `${field}:${refName}`;
			if (seenRefs.has(key)) continue;
			seenRefs.add(key);
			errors.push({
				rule: "workflow-name-output",
				category: "output",
				message: `Output '{{outputs.${refName}}}' referenced in workflow ${field} before any step execution.`,
			});
		}
	};

	if (context.doc.name) {
		checkOutputRefs(context.doc.name, "name");
	}
	if (context.doc.title) {
		checkOutputRefs(context.doc.title, "title");
	}
	return errors;
};

/**
 * Purpose: Validates that step output references point to declared outputs and are not forward references.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of unknown and forward output reference errors.
 */
export const ruleStepOutputReferences: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];
	const declaredMap = extractDeclaredOutputs(context.doc.steps);

	for (let i = 0; i < context.doc.steps.length; i++) {
		const step = context.doc.steps[i];
		const stringsToCheck = extractStepStrings(step, { includeForeach: false });
		const seenRefs = new Set<string>();

		for (const str of stringsToCheck) {
			const matches = str.matchAll(OUTPUT_REF_REGEX);
			for (const match of matches) {
				const refName = match[1];
				if (seenRefs.has(refName)) continue;
				seenRefs.add(refName);

				const declared = declaredMap.get(refName);
				if (declared === undefined) {
					errors.push({
						rule: "unknown-output",
						category: "output",
						message: `Unknown output '{{outputs.${refName}}}' referenced at step ${i + 1}.`,
						stepIndex: i,
					});
				} else if (declared.stepIndex >= i) {
					errors.push({
						rule: "forward-output-reference",
						category: "output",
						message: `Output '{{outputs.${refName}}}' referenced at step ${i + 1} before it is declared at step ${declared.stepIndex + 1}.`,
						stepIndex: i,
					});
				}
			}
		}
	}

	return errors;
};

/**
 * Purpose: Enforces that subagent steps do not depend on outputs produced by earlier subagent steps.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of subagent dependency errors.
 */
export const ruleSubagentDependencies: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];
	const declaredMap = extractDeclaredOutputs(context.doc.steps);

	for (let i = 0; i < context.doc.steps.length; i++) {
		const step = context.doc.steps[i];
		if (step.kind !== "subagent") continue;

		const stringsToCheck = extractStepStrings(step);
		const seenRefs = new Set<string>();

		for (const str of stringsToCheck) {
			const matches = str.matchAll(OUTPUT_REF_REGEX);
			for (const match of matches) {
				const refName = match[1];
				if (seenRefs.has(refName)) continue;
				seenRefs.add(refName);

				const declared = declaredMap.get(refName);
				if (
					declared &&
					declared.stepIndex < i &&
					declared.kind === "subagent"
				) {
					errors.push({
						rule: "subagent-dependency",
						category: "output",
						message: `Subagent step ${i + 1} ('${step.name}') cannot depend on output '{{outputs.${refName}}}' produced by subagent step ${declared.stepIndex + 1}. Subagents execute concurrently and cannot depend on each other.`,
						stepIndex: i,
					});
				}
			}
		}
	}

	return errors;
};

/**
 * Purpose: Ensures that every declared output is referenced at least once in subsequent workflow steps.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of unused output errors.
 */
export const ruleUnusedOutputs: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];
	const declaredMap = extractDeclaredOutputs(context.doc.steps);
	const usedOutputs = new Set<string>();

	for (let i = 0; i < context.doc.steps.length; i++) {
		const step = context.doc.steps[i];
		const stringsToCheck = extractStepStrings(step);

		for (const str of stringsToCheck) {
			const matches = str.matchAll(OUTPUT_REF_REGEX);
			for (const match of matches) {
				usedOutputs.add(match[1]);
			}
		}
	}

	for (const [name, { stepIndex }] of declaredMap) {
		if (!usedOutputs.has(name)) {
			errors.push({
				rule: "unused-output",
				category: "output",
				message: `Output '${name}' declared at step ${stepIndex + 1} is never used in the workflow. All outputs must be used at least once.`,
				stepIndex,
			});
		}
	}

	return errors;
};

/**
 * Purpose: Validates that all {{args.<name>}} placeholders across doc name and steps can be resolved.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc and optional resolved args.
 * - Outputs: readonly array of template argument interpolation or declaration errors.
 */
export const ruleTemplateArgs: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];
	const declaredAndDerivedArgs = new Set(Object.keys(context.doc.args));
	for (const def of Object.values(context.doc.args)) {
		if (def.type === "choice") {
			const mapping = def.mapping ?? def.mappings;
			if (mapping && !isFlatChoiceMapping(mapping)) {
				for (const derivedKey of Object.keys(mapping)) {
					declaredAndDerivedArgs.add(derivedKey);
				}
			}
		}
	}
	const seenMissing = new Set<string>();

	const check = (str: string, stepIndex?: number) => {
		if (context.args !== undefined) {
			try {
				interpolateTemplate(str, context.args);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push({
					rule: "template-args",
					category: "template",
					message,
					...(stepIndex !== undefined ? { stepIndex } : {}),
				});
			}
		} else {
			const matches = str.matchAll(/\{\{args\.([a-zA-Z0-9_-]+)\}\}/g);
			for (const match of matches) {
				const argName = match[1];
				const key = `${stepIndex ?? "doc"}:${argName}`;
				if (!declaredAndDerivedArgs.has(argName) && !seenMissing.has(key)) {
					seenMissing.add(key);
					errors.push({
						rule: "template-args",
						category: "template",
						message: `Unresolved workflow argument: {{args.${argName}}} (not declared in workflow 'args')`,
						...(stepIndex !== undefined ? { stepIndex } : {}),
					});
				}
			}
		}
	};

	if (context.doc.name) {
		check(context.doc.name);
	}
	if (context.doc.title) {
		check(context.doc.title);
	}

	for (let i = 0; i < context.doc.steps.length; i++) {
		const step = context.doc.steps[i];
		const uniqueStrings = new Set(extractStepStrings(step));
		for (const str of uniqueStrings) {
			check(str, i);
		}
	}

	return errors;
};

/**
 * Purpose: Enforces that 'foreach' on a subagent references a valid declared output of type 'list'.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of foreach validation errors.
 */
export const ruleForeachOutputReferences: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];
	const declaredMap = extractDeclaredOutputs(context.doc.steps);

	for (let i = 0; i < context.doc.steps.length; i++) {
		const step = context.doc.steps[i];
		if (step.kind !== "subagent" || !step.foreach) continue;

		const match = step.foreach.match(/^\{\{outputs\.([a-zA-Z0-9_-]+)\}\}$/);
		if (!match) {
			errors.push({
				rule: "foreach-invalid-expression",
				category: "output",
				message: `Subagent step ${i + 1} ('${step.name}') has invalid foreach expression '${step.foreach}'. Must be '{{outputs.<name>}}'.`,
				stepIndex: i,
			});
			continue;
		}

		const refName = match[1];
		const declared = declaredMap.get(refName);
		if (declared === undefined) {
			errors.push({
				rule: "unknown-output",
				category: "output",
				message: `Subagent step ${i + 1} ('${step.name}') foreach references unknown output '{{outputs.${refName}}}'.`,
				stepIndex: i,
			});
		} else if (declared.stepIndex >= i) {
			errors.push({
				rule: "forward-output-reference",
				category: "output",
				message: `Subagent step ${i + 1} ('${step.name}') foreach references output '{{outputs.${refName}}}' before it is declared at step ${declared.stepIndex + 1}.`,
				stepIndex: i,
			});
		} else if (declared.type !== "list") {
			errors.push({
				rule: "foreach-non-list-output",
				category: "output",
				message: `Subagent step ${i + 1} ('${step.name}') foreach references output '{{outputs.${refName}}}' which is of type '${declared.type}', expected 'list'.`,
				stepIndex: i,
			});
		}
	}

	return errors;
};

/**
 * Purpose: Validates exhaustiveness and unknown choice keys for a choice mapping entry.
 */
function validateChoiceMappingEntries(
	choices: readonly string[],
	choiceMap: Record<string, string>,
	argName: string,
	derivedKey?: string,
): ValidationError[] {
	const errors: ValidationError[] = [];
	const contextLabel = derivedKey
		? `Argument '${argName}' mapping for '${derivedKey}'`
		: `Argument '${argName}' mapping`;

	for (const choice of choices) {
		if (!Object.hasOwn(choiceMap, choice)) {
			errors.push({
				rule: "choice-mapping-non-exhaustive",
				category: "template",
				message: `${contextLabel} is missing choice '${choice}'. All choices must be mapped.`,
			});
		}
	}

	for (const mappedKey of Object.keys(choiceMap)) {
		if (!choices.includes(mappedKey)) {
			errors.push({
				rule: "choice-mapping-unknown-choice",
				category: "template",
				message: `${contextLabel} references unknown choice '${mappedKey}'. Allowed choices: ${choices.join(", ")}.`,
			});
		}
	}

	return errors;
}

/**
 * Purpose: Enforces that choice argument mapping definitions are exhaustive, reference valid choices, and do not collide.
 * Contract:
 * - Inputs: WorkflowValidationContext with doc.
 * - Outputs: readonly array of choice mapping validation errors.
 */
export const ruleChoiceMapping: WorkflowRule = (context) => {
	const errors: ValidationError[] = [];
	const seenDerived = new Set<string>();
	const topLevelArgNames = new Set(Object.keys(context.doc.args));

	for (const [argName, def] of Object.entries(context.doc.args)) {
		if (def.type !== "choice") continue;
		const mapping = def.mapping ?? def.mappings;
		if (!mapping) continue;

		if (Object.keys(mapping).length === 0) {
			errors.push({
				rule: "choice-mapping-empty",
				category: "template",
				message: `Argument '${argName}' mapping cannot be empty.`,
			});
			continue;
		}

		if (isFlatChoiceMapping(mapping)) {
			errors.push(
				...validateChoiceMappingEntries(def.choices, mapping, argName),
			);
		} else {
			for (const [derivedKey, choiceMap] of Object.entries(mapping)) {
				if (topLevelArgNames.has(derivedKey)) {
					errors.push({
						rule: "choice-mapping-collision",
						category: "template",
						message: `Derived argument '${derivedKey}' in argument '${argName}' mapping collides with top-level argument '${derivedKey}'.`,
					});
				} else if (seenDerived.has(derivedKey)) {
					errors.push({
						rule: "choice-mapping-duplicate",
						category: "template",
						message: `Derived argument '${derivedKey}' in argument '${argName}' mapping is already defined in another choice mapping.`,
					});
				} else {
					seenDerived.add(derivedKey);
				}

				if (Object.keys(choiceMap).length === 0) {
					errors.push({
						rule: "choice-mapping-empty",
						category: "template",
						message: `Argument '${argName}' mapping for '${derivedKey}' cannot be empty.`,
					});
					continue;
				}

				errors.push(
					...validateChoiceMappingEntries(
						def.choices,
						choiceMap,
						argName,
						derivedKey,
					),
				);
			}
		}
	}

	return errors;
};

export const WORKFLOW_RULES: readonly WorkflowRule[] = [
	ruleSubagentOutputRequired,
	ruleSubagentOutputTypes,
	ruleDuplicateOutputNames,
	ruleWorkflowNameOutputReferences,
	ruleStepOutputReferences,
	ruleSubagentDependencies,
	ruleForeachOutputReferences,
	ruleUnusedOutputs,
	ruleTemplateArgs,
	ruleChoiceMapping,
];

/**
 * Purpose: Executes a set of workflow validation rules against a document and arguments context.
 * Contract:
 * - Inputs: WorkflowValidationContext.
 * - Outputs: readonly array of all collected validation errors.
 */
export function validateWorkflow(
	context: WorkflowValidationContext,
): readonly ValidationError[] {
	return WORKFLOW_RULES.flatMap((rule) => rule(context));
}

/**
 * Purpose: Formats an array of validation errors into a human-readable diagnostic message.
 * Contract:
 * - Inputs: workflow target path and array of validation errors.
 * - Outputs: formatted error string.
 */
export function formatValidationErrors(
	targetPath: string,
	errors: readonly ValidationError[],
): string {
	if (errors.length === 0) {
		return "";
	}
	if (errors.length === 1) {
		const prefix = errors[0].category === "template" ? "Template" : "Output";
		return `${prefix} validation error in workflow '${targetPath}': ${errors[0].message}`;
	}
	return `Validation errors in workflow '${targetPath}':\n${errors.map((e) => `- ${e.message}`).join("\n")}`;
}
