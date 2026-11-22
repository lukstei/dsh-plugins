import type { InputActions } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { writeClipboard } from "@deepseek-ai/dsh-client-ui-primitives";
import type { CodeQuotePayload } from "./CodeFileView.tsx";

export interface FormattedQuote {
	chipText: string;
	markdownText: string;
}

/**
 * Formats a code quote payload ensuring file name, line numbers, and quoted text
 * are consistently present.
 */
export function formatQuoteContent(quote: CodeQuotePayload): FormattedQuote {
	const header = quote.lines
		? `**${quote.path}:${quote.lines}**`
		: `**${quote.path}**`;
	const normalized = quote.text.replace(/\r?\n$/, "");
	const chipText = `${header}\n${quote.text}`;
	const markdownText = `> ${header}\n${normalized
		.split("\n")
		.map((l) => `> ${l}`)
		.join("\n")}\n\n`;

	return { chipText, markdownText };
}

/**
 * Inserts a formatted quote into the conversation composer or falls back to
 * clipboard copy.
 */
export function quoteToComposer(
	quote: CodeQuotePayload,
	inputActions?: Pick<
		InputActions,
		"insertQuote" | "insertText" | "captureInsertion" | "persistDraft"
	>,
): void {
	const { chipText, markdownText } = formatQuoteContent(quote);

	let inserted = false;
	if (inputActions) {
		try {
			inserted = Boolean(inputActions.insertQuote(chipText));
			if (inserted) {
				inputActions.persistDraft();
			}
		} catch {
			inserted = false;
		}

		if (!inserted) {
			try {
				const span = inputActions.captureInsertion();
				const ok = Boolean(
					inputActions.insertText(markdownText, {
						...span,
						start: span.end,
					}),
				);
				if (ok) {
					inputActions.persistDraft();
					inserted = true;
				}
			} catch {
				inserted = false;
			}
		}
	}

	if (!inserted) {
		void writeClipboard(markdownText);
	}
}
