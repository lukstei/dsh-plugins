import { writeClipboard } from "@deepseek-ai/dsh-client-ui-primitives";
import { describe, expect, it, vi } from "vitest";
import { formatQuoteContent, quoteToComposer } from "./quote.ts";

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	writeClipboard: vi.fn().mockResolvedValue(true),
}));

describe("formatQuoteContent", () => {
	it("includes explicit lines and path in header and chip text", () => {
		const formatted = formatQuoteContent({
			path: "src/utils.ts",
			lines: "14–20",
			text: "const a = 1;\nconst b = 2;",
		});

		expect(formatted.chipText).toBe(
			"**src/utils.ts:14–20**\nconst a = 1;\nconst b = 2;",
		);
		expect(formatted.markdownText).toBe(
			"> **src/utils.ts:14–20**\n> const a = 1;\n> const b = 2;\n\n",
		);
	});

	it("omits line label when lines is undefined without inventing lines", () => {
		const formatted = formatQuoteContent({
			path: "src/main.ts",
			text: "preventDefault();",
		});

		expect(formatted.chipText).toBe("**src/main.ts**\npreventDefault();");
		expect(formatted.markdownText).toBe(
			"> **src/main.ts**\n> preventDefault();\n\n",
		);
	});

	it("trims trailing newline from text to avoid trailing empty quote line", () => {
		const formatted = formatQuoteContent({
			path: "src/config.json",
			text: '{\n  "key": "value"\n}\n',
		});

		expect(formatted.markdownText).toBe(
			'> **src/config.json**\n> {\n>   "key": "value"\n> }\n\n',
		);
	});
});

describe("quoteToComposer", () => {
	it("inserts formatted quote containing path and lines via insertQuote", () => {
		const insertQuote = vi.fn().mockReturnValue(true);
		const persistDraft = vi.fn();
		const inputActions = {
			insertQuote,
			persistDraft,
			insertText: vi.fn(),
			captureInsertion: vi.fn(),
		};

		quoteToComposer(
			{
				path: "packages/app/index.ts",
				lines: "42",
				text: "console.log('hello');",
			},
			inputActions,
		);

		expect(insertQuote).toHaveBeenCalledWith(
			"**packages/app/index.ts:42**\nconsole.log('hello');",
		);
		expect(persistDraft).toHaveBeenCalledTimes(1);
	});

	it("falls back to insertText when insertQuote returns false", () => {
		const insertQuote = vi.fn().mockReturnValue(false);
		const insertText = vi.fn().mockReturnValue(true);
		const persistDraft = vi.fn();
		const captureInsertion = vi.fn().mockReturnValue({ start: 0, end: 0 });
		const inputActions = {
			insertQuote,
			insertText,
			captureInsertion,
			persistDraft,
		};

		quoteToComposer(
			{
				path: "packages/app/index.ts",
				lines: "10",
				text: "return false;",
			},
			inputActions,
		);

		expect(insertText).toHaveBeenCalledWith(
			"> **packages/app/index.ts:10**\n> return false;\n\n",
			{ start: 0, end: 0 },
		);
		expect(persistDraft).toHaveBeenCalledTimes(1);
	});

	it("falls back to writeClipboard when insertText returns false", () => {
		const insertQuote = vi.fn().mockReturnValue(false);
		const insertText = vi.fn().mockReturnValue(false);
		const persistDraft = vi.fn();
		const captureInsertion = vi.fn().mockReturnValue({ start: 0, end: 0 });
		const inputActions = {
			insertQuote,
			insertText,
			captureInsertion,
			persistDraft,
		};

		quoteToComposer(
			{
				path: "packages/app/index.ts",
				lines: "10",
				text: "fallback to clipboard;",
			},
			inputActions,
		);

		expect(writeClipboard).toHaveBeenCalledWith(
			"> **packages/app/index.ts:10**\n> fallback to clipboard;\n\n",
		);
		expect(persistDraft).not.toHaveBeenCalled();
	});
});
