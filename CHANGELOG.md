# Changelog

## v0.2.2-rc.5.4 - 2026-11-23

- **@lukstei/dsh-session-handoff**
  - Adds a handoff ring beside the send button. It appears at 70k prompt tokens (yellow) and turns red at 100k. It is a display-only hint: run `/handoff` yourself.
  - After 5 idle minutes the prompt cache is cold, so the thresholds drop to 40k and 70k.
  - Both thresholds are capped at 60% and 80% of the model's context window, so small-window models warn before compaction.
  - ACP agent sessions get the ring too. Their context usage is read from the optional ACP adapter peer dependency once per finished turn. Without the adapter, only regular DSH sessions show it.
  - `/handoff` now marks the source session done in Kanban and closes its pane once the new session opens. A source that was never initialised in Kanban still loses its pane.
  - The plugin now requires the UI slots service. Without it the plugin stays pending and does not activate.

