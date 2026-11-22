// @vitest-environment happy-dom
import assert from "node:assert/strict";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSelectedLineSpan, useSelectionQuote } from "./useSelectionQuote.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("getSelectedLineSpan", () => {
	let container: HTMLDivElement;
	let line1: HTMLSpanElement;
	let line2: HTMLSpanElement;
	let line3: HTMLSpanElement;

	beforeEach(() => {
		container = document.createElement("div");
		line1 = document.createElement("span");
		line1.className = "line";
		line1.textContent = "first line";

		line2 = document.createElement("span");
		line2.className = "line";
		line2.textContent = "second line";

		line3 = document.createElement("span");
		line3.className = "line";
		line3.textContent = "third line";

		container.append(line1, line2, line3);
		document.body.append(container);
	});

	afterEach(() => {
		container.remove();
	});

	it("returns 1-based single line span for selection within one line", () => {
		assert(line2.firstChild);
		const range = document.createRange();
		range.setStart(line2.firstChild, 2);
		range.setEnd(line2.firstChild, 6);

		const span = getSelectedLineSpan(container, range);
		expect(span).toEqual({ min: 2, max: 2 });
	});

	it("returns multi-line span for selection across several lines", () => {
		assert(line1.firstChild);
		assert(line3.firstChild);
		const range = document.createRange();
		range.setStart(line1.firstChild, 3);
		range.setEnd(line3.firstChild, 4);

		const span = getSelectedLineSpan(container, range);
		expect(span).toEqual({ min: 1, max: 3 });
	});

	it("excludes a boundary line when selection ends at offset 0 of that line", () => {
		assert(line1.firstChild);
		assert(line3.firstChild);
		const range = document.createRange();
		range.setStart(line1.firstChild, 0);
		range.setEnd(line3.firstChild, 0);

		const span = getSelectedLineSpan(container, range);
		expect(span).toEqual({ min: 1, max: 2 });
	});

	it("excludes an empty boundary line when selection ends at offset 0 of that line", () => {
		line3.textContent = "";
		assert(line1.firstChild);
		const range = document.createRange();
		range.setStart(line1.firstChild, 0);
		range.setEnd(line3, 0);

		const span = getSelectedLineSpan(container, range);
		expect(span).toEqual({ min: 1, max: 2 });
	});

	it("excludes a boundary line when selection starts at text length of that line", () => {
		assert(line1.firstChild);
		assert(line3.firstChild);
		const range = document.createRange();
		range.setStart(line1.firstChild, (line1.textContent ?? "").length);
		range.setEnd(line3.firstChild, 4);

		const span = getSelectedLineSpan(container, range);
		expect(span).toEqual({ min: 2, max: 3 });
	});

	it("includes empty lines intersected by range", () => {
		line2.textContent = "";
		assert(line1.firstChild);
		assert(line3.firstChild);
		const range = document.createRange();
		range.setStart(line1.firstChild, 0);
		range.setEnd(line3.firstChild, 4);

		const span = getSelectedLineSpan(container, range);
		expect(span).toEqual({ min: 1, max: 3 });
	});

	it("returns null if container has no .line elements", () => {
		const emptyContainer = document.createElement("div");
		assert(line1.firstChild);
		const range = document.createRange();
		range.setStart(line1.firstChild, 0);
		range.setEnd(line1.firstChild, 2);

		const span = getSelectedLineSpan(emptyContainer, range);
		expect(span).toBeNull();
	});
});

describe("useSelectionQuote", () => {
	let host: HTMLDivElement;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.append(host);
	});

	afterEach(() => {
		host.remove();
		window.getSelection()?.removeAllRanges();
	});

	function HookTestComponent({ enabled }: { enabled: boolean }) {
		const containerRef = useRef<HTMLDivElement>(null);
		const { floatingQuote, clearFloatingQuote } = useSelectionQuote({
			containerRef,
			enabled,
		});

		return (
			<div ref={containerRef} data-testid="container">
				<span className="line">some sample text</span>
				<div data-testid="quote-state">
					{floatingQuote ? JSON.stringify(floatingQuote) : "null"}
				</div>
				<button
					type="button"
					data-testid="clear-btn"
					onClick={clearFloatingQuote}
				>
					Clear
				</button>
			</div>
		);
	}

	it("updates floating quote when valid selection exists inside container", async () => {
		const root = createRoot(host);
		await act(async () => {
			root.render(<HookTestComponent enabled={true} />);
		});

		const line = host.querySelector(".line");
		assert(line?.firstChild);

		const sel = window.getSelection();
		assert(sel);
		const range = document.createRange();
		range.setStart(line.firstChild, 0);
		range.setEnd(line.firstChild, 11);
		sel.removeAllRanges();
		sel.addRange(range);

		await act(async () => {
			document.dispatchEvent(new Event("selectionchange"));
		});

		const stateEl = host.querySelector('[data-testid="quote-state"]');
		assert(stateEl);
		assert(stateEl.textContent !== "null");
		const parsed = JSON.parse(stateEl.textContent ?? "{}");
		expect(parsed.text).toBe("some sample");
		expect(parsed.lines).toBe("1");
	});

	it("clears floating quote on selection collapse or clear", async () => {
		const root = createRoot(host);
		await act(async () => {
			root.render(<HookTestComponent enabled={true} />);
		});

		const line = host.querySelector(".line");
		assert(line?.firstChild);

		const sel = window.getSelection();
		assert(sel);
		const range = document.createRange();
		range.setStart(line.firstChild, 0);
		range.setEnd(line.firstChild, 4);
		sel.removeAllRanges();
		sel.addRange(range);

		await act(async () => {
			document.dispatchEvent(new Event("selectionchange"));
		});

		const stateEl = host.querySelector('[data-testid="quote-state"]');
		assert(stateEl?.textContent?.includes("some"));

		// Collapse selection
		sel.removeAllRanges();
		await act(async () => {
			document.dispatchEvent(new Event("selectionchange"));
		});

		assert(stateEl);
		expect(stateEl.textContent).toBe("null");
	});

	it("clears floating quote when enabled becomes false", async () => {
		const root = createRoot(host);
		await act(async () => {
			root.render(<HookTestComponent enabled={true} />);
		});

		const line = host.querySelector(".line");
		assert(line?.firstChild);

		const sel = window.getSelection();
		assert(sel);
		const range = document.createRange();
		range.setStart(line.firstChild, 0);
		range.setEnd(line.firstChild, 4);
		sel.removeAllRanges();
		sel.addRange(range);

		await act(async () => {
			document.dispatchEvent(new Event("selectionchange"));
		});

		const stateEl = host.querySelector('[data-testid="quote-state"]');
		assert(stateEl?.textContent?.includes("some"));

		// Toggle enabled to false
		await act(async () => {
			root.render(<HookTestComponent enabled={false} />);
		});

		assert(stateEl);
		expect(stateEl.textContent).toBe("null");
	});
});
