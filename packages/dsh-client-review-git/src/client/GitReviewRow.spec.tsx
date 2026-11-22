// @vitest-environment happy-dom
import assert from "node:assert/strict";
import type { ComponentProps, ComponentType } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { GitReviewRow } from "./GitReviewRow.tsx";

const Component = GitReviewRow as unknown as ComponentType<
	Record<string, unknown>
>;

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
	DisclosureRow: ({
		title,
		collapsedContent,
		children,
	}: {
		title: string;
		collapsedContent?: React.ReactNode;
		children?: React.ReactNode;
	}) => (
		<div data-disclosure-row>
			<span>{title}</span>
			{collapsedContent}
			{children}
		</div>
	),
	IconBranchOutlineRegular: () => <svg aria-hidden="true" />,
	IconCopyOutlineRegular: () => <svg aria-hidden="true" />,
	IconCheckOutlineRegular: () => <svg aria-hidden="true" />,
	useClipboardCopy: () => ({ copied: false, onCopy: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(() => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

test("renders preparing state", async () => {
	await act(async () => {
		root.render(
			<Component
				phase="preparing"
				callId="call-prep"
				toolName="git_review_present"
			/>,
		);
	});
	assert(container.querySelector('[data-state="preparing"]'));
	assert.match(container.textContent ?? "", /Git Review/);
});

test("renders started call with target label", async () => {
	const block = {
		callId: "call-1",
		argsRaw: JSON.stringify({
			branch: "feature/row-test",
			commit: "1234567890abcdef",
		}),
	};
	await act(async () => {
		root.render(
			<Component
				phase="start"
				callId="call-1"
				toolName="git_review_present"
				block={block}
			/>,
		);
	});
	assert(container.querySelector('[data-state="running"]'));
	assert.match(container.textContent ?? "", /feature\/row-test/);
	assert.match(container.textContent ?? "", /1234567/);
});

test("renders settled call content", async () => {
	const block = {
		kind: "result" as const,
		callId: "call-2",
		call: {
			callId: "call-2",
			name: "git_review_present",
			argsRaw: JSON.stringify({ branch: "main" }),
		},
		content: [{ type: "text" as const, text: "Git review ready: main" }],
		isError: false,
	};
	await act(async () => {
		root.render(
			<Component
				phase="result"
				callId="call-2"
				toolName="git_review_present"
				block={block}
			/>,
		);
	});
	assert(container.querySelector('[data-state="ok"]'));
	assert.match(container.textContent ?? "", /main/);
	assert.match(container.textContent ?? "", /Git review ready: main/);
});
