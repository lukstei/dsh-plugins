export const WORKFLOW_CARD_CSS = `
.dsh-wf-card,
.dsh-wf-card * {
  box-sizing: border-box;
}

.dsh-wf-card {
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
  border-radius: var(--dsw-radius-md, 6px);
  background: var(--dsw-alias-surface-raised, rgba(255, 255, 255, 0.03));
  color: var(--dsw-alias-label-primary, inherit);
  margin: 4px 0;
  overflow: hidden;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
}

.dsh-wf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  gap: 8px;
  background: transparent;
  width: 100%;
  min-width: 0;
  font: inherit;
  color: inherit;
}

.dsh-wf-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.dsh-wf-command-badge {
  display: inline-flex;
  align-items: center;
  font-family: var(--dsw-font-mono, monospace);
  font-size: 12px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
  flex-shrink: 0;
  user-select: text;
}

.dsh-wf-args {
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  font-family: var(--dsw-font-mono, monospace);
  font-size: 12px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  min-width: 0;
  flex-shrink: 1;
}

.dsh-wf-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
  border-radius: var(--dsw-radius-sm, 4px);
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.dsh-wf-copy-btn:hover {
  background: var(--dsw-alias-surface-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-primary, inherit);
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2));
}

.dsh-wf-copy-btn[data-copied="true"] {
  color: var(--dsw-alias-state-success-primary, #10b981);
  border-color: var(--dsw-alias-state-success-primary, #10b981);
}

.dsh-wf-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.4;
  flex-shrink: 0;
  user-select: none;
}

.dsh-wf-badge-running {
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dsh-wf-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary, #3b82f6);
  animation: dsh-wf-pulse 1.4s ease-in-out infinite;
}

@keyframes dsh-wf-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.1); }
}

.dsh-wf-badge-success {
  color: var(--dsw-alias-state-success-primary, #10b981);
  font-weight: 500;
}

.dsh-wf-badge-paused {
  color: var(--dsw-alias-state-warning-primary, #f59e0b);
  font-weight: 500;
}

.dsh-wf-badge-aborted {
  color: var(--dsw-alias-state-error-primary, #ef4444);
  font-weight: 500;
}

.dsh-wf-body {
  border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  background: var(--dsw-alias-markdown-code-block, rgba(0, 0, 0, 0.15));
  padding: 8px 12px;
  font-family: var(--dsw-font-mono, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  color: var(--dsw-alias-label-secondary, inherit);
}

.dsh-wf-body[data-paused="true"] {
  color: var(--dsw-alias-state-warning-primary, #f59e0b);
}

.dsh-wf-gate-line {
  margin-bottom: 4px;
  line-height: 1.4;
}

.dsh-wf-next-line {
  margin-bottom: 4px;
  line-height: 1.4;
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 500;
}

.dsh-wf-hint-line {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  font-style: italic;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 0.5px dashed var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}

.dsh-wf-body[data-error="true"] {
  color: var(--dsw-alias-state-error-primary, #ef4444);
}

.dsh-wf-step-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  margin: 6px 0 2px 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  font-family: var(--dsw-font-mono, monospace);
  user-select: none;
}

.dsh-wf-step-row[data-status="running"] {
  color: var(--dsw-alias-label-primary, inherit);
}

.dsh-wf-step-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--dsw-alias-state-business-primary, #3b82f6);
}

.dsh-wf-step-icon[data-status="done"] {
  color: var(--dsw-alias-state-success-primary, #10b981);
}

.dsh-wf-step-icon[data-status="paused"] {
  color: var(--dsw-alias-state-warning-primary, #f59e0b);
}

.dsh-wf-step-icon[data-status="aborted"],
.dsh-wf-step-icon[data-status="error"] {
  color: var(--dsw-alias-state-error-primary, #ef4444);
}

.dsh-wf-step-label {
  font-weight: 500;
  letter-spacing: 0.02em;
}

.dsh-wf-step-error {
  margin: 2px 0 6px 26px;
  padding: 6px 10px;
  background: var(--dsw-alias-markdown-code-block, rgba(0, 0, 0, 0.15));
  border-left: 2px solid var(--dsw-alias-state-error-primary, #ef4444);
  border-radius: 0 var(--dsw-radius-sm, 4px) var(--dsw-radius-sm, 4px) 0;
  font-family: var(--dsw-font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary, #ef4444);
  white-space: pre-wrap;
  word-break: break-word;
}

.dsh-wf-print-step {
  margin: 2px 0 6px 16px;
  padding: 6px 10px;
  background: var(--dsw-alias-markdown-code-block, rgba(0, 0, 0, 0.15));
  border-left: 2px solid var(--dsw-alias-state-business-primary, #3b82f6);
  border-radius: 0 var(--dsw-radius-sm, 4px) var(--dsw-radius-sm, 4px) 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, inherit);
  min-width: 0;
  overflow-x: auto;
}

.dsh-wf-resume-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  background: var(--dsw-alias-surface-raised, rgba(255, 255, 255, 0.08));
  border: 0.5px solid var(--dsw-alias-state-warning-primary, #f59e0b);
  border-radius: var(--dsw-radius-sm, 6px);
  color: var(--dsw-alias-state-warning-primary, #f59e0b);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.dsh-wf-resume-btn:hover {
  background: var(--dsw-alias-state-warning-primary, #f59e0b);
  color: #000000;
  border-color: var(--dsw-alias-state-warning-primary, #f59e0b);
}

.dsh-wf-resume-btn:active {
  transform: scale(0.97);
}

.dsh-wf-resume-btn-label {
  line-height: 1;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-wf-toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.dsh-wf-discard-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.16));
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  transition: background-color 100ms ease, border-color 100ms ease, color 100ms ease;
}

.dsh-wf-discard-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-state-error-primary, #ef4444);
  border-color: var(--dsw-alias-state-error-primary, #ef4444);
}

.dsh-wf-discard-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.dsh-wf-discard-btn-label {
  line-height: 1;
}

.dsh-wf-markdown-body {
  border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  padding: 10px 14px;
  min-width: 0;
  overflow-x: auto;
}
`;
