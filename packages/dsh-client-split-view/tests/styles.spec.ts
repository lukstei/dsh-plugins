import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { registerSplitStyles, SPLIT_VIEW_CSS } from "../src/client/styles.ts";

interface MockStyleElement {
	textContent: string;
	setAttribute: (k: string, v: string) => void;
	remove: () => void;
}

// Flattened so declarations are asserted on their content, not on line wrapping.
const ruleBody = (selector: string): string => {
	const match = new RegExp(`${selector}\\s*\\{([^}]+)\\}`).exec(SPLIT_VIEW_CSS);
	if (match === null) throw new Error(`missing rule: ${selector}`);
	return match[1].replace(/\s+/g, " ");
};

describe("registerSplitStyles", () => {
	it("reserves the strip the title chip bleeds into and expands title space", () => {
		const crumbs = ruleBody("\\.dsh-split-crumbs");
		expect(crumbs).toContain("padding-inline: 6px");
		expect(crumbs).toContain("margin-inline: -6px");

		const lastSeg = ruleBody("\\.dsh-split-crumb-seg:last-child");
		expect(lastSeg).toContain("overflow: visible");
		expect(lastSeg).toContain("flex: 1 1 auto");
		expect(lastSeg).toContain("max-width: 100%");

		const current = ruleBody("\\.dsh-split-crumb\\.is-current");
		expect(current).toContain("padding-inline: 6px");
		expect(current).toContain("margin-inline: -6px");
		expect(current).toContain("max-width: 100%");
	});

	it("recolours the send button in subagent panes", () => {
		const body = ruleBody("\\.dsh-split-pane-wrapper\\.is-subagent");
		expect(body).toContain(
			"--dsw-alias-button-info-fill: var(--dsw-alias-state-warn-primary)",
		);
		expect(body).toContain(
			"--dsw-alias-button-info-hover: var(--dsw-alias-state-warn-secondary)",
		);
	});

	it("chips the pane title while its sidebar row is hovered", () => {
		const body = ruleBody(
			"\\.dsh-split-pane-wrapper\\.is-hovered \\.dsh-split-crumb\\.is-current",
		);
		expect(body).toContain("background: var(--dsw-alias-interactive-bg-hover)");
		expect(body).toContain("color: var(--dsw-alias-label-primary)");
		expect(body).toContain("padding-block: 2px");
		expect(body).toContain("margin-block: -2px");
		// edge case: hover must not bring back the whole-pane ring, only the title chip.
		expect(body).not.toMatch(/box-shadow/);
	});

	it("contains hover actions in the flexible title area", () => {
		const actionRules = [
			...SPLIT_VIEW_CSS.matchAll(/\.dsh-split-header-actions\s*\{([^}]+)\}/g),
		]
			.map((match) => match[1])
			.join("\n");
		expect(actionRules).toContain("position: absolute");
		expect(actionRules).toContain("inset-inline-end: 0");
		expect(actionRules).toContain("gap: 2px");
		expect(actionRules).toContain("height: 28px");
		expect(SPLIT_VIEW_CSS).toMatch(
			/\.dsh-split-pane-header\s*\{[^}]*min-height: 40px;\s*height: 40px/,
		);
		expect(SPLIT_VIEW_CSS).toMatch(
			/\.dsh-split-header-actions button\s*\{\s*width: 28px !important;\s*height: 28px !important/,
		);
		expect(SPLIT_VIEW_CSS).toMatch(
			/\.dsh-split-pane-close\s*\{\s*margin-inline-start: 4px;\s*\}/,
		);
		expect(SPLIT_VIEW_CSS).toMatch(
			/\.dsh-split-header-left\s*\{[^}]*min-height: 28px/,
		);
		expect(SPLIT_VIEW_CSS).toMatch(
			/\.dsh-split-header-left\s*\{[^}]*position: relative/,
		);
		expect(SPLIT_VIEW_CSS).toMatch(
			/\.dsh-split-header-left\s*\{[^}]*align-items: center/,
		);
	});
	it("registers style tag with layout rules constraining conversation content and scroll", () => {
		let attachedStyle: MockStyleElement | null = null;

		const documentMock = {
			createElement: (tag: string) => {
				if (tag === "style") {
					attachedStyle = {
						textContent: "",
						setAttribute: vi.fn(),
						remove: vi.fn(),
					};
					return attachedStyle;
				}
				return {};
			},
			head: {
				appendChild: (el: unknown) => el,
			},
		};

		vi.stubGlobal("document", documentMock);

		const cleanup = registerSplitStyles({} as Context, "test-plugin");
		const style = attachedStyle as MockStyleElement | null;
		expect(style).not.toBeNull();
		if (style) {
			expect(style.textContent).toContain(
				".dsh-split-pane-body > [data-conversation-content]",
			);
			expect(style.textContent).toContain(
				".dsh-split-pane-body > [data-conversation-content] > [data-conversation-scroll]",
			);
			expect(style.textContent).toContain("height: 100%");
			expect(style.textContent).toContain("overflow-x: hidden");
			expect(style.textContent).toContain(
				"--dsh-chat-content-width: min(100%, 860px)",
			);
			expect(style.textContent).toContain(
				'.dsh-split-pane-body [data-conversation-scroll] :is([class*="_scroll"], :has(> [data-chat-flow]))',
			);
			expect(style.textContent).toContain("padding: 16px 12px");
			expect(style.textContent).toContain(
				'.dsh-split-pane-body [data-conversation-content] :is([class*="md-table-wide"], .md-table-wide)',
			);
			expect(style.textContent).toContain("width: 100% !important");
			expect(style.textContent).toContain("margin-left: 0 !important");
			expect(style.textContent).toContain(".dsh-split-file-markdown");
			expect(style.textContent).toContain(".dsh-split-file-code");
			expect(style.textContent).toContain("max-width: 860px");
			expect(style.textContent).toContain(".dsh-split-subagent-pill.is-active");
			expect(style.textContent).toContain(".dsh-split-subagent-menu-item");
			expect(style.textContent).toContain(".dsh-split-overlay-tab-path");
			expect(style.textContent).toContain("user-select: text");
			expect(style.textContent).toContain("max-width: 85px");
			expect(style.textContent).toContain(
				".dsh-split-pane-body:has(.dsh-split-overlay-view) > [data-conversation-content] > [data-conversation-scroll]",
			);
			expect(style.textContent).toContain(
				".dsh-split-pane-body:has(.dsh-split-file) [data-composer-seat]",
			);
			expect(style.textContent).not.toContain(
				".dsh-split-pane-body:has(.dsh-split-overlay-view) [data-composer-seat]",
			);
			expect(style.textContent).toContain(
				"color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent)",
			);
			expect(style.textContent).toContain(
				'.dsh-split-pane-header[draggable="true"]',
			);
			expect(style.textContent).toContain(
				".dsh-split-pane-wrapper.is-drag-over",
			);
			expect(style.textContent).toContain(
				".dsh-split-shell.is-dragging .dsh-split-pane-body",
			);
			expect(style.textContent).toContain("pointer-events: none");
			expect(style.textContent).toContain(
				"[data-sidebar-drawer] [data-global-panel]:has(.dsh-split-shell)",
			);
			expect(style.textContent).toContain("padding-top: 0 !important");
			expect(style.textContent).toContain(
				"[data-sidebar-drawer] .dsh-split-pane-header",
			);
			expect(style.textContent).toContain("height: 50px !important");
			expect(style.textContent).toContain("min-height: 50px !important");
			expect(style.textContent).toContain(
				"padding-inline-start: max(48px, var(--dsh-frame-leading-clearance, 48px)) !important",
			);

			cleanup();
			expect(style.remove).toHaveBeenCalled();
		}

		vi.unstubAllGlobals();
	});
});
