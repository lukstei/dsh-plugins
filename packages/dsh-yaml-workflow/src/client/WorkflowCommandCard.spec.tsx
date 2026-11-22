import assert from "node:assert/strict";
import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
// @ts-expect-error react-dom lacks bundled type declarations in devDependencies
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowTestRunner } from "../e2e/test-runner.ts";
import { parseInvocationInput, resolveWorkflowArgs } from "../parser.ts";
import {
	executeValidatedWorkflow,
	validateWorkflowInvocation,
} from "../runner.ts";
import type { WorkflowInvocation, WorkflowRun } from "../types.ts";
import {
	getPausedGateDetails,
	resolveWorkflowCommand,
	WorkflowCommandCard,
} from "./WorkflowCommandCard.tsx";

const workflow = `args:
  effort:
    type: choice
    default: high
    choices: [low, alias, high]
    mappings:
      low: "acp-codex-acp/gpt-6.1-sol:low"
      alias: "acp-codex-acp/gpt-6.1-sol:low"
      high: "acp-codex-acp/gpt-6.1-sol:high"
  environment:
    type: choice
    default: staging
    choices: [staging, production]
    mapping:
      cluster_url:
        staging: "https://staging.internal"
        production: "https://production.internal"
  instructions:
    type: string
    default: None
    required: false
  review:
    type: bool
    default: true
  smells:
    type: bool
    default: true
steps:
  - print: "{{args.effort}} {{args.cluster_url}} {{args.instructions}} {{args.review}} {{args.smells}}"
`;

function createNode(run: WorkflowRun): ChatNode<"wf-state"> {
	return {
		key: "copy-test",
		kind: "wf-state",
		id: "copy-test",
		target: "chat",
		anchorSeq: 1,
		location: { kind: "unresolved" },
		visibility: "visible",
		data: run,
	};
}

describe("workflow command copy", () => {
	it.each([
		"review effort=low",
		"review effort=alias",
		"review",
		'review effort=high review=false smells=false instructions="check edge cases"',
		"review environment=production check edge cases",
		'"review flow.yaml" effort=low instructions=\'check "quotes"\'',
		"  review\teffort=low  ",
	])(
		"preserves input through execution and event replay: %s",
		async (input) => {
			const runner = new WorkflowTestRunner({ sessionId: "copy-test" });
			runner.registerWorkflow("review", workflow);
			runner.registerWorkflow("review flow.yaml", workflow);
			const validated = await validateWorkflowInvocation(input, runner);
			assert.equal(validated.kind, "valid");
			assert.ok(validated.kind === "valid");
			await executeValidatedWorkflow(validated, runner);

			const replayed = runner.getLatestRun();
			assert.ok(replayed);
			const command = resolveWorkflowCommand(replayed.invocation);
			assert.equal(command, `/wf ${input.trim()}`);
			assert.ok(command);
			const parsed = parseInvocationInput(command.slice("/wf ".length));
			assert.deepEqual(
				resolveWorkflowArgs({
					declarations: replayed.workflow.args,
					explicitArgs: parsed.explicitArgs,
					implicitInstructions: parsed.implicitInstructions,
				}),
				validated.invocation.resolvedArgs,
			);
			assert.equal(replayed.invocation.rawInput, input);
		},
	);

	it("keeps execution values expanded while copying choice names", async () => {
		const runner = new WorkflowTestRunner({ sessionId: "copy-test" });
		runner.registerWorkflow("review", workflow);
		const validated = await validateWorkflowInvocation(
			"review effort=low",
			runner,
		);
		assert.ok(validated.kind === "valid");
		expect({
			command: resolveWorkflowCommand(validated.invocation),
			resolvedArgs: validated.invocation.resolvedArgs,
		}).toMatchInlineSnapshot(`
			{
			  "command": "/wf review effort=low",
			  "resolvedArgs": {
			    "cluster_url": "https://staging.internal",
			    "effort": "acp-codex-acp/gpt-6.1-sol:low",
			    "environment": "staging",
			    "instructions": "None",
			    "review": "true",
			    "smells": "true",
			  },
			}
		`);
	});

	it.each([true, false])(
		"renders Copy availability with recorded input: %s",
		async (recorded) => {
			const runner = new WorkflowTestRunner({ sessionId: "copy-test" });
			runner.registerWorkflow("review", workflow);
			const validated = await validateWorkflowInvocation(
				"review effort=low",
				runner,
			);
			assert.ok(validated.kind === "valid");
			const invocation: WorkflowInvocation = recorded
				? validated.invocation
				: {
						targetPath: validated.invocation.targetPath,
						resolvedArgs: validated.invocation.resolvedArgs,
						runId: validated.invocation.runId,
					};
			const run: WorkflowRun = {
				workflow: validated.doc,
				invocation,
				state: validated.state,
			};
			const html = renderToStaticMarkup(
				<WorkflowCommandCard node={createNode(run)} />,
			);
			const button = html.match(/<button[^>]*>/);
			assert.ok(button);
			expect(button[0]).toMatchSnapshot();
			assert.equal(resolveWorkflowCommand(invocation) === undefined, !recorded);
		},
	);
});

describe("getPausedGateDetails", () => {
	it("returns undefined if run state is not paused", () => {
		const run: WorkflowRun = {
			workflow: {
				args: {},
				steps: [{ kind: "prompt", name: "Step 1", prompt: "p", gate: true }],
			},
			invocation: { targetPath: "test.yaml", runId: "r1", resolvedArgs: {} },
			state: { stepIndex: 0, status: "running" },
		};
		assert.equal(getPausedGateDetails(run), undefined);
	});

	it("resolves boolean and templated gates including whitespace and embedded templates", () => {
		const makeRun = (
			gate: string | boolean | undefined,
			resolvedArgs: Record<string, string>,
		): WorkflowRun => ({
			workflow: {
				args: {},
				steps: [
					{ kind: "prompt", name: "Deploy Step", prompt: "p", gate },
					{ kind: "prompt", name: "Next Step", prompt: "next" },
				],
			},
			invocation: { targetPath: "test.yaml", runId: "r1", resolvedArgs },
			state: { stepIndex: 0, status: "paused", pauseReason: "gate" },
		});

		// gate: true -> stepName
		const resTrue = getPausedGateDetails(makeRun(true, {}));
		assert.equal(resTrue?.gate, "Deploy Step");
		assert.equal(resTrue?.nextStepLabel, "Step 2 of 2: Next Step");

		// gate: false -> undefined
		const resFalse = getPausedGateDetails(makeRun(false, {}));
		assert.equal(resFalse?.gate, undefined);

		// gate: "  {{args.wait}}  " with wait: "true" -> stepName
		const resTemplatedTrue = getPausedGateDetails(
			makeRun("  {{args.wait}}  ", { wait: "true" }),
		);
		assert.equal(resTemplatedTrue?.gate, "Deploy Step");

		// gate: "  {{args.wait}}  " with wait: "false" -> undefined
		const resTemplatedFalse = getPausedGateDetails(
			makeRun("  {{args.wait}}  ", { wait: "false" }),
		);
		assert.equal(resTemplatedFalse?.gate, undefined);

		// gate: "Verify {{args.env}} cluster" -> interpolated string
		const resEmbedded = getPausedGateDetails(
			makeRun("Verify {{args.env}} cluster", { env: "prod" }),
		);
		assert.equal(resEmbedded?.gate, "Verify prod cluster");
	});
});
