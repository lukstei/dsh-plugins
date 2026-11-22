import type { PropsRenderFactories } from "@deepseek-ai/dsh-client-ui-slots";
// @ts-expect-error react-dom lacks bundled type declarations in devDependencies
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { WorkflowMarkdownResult } from "./WorkflowMarkdownResult.tsx";

vi.mock("./WorkflowStyles.tsx", () => ({ WorkflowStyles: () => null }));

const cases = [
	{
		label: "validation success",
		node: {
			name: "wf-validate",
			args: " ./deploy.yaml env=staging",
			outcome: {
				kind: "success",
				text: "### Workflow Validation: `./deploy.yaml`\n- **Status:** Valid\n- **Steps:** 1\n  1. [print] Deploy",
			},
		},
	},
	{
		label: "validation diagnostics retain literal YAML and backticks",
		node: {
			name: "wf-validate",
			args: " ./broken.yaml",
			outcome: {
				kind: "error",
				text: "Failed to parse workflow './broken.yaml':\n  2 | - print: *bad\n    |          ^\n```\n<unexpected>",
			},
		},
	},
	{
		label: "missing target",
		node: {
			name: "wf-validate",
			args: "",
			outcome: {
				kind: "error",
				text: "Usage: /wf-validate <workflow.yaml> [key=value ...]",
			},
		},
	},
	{
		label: "workflow list including unnamed workflows and parameters",
		node: {
			name: "wf-list",
			args: "",
			outcome: {
				kind: "success",
				text: "### Local Workflows (.agents/wf)\n- **Deploy** (`deploy.yaml`): Deploy service\n  - `env` (choice, required): Target environment\n- `unnamed.yaml`\n\n### Common Workflows\n*(No workflows found)*",
			},
		},
	},
	{
		label: "empty workflow list",
		node: {
			name: "wf-list",
			args: null,
			outcome: {
				kind: "success",
				text: "### Local Workflows\n*(No workflows found)*",
			},
		},
	},
	{
		label: "workflow list failure",
		node: {
			name: "wf-list",
			args: "",
			outcome: {
				kind: "error",
				text: "Failed to list workflows: permission denied",
			},
		},
	},
	{
		label: "pending command",
		node: { name: "wf-validate", args: " ./deploy.yaml", outcome: null },
	},
] satisfies {
	label: string;
	node: Parameters<typeof WorkflowMarkdownResult>[0]["node"];
}[];

test.each(cases)("renders expanded Markdown result: $label", ({ node }) => {
	const renderFactorySlot = vi.fn((_name: string, _props: object) => (
		<div data-markdown="" />
	)) satisfies PropsRenderFactories["renderFactorySlot"];
	const html = renderToStaticMarkup(
		<WorkflowMarkdownResult
			node={node}
			renderFactorySlot={renderFactorySlot}
		/>,
	);

	expect({ html, markdown: renderFactorySlot.mock.calls }).toMatchSnapshot();
});
