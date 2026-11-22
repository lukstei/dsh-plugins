/** Styles for DSH Split View plugin. */
import type { Context as ClientContext } from "@deepseek-ai/cordis";

export const SPLIT_VIEW_CSS = `
.dsh-split-shell,
.dsh-split-shell {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}

.dsh-split-col,
.dsh-split-col {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dsh-split-col:not(:last-child)::after,
.dsh-split-col:not(:last-child)::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: 0.5px;
  background: linear-gradient(to bottom, transparent, var(--dsw-alias-border-l3) 24px);
  pointer-events: none;
}

.dsh-split-pane-wrapper,
.dsh-split-pane-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}

/* Subagent panes recolour the composer's send button (info-fill tokens) so it is obvious
 * you are messaging a subagent, not the main session. */
.dsh-split-pane-wrapper.is-subagent {
  --dsw-alias-button-info-fill: var(--dsw-alias-state-warn-primary);
  --dsw-alias-button-info-hover: var(--dsw-alias-state-warn-secondary);
}

.dsh-split-pane-header,
.dsh-split-pane-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  height: 40px;
  padding: 0 12px;
  padding-inline-start: max(12px, var(--dsh-frame-leading-clearance, 0px));
  background: transparent;
  flex-shrink: 0;
  box-sizing: border-box;
  user-select: none;
}

[data-sidebar-drawer] .dsh-split-pane-header,
[data-sidebar-drawer] .dsh-split-pane-header {
  height: 50px !important;
  min-height: 50px !important;
  padding-inline-start: max(48px, var(--dsh-frame-leading-clearance, 48px)) !important;
}

.dsh-split-pane-header[draggable="true"],
.dsh-split-pane-header[draggable="true"] {
  cursor: grab;
}

.dsh-split-pane-header[draggable="true"]:active,
.dsh-split-pane-header[draggable="true"]:active {
  cursor: grabbing;
}

.dsh-split-pane-wrapper.is-drag-over,
.dsh-split-pane-wrapper.is-drag-over {
  box-shadow: inset 0 0 0 2px var(--dsw-alias-state-business-primary);
}

.dsh-split-shell.is-dragging .dsh-split-pane-body,
.dsh-split-shell.is-dragging .dsh-split-pane-body {
  pointer-events: none;
}

@media (hover: hover) {
  .dsh-split-header-actions,
  .dsh-split-header-actions {
    position: absolute;
    inset-inline-end: 0;
    background: var(--dsw-alias-bg-base);
    box-shadow: -8px 0 8px var(--dsw-alias-bg-base);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
  }

  .dsh-split-pane-header:is(:hover, :focus-within) .dsh-split-header-actions,
  .dsh-split-pane-header:is(:hover, :focus-within) .dsh-split-header-actions,
  .dsh-split-header-actions:has(.is-pressed),
  .dsh-split-header-actions:has(.is-pressed) {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-split-header-actions,
  .dsh-split-header-actions {
    transition: none;
  }
}

.dsh-split-header-left,
.dsh-split-header-left {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: 20px;
}

.dsh-split-pane-status,
.dsh-split-pane-status {
  display: inline-block;
  width: 6px;
  flex: none;
}

/* The current crumb's chip overhangs its box by the chip padding; the reserved strip
 * keeps that bleed inside the clip rect without moving the breadcrumb. */
.dsh-split-crumbs,
.dsh-split-crumbs {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  padding-inline: 6px;
  margin-inline: -6px;
  white-space: nowrap;
}

.dsh-split-crumb-seg,
.dsh-split-crumb-seg {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 0 1 auto;
  max-width: max-content;
  overflow: hidden;
}

.dsh-split-crumb-seg:last-child,
.dsh-split-crumb-seg:last-child {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: visible;
}

.dsh-split-crumb-sep,
.dsh-split-crumb-sep {
  flex: none;
  color: var(--dsw-alias-label-caption);
}

.dsh-split-crumb,
.dsh-split-crumb {
  display: inline-block;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border-radius: var(--dsw-radius-md);
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  transition: color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease),
    background-color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}

.dsh-split-crumb.is-current,
.dsh-split-crumb.is-current {
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
  /* Compensated so the chip is padded on both sides while the title keeps its place;
   * the nav reserves the strip the overhang bleeds into. */
  padding-inline: 6px;
  margin-inline: -6px;
  min-width: 0;
  max-width: 100%;
}

.dsh-split-crumbs > .dsh-split-crumb.is-current,
.dsh-split-crumbs > .dsh-split-crumb.is-current {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
}

.dsh-split-pane-header.is-focused .dsh-split-crumb.is-current,
.dsh-split-pane-header.is-focused .dsh-split-crumb.is-current {
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

/* Block-only compensation: the chip grows vertically on hover, leaving the reserved
 * horizontal metrics untouched. */
.dsh-split-pane-wrapper.is-hovered .dsh-split-crumb.is-current {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  padding-block: 2px;
  margin-block: -2px;
}

.dsh-split-subagent-pill,
.dsh-split-subagent-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 140px;
  padding: 0 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

.dsh-split-subagent-pill:hover,
.dsh-split-subagent-pill:hover,
.dsh-split-subagent-pill.is-active,
.dsh-split-subagent-pill.is-active {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-split-subagent-text,
.dsh-split-subagent-text {
  min-width: 0;
  max-width: 85px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-split-subagent-menu-item,
.dsh-split-subagent-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.dsh-split-subagent-menu-title,
.dsh-split-subagent-menu-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.dsh-split-subagent-menu-status,
.dsh-split-subagent-menu-status {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
  flex-shrink: 0;
}

.dsh-split-crumb.is-subagent,
.dsh-split-crumb.is-subagent {
  font-size: 12px;
  line-height: 18px;
}

.dsh-split-pane-body,
.dsh-split-pane-body {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.dsh-split-pane-body[data-phase="active"]:has([data-chat-flow])::before,
.dsh-split-pane-body[data-phase="active"]:has([data-chat-flow])::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 12px;
  z-index: 10;
  background: linear-gradient(to bottom, var(--dsw-alias-bg-base), transparent);
  pointer-events: none;
}

.dsh-split-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: 28px;
}

.dsh-split-icon-btn,
.dsh-split-header-actions button {
  width: 28px !important;
  height: 28px !important;
  min-width: 28px !important;
  max-width: 28px !important;
  min-height: 28px !important;
  max-height: 28px !important;
  color: var(--dsw-alias-label-secondary);
  padding: 0 !important;
  border: 0 !important;
  border-radius: var(--dsw-radius-xs) !important;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease),
    background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}

.dsh-split-pane-close {
  margin-inline-start: 4px;
}

.dsh-split-icon-btn svg,
.dsh-split-header-actions button svg {
  width: 14px !important;
  height: 14px !important;
  flex: none;
}

@media (hover: hover) {
  .dsh-split-icon-btn:hover:not(:disabled),
  .dsh-split-header-actions button:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover) !important;
    color: var(--dsw-alias-label-primary) !important;
  }
}

.dsh-split-icon-btn:focus-visible,
.dsh-split-header-actions button:focus-visible {
  outline: var(--dsw-focus-ring-width) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
  z-index: 1;
}

.dsh-split-icon-btn.is-pressed {
  background: var(--dsw-alias-interactive-bg-active) !important;
  color: var(--dsw-alias-state-business-primary) !important;
}

.dsh-split-popout-btn,
.dsh-split-popout-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-secondary);
  opacity: 0.7;
  transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease),
    color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease),
    background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
  flex-shrink: 0;
}

.dsh-split-popout-btn:hover,
.dsh-split-popout-btn:hover {
  opacity: 1;
  color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-split-pane-header:not(.is-focused) .dsh-split-popout-btn,
.dsh-split-pane-header:not(.is-focused) .dsh-split-popout-btn {
  opacity: 0.6;
}

.dsh-split-pane-header:not(.is-focused):hover .dsh-split-popout-btn,
.dsh-split-pane-header:not(.is-focused):hover .dsh-split-popout-btn {
  opacity: 0.95;
}

.dsh-split-btn,
.dsh-split-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.dsh-split-btn:hover,
.dsh-split-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-split-btn:disabled,
.dsh-split-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.dsh-split-overlay-tab,
.dsh-split-overlay-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  height: 36px;
  padding: 0 8px 0 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-base);
  flex-shrink: 0;
  box-sizing: border-box;
  user-select: none;
}

.dsh-split-overlay-tab-title,
.dsh-split-overlay-tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-split-overlay-tab-path,
.dsh-split-overlay-tab-path {
  user-select: text;
  cursor: text;
  font-size: 13px;
}

.dsh-split-overlay-close,
.dsh-split-overlay-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-xs);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.dsh-split-overlay-close:hover,
.dsh-split-overlay-close:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-split-overlay-close:disabled,
.dsh-split-overlay-close:disabled {
  cursor: default;
  opacity: 0.4;
  background: transparent;
}

.dsh-split-overlay-close:focus-visible,
.dsh-split-overlay-close:focus-visible {
  outline: var(--dsw-focus-ring-width) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}

.dsh-split-file,
.dsh-split-file {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

.dsh-split-floating-quote,
.dsh-split-floating-quote {
  position: absolute;
  z-index: 25;
  pointer-events: auto;
}

.dsh-split-floating-quote-btn,
.dsh-split-floating-quote-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 500;
  font-family: var(--dsw-font-family);
  color: #ffffff;
  background: var(--dsw-alias-interactive-bg-primary, #3b82f6);
  border: none;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.dsh-split-floating-quote-btn:hover,
.dsh-split-floating-quote-btn:hover {
  filter: brightness(1.1);
}

.dsh-split-file-text,
.dsh-split-file-text {
  margin: 0;
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-split-file-code,
.dsh-split-file-code {
  width: 100%;
  min-width: 0;
}

.dsh-split-file-code .md-code-block,
.dsh-split-file-code .md-code-block {
  margin: 0 !important;
  --dsl-code-block-border-radius: 0px;
  --dsl-code-block-background: transparent;
}

.dsh-split-file-markdown,
.dsh-split-file-markdown {
  max-width: 860px;
  margin: 0 auto;
  box-sizing: border-box;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-split-file-markdown img,
.dsh-split-file-markdown img {
  max-width: 100%;
  height: auto;
}

.dsh-split-file-media,
.dsh-split-file-media {
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.dsh-split-file-note,
.dsh-split-file-note {
  margin: 0;
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary, #64748b);
}

.dsh-split-file-image,
.dsh-split-file-image {
  display: block;
  max-width: calc(100% - 28px);
  max-height: calc(100% - 28px);
  object-fit: contain;
  margin: 14px auto;
}

.dsh-split-restore-btn,
.dsh-split-restore-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--dsw-alias-state-business-primary, #3964fe) !important;
  color: #ffffff !important;
  border: 1px solid transparent !important;
  font-weight: 500;
}

.dsh-split-restore-btn:hover,
.dsh-split-restore-btn:hover {
  background: var(--dsw-alias-brand-hover, #2b54e8) !important;
  color: #ffffff !important;
}

@media (max-width: 767px) {
  [data-sidebar-drawer] [data-global-panel]:has(.dsh-split-shell),
  [data-sidebar-drawer] [data-global-panel]:has(.dsh-split-shell) {
    padding-top: 0 !important;
  }

  .dsh-split-pane-header,
  .dsh-split-pane-header {
    height: 50px !important;
    min-height: 50px !important;
    padding-inline-start: max(48px, var(--dsh-frame-leading-clearance, 48px)) !important;
  }

  .dsh-split-crumb-seg:last-child,
  .dsh-split-crumb-seg:last-child {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
  }

  .dsh-split-crumb.is-current,
  .dsh-split-crumb.is-current {
    min-width: 0 !important;
    max-width: 100% !important;
  }

  .dsh-split-col:not(.is-focused),
  .dsh-split-col:not(.is-focused) {
    display: none !important;
  }

  .dsh-split-col.is-focused,
  .dsh-split-col.is-focused {
    display: flex !important;
    flex: 1 1 100% !important;
    width: 100% !important;
  }

  .dsh-split-col:not(:last-child)::after,
  .dsh-split-col:not(:last-child)::after {
    display: none !important;
  }

  .dsh-split-maximize-btn,
  .dsh-split-maximize-btn {
    display: none !important;
  }
}

.dsh-split-overlay-view,
.dsh-split-overlay-view {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dsh-split-pane-body:has(.dsh-split-overlay-view) > [data-conversation-content] > [data-conversation-scroll],
.dsh-split-pane-body:has(.dsh-split-overlay-view) > [data-conversation-content] > [data-conversation-scroll] {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dsh-split-pane-body:has(.dsh-split-file) .dsh-split-file,
.dsh-split-pane-body:has(.dsh-split-file) .dsh-split-file {
  box-sizing: border-box;
  padding-bottom: 36px;
}

.dsh-split-pane-body:has(.dsh-split-file) [data-composer-seat],
.dsh-split-pane-body:has(.dsh-split-file) [data-composer-seat] {
  position: relative;
  flex: none;
  margin-top: -36px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
    var(--dsw-alias-bg-base) 28px,
    var(--dsw-alias-bg-base) 100%
  );
  border-top: none;
  padding: 16px 12px 12px;
  pointer-events: none;
}

.dsh-split-pane-body:has(.dsh-split-file) [data-composer-seat] > *,
.dsh-split-pane-body:has(.dsh-split-file) [data-composer-seat] > * {
  pointer-events: auto;
}

.dsh-split-pane-body > [data-conversation-content],
.dsh-split-pane-body > [data-conversation-content] {
  flex: 1 1 0;
  height: 100%;
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  --dsh-chat-content-width: min(100%, 860px);
}

.dsh-split-pane-body > [data-conversation-content] > [data-conversation-scroll],
.dsh-split-pane-body > [data-conversation-content] > [data-conversation-scroll] {
  flex: 1 1 0;
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow-x: hidden;
}

.dsh-split-pane-body [data-conversation-scroll] :is([class*="_scroll"], :has(> [data-chat-flow])),
.dsh-split-pane-body [data-conversation-scroll] :is([class*="_scroll"], :has(> [data-chat-flow])) {
  padding: 16px 12px;
}

.dsh-split-pane-body [data-conversation-content] :is([class*="md-table-wide"], .md-table-wide),
.dsh-split-pane-body [data-conversation-content] :is([class*="md-table-wide"], .md-table-wide) {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: 0 !important;
  padding-left: 0 !important;
  overflow-x: auto !important;
  padding-bottom: 0 !important;
}
`;

export function registerSplitStyles(
	_ctx: ClientContext,
	pluginId: string,
): () => void {
	if (typeof document === "undefined") return () => {};
	const styleEl = document.createElement("style");
	styleEl.setAttribute("data-plugin", pluginId);
	styleEl.textContent = SPLIT_VIEW_CSS;
	document.head.appendChild(styleEl);
	return () => {
		styleEl.remove();
	};
}
