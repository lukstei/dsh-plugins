// @vitest-environment happy-dom
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewCard } from "./ReviewCard.tsx";

const mockOnCopy = vi.fn();
let mockCopied = false;

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	IconBranchOutlineRegular: () => <svg data-testid="branch-icon" />,
	IconCopyOutlineRegular: () => <svg data-testid="copy-icon" />,
	IconCheckOutlineRegular: () => <svg data-testid="check-icon" />,
	useClipboardCopy: () => ({
		copied: mockCopied,
		onCopy: mockOnCopy,
	}),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ReviewCard", () => {
	let container: HTMLDivElement;

	beforeEach(() => {
		mockCopied = false;
		mockOnCopy.mockClear();
		container = document.createElement("div");
		document.body.append(container);
	});

	afterEach(() => {
		container.remove();
	});

	it("renders branch title, description, and branch icon", async () => {
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<ReviewCard
					title="docs/dsh-adapter-upgrade-playbook"
					description="All commits"
				/>,
			);
		});

		assert(
			container.textContent?.includes("docs/dsh-adapter-upgrade-playbook"),
		);
		assert(container.textContent?.includes("All commits"));
		assert(container.querySelector('[data-testid="branch-icon"]'));
		assert(container.querySelector('[data-testid="copy-icon"]'));
	});

	it("calls onOpen when the review card is clicked", async () => {
		const onOpen = vi.fn();
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<ReviewCard
					title="feature/auth"
					description="All commits"
					onOpen={onOpen}
				/>,
			);
		});

		const card = container.querySelector("[data-review-card]");
		assert(card);
		assert.equal(card.getAttribute("data-clickable"), "true");

		await act(async () => {
			card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("copies branch name and prevents onOpen when branch name is clicked", async () => {
		const onOpen = vi.fn();
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<ReviewCard
					title="feature/auth"
					description="All commits"
					onOpen={onOpen}
				/>,
			);
		});

		const branchBtn = container.querySelector("[data-branch-copy]");
		assert(branchBtn);

		await act(async () => {
			branchBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(mockOnCopy).toHaveBeenCalledTimes(1);
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("does not call onCopy if user was selecting text with mouse", async () => {
		const onOpen = vi.fn();
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<ReviewCard
					title="feature/auth"
					description="All commits"
					onOpen={onOpen}
				/>,
			);
		});

		const branchBtn = container.querySelector("[data-branch-copy]");
		assert(branchBtn);

		const selectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
			toString: () => "feature",
		} as unknown as Selection);

		await act(async () => {
			branchBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(mockOnCopy).not.toHaveBeenCalled();
		expect(onOpen).not.toHaveBeenCalled();
		selectionSpy.mockRestore();
	});

	it("supports keyboard navigation on card and copy button", async () => {
		const onOpen = vi.fn();
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<ReviewCard
					title="feature/auth"
					description="All commits"
					onOpen={onOpen}
				/>,
			);
		});

		const card = container.querySelector("[data-review-card]");
		assert(card);
		await act(async () => {
			card.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(onOpen).toHaveBeenCalledTimes(1);

		const branchBtn = container.querySelector("[data-branch-copy]");
		assert(branchBtn);
		await act(async () => {
			branchBtn.dispatchEvent(
				new KeyboardEvent("keydown", { key: " ", bubbles: true }),
			);
		});
		expect(mockOnCopy).toHaveBeenCalledTimes(1);
	});
});
