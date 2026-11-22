import type { PropsRenderFactories } from "@deepseek-ai/dsh-client-ui-slots";
// @ts-expect-error react-dom lacks bundled type declarations in devDependencies
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { WorkflowMarkdown } from "./WorkflowMarkdown.tsx";

test("renders markdown content through shared reasoning factory", () => {
	const renderFactorySlot = vi.fn((_name: string, _props: object) => (
		<span data-markdown="" />
	)) satisfies PropsRenderFactories["renderFactorySlot"];

	const html = renderToStaticMarkup(
		<WorkflowMarkdown
			text="Hello **world**"
			className="test-class"
			renderFactorySlot={renderFactorySlot}
		/>,
	);

	expect(html).toBe(
		'<div class="test-class"><span data-markdown=""></span></div>',
	);
	expect(renderFactorySlot).toHaveBeenCalledWith(
		"conversation.chat.reasoning.content",
		{
			text: "Hello **world**",
			running: false,
		},
	);
});
