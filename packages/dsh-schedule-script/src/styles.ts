export const SCHEDULE_SCRIPT_CSS = `
.dsh-schedule-root,
.dsh-schedule-root * {
  box-sizing: border-box;
}

.dsh-schedule-root {
  display: inline-flex;
  align-items: center;
  position: relative;
  font-family: inherit;
}

/* 28px Icon-Only Button */
.dsh-schedule-icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: var(--dsw-radius-sm, 4px);
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  color: var(--dsw-alias-label-secondary, #64748b);
  transition: all 0.15s ease;
}

.dsh-schedule-icon-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, inherit);
}

.dsh-schedule-icon-btn.is-active,
.dsh-schedule-icon-btn.is-pressed {
  background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-state-business-primary, inherit);
}

.dsh-schedule-icon-btn:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #2563eb));
  outline-offset: -2px;
}

/* Status Dot Badge on Icon */
.dsh-schedule-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dsh-schedule-dot-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-base, #ffffff);
}

.dsh-schedule-dot[data-status="active"],
.dsh-schedule-dot-badge[data-status="active"] {
  background: var(--dsw-alias-state-success-primary, #10b981);
}

.dsh-schedule-dot[data-status="warning"],
.dsh-schedule-dot-badge[data-status="warning"],
.dsh-schedule-dot[data-status="paused"],
.dsh-schedule-dot-badge[data-status="paused"] {
  background: var(--dsw-alias-state-warn-primary, #f59e0b);
}

.dsh-schedule-dot[data-status="error"],
.dsh-schedule-dot-badge[data-status="error"] {
  background: var(--dsw-alias-state-error-primary, #ef4444);
}

.dsh-schedule-dot[data-status="stopped"],
.dsh-schedule-dot-badge[data-status="stopped"] {
  background: var(--dsw-alias-label-tertiary, #94a3b8);
}

/* Popover Card Component - Portaled to document.body to avoid parent clipping */
.dsh-schedule-popover {
  position: fixed;
  top: max(12px, var(--dsh-frame-overlay-top, 12px));
  left: 12px;
  right: anchor(right);
  bottom: calc(anchor(top) + 8px);
  align-self: safe end;
  justify-self: safe end;
  margin: 0;
  height: fit-content;
  box-sizing: border-box;
  font-family: var(--dsw-font-sans, system-ui, -apple-system, sans-serif);
  width: 310px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px);
  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #ffffff));
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.12)));
  border-radius: var(--dsw-radius-md, 8px);
  padding: 12px 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14), 0 2px 6px rgba(0, 0, 0, 0.06);
  color: var(--dsw-alias-label-primary, #0f172a);
  font-size: 13px;
  line-height: 1.5;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.dsh-schedule-popover * {
  box-sizing: border-box;
}

/* Static variant for Ladle stories or embedded previews */
.dsh-schedule-popover.is-static {
  position: relative;
  inset: auto;
  max-width: 100%;
  z-index: auto;
}

.dsh-schedule-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dsh-schedule-popover-title {
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--dsw-alias-label-primary, inherit);
}

.dsh-schedule-popover-title svg {
  align-self: baseline;
  transform: translateY(2px);
  flex-shrink: 0;
}

.dsh-schedule-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: var(--dsw-radius-xs, 4px);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}

.dsh-schedule-status-badge[data-status="active"] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #10b981) 12%, transparent);
  color: var(--dsw-alias-state-success-primary, #059669);
}

.dsh-schedule-status-badge[data-status="warning"],
.dsh-schedule-status-badge[data-status="paused"] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 12%, transparent);
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, #d97706));
}

.dsh-schedule-status-badge[data-status="error"] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 12%, transparent);
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

.dsh-schedule-status-badge[data-status="stopped"] {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #94a3b8) 15%, transparent);
  color: var(--dsw-alias-label-tertiary, #64748b);
}

.dsh-schedule-details-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #64748b);
}

.dsh-schedule-detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dsh-schedule-detail-value {
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 500;
}

.dsh-schedule-mono-badge {
  font-family: var(--dsw-font-mono, monospace);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-interactive-bg-subtle, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-label-primary, inherit);
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-schedule-error-value {
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, #d97706));
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Fatal Error Callout */
.dsh-schedule-callout {
  padding: 8px 10px;
  border-radius: var(--dsw-radius-sm, 6px);
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.dsh-schedule-callout-header {
  font-weight: 600;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.dsh-schedule-callout-fatal {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 25%, transparent);
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

.dsh-schedule-callout-warning {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 25%, transparent);
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, #d97706));
}

.dsh-schedule-callout-paused {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 25%, transparent);
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, #d97706));
}

.dsh-schedule-callout-completed {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #10b981) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, #10b981) 25%, transparent);
  color: var(--dsw-alias-state-success-primary, #059669);
}

.dsh-schedule-callout-stopped {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #94a3b8) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary, #94a3b8) 25%, transparent);
  color: var(--dsw-alias-label-secondary, #64748b);
}

/* Command Row in Chat Trajectory */
.dsh-schedule-command-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}

.dsh-schedule-command-separator {
  flex: none;
  width: 2px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption, #cbd5e1);
}

.dsh-schedule-command-status {
  min-width: 0;
  overflow: hidden;
  flex: 0 1 auto;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-secondary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-schedule-command-status[data-error] {
  color: var(--dsw-alias-state-error-primary, #ef4444);
}

.dsh-schedule-command-error-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding-left: 22px;
  margin-top: 2px;
  margin-bottom: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, #d97706));
}

.dsh-schedule-command-error-line[data-fatal="true"] {
  color: var(--dsw-alias-state-error-primary, #ef4444);
}

.dsh-schedule-command-error-bullet {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.4;
}

.dsh-schedule-command-error-text {
  word-break: break-word;
  white-space: pre-wrap;
}
`;
