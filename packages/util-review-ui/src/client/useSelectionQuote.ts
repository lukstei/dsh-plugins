import { type RefObject, useEffect, useState } from "react";

export interface FloatingQuoteState {
	text: string;
	lines?: string;
	top: number;
	left: number;
}

/**
 * Computes 1-based start and end line indices from .line elements intersecting the range.
 * @internal
 */
export function getSelectedLineSpan(
	container: HTMLElement,
	range: Range,
): { min: number; max: number } | null {
	const lineElements = container.querySelectorAll<HTMLElement>(".line");
	if (lineElements.length === 0) return null;

	let min = -1;
	let max = -1;
	const doc = container.ownerDocument;
	const part = doc.createRange();

	for (let i = 0; i < lineElements.length; i++) {
		const line = lineElements[i];
		if (!range.intersectsNode(line)) {
			if (min !== -1) break; // .line elements are sequential DOM siblings
			continue;
		}

		const isStart = line.contains(range.startContainer);
		const isEnd = line.contains(range.endContainer);

		if (!isStart && !isEnd) {
			// Intermediate line strictly spanned by selection
			if (min === -1) min = i;
			max = i;
			continue;
		}

		part.selectNodeContents(line);
		if (isStart) {
			part.setStart(range.startContainer, range.startOffset);
		}
		if (isEnd) {
			part.setEnd(range.endContainer, range.endOffset);
		}

		if (!part.collapsed && part.toString() !== "") {
			if (min === -1) min = i;
			max = i;
		}
	}

	return min === -1 ? null : { min: min + 1, max: max + 1 };
}

export function useSelectionQuote({
	containerRef,
	enabled,
}: {
	containerRef: RefObject<HTMLElement | null>;
	enabled: boolean;
}): {
	floatingQuote: FloatingQuoteState | null;
	clearFloatingQuote: () => void;
} {
	const [floatingQuote, setFloatingQuote] = useState<FloatingQuoteState | null>(
		null,
	);

	useEffect(() => {
		if (!enabled) {
			setFloatingQuote(null);
			return;
		}

		const update = () => {
			const container = containerRef.current;
			if (!container) {
				setFloatingQuote(null);
				return;
			}
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
				setFloatingQuote(null);
				return;
			}
			const range = sel.getRangeAt(0);
			if (!container.contains(range.commonAncestorContainer)) {
				setFloatingQuote(null);
				return;
			}
			const text = sel.toString().trim();
			if (!text) {
				setFloatingQuote(null);
				return;
			}

			const rect = range.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();

			let lines: string | undefined;
			const span = getSelectedLineSpan(container, range);
			if (span !== null) {
				lines =
					span.min === span.max ? String(span.min) : `${span.min}–${span.max}`;
			}

			const top = Math.max(0, rect.top - containerRect.top - 32);
			const left = Math.max(
				8,
				Math.min(
					containerRect.width - 70,
					rect.left - containerRect.left + rect.width / 2 - 30,
				),
			);
			setFloatingQuote({ text, lines, top, left });
		};

		document.addEventListener("selectionchange", update);
		return () => {
			document.removeEventListener("selectionchange", update);
			setFloatingQuote(null);
		};
	}, [enabled, containerRef]);

	const clearFloatingQuote = () => {
		setFloatingQuote(null);
		window.getSelection()?.removeAllRanges();
	};

	return { floatingQuote, clearFloatingQuote };
}
