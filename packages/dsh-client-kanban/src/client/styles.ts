/** CSS styling for the Kanban board using DSH design tokens. */
import type { Context as ClientContext } from "@deepseek-ai/cordis";

export const KANBAN_CSS = `
.dsh-kanban-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary, #1e293b);
  overflow: hidden;
  box-sizing: border-box;
}

.dsh-kanban-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  min-width: 0;
}

.dsh-kanban-topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.dsh-kanban-title {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-primary, #1e293b);
  flex-shrink: 0;
}

.dsh-kanban-workspace-scroll {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  scrollbar-width: thin;
  padding: 6px 2px;
}

.dsh-kanban-workspace-scroll::-webkit-scrollbar {
  height: 3px;
}

.dsh-kanban-workspace-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-border-l1, #cbd5e1);
  border-radius: 2px;
}

.dsh-kanban-ws-btn {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l1, #e2e8f0);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.3;
}

.dsh-kanban-ws-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l2, #cbd5e1);
}

.dsh-kanban-ws-btn.active {
  background: var(--dsw-alias-state-business-primary, #2563eb);
  color: #ffffff;
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
  font-weight: 500;
}

.dsh-kanban-ws-badges {
  position: absolute;
  top: -3px;
  bottom: -3px;
  right: -7px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2px;
  align-items: center;
  line-height: 1;
  pointer-events: none;
  z-index: 1;
}

.dsh-kanban-ws-badge {
  font-size: 9px;
  font-weight: 700;
  border-radius: 9999px;
  min-width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  color: #ffffff;
  box-sizing: border-box;
  box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-module-platform);
}

.dsh-kanban-ws-badge-top {
  background: var(--dsw-alias-state-success-primary);
  margin-bottom: auto;
}

.dsh-kanban-ws-badge-bottom {
  background: var(--dsw-alias-state-warn-primary);
  margin-top: auto;
}

.dsh-kanban-ws-badge-alert {
  background: var(--dsw-alias-state-error-primary);
}

.dsh-kanban-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}

.dsh-kanban-btn-start {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--dsw-alias-state-business-primary, #2563eb);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.dsh-kanban-btn-start:hover {
  opacity: 0.9;
}

.dsh-kanban-btn-start:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dsh-kanban-btn-prepare {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary, #1e293b);
  border: 1px solid var(--dsw-alias-border-l1, #cbd5e1);
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.dsh-kanban-btn-prepare:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l2, #94a3b8);
}

.dsh-kanban-search-box {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.dsh-kanban-search-input {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary, #1e293b);
  border: 1px solid var(--dsw-alias-border-l1, #cbd5e1);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 18px;
  outline: none;
  transition: border-color 0.15s ease;
  width: 180px;
  max-width: 100%;
  box-sizing: border-box;
}

.dsh-kanban-search-input:focus {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-kanban-search-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-kanban-search-status {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #64748b);
}

.dsh-kanban-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@media (min-width: 768px) {
  .dsh-kanban-scroll {
    flex-direction: row;
    align-items: stretch;
    gap: 16px;
    overflow-x: auto;
  }
  .dsh-kanban-section {
    flex: 1;
    min-width: 220px;
    display: flex;
    flex-direction: column;
  }
  .dsh-kanban-lane-body {
    flex: 1;
    overflow-y: auto;
    display: flex !important;
  }
  .dsh-kanban-collapse-icon {
    display: none;
  }
  .dsh-kanban-section-header {
    cursor: default;
  }
  .dsh-kanban-card-mobile-actions {
    display: none;
  }
}

@media (max-width: 767px) {
  .dsh-kanban-title {
    display: none;
  }

  .dsh-kanban-topbar {
    padding: 6px 10px;
    gap: 8px;
  }

  .dsh-kanban-controls {
    padding: 6px 10px;
    gap: 6px;
  }

  .dsh-kanban-btn-start,
  .dsh-kanban-btn-prepare {
    padding: 5px 10px;
    font-size: 12px;
  }

  .dsh-kanban-search-box {
    width: 100%;
    margin-left: 0;
  }

  .dsh-kanban-search-input {
    width: 100%;
    padding: 5px 24px 5px 8px;
    font-size: 12px;
  }

  .dsh-kanban-scroll {
    padding: 8px 10px;
    gap: 8px;
  }

  .dsh-kanban-section {
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .dsh-kanban-lane-body {
    box-sizing: border-box;
  }

  .dsh-kanban-card {
    padding: 8px 10px;
    box-sizing: border-box;
    width: 100%;
  }

  .dsh-kanban-card-title {
    font-size: 13px;
  }

  .dsh-kanban-section.is-collapsed .dsh-kanban-lane-body {
    display: none;
  }

  .dsh-kanban-section.is-empty .dsh-kanban-lane-body {
    min-height: 0;
    padding: 4px 8px;
  }

  .dsh-kanban-section.is-empty .dsh-kanban-empty {
    padding: 4px 0;
    font-size: 11px;
  }

  .dsh-kanban-collapse-icon {
    display: inline-block;
    font-size: 10px;
    width: 12px;
    color: var(--dsw-alias-label-secondary, #64748b);
  }

  .dsh-kanban-card-mobile-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 0.5px solid var(--dsw-alias-border-l1, #e2e8f0);
  }

  .dsh-kanban-btn-mobile-action {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 500;
    border-radius: 4px;
    border: 1px solid var(--dsw-alias-border-l1, #cbd5e1);
    background: var(--dsw-alias-bg-module-platform);
    color: var(--dsw-alias-label-primary, #1e293b);
    cursor: pointer;
    line-height: 1.2;
    touch-action: manipulation;
  }

  .dsh-kanban-btn-mobile-action:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }

  .dsh-kanban-btn-mobile-action.is-primary {
    background: var(--dsw-alias-state-business-primary, #2563eb);
    color: #ffffff;
    border-color: var(--dsw-alias-state-business-primary, #2563eb);
  }

  .dsh-kanban-btn-mobile-action.is-primary:hover {
    opacity: 0.9;
  }
}

.dsh-kanban-section {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-module-platform);
  overflow: hidden;
  transition: border-color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}

.dsh-kanban-section.drag-over {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
  background: var(--dsw-alias-state-business-tertiary);
}

.dsh-kanban-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: transparent;
}

.dsh-kanban-section-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dsh-kanban-pill {
  padding: 1px 6px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary, #475569);
  border: 0.5px solid var(--dsw-alias-border-l1, #cbd5e1);
}

.dsh-kanban-lane-body {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 32px;
}

.dsh-kanban-new-card {
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-state-business-primary, #2563eb);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 2px 4px rgba(37, 99, 235, 0.1);
}

.dsh-kanban-prepare-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-state-business-primary, #2563eb);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dsh-kanban-new-card-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l1, #cbd5e1);
  border-radius: 4px;
  background: var(--dsw-alias-bg-base);
  color: inherit;
  box-sizing: border-box;
  outline: none;
}

.dsh-kanban-new-card-input:focus {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-kanban-new-card-textarea {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.4;
  border: 1px solid var(--dsw-alias-border-l1, #cbd5e1);
  border-radius: 4px;
  background: var(--dsw-alias-bg-base);
  color: inherit;
  box-sizing: border-box;
  outline: none;
  resize: vertical;
  min-height: 54px;
  font-family: inherit;
}

.dsh-kanban-new-card-textarea:focus {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-kanban-new-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsh-kanban-btn-add {
  background: var(--dsw-alias-state-business-primary, #2563eb);
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.dsh-kanban-btn-add:hover {
  opacity: 0.9;
}

.dsh-kanban-btn-cancel {
  background: transparent;
  color: var(--dsw-alias-label-secondary, #64748b);
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
}

.dsh-kanban-btn-cancel:hover {
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-kanban-card {
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1, #e2e8f0);
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: transform 0.1s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
}

.dsh-kanban-card:hover {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
  transform: translateY(-1px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
}

.dsh-kanban-card[draggable="true"] {
  cursor: grab;
}

.dsh-kanban-card[draggable="true"]:active {
  cursor: grabbing;
}

.dsh-kanban-card.is-active-session {
  border-left: 3px solid var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-kanban-card.is-alert {
  border-left: 3px solid var(--dsw-alias-state-error-primary);
}

.dsh-kanban-card.is-pinned {
  border-top: 2px solid var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-kanban-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}

@media (max-width: 767px) {
  .dsh-kanban-card-header {
    margin-bottom: 4px;
  }
}

.dsh-kanban-card-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  word-break: break-word;
  user-select: none;
}

.dsh-kanban-card-pin-btn {
  background: transparent;
  border: none;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #94a3b8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
}

.dsh-kanban-card:hover .dsh-kanban-card-pin-btn,
.dsh-kanban-card-pin-btn:focus-visible,
.dsh-kanban-card-pin-btn.is-pinned {
  opacity: 1;
  pointer-events: auto;
}

.dsh-kanban-card-pin-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2563eb);
  outline-offset: 1px;
}

@media (hover: none), (pointer: coarse) {
  .dsh-kanban-card-pin-btn {
    opacity: 1;
    pointer-events: auto;
  }
}

.dsh-kanban-card-pin-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-kanban-card-pin-btn.is-pinned {
  color: var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-kanban-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #64748b);
  margin-top: 4px;
  gap: 8px;
}

.dsh-session-links { flex: none; }

.dsh-session-links-trigger:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.dsh-session-links-menu { max-width: min(320px, calc(100vw - 24px)); }

.dsh-session-link {
  white-space: normal;
  overflow-wrap: anywhere;
}

.dsh-kanban-badge-running {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-state-success-primary);
  font-weight: 600;
}

.dsh-kanban-badge-hold {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary, #64748b);
  border: 1px solid var(--dsw-alias-border-l1, #cbd5e1);
  margin-left: 6px;
}

.dsh-kanban-pane-status {
  display: inline-block;
  position: relative;
  width: 6px;
  height: 1cap;
}

.dsh-kanban-pane-status .dsh-kanban-badge-dot {
  position: absolute;
  inset: 0;
  margin: auto;
}

.dsh-kanban-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
  transition: background-color 0.1s ease;
}

.dsh-kanban-badge-dot.is-active {
  background: var(--dsw-alias-state-success-primary);
  animation: dsh-pulse 1.5s infinite;
}

.dsh-kanban-badge-dot.is-review {
  background: var(--dsw-alias-state-warn-primary);
}

.dsh-kanban-badge-dot.is-alert {
  background: var(--dsw-alias-state-error-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-error-primary) 20%, transparent);
  animation: dsh-pulse 1.5s infinite;
}

.dsh-kanban-badge-dot.is-todo {
  background: var(--dsw-alias-state-idle-primary);
}

.dsh-kanban-badge-dot.is-done {
  background: var(--dsw-alias-label-tertiary, #94a3b8);
}

@media (prefers-reduced-motion: reduce) {
  .dsh-kanban-badge-dot:is(.is-active, .is-alert) {
    animation: none;
  }
}

.dsh-kanban-badge-alert-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);
}

.dsh-kanban-badge-alert-pill .dsh-kanban-badge-dot {
  background: var(--dsw-alias-state-error-primary);
}

@keyframes dsh-pulse {
  0% { opacity: 1; }
  50% { opacity: 0.4; }
  100% { opacity: 1; }
}

.dsh-kanban-btn-action {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary, #1e293b);
  border: 1px solid var(--dsw-alias-border-l1, #cbd5e1);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.dsh-kanban-btn-action:hover {
  background: var(--dsw-alias-state-business-primary, #2563eb);
  color: #ffffff;
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-kanban-btn-start-card {
  color: var(--dsw-alias-state-business-primary, #2563eb);
  font-weight: 600;
}

.dsh-kanban-empty {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #94a3b8);
  text-align: center;
  padding: 12px 0;
  font-style: italic;
}

.dsh-kanban-recycle-bin {
  margin: 8px 12px;
  padding: 10px;
  border: 1.5px dashed var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-state-error-primary);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
  user-select: none;
}

.dsh-kanban-recycle-bin.is-drag-over {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent);
  border-color: var(--dsw-alias-state-error-primary);
  transform: scale(1.01);
}

/* Badges across kanban views (consistent blue for in-progress, orange for review) */
.dsh-kanban-badge {
  font-size: 10px;
  font-weight: 700;
  border-radius: 9999px;
  padding: 0 5px;
  height: 15px;
  min-width: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  box-sizing: border-box;
}

.dsh-kanban-badge.is-active {
  background: var(--dsw-alias-state-success-primary);
  color: #ffffff;
}

.dsh-kanban-badge.is-review {
  background: var(--dsw-alias-state-warn-primary);
  color: #ffffff;
}

.dsh-kanban-badge.is-alert {
  background: var(--dsw-alias-state-error-primary);
  color: #ffffff;
}

/* --- Left Sidebar In-Flight Kanban Styles (matching native Workspace Browser) --- */

.dsh-inflight-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 14px;
  color: var(--dsw-alias-label-primary, #1e293b);
  padding: 0;
}

.dsh-inflight-sidebar-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  min-height: 36px;
  height: 36px;
  margin: 0 0 4px;
  padding: 0 8px 0 0;
  box-sizing: border-box;
  width: calc(100% - var(--dsh-sidebar-inline-padding, 8px));
  color: var(--dsw-alias-label-primary, #1e293b);
}

/* Native .panelRow: 3px paint inset, 9px inline padding, 6px label gap. */
.dsh-inflight-header-clickable {
  display: flex;
  align-items: center;
  gap: var(--dsh-sidebar-label-gap, 6px);
  min-height: 36px;
  height: 36px;
  padding: 7px calc(
    var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px)
  );
  margin: 0;
  box-sizing: border-box;
  border: none;
  border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  background-clip: padding-box;
  color: var(--dsw-alias-label-primary, #1e293b);
  font: inherit;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
  flex: 1;
  min-width: 0;
  transition: background 0.15s ease;
}

.dsh-inflight-header-clickable:hover {
  background-color: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-inflight-header-clickable:hover .dsh-inflight-sidebar-title {
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-inflight-header-icon {
  flex: none;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
}

.dsh-inflight-sidebar-title {
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  color: var(--dsw-alias-label-primary, #1e293b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-inflight-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.dsh-inflight-btn-close {
  flex: none;
  width: 24px;
  height: 24px;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dsw-radius-xs);
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #64748b);
  cursor: pointer;
  padding: 0;
  box-sizing: border-box;
  transition: all 0.15s ease;
}

.dsh-inflight-btn-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-inflight-sidebar-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  margin-inline-end: 2px;
  padding: 0 calc(var(--dsh-sidebar-inline-padding, 8px) - 5px - 2px) 16px 0;
  scrollbar-gutter: stable;
  display: flex;
  flex-direction: column;
  width: calc(100% - 2px);
  box-sizing: border-box;
}

/* Workspace Group Section */
.dsh-inflight-ws-group {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
}

.dsh-inflight-ws-group + .dsh-inflight-ws-group {
  margin-top: 4px;
}

.dsh-inflight-ws-header-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 34px;
  border-radius: var(--dsw-radius-md);
  border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent;
  background-clip: padding-box;
  padding: 0 8px;
  padding-inline-start: calc(
    var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px)
  );
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary, #1e293b);
  cursor: pointer;
  user-select: none;
}

.dsh-inflight-ws-header-row:hover {
  background-color: var(--dsw-alias-interactive-bg-hover);
}

.dsh-inflight-ws-header {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
  color: inherit;
}

.dsh-inflight-ws-icon {
  flex: none;
  width: 16px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary, #81858c);
}

.dsh-inflight-ws-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-inflight-btn-add-task {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  min-width: 20px;
  min-height: 20px;
  border: none;
  border-radius: var(--dsw-radius-xs);
  padding: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #81858c);
  transition: all 0.15s ease;
  margin-left: auto;
}

.dsh-inflight-btn-add-task:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-inflight-ws-cards {
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  margin-top: 2px;
  margin-bottom: 4px;
}

.dsh-inflight-ws-cards > * + * {
  margin-top: 2px;
}

/* In-flight Session Card (styled to match native DSH sessionRow) */
.dsh-inflight-card {
  width: 100%;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 0;
  border-radius: var(--dsw-radius-md);
  border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent;
  background-clip: padding-box;
  padding: 0 8px;
  padding-inline-start: calc(
    var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px)
  );
  cursor: pointer;
  user-select: none;
  color: var(--dsw-alias-label-primary, #1e293b);
  box-sizing: border-box;
  transition: background 0.1s ease;
}

.dsh-inflight-card:hover {
  background-color: var(--dsw-alias-interactive-bg-hover);
}

.dsh-inflight-card.is-current {
  background-color: var(--dsw-alias-interactive-bg-hover);
}

.dsh-inflight-card.is-focused {
  background-color: var(--dsw-alias-interactive-bg-active);
}

.dsh-inflight-card.is-focused .dsh-inflight-card-title {
  font-weight: 400;
}

.dsh-inflight-card.is-alert {
  border-inline-start-color: var(--dsw-alias-state-error-primary);
}

.dsh-inflight-card-content {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
  margin-inline-start: var(--dsh-sidebar-label-gap, 6px);
}

.dsh-inflight-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0;
  height: 100%;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
}

.dsh-inflight-card-slot {
  color: var(--dsw-alias-label-tertiary, #81858c);
  flex: none;
  width: 16px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.dsh-inflight-card-slot-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Native row icon buttons keep a 24px hover target on a 16px layout footprint
 * through compensated margins (ui-workspace Rows.module.css .iconButton). */
.dsh-inflight-btn-slot-close {
  flex: none;
  display: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: -4px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #81858c);
  border-radius: var(--dsw-radius-xs);
  transition: color 0.12s ease, background-color 0.12s ease;
  box-sizing: border-box;
}

.dsh-inflight-card.has-slot-close:hover .dsh-inflight-btn-slot-close,
.dsh-inflight-card.has-slot-close:focus-within .dsh-inflight-btn-slot-close {
  display: inline-flex;
}

.dsh-inflight-card.has-slot-close:hover .dsh-inflight-card-slot-status,
.dsh-inflight-card.has-slot-close:focus-within .dsh-inflight-card-slot-status {
  display: none;
}

.dsh-inflight-btn-slot-close:hover,
.dsh-inflight-btn-slot-close:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-inflight-rail-session-dot svg {
  color: var(--dsw-alias-label-tertiary, #81858c);
}

.dsh-inflight-btn-fullscreen-toggle {
  flex: none;
  width: 24px;
  height: 24px;
  margin: -4px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-state-business-primary, #3964fe);
  border-radius: var(--dsw-radius-xs);
  transition: color 0.12s ease, background-color 0.12s ease;
  box-sizing: border-box;
}

.dsh-inflight-btn-fullscreen-toggle:hover,
.dsh-inflight-btn-fullscreen-toggle:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

.dsh-inflight-btn-fullscreen-toggle:is(.is-active, .is-pressed, [aria-pressed="true"]) {
  background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-state-business-primary, #3964fe);
}

.dsh-inflight-btn-fullscreen-toggle:is(.is-active, .is-pressed, [aria-pressed="true"]):hover,
.dsh-inflight-btn-fullscreen-toggle:is(.is-active, .is-pressed, [aria-pressed="true"]):focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.12));
}

.dsh-inflight-card-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-inline-end: var(--dsh-sidebar-label-gap, 6px);
  font-size: 14px;
  line-height: 20px;
}

.dsh-inflight-card-time {
  flex: none;
  font-size: 10px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #81858c);
  margin-left: auto;
  margin-inline-end: -1px;
}

.dsh-inflight-card-actions {
  flex: none;
  display: none;
  align-items: center;
  gap: 13px;
  margin-left: auto;
}

.dsh-inflight-card:hover .dsh-inflight-card-actions,
.dsh-inflight-card:focus-within .dsh-inflight-card-actions {
  display: inline-flex;
}

.dsh-inflight-card:hover .dsh-inflight-card-time,
.dsh-inflight-card:focus-within .dsh-inflight-card-time {
  display: none;
}

/* Touch / mobile fallback: when hover is unavailable, show actions on the active task */
@media (hover: none), (pointer: coarse) {
  .dsh-inflight-card.is-current .dsh-inflight-card-actions {
    display: inline-flex;
  }
  .dsh-inflight-card.is-current .dsh-inflight-card-time {
    display: none;
  }
}

.dsh-inflight-btn-action {
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  margin: -4px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dsw-radius-xs);
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #81858c);
  transition: all 0.12s ease;
  box-sizing: border-box;
}

.dsh-inflight-btn-action:disabled,
.dsh-inflight-btn-action.is-disabled {
  opacity: 0.25;
  cursor: not-allowed;
  pointer-events: none;
}

.dsh-inflight-btn-action:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1e293b);
}

.dsh-inflight-btn-action.is-done:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.dsh-inflight-btn-action.is-hold:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}

@media (hover: none), (pointer: coarse) {
  .dsh-inflight-btn-action {
    width: 26px;
    height: 26px;
    min-width: 26px;
    min-height: 26px;
  }
  .dsh-inflight-btn-action:active {
    transform: scale(0.92);
  }
}

/* Rail mode */
.dsh-inflight-sidebar-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  width: 100%;
  box-sizing: border-box;
}

.dsh-inflight-rail-switcher-btn {
  width: 34px;
  height: 34px;
  border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-border-l1, #e2e8f0);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary, #1e293b);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  position: relative;
  transition: all 0.15s ease;
}

.dsh-inflight-rail-switcher-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, #f1f5f9);
}

.dsh-inflight-rail-switcher-btn.is-active {
  background: var(--dsw-alias-state-business-primary, #2563eb);
  color: #ffffff;
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-inflight-rail-badges {
  position: absolute;
  top: -3px;
  bottom: -3px;
  right: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  line-height: 1;
  pointer-events: none;
  z-index: 2;
}

.dsh-inflight-rail-divider {
  width: 24px;
  height: 1px;
  background: var(--dsw-alias-border-l1, #e2e8f0);
  margin: 2px 0;
}

.dsh-inflight-rail-session-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 0.5px solid transparent;
  box-sizing: border-box;
  background: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.1s ease;
}

.dsh-inflight-rail-session-dot:hover {
  background: var(--dsw-alias-interactive-bg-hover, #f1f5f9);
}

.dsh-inflight-rail-session-dot.is-current {
  border-color: var(--dsw-alias-border-l2, #cbd5e1);
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
}

.dsh-inflight-rail-session-dot.is-focused {
  border-color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-active);
}

.dsh-kanban-transition-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
}

.dsh-kanban-transition-item-primary {
  color: var(--dsw-alias-state-business-primary, #3964fe);
  font-weight: 600;
}

.dsh-kanban-transition-item-primary svg {
  color: var(--dsw-alias-state-business-primary, #3964fe);
  stroke-width: 1.8;
}

.dsh-kanban-transition-menu [role="menuitem"]:has(.dsh-kanban-transition-item-primary) {
  background: var(--dsw-alias-interactive-bg-subtle, rgba(57, 100, 254, 0.05));
}

.dsh-kanban-transition-menu [role="menuitem"]:has(.dsh-kanban-transition-item-primary):hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(57, 100, 254, 0.1)) !important;
}

.dsh-kanban-input-icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: var(--dsw-radius-sm, 4px);
}

.dsh-kanban-input-icon-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}

.dsh-kanban-input-icon-btn.is-pressed {
  background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.08)) !important;
  color: var(--dsw-alias-state-business-primary) !important;
}

.dsh-kanban-transition-menu {
  display: inline-flex !important;
  min-width: 0 !important;
  flex-shrink: 1 !important;
}

.dsh-kanban-input-chip {
  height: 28px !important;
  padding: 0 6px !important;
  color: var(--dsw-alias-label-secondary, #64748b) !important;
  font-size: 13px !important;
  line-height: 20px !important;
  font-weight: 500 !important;
  gap: 4px !important;
  border-radius: var(--dsw-radius-sm, 6px) !important;
  background: transparent !important;
  border: none !important;
  display: inline-flex !important;
  align-items: center !important;
  cursor: pointer !important;
  max-width: 180px;
  min-width: 0 !important;
  flex-shrink: 1 !important;
  transition: background 0.12s ease, color 0.12s ease;
}

.dsh-kanban-input-chip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05)) !important;
  color: var(--dsw-alias-label-primary, #0f172a) !important;
}

.dsh-kanban-input-chip.is-pressed {
  background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.08)) !important;
  color: var(--dsw-alias-label-primary, #0f172a) !important;
}

.dsh-kanban-input-chip:disabled {
  color: var(--dsw-alias-label-dimmed, #94a3b8) !important;
  cursor: default !important;
  opacity: 0.6;
}

.dsh-kanban-input-chip:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6));
  outline-offset: -1px;
}

.dsh-kanban-input-chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-kanban-input-chip-chevron {
  flex-shrink: 0;
  opacity: 0.7;
}

.dsh-kanban-input-chip:hover .dsh-kanban-input-chip-chevron {
  opacity: 1;
}

`;

export function registerKanbanStyles(
	_ctx: ClientContext,
	pluginId: string,
): () => void {
	if (typeof document === "undefined") return () => {};
	const styleEl = document.createElement("style");
	styleEl.setAttribute("data-plugin", pluginId);
	styleEl.textContent = KANBAN_CSS;
	document.head.appendChild(styleEl);
	return () => {
		styleEl.remove();
	};
}
