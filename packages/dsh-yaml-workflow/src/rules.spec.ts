import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	formatValidationErrors,
	ruleChoiceMapping,
	ruleDuplicateOutputNames,
	ruleForeachOutputReferences,
	ruleStepOutputReferences,
	ruleSubagentDependencies,
	ruleSubagentOutputRequired,
	ruleSubagentOutputTypes,
	ruleTemplateArgs,
	ruleUnusedOutputs,
	ruleWorkflowNameOutputReferences,
	validateWorkflow,
} from "./rules.ts";
import type { WorkflowDocument } from "./types.ts";

describe("rules", () => {
	describe("ruleSubagentOutputRequired", () => {
		it("allows subagent with output or outputs", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Sub 1",
						prompt: "run",
						config: { provider: "spawn" },
						output: "out1",
					},
					{
						kind: "subagent",
						name: "Sub 2",
						prompt: "run 2",
						config: { provider: "spawn" },
						outputs: { out2: { type: "string" } },
					},
					{
						kind: "prompt",
						name: "Prompt step without output",
						prompt: "noop",
					},
				],
			};
			const errors = ruleSubagentOutputRequired({ doc });
			assert.equal(errors.length, 0);
		});

		it("reports error when subagent has neither output nor outputs", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Silent Subagent",
						prompt: "run",
						config: { provider: "spawn" },
					},
				],
			};
			const errors = ruleSubagentOutputRequired({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "subagent-output-required");
			assert.equal(errors[0].category, "output");
			assert.match(
				errors[0].message,
				/Subagent step 1 \('Silent Subagent'\) must declare at least one output via 'output' or 'outputs'/,
			);
		});

		it("reports error when subagent has empty outputs map", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Empty Outputs Subagent",
						prompt: "run",
						config: { provider: "spawn" },
						outputs: {},
					},
				],
			};
			const errors = ruleSubagentOutputRequired({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "subagent-output-required");
		});
	});

	describe("ruleDuplicateOutputNames", () => {
		it("returns empty errors when all output names are unique", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Step 1",
						prompt: "run",
						config: { provider: "spawn" },
						output: "sub_res",
					},
					{
						kind: "prompt",
						name: "Step 2",
						prompt: "Use {{outputs.sub_res}}",
						outputs: { prompt_res: { type: "string" } },
					},
				],
			};
			const errors = ruleDuplicateOutputNames({ doc });
			assert.equal(errors.length, 0);
		});

		it("collects duplicate output errors across subagent and prompt steps", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Step 1",
						prompt: "run",
						config: { provider: "spawn" },
						output: "dup1",
					},
					{
						kind: "subagent",
						name: "Step 2",
						prompt: "run 2",
						config: { provider: "spawn" },
						output: "dup1",
					},
					{
						kind: "prompt",
						name: "Step 3",
						prompt: "run 3",
						outputs: { dup2: { type: "string" } },
					},
					{
						kind: "prompt",
						name: "Step 4",
						prompt: "run 4",
						outputs: { dup2: { type: "string" } },
					},
				],
			};
			const errors = ruleDuplicateOutputNames({ doc });
			assert.equal(errors.length, 2);
			assert.equal(errors[0].rule, "duplicate-output-name");
			assert.equal(errors[0].category, "output");
			assert.match(
				errors[0].message,
				/Duplicate output name 'dup1' declared at step 2/,
			);
			assert.match(
				errors[1].message,
				/Duplicate output name 'dup2' declared at step 4/,
			);
		});
	});

	describe("ruleWorkflowNameOutputReferences", () => {
		it("returns empty errors for clean workflow names or documents without names", () => {
			assert.equal(
				ruleWorkflowNameOutputReferences({ doc: { args: {}, steps: [] } })
					.length,
				0,
			);
			assert.equal(
				ruleWorkflowNameOutputReferences({
					doc: { args: {}, name: "Clean Name", steps: [] },
				}).length,
				0,
			);
		});

		it("returns error if workflow name references an output", () => {
			const errors = ruleWorkflowNameOutputReferences({
				doc: {
					args: {},
					name: "Workflow {{outputs.result}}",
					steps: [],
				},
			});
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "workflow-name-output");
			assert.equal(errors[0].category, "output");
			assert.match(
				errors[0].message,
				/Output '\{\{outputs\.result\}\}' referenced in workflow name before any step execution\./,
			);
		});

		it("deduplicates multiple references to the same output in workflow name", () => {
			const errors = ruleWorkflowNameOutputReferences({
				doc: {
					args: {},
					name: "Workflow {{outputs.result}} and {{outputs.result}}",
					steps: [],
				},
			});
			assert.equal(errors.length, 1);
		});

		it("returns error if workflow title references an output", () => {
			const errors = ruleWorkflowNameOutputReferences({
				doc: {
					args: {},
					title: "Workflow {{outputs.result}}",
					steps: [],
				},
			});
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "workflow-name-output");
			assert.equal(errors[0].category, "output");
			assert.match(
				errors[0].message,
				/Output '\{\{outputs\.result\}\}' referenced in workflow title before any step execution\./,
			);
		});
	});

	describe("ruleStepOutputReferences", () => {
		it("returns empty errors when references are backwards and valid", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "step 1",
						outputs: {
							str_out: { type: "string" },
							file_out: { type: "file", path: "data.txt", base: "scratch" },
						},
					},
					{
						kind: "prompt",
						name: "Step 2",
						prompt: "Use {{outputs.str_out}} and {{outputs.file_out}}",
						outputs: {
							chained: {
								type: "file",
								path: "chained-{{outputs.str_out}}.txt",
								base: "scratch",
							},
						},
					},
					{
						kind: "print",
						name: "Step 3",
						if: "{{outputs.str_out}} == done",
						text: "Finish {{outputs.chained}}",
					},
				],
			};
			const errors = ruleStepOutputReferences({ doc });
			assert.equal(errors.length, 0);
		});

		it("returns errors for unknown outputs and forward references", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Use {{outputs.ghost}} and {{outputs.future}}",
					},
					{
						kind: "prompt",
						name: "Step 2",
						prompt: "Produce future",
						outputs: { future: { type: "string" } },
					},
				],
			};
			const errors = ruleStepOutputReferences({ doc });
			assert.equal(errors.length, 2);
			assert.equal(errors[0].rule, "unknown-output");
			assert.match(
				errors[0].message,
				/Unknown output '\{\{outputs\.ghost\}\}' referenced at step 1\./,
			);
			assert.equal(errors[1].rule, "forward-output-reference");
			assert.match(
				errors[1].message,
				/Output '\{\{outputs\.future\}\}' referenced at step 1 before it is declared at step 2\./,
			);
		});

		it("deduplicates repeated references to unknown outputs within the same step", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step with {{outputs.ghost}}",
						prompt: "Use {{outputs.ghost}} again {{outputs.ghost}}",
					},
				],
			};
			const errors = ruleStepOutputReferences({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "unknown-output");
		});
	});

	describe("ruleSubagentDependencies", () => {
		it("allows subagent step to reference output from a prompt step", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Prompt 1",
						prompt: "Ask user",
						outputs: { query: { type: "string" } },
					},
					{
						kind: "subagent",
						name: "Subagent 1",
						prompt: "Investigate {{outputs.query}}",
						config: { provider: "spawn" },
						output: "result",
					},
				],
			};
			const errors = ruleSubagentDependencies({ doc });
			assert.equal(errors.length, 0);
		});

		it("rejects subagent step referencing output from an earlier subagent step", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Subagent 1",
						prompt: "Find issues",
						config: { provider: "spawn" },
						output: "issues",
					},
					{
						kind: "subagent",
						name: "Subagent 2",
						prompt: "Fix {{outputs.issues}} and {{outputs.issues}}",
						config: { provider: "spawn" },
						output: "fixes",
					},
				],
			};
			const errors = ruleSubagentDependencies({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "subagent-dependency");
			assert.equal(errors[0].stepIndex, 1);
			assert.match(
				errors[0].message,
				/Subagent step 2 \('Subagent 2'\) cannot depend on output '\{\{outputs\.issues\}\}' produced by subagent step 1/,
			);
		});
	});

	describe("ruleUnusedOutputs", () => {
		it("returns empty errors when all declared outputs are used", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "step 1",
						outputs: { out1: { type: "string" } },
					},
					{
						kind: "prompt",
						name: "Step 2",
						prompt: "Use {{outputs.out1}}",
					},
				],
			};
			const errors = ruleUnusedOutputs({ doc });
			assert.equal(errors.length, 0);
		});

		it("returns error when a declared output is never used", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "step 1",
						outputs: {
							used: { type: "string" },
							orphan: { type: "string" },
						},
					},
					{
						kind: "prompt",
						name: "Step 2",
						prompt: "Use {{outputs.used}}",
					},
				],
			};
			const errors = ruleUnusedOutputs({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "unused-output");
			assert.match(
				errors[0].message,
				/Output 'orphan' declared at step 1 is never used in the workflow\. All outputs must be used at least once\./,
			);
		});
	});

	describe("ruleTemplateArgs", () => {
		it("returns empty errors when all template args resolve", () => {
			const doc: WorkflowDocument = {
				args: {},
				name: "Flow {{args.env}}",
				steps: [
					{
						kind: "prompt",
						name: "Step {{args.step_num}}",
						if: "{{args.run_step}} == true",
						prompt: "Deploy to {{args.env}}",
						gate: "Approve {{args.env}}",
					},
					{
						kind: "print",
						name: "Step 2",
						text: "Done in {{args.env}}",
					},
				],
			};
			const errors = ruleTemplateArgs({
				doc,
				args: { env: "prod", step_num: "1", run_step: "true" },
			});
			assert.equal(errors.length, 0);
		});

		it("collects all unresolved argument errors across document and steps", () => {
			const doc: WorkflowDocument = {
				args: {},
				name: "Flow {{args.missing_name}}",
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Build {{args.missing_prompt}}",
					},
				],
			};
			const errors = ruleTemplateArgs({ doc, args: {} });
			assert.equal(errors.length, 2);
			assert.equal(errors[0].rule, "template-args");
			assert.equal(errors[0].category, "template");
			assert.match(
				errors[0].message,
				/Unresolved workflow argument: \{\{args\.missing_name\}\}/,
			);
			assert.match(
				errors[1].message,
				/Unresolved workflow argument: \{\{args\.missing_prompt\}\}/,
			);
		});

		it("validates template arguments in file output paths", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Generate report",
						outputs: {
							report: {
								type: "file",
								path: "reports/{{args.report_id}}.txt",
								base: "scratch",
							},
						},
					},
				],
			};
			const errors = ruleTemplateArgs({ doc, args: {} });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "template-args");
			assert.match(
				errors[0].message,
				/Unresolved workflow argument: \{\{args\.report_id\}\}/,
			);
		});

		it("deduplicates identical strings in gate-only steps", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Gate step",
						prompt: "Approve {{args.missing}}",
						gate: "Approve {{args.missing}}",
					},
				],
			};
			const errors = ruleTemplateArgs({ doc, args: {} });
			assert.equal(errors.length, 1);
		});

		it("statically validates template argument declarations when runtime args are omitted", () => {
			const validDoc: WorkflowDocument = {
				args: {
					target: { type: "string" },
				},
				name: "Flow {{args.target}}",
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Deploy to {{args.target}}",
					},
				],
			};
			const noErrors = ruleTemplateArgs({ doc: validDoc });
			assert.equal(noErrors.length, 0);

			const invalidDoc: WorkflowDocument = {
				args: {
					target: { type: "string" },
				},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Deploy with {{args.undeclared}}",
					},
				],
			};
			const errors = ruleTemplateArgs({ doc: invalidDoc });
			assert.equal(errors.length, 1);
			assert.match(
				errors[0].message,
				/Unresolved workflow argument: \{\{args\.undeclared\}\} \(not declared in workflow 'args'\)/,
			);
		});

		it("validates template arguments inside subagent config", () => {
			const doc: WorkflowDocument = {
				args: {
					model: { type: "string" },
				},
				steps: [
					{
						kind: "subagent",
						name: "Step 1",
						prompt: "Review code",
						config: {
							provider: "spawn",
							model: "{{args.model}}",
							preset: "{{args.missing_preset}}",
						},
						output: "res",
					},
				],
			};
			const errors = ruleTemplateArgs({ doc });
			assert.equal(errors.length, 1);
			assert.match(
				errors[0].message,
				/Unresolved workflow argument: \{\{args\.missing_preset\}\}/,
			);
		});

		it("validates template arguments in workflow title", () => {
			const invalidDoc: WorkflowDocument = {
				title: "Release {{args.unknown}}",
				args: {
					version: { type: "string" },
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Run" }],
			};
			const errors = ruleTemplateArgs({ doc: invalidDoc });
			assert.equal(errors.length, 1);
			assert.match(
				errors[0].message,
				/Unresolved workflow argument: \{\{args\.unknown\}\}/,
			);

			const validDoc: WorkflowDocument = {
				title: "Release {{args.version}}",
				args: {
					version: { type: "string" },
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Run" }],
			};
			const noErrors = ruleTemplateArgs({ doc: validDoc });
			assert.equal(noErrors.length, 0);
		});
	});

	describe("ruleForeachOutputReferences", () => {
		it("passes when foreach references prior list output", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Find items",
						outputs: { items: { type: "list" } },
					},
					{
						kind: "subagent",
						name: "Step 2",
						prompt: "Process {{item}}",
						config: { provider: "spawn" },
						foreach: "{{outputs.items}}",
						output: "results",
					},
				],
			};
			const errors = ruleForeachOutputReferences({ doc });
			assert.equal(errors.length, 0);
		});

		it("rejects unknown output or forward reference in foreach", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Step 1",
						prompt: "Process {{item}}",
						config: { provider: "spawn" },
						foreach: "{{outputs.ghost}}",
						output: "results",
					},
					{
						kind: "subagent",
						name: "Step 2",
						prompt: "Process {{item}}",
						config: { provider: "spawn" },
						foreach: "{{outputs.future}}",
						output: "results2",
					},
					{
						kind: "prompt",
						name: "Step 3",
						prompt: "Produce future",
						outputs: { future: { type: "list" } },
					},
				],
			};
			const errors = ruleForeachOutputReferences({ doc });
			assert.equal(errors.length, 2);
			assert.equal(errors[0].rule, "unknown-output");
			assert.equal(errors[1].rule, "forward-output-reference");
		});

		it("rejects foreach referencing non-list output", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Make string",
						outputs: { str_out: { type: "string" } },
					},
					{
						kind: "subagent",
						name: "Step 2",
						prompt: "Process {{item}}",
						config: { provider: "spawn" },
						foreach: "{{outputs.str_out}}",
						output: "results",
					},
				],
			};
			const errors = ruleForeachOutputReferences({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "foreach-non-list-output");
			assert.match(errors[0].message, /expected 'list'/);
		});

		it("does not produce duplicate errors in ruleStepOutputReferences for foreach reference", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Step 1",
						prompt: "Process {{item}}",
						config: { provider: "spawn" },
						foreach: "{{outputs.unknown_list}}",
						output: "results",
					},
				],
			};
			const stepErrors = ruleStepOutputReferences({ doc });
			const foreachErrors = ruleForeachOutputReferences({ doc });
			assert.equal(stepErrors.length, 0);
			assert.equal(foreachErrors.length, 1);
			assert.equal(foreachErrors[0].rule, "unknown-output");
		});
	});

	describe("ruleSubagentOutputTypes", () => {
		it("rejects subagent step declaring type list output", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Step 1",
						prompt: "Run subagent",
						config: { provider: "spawn" },
						outputs: { items: { type: "list" } },
					},
				],
			};
			const errors = ruleSubagentOutputTypes({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "subagent-output-list-disallowed");
		});

		it("rejects foreach subagent declaring file output", () => {
			const doc: WorkflowDocument = {
				args: {},
				steps: [
					{
						kind: "subagent",
						name: "Step 1",
						prompt: "Run subagent",
						config: { provider: "spawn" },
						foreach: "{{outputs.items}}",
						outputs: {
							report: { type: "file", path: "report.md", base: "scratch" },
						},
					},
				],
			};
			const errors = ruleSubagentOutputTypes({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "foreach-subagent-output-file-disallowed");
		});
	});

	describe("validateWorkflow & formatValidationErrors", () => {
		it("validates valid workflow with zero errors", () => {
			const doc: WorkflowDocument = {
				args: {},
				name: "Good flow",
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Generate",
						outputs: { my_out: { type: "string" } },
					},
					{
						kind: "prompt",
						name: "Step 2",
						prompt: "Consume {{outputs.my_out}}",
					},
				],
			};
			const errors = validateWorkflow({ doc });
			assert.equal(errors.length, 0);
		});

		it("aggregates errors from multiple rules together", () => {
			const doc: WorkflowDocument = {
				args: {},
				name: "Flow with {{outputs.bad}}",
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Generate {{args.missing}}",
						outputs: { unused_out: { type: "string" } },
					},
				],
			};
			const errors = validateWorkflow({ doc, args: {} });
			assert.equal(errors.length, 3);
			assert.ok(errors.some((e) => e.rule === "workflow-name-output"));
			assert.ok(errors.some((e) => e.rule === "unused-output"));
			assert.ok(errors.some((e) => e.rule === "template-args"));

			const formattedSingle = formatValidationErrors("test.yaml", [errors[0]]);
			assert.match(
				formattedSingle,
				/^Output validation error in workflow 'test\.yaml':/,
			);

			const formattedMultiple = formatValidationErrors("test.yaml", errors);
			assert.match(
				formattedMultiple,
				/^Validation errors in workflow 'test\.yaml':/,
			);
			assert.match(formattedMultiple, /- Output '\{\{outputs\.bad\}\}'/);
			assert.match(formattedMultiple, /- Output 'unused_out'/);
			assert.match(formattedMultiple, /- Unresolved workflow argument/);
		});

		it("returns empty string when error list is empty", () => {
			assert.equal(formatValidationErrors("test.yaml", []), "");
		});
	});

	describe("ruleChoiceMapping", () => {
		it("passes on valid exhaustive choice mapping", () => {
			const doc: WorkflowDocument = {
				args: {
					type: {
						type: "choice",
						choices: ["article", "studio"],
						mapping: {
							instructions: {
								article: "write article",
								studio: "write studio guide",
							},
						},
					},
				},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Prompt: {{args.instructions}}",
					},
				],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 0);

			// Static template check also resolves {{args.instructions}} without runtime args
			const templateErrors = ruleTemplateArgs({ doc });
			assert.equal(templateErrors.length, 0);
		});

		it("fails when choice mapping is missing a choice", () => {
			const doc: WorkflowDocument = {
				args: {
					type: {
						type: "choice",
						choices: ["article", "studio"],
						mapping: {
							instructions: {
								article: "write article",
							},
						},
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-non-exhaustive");
			assert.match(errors[0].message, /missing choice 'studio'/);
		});

		it("fails when choice mapping references unknown choice", () => {
			const doc: WorkflowDocument = {
				args: {
					type: {
						type: "choice",
						choices: ["article", "studio"],
						mapping: {
							instructions: {
								article: "write article",
								studio: "write studio guide",
								unknown: "unexpected",
							},
						},
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-unknown-choice");
			assert.match(errors[0].message, /unknown choice 'unknown'/);
		});

		it("fails when derived argument collides with top-level argument", () => {
			const doc: WorkflowDocument = {
				args: {
					type: {
						type: "choice",
						choices: ["article", "studio"],
						mapping: {
							instructions: {
								article: "write article",
								studio: "write studio guide",
							},
						},
					},
					instructions: {
						type: "string",
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-collision");
			assert.match(
				errors[0].message,
				/collides with top-level argument 'instructions'/,
			);
		});

		it("passes on valid exhaustive flat choice mapping", () => {
			const doc: WorkflowDocument = {
				args: {
					effort: {
						type: "choice",
						choices: ["low", "high"],
						mapping: {
							low: "model-fast",
							high: "model-smart",
						},
					},
				},
				steps: [
					{
						kind: "prompt",
						name: "Step 1",
						prompt: "Subagent: {{args.effort}}",
					},
				],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 0);

			const templateErrors = ruleTemplateArgs({ doc });
			assert.equal(templateErrors.length, 0);
		});

		it("fails on non-exhaustive flat choice mapping", () => {
			const doc: WorkflowDocument = {
				args: {
					effort: {
						type: "choice",
						choices: ["low", "high"],
						mapping: {
							low: "model-fast",
						},
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-non-exhaustive");
			assert.match(errors[0].message, /missing choice 'high'/);
		});

		it("fails on unknown choice in flat choice mapping", () => {
			const doc: WorkflowDocument = {
				args: {
					effort: {
						type: "choice",
						choices: ["low", "high"],
						mapping: {
							low: "model-fast",
							high: "model-smart",
							medium: "model-medium",
						},
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-unknown-choice");
			assert.match(errors[0].message, /unknown choice 'medium'/);
		});

		it("fails when multiple choice arguments derive the same argument name", () => {
			const doc: WorkflowDocument = {
				args: {
					typeA: {
						type: "choice",
						choices: ["a1", "a2"],
						mapping: {
							shared: { a1: "1", a2: "2" },
						},
					},
					typeB: {
						type: "choice",
						choices: ["b1", "b2"],
						mapping: {
							shared: { b1: "1", b2: "2" },
						},
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-duplicate");
			assert.match(
				errors[0].message,
				/already defined in another choice mapping/,
			);
		});

		it("fails when choice name matches Object.prototype property but is unmapped", () => {
			const doc: WorkflowDocument = {
				args: {
					mode: {
						type: "choice",
						choices: ["low", "toString"],
						mapping: {
							low: "1",
						},
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-non-exhaustive");
			assert.match(errors[0].message, /missing choice 'toString'/);
		});

		it("fails when choice mapping is empty", () => {
			const doc: WorkflowDocument = {
				args: {
					mode: {
						type: "choice",
						choices: ["low", "high"],
						mapping: {},
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-empty");
			assert.match(errors[0].message, /mapping cannot be empty/);
		});

		it("fails when nested choice mapping entry is empty", () => {
			const doc: WorkflowDocument = {
				args: {
					mode: {
						type: "choice",
						choices: ["low", "high"],
						mapping: {
							derived: {},
						},
					},
				},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "Prompt" }],
			};
			const errors = ruleChoiceMapping({ doc });
			assert.equal(errors.length, 1);
			assert.equal(errors[0].rule, "choice-mapping-empty");
			assert.match(errors[0].message, /mapping for 'derived' cannot be empty/);
		});
	});
});
