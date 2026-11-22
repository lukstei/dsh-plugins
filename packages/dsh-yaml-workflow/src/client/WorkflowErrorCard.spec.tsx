/**
 * PURPOSE: Unit tests for WorkflowErrorCard component and command resolution helper.
 * ALLOWED: In-memory tests, assertion checks.
 */

import assert from "node:assert/strict";
import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
// @ts-expect-error react-dom lacks bundled type declarations in devDependencies
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
	resolveErrorCommand,
	WorkflowErrorCard,
	type WorkflowErrorChatData,
} from "./WorkflowErrorCard.tsx";

function createErrorNode(
	overrides?: Partial<WorkflowErrorChatData>,
): ChatNode<"wf-error"> {
	return {
		key: "error-node-1",
		kind: "wf-error",
		id: "cmd-1",
		target: "chat",
		anchorSeq: 1,
		location: { kind: "unresolved" },
		visibility: "visible",
		data: {
			name: "wf",
			args: " impl ",
			text: "Argument error in workflow 'impl': Missing required argument 'instructions'",
			...overrides,
		},
	};
}

describe("resolveErrorCommand", () => {
	it("reconstructs command with trimmed arguments", () => {
		assert.equal(
			resolveErrorCommand({ name: "wf", args: " deploy.yaml env=prod " }),
			"/wf deploy.yaml env=prod",
		);
	});

	it("defaults to /wf when command name is omitted", () => {
		assert.equal(resolveErrorCommand({ args: "test.yaml" }), "/wf test.yaml");
	});

	it("omits argument suffix when args is null, empty, or whitespace", () => {
		assert.equal(resolveErrorCommand({ name: "wf", args: null }), "/wf");
		assert.equal(resolveErrorCommand({ name: "wf", args: "" }), "/wf");
		assert.equal(resolveErrorCommand({ name: "wf", args: "   " }), "/wf");
	});

	it("preserves custom command names", () => {
		assert.equal(
			resolveErrorCommand({ name: "wf-resume", args: "proceed" }),
			"/wf-resume proceed",
		);
		assert.equal(
			resolveErrorCommand({ name: "wf-abort", args: null }),
			"/wf-abort",
		);
	});
});

describe("WorkflowErrorCard", () => {
	it("renders error card with command badge, args, error message, and copy button", () => {
		const node = createErrorNode();
		const html = renderToStaticMarkup(<WorkflowErrorCard node={node} />);

		assert.ok(html.includes("dsh-wf-card"));
		assert.ok(html.includes('data-state="aborted"'));
		assert.ok(html.includes("/wf"));
		assert.ok(html.includes("impl"));
		assert.ok(html.includes("dsh-wf-copy-btn"));
		assert.ok(html.includes('title="Copy command"'));
		assert.ok(html.includes('aria-label="Copy command"'));
		assert.ok(
			html.includes("Argument error in workflow") &&
				html.includes("Missing required argument"),
		);
	});

	it("renders error card without args when args is null", () => {
		const node = createErrorNode({
			args: null,
			text: "Usage: /wf <workflow.yaml>",
		});
		const html = renderToStaticMarkup(<WorkflowErrorCard node={node} />);

		assert.ok(html.includes("dsh-wf-card"));
		assert.ok(html.includes("dsh-wf-copy-btn"));
		assert.ok(html.includes("/wf"));
	});

	it("renders custom command name badge when specified", () => {
		const node = createErrorNode({
			name: "wf-resume",
			args: "proceed",
			text: "No interrupted workflow found to resume",
		});
		const html = renderToStaticMarkup(<WorkflowErrorCard node={node} />);

		assert.ok(html.includes("/wf-resume"));
		assert.ok(html.includes("proceed"));
		assert.ok(html.includes("dsh-wf-copy-btn"));
	});
});
