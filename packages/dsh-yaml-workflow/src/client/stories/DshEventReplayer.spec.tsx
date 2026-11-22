import assert from "node:assert/strict";
// @ts-expect-error react-dom lacks bundled type declarations in devDependencies
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { WORKFLOW_EVENT_NAME } from "../../fold.ts";
import { AllVariants } from "../WorkflowIntegration.stories.tsx";
import { DshEventReplayer } from "./DshEventReplayer.tsx";

test("renders the existing success and failure integration stories", () => {
	const html = renderToStaticMarkup(<AllVariants />);
	assert.match(html, /deploy.yml --env=production/);
	assert.match(html, /test-and-publish.yml/);
});

test.each([
	{ args: "{", error: SyntaxError },
	{ args: "null", error: TypeError },
])("surfaces invalid fixture payload $args", ({ args, error }) => {
	assert.throws(
		() =>
			renderToStaticMarkup(
				<DshEventReplayer
					events={[
						{ type: "command/run", data: { name: WORKFLOW_EVENT_NAME, args } },
					]}
					autoPlay={false}
				/>,
			),
		error,
	);
});

test("ignores unrelated commands without parsing their arguments", () => {
	assert.doesNotThrow(() =>
		renderToStaticMarkup(
			<DshEventReplayer
				events={[
					{ type: "command/run", data: { name: "other-command", args: "{" } },
				]}
				autoPlay={false}
			/>,
		),
	);
});
