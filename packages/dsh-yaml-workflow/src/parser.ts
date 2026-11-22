/**
 * PURPOSE: Pure parsing, argument resolution, templating, and prompt formatting utilities.
 * ALLOWED: Pure computation, string manipulation, YAML parsing, schema validation.
 * FORBIDDEN: No I/O, no filesystem, no runtime state, no agent orchestration.
 */

import { parse } from "yaml";
import { interpolateTemplate, parseBoolean } from "./boolean.ts";

export {
	interpolateTemplate,
	parseBoolean,
	resolveGate,
} from "./boolean.ts";

import {
	type ChoiceMapping,
	type FormatStepPromptOptions,
	type FormatStepPromptOutputRequirement,
	type JsonSchemaNode,
	type ObjectJsonSchema,
	type ParsedInvocation,
	type StepOutputDef,
	type StepOutputsMap,
	type SubagentConfig,
	type WorkflowArg,
	type WorkflowDocument,
	type WorkflowFile,
	WorkflowFileSchema,
	type WorkflowGroup,
	type WorkflowParamSummary,
	type WorkflowStep,
	type WorkflowStepOutputsMap,
	type WorkflowSummary,
} from "./types.ts";

/**
 * Purpose: Parses raw YAML text into a validated WorkflowFile.
 * CONTRACT:
 * - Input: raw YAML string content.
 * - Output: validated WorkflowFile representing valid file format.
 * - Throws: Error when YAML parsing fails or file violates WorkflowFileSchema.
 */
export function parseWorkflowFile(content: string): WorkflowFile {
	const raw = parse(content);
	const result = WorkflowFileSchema.safeParse(raw);
	if (!result.success) {
		const reasons = result.error.issues
			.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
			.join("; ");
		throw new Error(`Invalid workflow schema: ${reasons}`);
	}
	return result.data;
}

/** Reserved model value: the child keeps the parent's provider and model. */
const INHERIT_MODEL = "inherit";

/**
 * Purpose: Parses concise model/subagent shorthand string [@preset/][llmProvider/]model[:thinking] or :thinking into SubagentConfig.
 * Contract:
 * - Inputs: Non-empty shorthand string.
 * - Outputs: SubagentConfig with parsed preset, llmProvider, model, and thinking fields.
 * - Throws: Error if format contains empty segments, runner prefixes, or invalid syntax.
 */
export function parseSubagentShorthand(shorthand: string): SubagentConfig {
	const trimmed = shorthand.trim();
	if (!trimmed) {
		throw new Error("Subagent shorthand cannot be empty");
	}

	if (trimmed.includes("+")) {
		throw new Error(
			"Invalid thinking delimiter '+'; use ':thinking' instead (e.g. ':high' or 'model:high')",
		);
	}

	if (
		trimmed === "fork" ||
		trimmed === "spawn" ||
		trimmed.startsWith("fork:") ||
		trimmed.startsWith("spawn:")
	) {
		throw new Error(
			"Runner/provider is not supported in model shorthand; configure runner on step definition",
		);
	}

	if (trimmed.includes("::")) {
		throw new Error("Subagent shorthand cannot contain consecutive colons");
	}

	if (trimmed.includes("//")) {
		throw new Error("Subagent shorthand cannot contain consecutive slashes");
	}

	const validateThinking = (thinking: string): void => {
		if (!thinking) {
			throw new Error("Subagent shorthand thinking after ':' cannot be empty");
		}
		if (
			thinking.includes(":") ||
			thinking.includes("/") ||
			thinking.includes("@")
		) {
			throw new Error(
				`Invalid thinking value '${thinking}': cannot contain ':', '/', or '@'`,
			);
		}
	};

	// Standalone thinking (:thinking)
	if (trimmed.startsWith(":")) {
		const thinking = trimmed.slice(1).trim();
		validateThinking(thinking);
		return { thinking };
	}

	let remaining = trimmed;
	let thinking: string | undefined;

	const colonIdx = remaining.lastIndexOf(":");
	if (colonIdx !== -1) {
		thinking = remaining.slice(colonIdx + 1).trim();
		validateThinking(thinking);
		remaining = remaining.slice(0, colonIdx).trim();
		if (remaining.includes(":")) {
			throw new Error("Subagent shorthand cannot contain multiple colons");
		}
	}

	let preset: string | undefined;
	if (remaining.startsWith("@")) {
		const firstSlashIdx = remaining.indexOf("/");
		if (firstSlashIdx === -1) {
			const presetName = remaining.slice(1).trim();
			if (!presetName) {
				throw new Error("Preset name after '@' cannot be empty");
			}
			throw new Error(
				`Preset '@${presetName}' requires an explicit model (e.g. '@${presetName}/model')`,
			);
		}
		preset = remaining.slice(1, firstSlashIdx).trim();
		if (!preset) {
			throw new Error("Preset name after '@' cannot be empty");
		}
		remaining = remaining.slice(firstSlashIdx + 1).trim();
		if (!remaining) {
			throw new Error(`Model name after preset '@${preset}/' cannot be empty`);
		}
	}

	let llmProvider: string | undefined;
	let model: string | undefined;

	if (remaining.includes("/")) {
		const slashIdx = remaining.indexOf("/");
		llmProvider = remaining.slice(0, slashIdx).trim();
		if (!llmProvider) {
			throw new Error(
				"Subagent shorthand LLM provider before '/' cannot be empty",
			);
		}
		const rest = remaining.slice(slashIdx + 1).trim();
		if (!rest) {
			throw new Error("Model name after provider cannot be empty");
		}
		if (rest.includes("/")) {
			throw new Error("Subagent shorthand model path has too many segments");
		}
		model = rest;
	} else {
		model = remaining;
	}

	if (!model) {
		throw new Error("Model name cannot be empty");
	}

	return {
		...(preset ? { preset } : {}),
		...(llmProvider ? { llmProvider } : {}),
		model,
		...(thinking ? { thinking } : {}),
	};
}

/**
 * Purpose: Normalizes a partial subagent configuration or shorthand result into a full SubagentConfig.
 * CONTRACT:
 * - Input: SubagentConfig | undefined
 * - Output: SubagentConfig with guaranteed provider (defaulting to "spawn"); the `inherit` model sentinel resolves to no model
 */
export function normalizeSubagentConfig(
	config: SubagentConfig | undefined,
): SubagentConfig {
	const model = config?.model === INHERIT_MODEL ? undefined : config?.model;
	return {
		provider: config?.provider ?? "spawn",
		...(config?.llmProvider ? { llmProvider: config.llmProvider } : {}),
		...(config?.preset ? { preset: config.preset } : {}),
		...(model ? { model } : {}),
		...(config?.thinking ? { thinking: config.thinking } : {}),
	};
}

/**
 * Purpose: Interpolates template variables in SubagentConfig fields.
 * CONTRACT:
 * - Inputs: SubagentConfig, optional args record, optional outputs map.
 * - Outputs: New SubagentConfig with string fields interpolated; an interpolated `inherit` model sentinel resolves to no model.
 */
export function interpolateSubagentConfig(
	config: SubagentConfig,
	args?: Record<string, string>,
	outputs?: Record<string, string | readonly string[]>,
): SubagentConfig {
	const resolvedArgs = args ?? {};
	const model = config.model
		? interpolateTemplate(config.model, resolvedArgs, outputs)
		: undefined;
	return {
		...(config.provider
			? {
					provider: interpolateTemplate(config.provider, resolvedArgs, outputs),
				}
			: {}),
		...(config.llmProvider
			? {
					llmProvider: interpolateTemplate(
						config.llmProvider,
						resolvedArgs,
						outputs,
					),
				}
			: {}),
		...(config.preset
			? {
					preset: interpolateTemplate(config.preset, resolvedArgs, outputs),
				}
			: {}),
		...(model && model !== INHERIT_MODEL ? { model } : {}),
		...(config.thinking
			? {
					thinking: interpolateTemplate(config.thinking, resolvedArgs, outputs),
				}
			: {}),
	};
}

function normalizeStepOutputs(
	outputs: StepOutputsMap | undefined,
): WorkflowStepOutputsMap | undefined {
	if (!outputs) return undefined;
	return Object.fromEntries(
		Object.entries(outputs).map(([name, def]) => [
			name,
			def.type === "file"
				? { type: "file", path: def.path, base: def.base ?? "scratch" }
				: def,
		]),
	);
}

/**
 * Purpose: Determines whether a ChoiceMapping is flat (direct choice-to-value) or nested (derived variable-to-choices).
 * CONTRACT:
 * - Inputs: ChoiceMapping object.
 * - Outputs: boolean true if flat, false if nested.
 */
export function isFlatChoiceMapping(
	mapping: ChoiceMapping,
): mapping is Record<string, string> {
	// edge case: external YAML choice mapping is untagged; distinguished at boundary by inspecting value type
	const values = Object.values(mapping);
	if (values.length === 0) return false;
	return typeof values[0] === "string";
}

/**
 * Purpose: Preprocesses a validated WorkflowFile into an internal runtime WorkflowDocument.
 * CONTRACT:
 * - Input: validated WorkflowFile.
 * - Output: preprocessed WorkflowDocument where every step has a guaranteed name.
 * - Invariant: Assigns "Step N" (1-indexed) to any step without an explicit name.
 */
export function preprocessWorkflow(file: WorkflowFile): WorkflowDocument {
	const normalizedArgs: Record<string, WorkflowArg> = Object.fromEntries(
		Object.entries(file.args ?? {}).map(([key, def]) => {
			const normalizedDefault =
				def.default !== undefined
					? def.type === "bool"
						? String(parseBoolean(def.default))
						: String(def.default)
					: undefined;
			if (def.type === "choice") {
				const { mappings, ...rest } = def;
				const normalizedMapping = def.mapping ?? mappings;
				return [
					key,
					// type-safe: rest retains choice variant properties and normalizedMapping preserves ChoiceMapping union
					{
						...rest,
						...(normalizedMapping !== undefined
							? { mapping: normalizedMapping }
							: {}),
						default: normalizedDefault,
						required: def.required ?? def.default === undefined,
					} as WorkflowArg,
				];
			}
			return [
				key,
				// type-safe: object spread on validated def preserves discriminated union invariant
				{
					...def,
					default: normalizedDefault,
					required: def.required ?? def.default === undefined,
				} as WorkflowArg,
			];
		}),
	);

	const steps: WorkflowStep[] = file.steps.map((raw, index) => {
		const defaultName = `Step ${index + 1}`;
		if (typeof raw === "string") {
			return {
				kind: "prompt",
				name: defaultName,
				prompt: raw,
			};
		}

		const record = raw as Record<string, unknown>;
		const name =
			typeof record.name === "string" && record.name.trim().length > 0
				? record.name
				: defaultName;

		const ifCond =
			typeof record.if === "string" && record.if.trim().length > 0
				? record.if.trim()
				: undefined;

		const rawOutputs = record.outputs as StepOutputsMap | undefined;
		const rawOutput =
			typeof record.output === "string" && record.output.trim().length > 0
				? record.output.trim()
				: undefined;
		const rawForeach =
			typeof record.foreach === "string" && record.foreach.trim().length > 0
				? record.foreach.trim()
				: undefined;

		if (rawOutput !== undefined && rawOutputs !== undefined) {
			throw new Error(
				`Step ${index + 1} cannot declare both 'output' and 'outputs'`,
			);
		}

		const isSubagent =
			record.kind === "subagent" ||
			(record.subagent !== undefined && record.subagent !== false);

		if (rawOutput !== undefined && !isSubagent) {
			throw new Error(
				`Step ${index + 1} cannot declare 'output' without 'subagent: true'. 'output' is only supported on subagent steps.`,
			);
		}

		const outputs = normalizeStepOutputs(rawOutputs);

		const step: WorkflowStep = (() => {
			if (record.kind === "print" || typeof record.print === "string") {
				// type-safe: schema guarantees print step has either string text or string print property
				const printText = (
					typeof record.text === "string" ? record.text : record.print
				) as string;
				return {
					kind: "print",
					name,
					text: printText,
				};
			}

			const extractStepGate = (raw: unknown): string | boolean | undefined => {
				if (typeof raw !== "string" && typeof raw !== "boolean") {
					return undefined;
				}
				return parseBoolean(raw) === false ? undefined : raw;
			};

			if (record.kind === "subagent" && typeof record.prompt === "string") {
				const gate = extractStepGate(record.gate);
				return {
					kind: "subagent",
					name,
					prompt: record.prompt,
					// type-safe: schema guarantees preprocessed subagent step has valid SubagentConfig
					config: record.config as SubagentConfig,
					...(rawForeach ? { foreach: rawForeach } : {}),
					...(gate !== undefined ? { gate } : {}),
					...(outputs ? { outputs } : {}),
					...(rawOutput ? { output: rawOutput } : {}),
				};
			}

			if (typeof record.prompt === "string") {
				const prompt = record.prompt;
				const gate = extractStepGate(record.gate);

				if (record.subagent !== undefined && record.subagent !== false) {
					const rawSubagent =
						typeof record.subagent === "string" &&
						record.subagent.includes("{{")
							? record.subagent
							: undefined;
					const parsedConfig =
						typeof record.subagent === "string"
							? parseSubagentShorthand(record.subagent)
							: typeof record.subagent === "object" && record.subagent !== null
								? // type-safe: schema validation guarantees valid SubagentConfig object
									(record.subagent as SubagentConfig)
								: undefined;
					const subagentConfig = normalizeSubagentConfig(parsedConfig);
					return {
						kind: "subagent",
						name,
						prompt,
						config: subagentConfig,
						...(rawSubagent ? { rawSubagent } : {}),
						...(rawForeach ? { foreach: rawForeach } : {}),
						...(gate !== undefined ? { gate } : {}),
						...(outputs ? { outputs } : {}),
						...(rawOutput ? { output: rawOutput } : {}),
					};
				}

				return {
					kind: "prompt",
					name,
					prompt,
					...(gate !== undefined ? { gate } : {}),
					...(outputs ? { outputs } : {}),
				};
			}

			if (typeof record.gate === "string" || typeof record.gate === "boolean") {
				const gatePrompt = typeof record.gate === "string" ? record.gate : name;
				const gate = extractStepGate(record.gate);
				return {
					kind: "prompt",
					name,
					prompt: gatePrompt,
					isSoloGate: true,
					...(gate !== undefined ? { gate } : {}),
					...(outputs ? { outputs } : {}),
				};
			}

			throw new Error(`Invalid step definition at step ${index + 1}`);
		})();

		return ifCond !== undefined ? { ...step, if: ifCond } : step;
	});

	return {
		...(file.name !== undefined ? { name: file.name } : {}),
		...(file.title !== undefined ? { title: file.title } : {}),
		...(file.description !== undefined
			? { description: file.description }
			: {}),
		args: normalizedArgs,
		steps,
	};
}

/**
 * Parses raw YAML text into a validated and preprocessed WorkflowDocument.
 * CONTRACT:
 * - Input: raw YAML string content.
 * - Output: fully validated and normalized WorkflowDocument.
 * - Throws: Error when YAML parsing fails or document violates WorkflowFileSchema.
 */
export function parseWorkflowDocument(content: string): WorkflowDocument {
	const file = parseWorkflowFile(content);
	return preprocessWorkflow(file);
}

/**
 * Purpose: Parses a saved list output and enforces its declared bounds.
 * Contract:
 * - Inputs: Output name, serialized JSON value, and validated list definition.
 * - Outputs: String array on success or a diagnostic for invalid JSON, items, or bounds.
 * - Throws: Unexpected parsing errors propagate.
 */
export function parseListOutput(
	name: string,
	value: string,
	definition: Extract<StepOutputDef, { type: "list" }>,
):
	| { readonly kind: "success"; readonly value: readonly string[] }
	| { readonly kind: "error"; readonly message: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (err: unknown) {
		if (!(err instanceof SyntaxError)) throw err;
		return {
			kind: "error",
			message: `Output '${name}' is declared as type 'list', but could not parse value as JSON array.`,
		};
	}
	if (!Array.isArray(parsed)) {
		return {
			kind: "error",
			message: `Output '${name}' is declared as type 'list', but received non-array value. Expected JSON array string.`,
		};
	}
	if (!parsed.every((item: unknown) => typeof item === "string")) {
		return {
			kind: "error",
			message: `Output '${name}' is declared as type 'list', but contains non-string elements. Expected JSON array of strings.`,
		};
	}
	if (definition.min !== undefined && parsed.length < definition.min) {
		return {
			kind: "error",
			message: `Output '${name}' requires at least ${definition.min} items, but received ${parsed.length}.`,
		};
	}
	if (definition.max !== undefined && parsed.length > definition.max) {
		return {
			kind: "error",
			message: `Output '${name}' allows at most ${definition.max} items, but received ${parsed.length}.`,
		};
	}
	return { kind: "success", value: parsed };
}

/**
 * Strips surrounding single or double quotes from a string.
 */
function unquote(text: string): string {
	return text.replace(/^(['"])(.*)\1$/, "$2");
}

/**
 * Parses a CLI command invocation string into a target path, key-value args, and implicit instructions.
 * CONTRACT:
 * - Input: rawInput string (e.g., "build.yaml target=prod optimize=true please run tests").
 * - Output: ParsedInvocation with targetPath, explicitArgs map, and implicitInstructions string.
 * - Invariant: Leading '@' mentions are stripped; whitespace-only inputs return empty fields.
 */
export function parseInvocationInput(rawInput: string): ParsedInvocation {
	// edge case: slash command chat mentions may prefix input with '@'
	const trimmed = rawInput.trim().replace(/^@/, "");
	if (!trimmed) {
		return { targetPath: "", explicitArgs: {}, implicitInstructions: "" };
	}

	const tokenRegex =
		/([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s]+))|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+/g;

	const matches = trimmed.match(tokenRegex) as RegExpMatchArray;

	let targetPath = "";
	const explicitArgs: Record<string, string> = {};
	const implicitTokens: string[] = [];
	let pathConsumed = false;

	for (const token of matches) {
		const kvMatch = token.match(/^([a-zA-Z0-9_-]+)=(.*)$/);
		if (kvMatch) {
			const key = kvMatch[1];
			explicitArgs[key] = unquote(kvMatch[2]);
		} else if (!pathConsumed) {
			targetPath = unquote(token);
			pathConsumed = true;
		} else {
			implicitTokens.push(unquote(token));
		}
	}

	return {
		targetPath,
		explicitArgs,
		implicitInstructions: implicitTokens.join(" "),
	};
}

/**
 * Resolves workflow arguments against declarations, verifying required fields, choices, and defaults.
 * CONTRACT:
 * - Input: declarations map, explicit key-value arguments, and unflagged implicit instructions.
 * - Output: complete map of resolved argument values.
 * - Throws: Error if undeclared arguments are passed, required arguments are missing, or choices are violated.
 */
export function resolveWorkflowArgs({
	declarations = {},
	explicitArgs,
	implicitInstructions,
}: {
	declarations?: Record<string, WorkflowArg>;
	explicitArgs: Record<string, string>;
	implicitInstructions: string;
}): Record<string, string> {
	const rawValues: Record<string, string> = { ...explicitArgs };

	if (implicitInstructions.length > 0) {
		if (!Object.hasOwn(declarations, "instructions")) {
			throw new Error(
				"Unexpected implicit instructions: workflow does not declare an 'instructions' argument in 'args'",
			);
		}
		if (rawValues.instructions !== undefined) {
			throw new Error(
				"Cannot specify both explicit 'instructions' argument and implicit trailing instructions",
			);
		}
		rawValues.instructions = implicitInstructions;
	}

	for (const [argName, def] of Object.entries(declarations)) {
		if (def.type === "choice") {
			const mapping = def.mapping ?? def.mappings;
			if (mapping && !isFlatChoiceMapping(mapping)) {
				for (const derivedKey of Object.keys(mapping)) {
					if (Object.hasOwn(explicitArgs, derivedKey)) {
						throw new Error(
							`Cannot pass explicit argument '${derivedKey}': '${derivedKey}' is derived from choice argument '${argName}'`,
						);
					}
				}
			}
		}
	}

	for (const key of Object.keys(explicitArgs)) {
		if (!Object.hasOwn(declarations, key)) {
			const declaredKeys = Object.keys(declarations).join(", ");
			throw new Error(
				`Unknown argument '${key}'. Declared arguments: ${declaredKeys}`,
			);
		}
	}

	const resolved: Record<string, string> = {};

	for (const [name, def] of Object.entries(declarations)) {
		const rawVal =
			rawValues[name] ??
			(def.default !== undefined ? String(def.default) : undefined);
		if (rawVal === undefined) {
			if (def.required !== false) {
				throw new Error(`Missing required argument '${name}'`);
			}
			continue;
		}

		if (def.type === "choice") {
			if (!def.choices.includes(rawVal)) {
				throw new Error(
					`Invalid value '${rawVal}' for argument '${name}'. Allowed choices: ${def.choices.join(", ")}`,
				);
			}
			resolved[name] = rawVal;
		} else if (def.type === "bool") {
			const boolVal = parseBoolean(rawVal);
			if (boolVal === undefined) {
				throw new Error(
					`Invalid value '${rawVal}' for bool argument '${name}'. Allowed values: true, false`,
				);
			}
			resolved[name] = String(boolVal);
		} else {
			resolved[name] = rawVal;
		}
	}

	for (const [argName, def] of Object.entries(declarations)) {
		if (def.type === "choice") {
			const mapping = def.mapping ?? def.mappings;
			if (mapping) {
				const choiceVal = resolved[argName];
				if (choiceVal !== undefined) {
					if (isFlatChoiceMapping(mapping)) {
						if (!Object.hasOwn(mapping, choiceVal)) {
							throw new Error(
								`Choice '${choiceVal}' for argument '${argName}' is not defined in mapping.`,
							);
						}
						resolved[argName] = mapping[choiceVal];
					} else {
						for (const [derivedKey, map] of Object.entries(mapping)) {
							if (!Object.hasOwn(map, choiceVal)) {
								throw new Error(
									`Choice '${choiceVal}' for derived argument '${derivedKey}' in '${argName}' mapping is not defined.`,
								);
							}
							resolved[derivedKey] = map[choiceVal];
						}
					}
				}
			}
		}
	}

	return resolved;
}

/**
 * Purpose: Evaluates a step condition string against resolved arguments and outputs.
 * CONTRACT:
 * - Inputs: condition template string, resolved args dictionary, and optional outputs dictionary.
 * - Outputs: boolean indicating whether the step condition is satisfied.
 * - Supported patterns:
 *   - Equality / inequality comparison: `<left> == <right>` or `<left> != <right>`
 *   - Negated boolean: `!<expr>`
 *   - Direct boolean: `<expr>` (truthy strictly if "true")
 */
export function evaluateStepCondition(
	condition: string,
	args: Record<string, string>,
	outputs?: Record<string, string | readonly string[]>,
): boolean {
	const trimmed = condition.trim();
	if (trimmed.length === 0) return false;

	const cmpMatch = trimmed.match(/^(.*?)\s*(==|!=)\s*(.*?)$/);
	if (cmpMatch) {
		const left = unquote(
			interpolateTemplate(cmpMatch[1].trim(), args, outputs).trim(),
		);
		const op = cmpMatch[2];
		const right = unquote(
			interpolateTemplate(cmpMatch[3].trim(), args, outputs).trim(),
		);
		return op === "==" ? left === right : left !== right;
	}

	if (trimmed.startsWith("!")) {
		const val = unquote(
			interpolateTemplate(trimmed.slice(1).trim(), args, outputs).trim(),
		);
		return parseBoolean(val) !== true;
	}

	const val = unquote(interpolateTemplate(trimmed, args, outputs).trim());
	return parseBoolean(val) === true;
}

/**
 * Purpose: Formats the complete markdown/XML prompt for an individual workflow step.
 * CONTRACT:
 * - Input: FormatStepPromptOptions with step index, totals, prompt body, and flags.
 * - Output: structured string with <workflow-info>, <step-instructions>, and <rules> blocks.
 */
export function formatStepPrompt(options: FormatStepPromptOptions): string {
	const header = `[STEP ${options.stepIndex + 1} OF ${options.totalSteps}: ${options.stepName}]`;

	const workflowInfoLines = ["<workflow-info>"];
	if (options.workflowName) {
		workflowInfoLines.push(`Workflow: "${options.workflowName}"`);
	}
	workflowInfoLines.push(
		`Step: ${options.stepIndex + 1} of ${options.totalSteps}`,
	);
	workflowInfoLines.push("</workflow-info>");
	const workflowInfo = workflowInfoLines.join("\n");

	const sections = [header, workflowInfo];

	if (options.isResumedStep) {
		sections.push(
			[
				"<workflow-resume>",
				`Workflow execution was resumed from an interrupted state at step ${options.stepIndex + 1} of ${options.totalSteps}.`,
				"Prior steps have completed, and instructions in this step may already be partially or fully done.",
				"Inspect current workspace and environment state before acting. Do not duplicate already completed operations.",
				"</workflow-resume>",
			].join("\n"),
		);
	}

	if (options.instructions) {
		sections.push(
			`<user-instructions>\n${options.instructions}\n</user-instructions>`,
		);
	}

	if (options.outputRequirements && options.outputRequirements.length > 0) {
		const reqLines = [
			"<output-requirements>",
			"This step requires the following outputs to be produced:",
		];
		for (const req of options.outputRequirements) {
			if (req.type === "file") {
				reqLines.push(
					`- File output '${req.name}': write to '${req.resolvedPath}'. Must exist and be non-empty.`,
				);
			} else if (req.type === "list") {
				const desc = req.description ? ` (${req.description})` : "";
				const bounds: string[] = [];
				if (req.min !== undefined) bounds.push(`min items: ${req.min}`);
				if (req.max !== undefined) bounds.push(`max items: ${req.max}`);
				const boundsStr = bounds.length > 0 ? ` [${bounds.join(", ")}]` : "";
				reqLines.push(
					`- List output '${req.name}'${desc}${boundsStr}: call tool 'save_output' with name="${req.name}" and value as a JSON array string.`,
				);
			} else {
				const desc = req.description ? ` (${req.description})` : "";
				reqLines.push(
					`- String output '${req.name}'${desc}: call tool 'save_output' with name="${req.name}" and value=<your_value>.`,
				);
			}
		}
		reqLines.push("</output-requirements>");
		sections.push(reqLines.join("\n"));
	}

	sections.push(`<step-instructions>\n${options.prompt}\n</step-instructions>`);

	const ruleLines = [
		"<rules>",
		"- Perform ONLY the instructions in <step-instructions>.",
		"- Conclude when complete.",
		"- Do NOT anticipate or execute any future steps.",
	];
	if (options.instructions) {
		ruleLines.push(
			"- Incorporate and follow the additional instructions in <user-instructions> while performing this step.",
		);
	}
	if (options.outputRequirements && options.outputRequirements.length > 0) {
		ruleLines.push(
			"- Ensure all required outputs in <output-requirements> are produced before concluding.",
			"- Do not present written outputs to the user as they are technical. Conclude with a brief acknowledgement message.",
		);
	}
	if (options.isResumedStep) {
		ruleLines.push(
			"- Verify existing workspace state before executing to avoid repeating completed work.",
		);
	}
	ruleLines.push("</rules>");
	sections.push(ruleLines.join("\n"));

	return sections.join("\n\n");
}

export interface OutputRetryMissingItem {
	readonly name: string;
	readonly type: "file" | "string" | "list";
	readonly resolvedPath?: string;
}

/**
 * Purpose: Formats an automated retry prompt when step output verification fails.
 */
export function formatOutputRetryPrompt({
	stepIndex,
	totalSteps,
	stepName,
	missingOutputs,
	attempt,
}: {
	stepIndex: number;
	totalSteps: number;
	stepName: string;
	missingOutputs: readonly OutputRetryMissingItem[];
	attempt: number;
}): string {
	const header = `[STEP ${stepIndex + 1} OF ${totalSteps} OUTPUT VERIFICATION FAILED (Attempt ${attempt} of 3)]`;
	const lines = [
		header,
		"<output-verification-failure>",
		`Step '${stepName}' output verification failed. Missing outputs:`,
	];
	for (const missing of missingOutputs) {
		if (missing.type === "file") {
			lines.push(
				`- File output '${missing.name}': expected non-empty file at '${missing.resolvedPath}'. Please create or write to this file.`,
			);
		} else if (missing.type === "list") {
			lines.push(
				`- List output '${missing.name}': tool 'save_output' was not called with name="${missing.name}" and a valid JSON array. Please call tool 'save_output'.`,
			);
		} else {
			lines.push(
				`- String output '${missing.name}': tool 'save_output' was not called with name="${missing.name}". Please call tool 'save_output'.`,
			);
		}
	}
	lines.push("</output-verification-failure>");
	return lines.join("\n");
}

/**
 * Purpose: Parses workflow YAML text and extracts a summary of metadata and parameters if valid.
 * Contract:
 * - Inputs: target path/identifier string and raw YAML string content.
 * - Outputs: WorkflowSummary object if parsing and validation succeed; null otherwise.
 * - Throws: None (errors caught and safely returned as null).
 */
export function parseWorkflowSummary(
	target: string,
	content: string,
): WorkflowSummary | null {
	try {
		const raw = parse(content);
		const result = WorkflowFileSchema.safeParse(raw);
		if (!result.success) return null;
		const file = result.data;
		const params: WorkflowParamSummary[] = Object.entries(file.args ?? {}).map(
			([name, arg]) => ({
				name,
				description: arg.description,
				type: arg.type,
				required: arg.required ?? arg.default === undefined,
				default: arg.default !== undefined ? String(arg.default) : undefined,
				choices: arg.type === "choice" ? arg.choices : undefined,
			}),
		);
		return {
			target,
			name: file.name,
			description: file.description,
			params,
		};
	} catch {
		return null;
	}
}

/**
 * Purpose: Formats a parameter's metadata and description as a Markdown bullet line item.
 * Contract:
 * - Inputs: parameter name and metadata object with type, choices, default, required, and description.
 * - Outputs: Formatted string (e.g. "  - `env` (choice, choices: staging, production, default: \"staging\"): Target tier").
 */
export function formatWorkflowParamDescriptor(
	name: string,
	param: {
		readonly type: string;
		readonly choices?: readonly string[];
		readonly default?: string | boolean;
		readonly required?: boolean;
		readonly description?: string;
	},
): string {
	const meta: string[] = [param.type];
	if (param.choices && param.choices.length > 0) {
		meta.push(`choices: ${param.choices.join(", ")}`);
	}
	if (param.default !== undefined) {
		meta.push(`default: "${param.default}"`);
	}
	if (param.required) {
		meta.push("required");
	}
	const metaStr = ` (${meta.join(", ")})`;
	const desc = param.description ? `: ${param.description}` : "";
	return `  - \`${name}\`${metaStr}${desc}`;
}

/**
 * Purpose: Formats categorized workflow summaries into user-readable Markdown.
 * Contract:
 * - Inputs: Array of WorkflowGroup containing group title and WorkflowSummary items.
 * - Outputs: Formatted Markdown text.
 * - Throws: None.
 */
export function formatWorkflowList(groups: readonly WorkflowGroup[]): string {
	const sections: string[] = [];

	for (const group of groups) {
		const lines: string[] = [`### ${group.title}`];
		if (group.workflows.length === 0) {
			lines.push("*(No workflows found)*");
		} else {
			for (const wf of group.workflows) {
				const titlePart = wf.name
					? `**${wf.name}** (\`${wf.target}\`)`
					: `\`${wf.target}\``;
				const descPart = wf.description ? `: ${wf.description}` : "";
				lines.push(`- ${titlePart}${descPart}`);
				if (wf.params.length > 0) {
					for (const param of wf.params) {
						lines.push(formatWorkflowParamDescriptor(param.name, param));
					}
				}
			}
		}
		sections.push(lines.join("\n"));
	}

	return sections.join("\n\n");
}

/**
 * Purpose: Formats a diagnostic summary for a validated workflow document and optional resolved arguments.
 * Contract:
 * - Inputs: targetPath string, doc WorkflowDocument, optional resolvedArgs dictionary.
 * - Outputs: Markdown string detailing workflow status, steps, declared arguments, and resolved arguments.
 * - Throws: None.
 */
export function formatValidationSummary(
	targetPath: string,
	doc: WorkflowDocument,
	resolvedArgs?: Record<string, string>,
): string {
	const lines: string[] = [
		`### Workflow Validation: \`${targetPath}\``,
		"- **Status:** Valid",
	];
	if (doc.name) {
		lines.push(`- **Name:** ${doc.name}`);
	}
	if (doc.title) {
		lines.push(`- **Title:** ${doc.title}`);
	}
	if (doc.description) {
		lines.push(`- **Description:** ${doc.description}`);
	}

	lines.push(`- **Steps:** ${doc.steps.length}`);
	for (let i = 0; i < doc.steps.length; i++) {
		const step = doc.steps[i];
		const isGateDeclared =
			(step.kind === "prompt" || step.kind === "subagent") &&
			step.gate !== undefined &&
			(typeof step.gate === "boolean"
				? step.gate
				: step.gate.trim() !== "" && parseBoolean(step.gate) !== false);
		const gateStr = isGateDeclared ? " [gate]" : "";
		lines.push(`  ${i + 1}. [${step.kind}] ${step.name}${gateStr}`);
		if (step.kind === "subagent" && step.output) {
			lines.push(`     - Output: \`${step.output}\``);
		}
		if ((step.kind === "prompt" || step.kind === "subagent") && step.outputs) {
			for (const [outName, outDef] of Object.entries(step.outputs)) {
				const extra =
					outDef.type === "file"
						? `: ${outDef.path}`
						: outDef.description
							? `: ${outDef.description}`
							: "";
				lines.push(`     - Output: \`${outName}\` (${outDef.type})${extra}`);
			}
		}
	}

	const declaredArgs = Object.entries(doc.args);
	if (declaredArgs.length > 0) {
		lines.push("- **Declared Arguments:**");
		for (const [name, def] of declaredArgs) {
			lines.push(formatWorkflowParamDescriptor(name, def));
		}
	}

	if (resolvedArgs !== undefined) {
		lines.push("- **Resolved Arguments:**");
		for (const [key, val] of Object.entries(resolvedArgs)) {
			lines.push(`  - \`${key}\`: "${val}"`);
		}
	}

	return lines.join("\n");
}

/**
 * Purpose: Constructs an ObjectJsonSchema enforcing structured JSON output for a subagent step.
 * Contract:
 * - Inputs: outputs map and resolvedOutputPaths dictionary mapping file output names to absolute paths.
 * - Outputs: ObjectJsonSchema with string properties and required keys matching all declared outputs.
 * - Invariant: File outputs become synthetic string parameters requiring the absolute file path.
 */
export function buildSubagentOutputSchema(
	outputs: WorkflowStepOutputsMap,
	resolvedOutputPaths: Record<string, string>,
): ObjectJsonSchema {
	const properties: Record<string, JsonSchemaNode> = {};
	const required: string[] = [];

	for (const [name, def] of Object.entries(outputs)) {
		required.push(name);
		if (def.type === "string") {
			properties[name] = {
				type: "string",
				description: def.description ?? `Output string value for '${name}'`,
			};
		} else {
			const resolvedPath = resolvedOutputPaths[name];
			properties[name] = {
				type: "string",
				description: `Absolute filesystem path of the written file for '${name}'. Must be written to: ${resolvedPath}`,
			};
		}
	}

	return {
		type: "object",
		properties,
		required,
		additionalProperties: false,
	};
}

/**
 * Purpose: Formats instructions for a subagent step, including structured output requirements when declared.
 * Contract:
 * - Inputs: interpolated prompt string and optional output requirements array.
 * - Outputs: formatted prompt text. Returns raw prompt if no output requirements.
 */
export function formatSubagentPrompt({
	prompt,
	outputRequirements,
}: {
	readonly prompt: string;
	readonly outputRequirements?: readonly FormatStepPromptOutputRequirement[];
}): string {
	if (!outputRequirements || outputRequirements.length === 0) {
		return prompt;
	}
	const reqLines = [
		"<output-requirements>",
		"This step requires structured outputs adhering to the requested JSON schema:",
	];
	for (const req of outputRequirements) {
		if (req.type === "file") {
			reqLines.push(
				`- File output '${req.name}': write the complete file content to '${req.resolvedPath}'. In the returned JSON object, set property '${req.name}' to the exact absolute file path '${req.resolvedPath}'.`,
			);
		} else {
			const desc = req.description ? ` (${req.description})` : "";
			reqLines.push(
				`- String output '${req.name}'${desc}: in the returned JSON object, set property '${req.name}' to the output string value.`,
			);
		}
	}
	reqLines.push("</output-requirements>");

	return `${prompt}\n\n${reqLines.join("\n")}`;
}
