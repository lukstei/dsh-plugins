import { describe, expect, it } from "vitest";
import { KANBAN_CSS } from "../src/client/styles.ts";

// Flattened so declarations are asserted on their content, not on line wrapping;
// anchored to a line start so descendant selectors do not shadow the rule.
const rule = (selector: string): string => {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`).exec(
		KANBAN_CSS,
	);
	if (match === null) throw new Error(`missing rule: ${selector}`);
	return match[1].replace(/\s+/g, " ");
};

describe("in-flight session row geometry", () => {
	it("preserves native paint insets on hover and selection", () => {
		for (const selector of [
			".dsh-inflight-header-clickable:hover",
			".dsh-inflight-ws-header-row:hover",
			".dsh-inflight-card:hover",
			".dsh-inflight-card.is-current",
		]) {
			expect(rule(selector)).toContain(
				"background-color: var(--dsw-alias-interactive-bg-hover)",
			);
		}
		expect(rule(".dsh-inflight-card.is-focused")).toContain(
			"background-color: var(--dsw-alias-interactive-bg-active)",
		);
	});

	it("matches the native session row box", () => {
		const card = rule(".dsh-inflight-card");
		expect(card).toContain("height: 32px");
		expect(card).toContain("border-radius: var(--dsw-radius-md)");
		expect(card).toContain("box-sizing: border-box");
		expect(card).toMatch(
			/border-inline: var\(--dsh-sidebar-paint-inset, 3px\) solid transparent/,
		);
		expect(card).toContain("background-clip: padding-box");
		expect(card).toContain("padding: 0 8px");
		expect(card).toMatch(
			/padding-inline-start: calc\(\s*var\(--dsh-sidebar-row-padding, 12px\) - var\(--dsh-sidebar-paint-inset, 3px\)\s*\)/,
		);
		expect(card).toContain("gap: 0");
	});

	it("keeps the native 6px slot-to-title gap on the content cell", () => {
		expect(rule(".dsh-inflight-card-content")).toContain(
			"margin-inline-start: var(--dsh-sidebar-label-gap, 6px)",
		);
		expect(rule(".dsh-inflight-card-time")).toContain(
			"margin-inline-end: -1px",
		);
	});

	it("keeps the 16x20 status slot on every row", () => {
		expect(rule(".dsh-inflight-card-slot")).toContain("width: 16px");
		expect(rule(".dsh-inflight-card-slot")).toContain("height: 20px");
		const toggle = rule(".dsh-inflight-btn-fullscreen-toggle");
		expect(toggle).toContain("width: 24px");
		expect(toggle).toContain("height: 24px");
		expect(toggle).toContain("margin: -4px");
		const toggleActive = rule(
			'.dsh-inflight-btn-fullscreen-toggle:is(.is-active, .is-pressed, [aria-pressed="true"])',
		);
		expect(toggleActive).toContain(
			"background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.08))",
		);
	});

	it("marks alerts without shifting row content", () => {
		const alert = rule(".dsh-inflight-card.is-alert");
		expect(alert).toContain(
			"border-inline-start-color: var(--dsw-alias-state-error-primary)",
		);
	});

	it("matches the native row action chip", () => {
		expect(rule(".dsh-inflight-card-actions")).toContain("gap: 13px");
		const action = rule(".dsh-inflight-btn-action");
		expect(action).toContain("width: 24px");
		expect(action).toContain("height: 24px");
		expect(action).toContain("margin: -4px");
		expect(action).toContain("border-radius: var(--dsw-radius-xs)");
	});

	it("keeps the native label gap after the title", () => {
		expect(rule(".dsh-inflight-card-title")).toContain(
			"margin-inline-end: var(--dsh-sidebar-label-gap, 6px)",
		);
	});
});

describe("in-flight sidebar header geometry", () => {
	it("restores the shell inset around the stable scrollbar", () => {
		const list = rule(".dsh-inflight-sidebar-list");
		expect(list).toContain("margin-inline-end: 2px");
		expect(list).toContain("width: calc(100% - 2px)");
		expect(list).toContain(
			"padding: 0 calc(var(--dsh-sidebar-inline-padding, 8px) - 5px - 2px) 16px 0",
		);
		const header = rule(".dsh-inflight-sidebar-header");
		expect(header).toContain(
			"width: calc(100% - var(--dsh-sidebar-inline-padding, 8px))",
		);
		expect(header).toContain("padding: 0 8px 0 0");
	});

	it("gives the section header the native panel-row box", () => {
		const header = rule(".dsh-inflight-header-clickable");
		expect(header).toMatch(
			/border-inline: var\(--dsh-sidebar-paint-inset, 3px\) solid transparent/,
		);
		expect(header).toContain("background-clip: padding-box");
		expect(header).toMatch(
			/padding: 7px calc\(\s*var\(--dsh-sidebar-row-padding, 12px\) - var\(--dsh-sidebar-paint-inset, 3px\)\s*\)/,
		);
		expect(header).toContain("gap: var(--dsh-sidebar-label-gap, 6px)");
		expect(rule(".dsh-inflight-sidebar-header")).toContain("margin: 0 0 4px");
	});

	it("gives the workspace header the native project-row box", () => {
		const row = rule(".dsh-inflight-ws-header-row");
		expect(row).toContain("height: 34px");
		expect(row).toMatch(
			/border-inline: var\(--dsh-sidebar-paint-inset, 3px\) solid transparent/,
		);
		expect(row).toContain("background-clip: padding-box");
		expect(row).toMatch(
			/padding-inline-start: calc\(\s*var\(--dsh-sidebar-row-padding, 12px\) - var\(--dsh-sidebar-paint-inset, 3px\)\s*\)/,
		);
	});

	it("sizes the header close chip like a native row icon button", () => {
		const close = rule(".dsh-inflight-btn-close");
		expect(close).toContain("width: 24px");
		expect(close).toContain("height: 24px");
		expect(close).toContain("margin: 0");
		expect(close).toContain("border-radius: var(--dsw-radius-xs)");
	});
});

describe("in-flight slot close affordance", () => {
	it("paints the native 24px compensated target for both slot buttons", () => {
		for (const selector of [
			".dsh-inflight-btn-slot-close",
			".dsh-inflight-btn-fullscreen-toggle",
		]) {
			const button = rule(selector);
			expect(button).toContain("width: 24px");
			expect(button).toContain("height: 24px");
			expect(button).toContain("margin: -4px");
			expect(button).toContain("border-radius: var(--dsw-radius-xs)");
			expect(KANBAN_CSS.replace(/\s+/g, " ")).toContain(
				`${selector}:hover, ${selector}:focus-visible {`,
			);
		}
	});

	it("swaps the status indicator for the close button on hover and focus", () => {
		const close = rule(".dsh-inflight-btn-slot-close");
		expect(close).toContain("display: none");
		expect(KANBAN_CSS).toMatch(
			/\.dsh-inflight-card\.has-slot-close:hover \.dsh-inflight-btn-slot-close,\s*\.dsh-inflight-card\.has-slot-close:focus-within \.dsh-inflight-btn-slot-close\s*\{[^}]*display: inline-flex/,
		);
		expect(KANBAN_CSS).toMatch(
			/\.dsh-inflight-card\.has-slot-close:hover \.dsh-inflight-card-slot-status,\s*\.dsh-inflight-card\.has-slot-close:focus-within \.dsh-inflight-card-slot-status\s*\{[^}]*display: none/,
		);
	});
});
