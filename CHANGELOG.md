# Changelog

## v0.2.2-rc.5.15 - 2026-11-28

- **@lukstei/dsh-session-handoff**
  - The plugin no longer requires the web server service, so it loads in shells that do not provide one.
  - The handoff ring falls back to the built-in limits when its configuration is not injected, such as after a hot reload, instead of failing.
  - The ring keeps the built-in limits when its model lookup fails, for example for subagent sessions.
- **@lukstei/dsh-yaml-workflow**
  - Ships three example workflows in `examples/`: `review` (unified code review with an optional gate and either fixes or proposed PR comments), `socratic` (a context-free review that asks up to six questions) and `write` (technical prose drafting with substance and style audits).
- **General**
  - The README lists the example workflows, the command for each and what it does.

## v0.2.2-rc.5.14 - 2026-11-28

- **General**
  - The README is reworked around installing with `dsh plugin add`. Each package ships a default `cordis.patch.yml`, so installing mounts it with working defaults. Add entries to your profile's `cordis.patch.yml` only to override config. The per-package install sections now show the same `dsh plugin add` step.
  - The README explains plugin versioning. Plugin versions follow `<dsh-version>.<n>`, so `0.2.2-rc.5.1` targets DSH `0.2.2-rc.5`. Upgrade DSH and the plugins together across DSH releases. Mixing versions across releases is not supported.
  - The PWA example for localhost no longer needs a `cordis.patch.yml` entry after install.

## v0.2.2-rc.5.13 - 2026-11-28

- **@lukstei/dsh-client-kanban**
  - Breaking: the link tool settings are nested under `linkTool`. Replace `kanban_add_link_tool_enabled` with `linkTool.enabled` and `kanban_add_link_tool_instructions` with `linkTool.instructions` in your profile's `cordis.patch.yml`.
- **General**
  - The README adds a Philosophy section describing the plugins' design goals and how breaking changes are handled.

## v0.2.2-rc.5.12 - 2026-11-28

- **@lukstei/dsh-client-pwa**
  - Breaking: the shipped default no longer turns on trusted reverse-proxy login. Installing DSH as an app on `localhost` keeps normal token login. If you relied on the old default, set the `auth` options (`userHeader`, `trustedCidrs`, `authRoutes`, `loginRedirectPath`) in your profile's `cordis.patch.yml`.
- **@lukstei/dsh-session-handoff**
  - The ring's warning thresholds can be set for all models, per provider, or per provider and model. The most specific setting wins for each value. Unset values keep the built-in bars: 100k and 150k tokens with a warm cache, 70k and 100k with a cold one.
  - The idle time after which the prompt cache counts as cold can also be set.
  - The ring reads the session's current model after each turn, so switching models applies that model's thresholds. The 60% and 80% window-share caps still apply.
- **General**
  - The README is reorganized into a starter setup, workspace features, standalone utilities and the plugin catalog. It adds a mobile screenshot.

## v0.2.2-rc.5.11 - 2026-11-27

- **@lukstei/dsh-session-handoff**
  - The brief quotes the last turn in full, up to 20,000 characters, so the most recent exchange carries over intact. The four turns before it keep the shorter quotes.
  - The last turn keeps every message you sent in it, not just the first. Earlier turns still keep only their first message.
  - Each turn labels its messages **User** and **Assistant**, so an unanswered message is no longer mistaken for a reply. A turn without a reply says so.
  - Where text is cut, the brief states how many characters were left out instead of showing a bare ellipsis.

## v0.2.2-rc.5.10 - 2026-11-26

- **General**
  - The README now opens with what a DSH workspace gives you and a three-step quick start. It then describes each workflow, the plugin catalog and an FAQ.

## v0.2.2-rc.5.9 - 2026-11-26

- **@lukstei/dsh-session-handoff**
  - Typing a bare `/handoff` in the composer opens the same model list as `/model`. Picking a model starts the new session on that model with the brief loaded. Works across native and ACP models.
  - `/handoff <provider>/<model>` starts the new session on that model directly. The model is checked before the session is created, so a typo returns an error instead of a broken session.
  - The handoff ring is unchanged and keeps the source session's model.
  - Breaking: `/handoff <session-id>` is removed. It used to write another session's brief into the current session. Use bare `/handoff` or the ring instead.

## v0.2.2-rc.5.8 - 2026-11-26

- **@lukstei/dsh-client-kanban**
  - Workspace tab counts for running, needs-attention and in-review sessions sit inline after the workspace name instead of overlapping the tab's edge. The counts are slightly larger.
- **@lukstei/dsh-resilient-persistence**
  - Retired and removed. Sessions with corrupt logs are no longer hidden from the session list, so one corrupt log can break session listing again. Remove the package from any profile that lists it.
- **@lukstei/dsh-session-handoff**
  - Handing off a session that was itself handed off now carries the earlier history into the brief. The brief lists the chain of session ids and merges the turns, failures and file paths of every earlier session, oldest first.
  - Briefs stay a bounded size however long the chain gets. Only the newest turns, failures and file paths are kept in full, and the rest are counted as omitted.
  - The handoff button is disabled while a turn is running or a handoff is already starting. Its tooltip says to wait for the turn to finish, and reads "Handing off…" while the handoff runs.

## v0.2.2-rc.5.7 - 2026-11-25

- **@lukstei/dsh-session-handoff**
  - Fixes the published package missing its server-side entry point. `dist/index.js` is now built and shipped, so the plugin's server half loads after install.

## v0.2.2-rc.5.6 - 2026-11-25

- **@lukstei/dsh-client-review-git**
  - Fixes the git review view failing to load from the published package. Its shared review UI code is now bundled into the plugin.
- **General**
  - Pre-release versions are now published to npm's `latest` tag instead of `next`, so `npm install` without a version can pick up a pre-release.

## v0.2.2-rc.5.5 - 2026-11-25

- **@lukstei/dsh-client-kanban**
  - Searching the board shows a ranked list of matching sessions beside a live preview of the focused one. Arrow keys move through results, Enter opens the session, and Escape clears the search. Double-clicking a result also opens it.
  - The preview has an "Open session" button.
  - Session links can point to another DSH session (`dsh://sessions/<id>`). Opening one switches to that session in the app instead of a browser tab.
  - The session menu has a "Close pane" entry that closes the pane without changing the session's Kanban lane.
- **@lukstei/dsh-client-split-view**
  - Adds `replaceSession(oldId, newId)` to swap the session in a pane for another one in place, keeping the pane's position.
- **@lukstei/dsh-session-handoff**
  - The context ring is now a clickable gauge button. Clicking it runs `/handoff` in the session.
  - Warning thresholds are higher: yellow at 100k prompt tokens and red at 150k when the cache is warm. After 5 idle minutes they are 70k and 100k. The window-share caps still apply.
  - The handoff session keeps the source title. The source session is renamed to `<title> (Resumed)`, unless it already has that suffix.
  - The new session gets a Kanban link back to the source session, labelled "Resumed from <id>".
  - After `/handoff`, the new session takes over the source's pane in the split view instead of opening beside it. The source is marked done in Kanban.

## v0.2.2-rc.5.4 - 2026-11-23

- **@lukstei/dsh-session-handoff**
  - Adds a handoff ring beside the send button. It appears at 70k prompt tokens (yellow) and turns red at 100k. It is a display-only hint: run `/handoff` yourself.
  - After 5 idle minutes the prompt cache is cold, so the thresholds drop to 40k and 70k.
  - Both thresholds are capped at 60% and 80% of the model's context window, so small-window models warn before compaction.
  - ACP agent sessions get the ring too. Their context usage is read from the optional ACP adapter peer dependency once per finished turn. Without the adapter, only regular DSH sessions show it.
  - `/handoff` now marks the source session done in Kanban and closes its pane once the new session opens. A source that was never initialised in Kanban still loses its pane.
  - The plugin now requires the UI slots service. Without it the plugin stays pending and does not activate.

