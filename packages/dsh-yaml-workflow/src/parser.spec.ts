/**
 * PURPOSE: Pure unit tests for parsing, CLI arguments, and prompt formatting utilities.
 * ALLOWED: In-memory tests, assertion checks, zero disk I/O, zero network/timers.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	buildSubagentOutputSchema,
	evaluateStepCondition,
	formatStepPrompt,
	formatSubagentPrompt,
	formatValidationSummary,
	formatWorkflowList,
	interpolateSubagentConfig,
	interpolateTemplate,
	normalizeSubagentConfig,
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
import { validateWorkflow } from "./rules.ts";
import type {
	WorkflowArg,
	WorkflowDocument,
	WorkflowFileStep,
} from "./types.ts";

describe("Parser & Utilities (Pure)", () => {
	it("parses valid workflow document and steps", () => {
		const doc = parseWorkflowDocument(`
name: "Test Flow"
description: "A test workflow"
args:
  target:
    type: string
    default: "all"
steps:
  - "Step one prompt"
  - print: "Done"
`);
		assert.equal(doc.name, "Test Flow");
		assert.equal(doc.steps.length, 2);
		assert.equal(doc.steps[0].kind, "prompt");
		assert.equal(doc.steps[1].kind, "print");

		const steps = parseWorkflowDocument(`
steps:
  - "Quick step"
`).steps;
		assert.equal(steps.length, 1);
		assert.equal(steps[0].kind, "prompt");
	});

	it("parses valid workflow document with title and parameters", () => {
		const doc = parseWorkflowDocument(`
name: "deploy-flow"
title: "Deploy {{args.env}} v{{args.version}}"
args:
  env:
    type: string
  version:
    type: string
steps:
  - "Deploy step"
`);
		assert.equal(doc.name, "deploy-flow");
		assert.equal(doc.title, "Deploy {{args.env}} v{{args.version}}");
		assert.equal(doc.steps.length, 1);
	});

	it("throws on invalid schema in parseWorkflowDocument", () => {
		assert.throws(
			() => parseWorkflowDocument("invalid: true"),
			/Invalid workflow schema/,
		);
	});

	it("parses CLI invocation input with paths, kv args, and unflagged instructions", () => {
		const parsed = parseInvocationInput(
			'@workflow.yaml env="production" count=5 please run carefully',
		);
		assert.equal(parsed.targetPath, "workflow.yaml");
		assert.deepEqual(parsed.explicitArgs, {
			env: "production",
			count: "5",
		});
		assert.equal(parsed.implicitInstructions, "please run carefully");

		const empty = parseInvocationInput("   ");
		assert.equal(empty.targetPath, "");
		assert.deepEqual(empty.explicitArgs, {});
		assert.equal(empty.implicitInstructions, "");
	});

	it("resolves workflow arguments with defaults and choices", () => {
		const declarations = {
			env: {
				type: "choice" as const,
				choices: ["staging", "production"],
				default: "staging",
			},
			tag: {
				type: "string" as const,
				required: false,
			},
			instructions: {
				type: "string" as const,
				required: false,
			},
		};

		const resolved = resolveWorkflowArgs({
			declarations,
			explicitArgs: { env: "production" },
			implicitInstructions: "extra instructions",
		});
		assert.equal(resolved.env, "production");
		assert.equal(resolved.instructions, "extra instructions");

		assert.throws(
			() =>
				resolveWorkflowArgs({
					declarations,
					explicitArgs: { env: "invalid" },
					implicitInstructions: "",
				}),
			/Invalid value 'invalid' for argument 'env'/,
		);

		assert.throws(
			() =>
				resolveWorkflowArgs({
					declarations,
					explicitArgs: { instructions: "explicit" },
					implicitInstructions: "trailing implicit",
				}),
			/Cannot specify both explicit 'instructions' argument and implicit trailing instructions/,
		);

		assert.throws(
			() =>
				resolveWorkflowArgs({
					declarations,
					explicitArgs: { unknownArg: "value" },
					implicitInstructions: "",
				}),
			/Unknown argument 'unknownArg'/,
		);
	});

	it("interpolates template variables", () => {
		const interpolated = interpolateTemplate(
			"Hello {{args.user}}, welcome to {{args.env}}!",
			{ user: "Alice", env: "production" },
		);
		assert.equal(interpolated, "Hello Alice, welcome to production!");

		assert.throws(
			() => interpolateTemplate("Hello {{args.missing}}", {}),
			/Unresolved workflow argument: \{\{args\.missing\}\}/,
		);
	});

	it("validates template variables across workflow document", () => {
		const doc = parseWorkflowDocument(`
name: "Deploy {{args.env}}"
steps:
  - prompt: "Deploy to {{args.env}}"
`);
		assert.equal(validateWorkflow({ doc, args: { env: "prod" } }).length, 0);
		const errors = validateWorkflow({ doc, args: {} });
		assert.ok(errors.some((e) => e.message.includes("{{args.env}}")));
	});

	it("formats step prompts with all sections", () => {
		const prompt = formatStepPrompt({
			stepIndex: 0,
			totalSteps: 2,
			stepName: "Setup",
			workflowName: "Deploy Pipeline",
			prompt: "Run migrations",
			isResumedStep: true,
			instructions: "Use verbose mode",
		});

		assert(prompt.includes("[STEP 1 OF 2: Setup]"));
		assert(prompt.includes('Workflow: "Deploy Pipeline"'));
		assert(prompt.includes("<workflow-resume>"));
		assert(prompt.includes("<user-instructions>\nUse verbose mode"));
		assert(
			prompt.includes(
				"<step-instructions>\nRun migrations\n</step-instructions>",
			),
		);
		assert(!prompt.includes("[GATE CRITERIA]"));
		assert(!prompt.includes("/wf-resume"));
	});

	it("parses and validates output: abc syntax on steps", () => {
		const doc = parseWorkflowDocument(`
steps:
  - name: "Review"
    prompt: "Run review"
    subagent: true
    output: abc
  - name: "Apply"
    prompt: "Findings: {{outputs.abc}}"
`);

		const firstStep = doc.steps[0];
		assert.equal(firstStep.kind, "subagent");
		assert.equal(firstStep.output, "abc");
		assert.equal(validateWorkflow({ doc }).length, 0);
	});

	it("throws error if both output and outputs are declared on the same step", () => {
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - name: "Invalid"
    prompt: "Invalid step"
    subagent: true
    output: abc
    outputs:
      def:
        type: string
`),
			/cannot declare both 'output' and 'outputs'/,
		);
	});

	describe("parseSubagentShorthand", () => {
		it("parses valid shorthand permutations", () => {
			assert.deepEqual(parseSubagentShorthand("deepseek-reasoner"), {
				model: "deepseek-reasoner",
			});
			assert.deepEqual(parseSubagentShorthand("deepseek-reasoner:high"), {
				model: "deepseek-reasoner",
				thinking: "high",
			});
			assert.deepEqual(parseSubagentShorthand(":high"), {
				thinking: "high",
			});
			assert.deepEqual(parseSubagentShorthand("@reviewer/deepseek-reasoner"), {
				preset: "reviewer",
				model: "deepseek-reasoner",
			});
			assert.deepEqual(
				parseSubagentShorthand("@reviewer/deepseek-reasoner:high"),
				{
					preset: "reviewer",
					model: "deepseek-reasoner",
					thinking: "high",
				},
			);
			assert.deepEqual(parseSubagentShorthand("acp-codex-acp/gpt-6.1-sol"), {
				llmProvider: "acp-codex-acp",
				model: "gpt-6.1-sol",
			});
			assert.deepEqual(
				parseSubagentShorthand("acp-codex-acp/gpt-6.1-sol:medium"),
				{
					llmProvider: "acp-codex-acp",
					model: "gpt-6.1-sol",
					thinking: "medium",
				},
			);
			assert.deepEqual(
				parseSubagentShorthand("@reviewer/acp-codex-acp/gpt-6.1-sol"),
				{
					preset: "reviewer",
					llmProvider: "acp-codex-acp",
					model: "gpt-6.1-sol",
				},
			);
			assert.deepEqual(
				parseSubagentShorthand("@reviewer/acp-codex-acp/gpt-6.1-sol:medium"),
				{
					preset: "reviewer",
					llmProvider: "acp-codex-acp",
					model: "gpt-6.1-sol",
					thinking: "medium",
				},
			);
			assert.deepEqual(parseSubagentShorthand("@reviewer/fast"), {
				preset: "reviewer",
				model: "fast",
			});
		});

		it("throws on invalid shorthand syntax", () => {
			assert.throws(() => parseSubagentShorthand(""), /cannot be empty/);
			assert.throws(() => parseSubagentShorthand("   "), /cannot be empty/);
			assert.throws(
				() => parseSubagentShorthand("@reviewer"),
				/requires an explicit model/,
			);
			assert.throws(
				() => parseSubagentShorthand("@reviewer:high"),
				/requires an explicit model/,
			);
			assert.throws(
				() => parseSubagentShorthand("@"),
				/Preset name after '@' cannot be empty/,
			);
			assert.throws(
				() => parseSubagentShorthand("@/model"),
				/Preset name after '@' cannot be empty/,
			);
			assert.throws(
				() => parseSubagentShorthand("@reviewer/"),
				/Model name after preset '@reviewer\/' cannot be empty/,
			);
			assert.throws(
				() => parseSubagentShorthand("provider/"),
				/Model name after provider cannot be empty/,
			);
			assert.throws(
				() => parseSubagentShorthand(":"),
				/thinking after ':' cannot be empty/,
			);
			assert.throws(
				() => parseSubagentShorthand("model:"),
				/thinking after ':' cannot be empty/,
			);
			assert.throws(
				() => parseSubagentShorthand("fork"),
				/Runner\/provider is not supported in model shorthand/,
			);
			assert.throws(
				() => parseSubagentShorthand("spawn"),
				/Runner\/provider is not supported in model shorthand/,
			);
			assert.throws(
				() => parseSubagentShorthand("fork:@reviewer/model"),
				/Runner\/provider is not supported in model shorthand/,
			);
			assert.throws(
				() => parseSubagentShorthand("spawn:@reviewer/model"),
				/Runner\/provider is not supported in model shorthand/,
			);
			assert.throws(
				() => parseSubagentShorthand("+high"),
				/Invalid thinking delimiter '\+'/,
			);
			assert.throws(
				() => parseSubagentShorthand("model+high"),
				/Invalid thinking delimiter '\+'/,
			);
			assert.throws(
				() => parseSubagentShorthand("a//b"),
				/cannot contain consecutive slashes/,
			);
			assert.throws(
				() => parseSubagentShorthand("a::b"),
				/cannot contain consecutive colons/,
			);
			assert.throws(
				() => parseSubagentShorthand(":high:low"),
				/cannot contain ':', '\/', or '@'/,
			);
			assert.throws(
				() => parseSubagentShorthand("model:high/extra"),
				/cannot contain ':', '\/', or '@'/,
			);
			assert.throws(
				() => parseSubagentShorthand("model:high@extra"),
				/cannot contain ':', '\/', or '@'/,
			);
			assert.throws(
				() => parseSubagentShorthand(":high/extra"),
				/cannot contain ':', '\/', or '@'/,
			);
			assert.throws(
				() => parseSubagentShorthand("@a/b/c/d"),
				/model path has too many segments/,
			);
		});
	});

	describe("normalizeSubagentConfig", () => {
		it("defaults provider to spawn when undefined", () => {
			assert.deepEqual(normalizeSubagentConfig(undefined), {
				provider: "spawn",
			});
			assert.deepEqual(normalizeSubagentConfig({}), {
				provider: "spawn",
			});
		});

		it("preserves explicit provider and passes through config fields", () => {
			assert.deepEqual(
				normalizeSubagentConfig({
					provider: "fork",
					llmProvider: "acp-codex-acp",
					preset: "reviewer",
					model: "gpt-6.1-sol",
					thinking: "medium",
				}),
				{
					provider: "fork",
					llmProvider: "acp-codex-acp",
					preset: "reviewer",
					model: "gpt-6.1-sol",
					thinking: "medium",
				},
			);
		});

		it("resolves the inherit model sentinel to no model", () => {
			assert.deepEqual(normalizeSubagentConfig({ model: "inherit" }), {
				provider: "spawn",
			});
			assert.deepEqual(
				normalizeSubagentConfig({
					preset: "reviewer",
					model: "inherit",
					thinking: "high",
				}),
				{ provider: "spawn", preset: "reviewer", thinking: "high" },
			);
		});
	});

	describe("interpolateSubagentConfig", () => {
		it("resolves an interpolated inherit model sentinel to no model", () => {
			assert.deepEqual(
				interpolateSubagentConfig(
					{ provider: "spawn", model: "{{args.model}}" },
					{ model: "inherit" },
				),
				{ provider: "spawn" },
			);
			assert.deepEqual(
				interpolateSubagentConfig(
					{ provider: "spawn", model: "{{args.model}}" },
					{ model: "deepseek-reasoner" },
				),
				{ provider: "spawn", model: "deepseek-reasoner" },
			);
		});
	});

	it("parses subagent: true and parameterized subagent shorthand strings", () => {
		const doc = parseWorkflowDocument(`
steps:
  - prompt: "Simple subagent task"
    subagent: true
  - prompt: "Parameterized subagent task"
    subagent: "@code-review/fast"
  - prompt: "Standard step"
    subagent: false
`);

		assert.equal(doc.steps.length, 3);
		assert.equal(doc.steps[0].kind, "subagent");
		if (doc.steps[0].kind === "subagent") {
			assert.deepEqual(doc.steps[0].config, { provider: "spawn" });
		}
		assert.equal(doc.steps[1].kind, "subagent");
		if (doc.steps[1].kind === "subagent") {
			assert.deepEqual(doc.steps[1].config, {
				provider: "spawn",
				model: "fast",
				preset: "code-review",
			});
		}
		assert.equal(doc.steps[2].kind, "prompt");
	});

	it("parses subagent defined as configuration object", () => {
		const doc = parseWorkflowDocument(`
steps:
  - prompt: "Object subagent"
    subagent:
      provider: "fork"
      model: "deepseek-reasoner"
      thinking: "high"
`);
		assert.equal(doc.steps.length, 1);
		assert.equal(doc.steps[0].kind, "subagent");
		if (doc.steps[0].kind === "subagent") {
			assert.deepEqual(doc.steps[0].config, {
				provider: "fork",
				model: "deepseek-reasoner",
				thinking: "high",
			});
		}
	});

	it("parses the inherit sentinel as parent route inheritance", () => {
		const doc = parseWorkflowDocument(`
steps:
  - prompt: "Inherited shorthand"
    subagent: "inherit"
  - prompt: "Inherited shorthand with effort"
    subagent: "inherit:high"
  - prompt: "Inherited object"
    subagent:
      model: "inherit"
`);

		assert.equal(doc.steps[0].kind, "subagent");
		if (doc.steps[0].kind === "subagent") {
			assert.deepEqual(doc.steps[0].config, { provider: "spawn" });
		}
		assert.equal(doc.steps[1].kind, "subagent");
		if (doc.steps[1].kind === "subagent") {
			assert.deepEqual(doc.steps[1].config, {
				provider: "spawn",
				thinking: "high",
			});
		}
		assert.equal(doc.steps[2].kind, "subagent");
		if (doc.steps[2].kind === "subagent") {
			assert.deepEqual(doc.steps[2].config, { provider: "spawn" });
		}
	});

	it("rejects invalid subagent types or invalid shorthand", () => {
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - prompt: "Number should fail"
    subagent: 123
`),
			/Invalid workflow schema/,
		);

		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - prompt: "Empty shorthand should fail"
    subagent: ""
`),
			/Invalid workflow schema/,
		);

		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - prompt: "Whitespace shorthand should fail"
    subagent: "   "
`),
			/Invalid workflow schema/,
		);
	});

	it("splits workflow file parsing and preprocessing with automatic step names", () => {
		const rawYaml = `
steps:
  - "First step without name"
  - kind: prompt
    name: "Custom Named Step"
    prompt: "Second step"
  - print: "Done message"
  - gate: "Approval checkpoint"
`;
		const file = parseWorkflowFile(rawYaml);
		assert.equal(file.steps.length, 4);

		const doc = preprocessWorkflow(file);
		assert.equal(doc.steps.length, 4);
		assert.equal(doc.steps[0].name, "Step 1");
		assert.equal(doc.steps[0].kind, "prompt");
		assert.equal(doc.steps[1].name, "Custom Named Step");
		assert.equal(doc.steps[1].kind, "prompt");
		assert.equal(doc.steps[2].name, "Step 3");
		assert.equal(doc.steps[2].kind, "print");
		assert.equal(doc.steps[3].name, "Step 4");
		assert.equal(doc.steps[3].kind, "prompt");
	});

	it("preserves preprocessed subagent steps through preprocessWorkflow", () => {
		const doc = preprocessWorkflow({
			steps: [
				{
					kind: "subagent",
					name: "Security Audit",
					prompt: "Run security audit",
					config: { provider: "spawn", preset: "security-auditor" },
					gate: "Security approval",
				} as unknown as WorkflowFileStep,
			],
		});
		assert.equal(doc.steps.length, 1);
		assert.equal(doc.steps[0].kind, "subagent");
		assert.equal(doc.steps[0].name, "Security Audit");
		if (doc.steps[0].kind === "subagent") {
			assert.equal(doc.steps[0].prompt, "Run security audit");
			assert.deepEqual(doc.steps[0].config, {
				provider: "spawn",
				preset: "security-auditor",
			});
			assert.equal(doc.steps[0].gate, "Security approval");
		}
	});

	it("parseWorkflowSummary extracts valid workflow metadata and arguments", () => {
		const yaml = `
name: "Deploy Service"
description: "Deploys the service to a target environment"
args:
  environment:
    type: choice
    choices: ["staging", "production"]
    default: "staging"
    description: "Target deployment environment"
  version:
    type: string
    description: "Semantic version tag"
steps:
  - "echo deploy"
`;
		const summary = parseWorkflowSummary("deploy.yaml", yaml);
		assert.ok(summary);
		assert.equal(summary.target, "deploy.yaml");
		assert.equal(summary.name, "Deploy Service");
		assert.equal(
			summary.description,
			"Deploys the service to a target environment",
		);
		assert.equal(summary.params.length, 2);
		assert.equal(summary.params[0].name, "environment");
		assert.equal(summary.params[0].type, "choice");
		assert.deepEqual(summary.params[0].choices, ["staging", "production"]);
		assert.equal(summary.params[0].default, "staging");
		assert.equal(summary.params[0].required, false);
		assert.equal(
			summary.params[0].description,
			"Target deployment environment",
		);

		assert.equal(summary.params[1].name, "version");
		assert.equal(summary.params[1].type, "string");
		assert.equal(summary.params[1].required, true);
		assert.equal(summary.params[1].description, "Semantic version tag");
	});

	it("parseWorkflowSummary returns null for invalid yaml or schema", () => {
		assert.equal(parseWorkflowSummary("invalid.yaml", "not: [valid"), null);
		assert.equal(parseWorkflowSummary("missing-steps.yaml", "name: Bad"), null);
	});

	it("formatWorkflowList formats categories and parameters deterministically", () => {
		const output = formatWorkflowList([
			{
				title: "Local Workflows (.agents/wf)",
				workflows: [
					{
						target: "deploy.yaml",
						name: "Deploy",
						description: "Deploy app",
						params: [
							{
								name: "env",
								description: "Target environment",
								type: "choice",
								choices: ["staging", "production"],
								required: true,
							},
						],
					},
				],
			},
			{
				title: "Common Workflows (~/.agents/wf)",
				workflows: [],
			},
		]);

		assert.ok(output.includes("### Local Workflows (.agents/wf)"));
		assert.ok(output.includes("- **Deploy** (`deploy.yaml`): Deploy app"));
		assert.ok(
			output.includes(
				"  - `env` (choice, choices: staging, production, required): Target environment",
			),
		);
		assert.ok(output.includes("### Common Workflows (~/.agents/wf)"));
		assert.ok(output.includes("*(No workflows found)*"));
	});

	it("buildSubagentOutputSchema builds schema with string properties and synthetic file parameters", () => {
		const outputs = {
			findings: {
				type: "string" as const,
				description: "Antipattern findings",
			},
			summary: {
				type: "string" as const,
			},
			audit_log: {
				type: "file" as const,
				path: "audit.log",
				base: "workspace" as const,
			},
		};
		const resolvedPaths = {
			audit_log: "/workspace/audit.log",
		};
		const schema = buildSubagentOutputSchema(outputs, resolvedPaths);
		assert.equal(schema.type, "object");
		assert.equal(schema.additionalProperties, false);
		assert.deepEqual(schema.required, ["findings", "summary", "audit_log"]);
		assert.deepEqual(schema.properties?.findings, {
			type: "string",
			description: "Antipattern findings",
		});
		assert.deepEqual(schema.properties?.summary, {
			type: "string",
			description: "Output string value for 'summary'",
		});
		assert.deepEqual(schema.properties?.audit_log, {
			type: "string",
			description:
				"Absolute filesystem path of the written file for 'audit_log'. Must be written to: /workspace/audit.log",
		});
	});

	it("formatSubagentPrompt formats requirements or returns raw prompt when empty", () => {
		const raw = formatSubagentPrompt({ prompt: "Do audit" });
		assert.equal(raw, "Do audit");

		const emptyReqs = formatSubagentPrompt({
			prompt: "Do audit",
			outputRequirements: [],
		});
		assert.equal(emptyReqs, "Do audit");

		const withReqs = formatSubagentPrompt({
			prompt: "Do audit",
			outputRequirements: [
				{
					name: "report",
					type: "file",
					resolvedPath: "/workspace/report.md",
				},
				{
					name: "score",
					type: "string",
					description: "Quality score",
				},
				{
					name: "notes",
					type: "string",
				},
			],
		});
		assert.ok(withReqs.includes("Do audit"));
		assert.ok(withReqs.includes("<output-requirements>"));
		assert.ok(
			withReqs.includes(
				"- File output 'report': write the complete file content to '/workspace/report.md'. In the returned JSON object, set property 'report' to the exact absolute file path '/workspace/report.md'.",
			),
		);
		assert.ok(
			withReqs.includes(
				"- String output 'score' (Quality score): in the returned JSON object, set property 'score' to the output string value.",
			),
		);
		assert.ok(
			withReqs.includes(
				"- String output 'notes': in the returned JSON object, set property 'notes' to the output string value.",
			),
		);
	});

	it("supports bool arguments in schema, preprocessing, and resolution", () => {
		const yaml = `
args:
  flag_bool:
    type: bool
    default: true
  flag_other:
    type: bool
    default: false
steps:
  - prompt: "Step 1"
`;
		const doc = parseWorkflowDocument(yaml);
		assert.equal(doc.args.flag_bool.type, "bool");
		assert.equal(doc.args.flag_bool.default, "true");
		assert.equal(doc.args.flag_other.type, "bool");
		assert.equal(doc.args.flag_other.default, "false");

		// Test arg resolution with default
		const resolvedDefaults = resolveWorkflowArgs({
			declarations: doc.args,
			explicitArgs: {},
			implicitInstructions: "",
		});
		assert.deepEqual(resolvedDefaults, {
			flag_bool: "true",
			flag_other: "false",
		});

		// Test arg resolution with explicit boolean true/false values
		const resolvedExplicit = resolveWorkflowArgs({
			declarations: doc.args,
			explicitArgs: {
				flag_bool: "false",
				flag_other: "true",
			},
			implicitInstructions: "",
		});
		assert.deepEqual(resolvedExplicit, {
			flag_bool: "false",
			flag_other: "true",
		});

		// Test invalid boolean value throws
		assert.throws(
			() =>
				resolveWorkflowArgs({
					declarations: doc.args,
					explicitArgs: { flag_bool: "1" },
					implicitInstructions: "",
				}),
			/Invalid value '1' for bool argument 'flag_bool'/,
		);
	});

	it("preprocesses step if conditions and validates templates", () => {
		const yaml = `
args:
  mode:
    type: choice
    choices: ["smell", "review"]
    default: "review"
steps:
  - name: "Smell Step"
    if: '{{args.mode}} == "smell"'
    prompt: "Scan smells"
  - name: "Review Step"
    if: '{{args.mode}} != "smell"'
    prompt: "Review code"
`;
		const doc = parseWorkflowDocument(yaml);
		assert.equal(doc.steps[0].if, '{{args.mode}} == "smell"');
		assert.equal(doc.steps[1].if, '{{args.mode}} != "smell"');

		// Validation succeeds with valid args
		assert.equal(validateWorkflow({ doc, args: { mode: "review" } }).length, 0);

		// Returns error on unresolved arg in if condition
		const ifErrors = validateWorkflow({ doc, args: {} });
		assert.ok(ifErrors.some((e) => e.message.includes("{{args.mode}}")));
	});

	it("evaluates step conditions accurately for equality, inequality, and booleans", () => {
		const args = {
			mode: "review",
			run_smell: "false",
			run_review: "true",
		};

		// String equality
		assert.equal(
			evaluateStepCondition('{{args.mode}} == "review"', args),
			true,
		);
		assert.equal(
			evaluateStepCondition("{{args.mode}} == 'review'", args),
			true,
		);
		assert.equal(
			evaluateStepCondition('{{args.mode}} == "smell"', args),
			false,
		);

		// String inequality
		assert.equal(evaluateStepCondition('{{args.mode}} != "smell"', args), true);
		assert.equal(
			evaluateStepCondition('{{args.mode}} != "review"', args),
			false,
		);

		// Direct boolean
		assert.equal(evaluateStepCondition("{{args.run_review}}", args), true);
		assert.equal(evaluateStepCondition("{{args.run_smell}}", args), false);

		// Negated boolean
		assert.equal(evaluateStepCondition("!{{args.run_smell}}", args), true);
		assert.equal(evaluateStepCondition("!{{args.run_review}}", args), false);

		// Empty/whitespace
		assert.equal(evaluateStepCondition("", args), false);

		// Empty string comparisons
		assert.equal(
			evaluateStepCondition("{{args.empty}} == ''", { empty: "" }),
			true,
		);
		assert.equal(
			evaluateStepCondition('{{args.empty}} == ""', { empty: "" }),
			true,
		);
		assert.equal(
			evaluateStepCondition("{{args.empty}} != ''", { empty: "" }),
			false,
		);

		// Embedded operators in outputs do not corrupt condition evaluation
		const outputs = {
			code: "const x == 5;",
			truthy: "true",
		};
		assert.equal(evaluateStepCondition("{{outputs.code}}", {}, outputs), false);
		assert.equal(
			evaluateStepCondition("{{outputs.truthy}}", {}, outputs),
			true,
		);
		assert.equal(
			evaluateStepCondition("{{outputs.code}} == 'const x == 5;'", {}, outputs),
			true,
		);
		assert.equal(
			evaluateStepCondition("{{outputs.code}} != 'other'", {}, outputs),
			true,
		);
	});

	it("rejects output: <name> on non-subagent steps and supports it on subagent steps", () => {
		// Zod schema rejects output on prompt step without subagent
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - prompt: "Step 1"
    output: out1
`),
			/'output' is only allowed on subagent steps/,
		);

		// Zod schema rejects output on prompt step with subagent: false
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - prompt: "Step 1"
    subagent: false
    output: out1
`),
			/'output' is only allowed on subagent steps/,
		);

		// Zod schema rejects output on print step
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - print: "Notice"
    output: out1
`),
			/'output' is only allowed on subagent steps/,
		);

		// Zod schema rejects output on print step with explicit kind
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - kind: print
    text: "Notice"
    output: out1
`),
			/'output' is only allowed on subagent steps/,
		);

		// Zod schema rejects output on solo gate step
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - gate: "Approval"
    output: out1
`),
			/'output' is only allowed on subagent steps/,
		);

		// Zod schema rejects prompt step with gate and output when subagent is false/omitted
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - prompt: "Review"
    gate: "Approval"
    output: out1
`),
			/'output' is only allowed on subagent steps|Invalid workflow schema/,
		);

		// preprocessWorkflow throws if rawOutput present on non-subagent step
		assert.throws(
			() =>
				preprocessWorkflow({
					steps: [
						{
							prompt: "Step 1",
							output: "out1",
						} as unknown,
					],
				} as unknown as Parameters<typeof preprocessWorkflow>[0]),
			/cannot declare 'output' without 'subagent: true'/,
		);

		// Successful parse on subagent: true
		const doc = parseWorkflowDocument(`
steps:
  - prompt: "Step 1"
    subagent: true
    output: out1
  - prompt: "Step 2 {{outputs.out1}}"
`);
		assert.equal(doc.steps[0].kind, "subagent");
		if (doc.steps[0].kind === "subagent") {
			assert.equal(doc.steps[0].output, "out1");
		}
	});

	it("normalizes boolean arguments to lowercase canonical values", () => {
		const declarations: Record<string, WorkflowArg> = {
			flagA: { type: "bool", required: true },
			flagB: { type: "bool", required: true },
		};
		const resolved = resolveWorkflowArgs({
			declarations,
			explicitArgs: {
				flagA: "True",
				flagB: "FALSE",
			},
			implicitInstructions: "",
		});
		assert.equal(resolved.flagA, "true");
		assert.equal(resolved.flagB, "false");
	});

	it("supports list outputs with min and max validation", () => {
		const yaml = `
steps:
  - prompt: "Produce items"
    outputs:
      items:
        type: list
        description: "List of items"
        min: 1
        max: 5
`;
		const doc = parseWorkflowDocument(yaml);
		assert.equal(doc.steps[0].kind, "prompt");
		const outputs = doc.steps[0].outputs;
		assert.ok(outputs?.items);
		assert.equal(outputs.items.type, "list");
		if (outputs.items.type === "list") {
			assert.equal(outputs.items.min, 1);
			assert.equal(outputs.items.max, 5);
		}

		// Rejects min > max
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - prompt: "Produce items"
    outputs:
      items:
        type: list
        min: 5
        max: 2
`),
			/'min' cannot be greater than 'max'/,
		);
	});

	it("supports foreach on subagent steps and rejects foreach on non-subagents", () => {
		const doc = parseWorkflowDocument(`
steps:
  - prompt: "Step 1"
    subagent: true
    foreach: "{{outputs.files}}"
    output: results
`);
		assert.equal(doc.steps[0].kind, "subagent");
		if (doc.steps[0].kind === "subagent") {
			assert.equal(doc.steps[0].foreach, "{{outputs.files}}");
		}

		// Rejects foreach on prompt step without subagent
		assert.throws(
			() =>
				parseWorkflowDocument(`
steps:
  - prompt: "Step 1"
    foreach: "{{outputs.files}}"
`),
			/'foreach' is only allowed on subagent steps/,
		);
	});

	it("renders list outputs as markdown bullet lists in interpolateTemplate and binds {{item}}", () => {
		const template = "Found items:\n{{outputs.items}}\nEnd.";
		const rendered = interpolateTemplate(
			template,
			{},
			{
				items: ["first", "second", "third"],
			},
		);
		assert.equal(rendered, "Found items:\n- first\n- second\n- third\nEnd.");

		// Empty list renders as empty string
		const emptyRendered = interpolateTemplate(template, {}, { items: [] });
		assert.equal(emptyRendered, "Found items:\n\nEnd.");

		// Binds {{item}}
		const itemTemplate = "Processing item: {{item}} from {{args.scope}}";
		const itemRendered = interpolateTemplate(
			itemTemplate,
			{ scope: "workspace" },
			{},
			{ item: "foo.ts" },
		);
		assert.equal(itemRendered, "Processing item: foo.ts from workspace");
	});

	it("formats validation summary with metadata, step breakdown, and parameters", () => {
		const doc = parseWorkflowDocument(`
name: "Deploy Pipeline"
description: "Deploys service"
args:
  env:
    type: choice
    choices: [staging, production]
    default: staging
  version:
    type: string
steps:
  - name: "Announce"
    print: "Deploying"
  - name: "Run Subagent"
    prompt: "Execute"
    subagent: true
    output: run_id
  - name: "Verify"
    prompt: "Verify {{outputs.run_id}}"
    gate: "Manual signoff"
`);
		const summaryWithoutArgs = formatValidationSummary("deploy.yaml", doc);
		assert.ok(
			summaryWithoutArgs.includes("### Workflow Validation: `deploy.yaml`"),
		);
		assert.ok(summaryWithoutArgs.includes("- **Status:** Valid"));
		assert.ok(summaryWithoutArgs.includes("- **Name:** Deploy Pipeline"));
		assert.ok(
			summaryWithoutArgs.includes("- **Description:** Deploys service"),
		);
		assert.ok(summaryWithoutArgs.includes("- **Steps:** 3"));
		assert.ok(summaryWithoutArgs.includes("1. [print] Announce"));
		assert.ok(summaryWithoutArgs.includes("2. [subagent] Run Subagent"));
		assert.ok(summaryWithoutArgs.includes("- Output: `run_id`"));
		assert.ok(summaryWithoutArgs.includes("3. [prompt] Verify [gate]"));
		assert.ok(summaryWithoutArgs.includes("- **Declared Arguments:**"));
		assert.ok(
			summaryWithoutArgs.includes(
				'`env` (choice, choices: staging, production, default: "staging")',
			),
		);
		assert.ok(summaryWithoutArgs.includes("`version` (string, required)"));

		const summaryWithArgs = formatValidationSummary("deploy.yaml", doc, {
			env: "production",
			version: "1.0.0",
		});
		assert.ok(summaryWithArgs.includes("- **Resolved Arguments:**"));
		assert.ok(summaryWithArgs.includes('`env`: "production"'));
		assert.ok(summaryWithArgs.includes('`version`: "1.0.0"'));

		// Summary without name/description and with file/string outputs
		const bareDoc: WorkflowDocument = {
			args: {},
			steps: [{ kind: "prompt", name: "Solo", prompt: "Hello" }],
		};
		const bareSummary = formatValidationSummary("bare.yaml", bareDoc);
		assert.ok(!bareSummary.includes("- **Name:**"));
		assert.ok(!bareSummary.includes("- **Description:**"));
		assert.ok(!bareSummary.includes("- **Declared Arguments:**"));

		const outputsDoc: WorkflowDocument = {
			args: {
				choice_arg: { type: "choice", choices: ["a"], required: true },
			},
			steps: [
				{
					kind: "prompt",
					name: "Solo",
					prompt: "Hello",
					outputs: {
						file_out: { type: "file", path: "out.txt", base: "scratch" },
						str_desc: { type: "string", description: "My string output" },
						str_nodesc: { type: "string" },
					},
				},
			],
		};
		const outputsSummary = formatValidationSummary("choice.yaml", outputsDoc, {
			choice_arg: "a",
		});
		assert.ok(outputsSummary.includes("- Output: `file_out` (file): out.txt"));
		assert.ok(
			outputsSummary.includes(
				"- Output: `str_desc` (string): My string output",
			),
		);
		assert.ok(outputsSummary.includes("- Output: `str_nodesc` (string)"));
	});

	it("resolves choice argument mapping and rejects explicit overrides of derived keys", () => {
		const yaml = `
args:
  type:
    type: choice
    choices: [article, studio]
    default: article
    mapping:
      instructions:
        article: "create a nice article"
        studio: "create a studio guide"
      tone:
        article: "narrative"
        studio: "factual"
steps:
  - prompt: "{{args.instructions}} with tone {{args.tone}}"
`;
		const doc = parseWorkflowDocument(yaml);
		assert.ok(doc.args.type.type === "choice" && doc.args.type.mapping);

		// 1. Resolve with default choice "article"
		const resolvedDefault = resolveWorkflowArgs({
			declarations: doc.args,
			explicitArgs: {},
			implicitInstructions: "",
		});
		assert.equal(resolvedDefault.type, "article");
		assert.equal(resolvedDefault.instructions, "create a nice article");
		assert.equal(resolvedDefault.tone, "narrative");

		// 2. Resolve with explicit choice "studio"
		const resolvedExplicit = resolveWorkflowArgs({
			declarations: doc.args,
			explicitArgs: { type: "studio" },
			implicitInstructions: "",
		});
		assert.equal(resolvedExplicit.type, "studio");
		assert.equal(resolvedExplicit.instructions, "create a studio guide");
		assert.equal(resolvedExplicit.tone, "factual");

		// 3. Reject explicit argument override of derived key
		assert.throws(
			() =>
				resolveWorkflowArgs({
					declarations: doc.args,
					explicitArgs: { instructions: "custom override" },
					implicitInstructions: "",
				}),
			/Cannot pass explicit argument 'instructions': 'instructions' is derived from choice argument 'type'/,
		);
	});

	it("resolves flat choice mapping with direct value replacement and supports 'mappings' alias", () => {
		const yaml = `
args:
  effort:
    type: choice
    default: high
    choices: [low, high]
    mappings:
      low: "acp-codex-acp/gpt-6-luna:xhigh"
      high: "acp-codex-acp/gpt-6.1-sol:medium"
steps:
  - prompt: "Subagent model: {{args.effort}}"
`;
		const doc = parseWorkflowDocument(yaml);
		assert.ok(doc.args.effort.type === "choice" && doc.args.effort.mapping);

		// 1. Resolve with default choice "high" -> maps effort directly
		const resolvedDefault = resolveWorkflowArgs({
			declarations: doc.args,
			explicitArgs: {},
			implicitInstructions: "",
		});
		assert.equal(resolvedDefault.effort, "acp-codex-acp/gpt-6.1-sol:medium");

		// 2. Resolve with explicit choice "low" -> maps effort directly
		const resolvedExplicit = resolveWorkflowArgs({
			declarations: doc.args,
			explicitArgs: { effort: "low" },
			implicitInstructions: "",
		});
		assert.equal(resolvedExplicit.effort, "acp-codex-acp/gpt-6-luna:xhigh");

		// 3. Optional choice with mapping omitted branch coverage
		const optionalMappingDoc = parseWorkflowDocument(`
args:
  opt:
    type: choice
    choices: [a, b]
    required: false
    mapping:
      derived:
        a: "valA"
        b: "valB"
steps:
  - prompt: "p"
`);
		const optResolved = resolveWorkflowArgs({
			declarations: optionalMappingDoc.args,
			explicitArgs: {},
			implicitInstructions: "",
		});
		assert.equal(optResolved.derived, undefined);

		// 4. Missing mapping key at runtime throws error
		const partialMappingDoc: Record<string, WorkflowArg> = {
			opt: {
				type: "choice",
				choices: ["a", "b"],
				default: "b",
				mapping: {
					derived: {
						a: "valA",
					},
				},
			},
		};
		assert.throws(
			() =>
				resolveWorkflowArgs({
					declarations: partialMappingDoc,
					explicitArgs: {},
					implicitInstructions: "",
				}),
			/Choice 'b' for derived argument 'derived' in 'opt' mapping is not defined/,
		);

		// 5. Flat mapping with runtime missing key throws error
		const flatPartialDoc: Record<string, WorkflowArg> = {
			opt: {
				type: "choice",
				choices: ["a", "b"],
				default: "b",
				mapping: {
					a: "valA",
				},
			},
		};
		assert.throws(
			() =>
				resolveWorkflowArgs({
					declarations: flatPartialDoc,
					explicitArgs: {},
					implicitInstructions: "",
				}),
			/Choice 'b' for argument 'opt' is not defined in mapping/,
		);
		const flatMatchResolved = resolveWorkflowArgs({
			declarations: flatPartialDoc,
			explicitArgs: { opt: "a" },
			implicitInstructions: "",
		});
		assert.equal(flatMatchResolved.opt, "valA");

		// 6. Inherited prototype properties (e.g. toString) are not treated as mapped values
		const protoDoc: Record<string, WorkflowArg> = {
			opt: {
				type: "choice",
				choices: ["toString", "custom"],
				default: "toString",
				mapping: {
					custom: "customVal",
				},
			},
		};
		assert.throws(
			() =>
				resolveWorkflowArgs({
					declarations: protoDoc,
					explicitArgs: {},
					implicitInstructions: "",
				}),
			/Choice 'toString' for argument 'opt' is not defined in mapping/,
		);
	});

	it("strictly rejects unrecognized argument properties and duplicate mapping/mappings", () => {
		// Reject unknown property on choice argument
		assert.throws(
			() =>
				parseWorkflowDocument(`
args:
  effort:
    type: choice
    choices: [low, high]
    unknown_field: true
steps:
  - prompt: "hi"
`),
			/Unrecognized key.*unknown_field/,
		);

		// Reject specifying both mapping and mappings
		assert.throws(
			() =>
				parseWorkflowDocument(`
args:
  effort:
    type: choice
    choices: [low, high]
    mapping:
      low: "val1"
      high: "val2"
    mappings:
      low: "val1"
      high: "val2"
steps:
  - prompt: "hi"
`),
			/Cannot specify both 'mapping' and 'mappings'/,
		);

		// Reject empty mapping object
		assert.throws(
			() =>
				parseWorkflowDocument(`
args:
  effort:
    type: choice
    choices: [low, high]
    mapping: {}
steps:
  - prompt: "hi"
`),
			/Invalid workflow schema/,
		);
	});

	it("supports boolean gate values in YAML and preprocesses them accurately", () => {
		const yaml = `
steps:
  - name: "Step True"
    prompt: "Prompt 1"
    gate: true
  - name: "Step False"
    prompt: "Prompt 2"
    gate: false
  - name: "Subagent True"
    prompt: "Sub 1"
    subagent: true
    output: out1
    gate: true
  - name: "Subagent False"
    prompt: "Sub 2"
    subagent: true
    output: out2
    gate: false
  - name: "Solo True"
    gate: true
  - name: "Solo False"
    gate: false
`;
		const doc = parseWorkflowDocument(yaml);
		assert.equal(doc.steps.length, 6);
		const s0 = doc.steps[0];
		const s1 = doc.steps[1];
		const s2 = doc.steps[2];
		const s3 = doc.steps[3];
		const s4 = doc.steps[4];
		const s5 = doc.steps[5];
		assert.equal(s0.kind === "prompt" ? s0.gate : undefined, true);
		assert.equal(s1.kind === "prompt" ? s1.gate : undefined, undefined);
		assert.equal(s2.kind === "subagent" ? s2.gate : undefined, true);
		assert.equal(s3.kind === "subagent" ? s3.gate : undefined, undefined);
		assert.equal(s4.kind === "prompt" ? s4.gate : undefined, true);
		assert.equal(s4.kind === "prompt" ? s4.isSoloGate : undefined, true);
		assert.equal(s5.kind === "prompt" ? s5.gate : undefined, undefined);
		assert.equal(s5.kind === "prompt" ? s5.isSoloGate : undefined, true);
	});

	it("resolveGate evaluates boolean, templated, and descriptive gate values", () => {
		// 1. Undefined and false
		assert.equal(resolveGate(undefined), undefined);
		assert.equal(resolveGate(false), undefined);
		assert.equal(resolveGate("false"), undefined);
		assert.equal(resolveGate("FALSE"), undefined);
		assert.equal(resolveGate(""), undefined);
		assert.equal(resolveGate("   "), undefined);

		// 2. Boolean true and "true" string fallback to stepName or default "Gate"
		assert.equal(resolveGate(true, {}, undefined, "plan"), "plan");
		assert.equal(resolveGate(true, {}, undefined, ""), "Gate");
		assert.equal(resolveGate(true), "Gate");
		assert.equal(resolveGate("true", {}, undefined, "plan"), "plan");
		assert.equal(resolveGate("TRUE", {}, undefined, "plan"), "plan");

		// 3. Templated argument injection (e.g. wait=true / wait=false)
		assert.equal(
			resolveGate("{{args.wait}}", { wait: "true" }, undefined, "plan"),
			"plan",
		);
		assert.equal(
			resolveGate("{{args.wait}}", { wait: "false" }, undefined, "plan"),
			undefined,
		);
		assert.equal(
			resolveGate("{{args.wait}}", { wait: "True" }, undefined, "plan"),
			"plan",
		);
		assert.equal(
			resolveGate("{{args.wait}}", { wait: "False" }, undefined, "plan"),
			undefined,
		);

		// 4. Custom descriptive string is preserved
		assert.equal(
			resolveGate("Approval required", {}, undefined, "plan"),
			"Approval required",
		);
		assert.equal(
			resolveGate("Approve {{args.env}}", { env: "prod" }, undefined, "plan"),
			"Approve prod",
		);
	});

	it("formatWorkflowSummary includes [gate] only for active gate steps", () => {
		const doc: WorkflowDocument = {
			args: {},
			steps: [
				{ kind: "prompt", name: "Step True", prompt: "p", gate: true },
				{ kind: "prompt", name: "Step False", prompt: "p", gate: false },
				{
					kind: "prompt",
					name: "Step Templated",
					prompt: "p",
					gate: "{{args.wait}}",
				},
				{ kind: "prompt", name: "Step Desc", prompt: "p", gate: "Approval" },
				{ kind: "prompt", name: "Step StrFalse", prompt: "p", gate: "false" },
				{ kind: "prompt", name: "Step EmptyStr", prompt: "p", gate: "" },
				{
					kind: "prompt",
					name: "Step WhitespaceStr",
					prompt: "p",
					gate: "   ",
				},
			],
		};
		const summary = formatValidationSummary("test.yaml", doc);
		assert.ok(summary.includes("1. [prompt] Step True [gate]"));
		assert.ok(
			summary.includes("2. [prompt] Step False\n") ||
				summary.includes("2. [prompt] Step False"),
		);
		assert.ok(!summary.includes("2. [prompt] Step False [gate]"));
		assert.ok(summary.includes("3. [prompt] Step Templated [gate]"));
		assert.ok(summary.includes("4. [prompt] Step Desc [gate]"));
		assert.ok(!summary.includes("5. [prompt] Step StrFalse [gate]"));
		assert.ok(!summary.includes("Step EmptyStr [gate]"));
		assert.ok(!summary.includes("Step WhitespaceStr [gate]"));
	});

	it("parseBoolean converts boolean values, case-insensitive strings, and rejects invalid inputs", () => {
		// Literal booleans
		assert.equal(parseBoolean(true), true);
		assert.equal(parseBoolean(false), false);

		// String representations
		assert.equal(parseBoolean("true"), true);
		assert.equal(parseBoolean("True"), true);
		assert.equal(parseBoolean("TRUE"), true);
		assert.equal(parseBoolean(" true "), true);
		assert.equal(parseBoolean("false"), false);
		assert.equal(parseBoolean("False"), false);
		assert.equal(parseBoolean("FALSE"), false);
		assert.equal(parseBoolean(" false "), false);

		// Non-boolean values return undefined
		assert.equal(parseBoolean(undefined), undefined);
		assert.equal(parseBoolean(null), undefined);
		assert.equal(parseBoolean(""), undefined);
		assert.equal(parseBoolean("   "), undefined);
		assert.equal(parseBoolean("yes"), undefined);
		assert.equal(parseBoolean("no"), undefined);
		assert.equal(parseBoolean(1), undefined);
		assert.equal(parseBoolean(0), undefined);
		assert.equal(parseBoolean({}), undefined);
	});
});
