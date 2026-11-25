# @lukstei/dsh-client-split-view

## Summary

Replaces the single-session chat view with side-by-side session panes. Each pane can show a file, a plugin view, or a related session in an overlay. Open panes persist across reloads. Used directly by people running several sessions at once, and by the Kanban and Git review plugins through the `splitView` service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- insert:
    - id: split-view
      name: '@lukstei/dsh-client-split-view'
```

No config. Client plugin (`platform: web`, `immediately: true`). Required services: `slots`, `sessions`, `uiWorkspace`, `uiSession`, `layout`, `remote`, `sidebarRight`, `remote.workspaceFiles`. The host entry is a no-op.

### Plugin dependencies

Client-side only. Client `inject`: `slots`, `sessions`, `uiWorkspace`, `uiSession`, `layout`, `remote`, `sidebarRight`, `remote.workspaceFiles`.

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `slots` | Required | @deepseek-ai/dsh-client-ui-slots | Plugin stays pending; never applies. |
| `sessions` | Required | @deepseek-ai/dsh-api-session-controller | Plugin stays pending; never applies. |
| `uiWorkspace`, `uiSession`, `layout` | Required | @deepseek-ai/dsh-client-ui-workspace, @deepseek-ai/dsh-client-ui-session, @deepseek-ai/dsh-client-ui-layout | Plugin stays pending; never applies. |
| `remote`, `remote.workspaceFiles` | Required | @deepseek-ai/dsh-api-gateway, @deepseek-ai/dsh-api-workspace-files | Plugin stays pending; never applies. |
| `sidebarRight` | Required | @deepseek-ai/dsh-client-ui-sidebar-right | Plugin stays pending; never applies. |

Code import (no mount): [`@lukstei/util-review-ui`](../util-review-ui/README.md) (`quote`, `useSelectionQuote`).

Provides the client service `splitView`.

Used by: [`dsh-client-kanban`](../dsh-client-kanban/README.md) (optional), [`dsh-client-review-git`](../dsh-client-review-git/README.md) (optional), [`dsh-session-handoff`](../dsh-session-handoff/README.md) (required, client side).

### Behavior

- Open sessions are equal-width columns. Focus, maximize or close each one; double-clicking a pane header (outside buttons) toggles maximize. Headers are draggable to reorder panes.
- Viewports under 768 px show one pane. Selecting a session replaces the current one, and maximize is disabled.
- State (open sessions, focus, overlays) is stored in `localStorage` under `dsh-client-split-view:state:v1` and restored once the session list is `ready`.
- A header control in `conversation.session.header.utilities` (`split-view-restore`) restores the split from the native view.
- While a pane is the pointer origin, `uiWorkspace.openSession` opens the target in that pane as a `session` overlay. `sidebarRight.openResource` opens a `file` overlay for file addresses; `uiWorkspace.startSession` creates a session and adds it as a pane. Other cases fall through to the originals. The overrides are restored on dispose.
- File overlays preview Markdown (rendered), images (png, jpg, gif, webp, avif, bmp, svg) or plain text.

### Service: `splitView`

`ISplitView` (from `@lukstei/dsh-client-split-view/client-contract`), provided on the Cordis client context:

| Member | Purpose |
|---|---|
| `getSnapshot`, `subscribe` | Observe `SplitState` (`sessionIds`, `focusedSessionId`, `maximizedSessionId`, `hoveredSessionId`, `suspended`, `overlays`) |
| `openSession`, `toggleSession`, `removeSession`, `replaceSession`, `resetToSingle` | Pane membership |
| `setFocus`, `toggleMaximize`, `setHoveredSession`, `reorderSession` | Pane state |
| `suspend`, `resume`, `isSuspended`, `isSplitActive` | Switch between split and native view |
| `openSlotOverlay(hostId, slotName, title, props)`, `closeOverlay(hostId)` | Factory overlays |
| `setFallbackPanelId(id)` | Panel selected when the last pane closes; default `null` (native conversation). Integrations must restore `null` on disposal |

`openSlotOverlay` props must be JSON objects (pass `{}` for factories without input). Functions, cycles, class instances and non-finite numbers are rejected before the current overlay is replaced. Props persist and are restored on reload. The overlay tab stays closable if its factory provider unloads.

### Slots

| Slot | Kind | Purpose |
|---|---|---|
| `split.pane` | single, session | Conversation viewport per column |
| `split.overlay` | single, session | File, factory and child-session overlays |
| `split.pane.status` | single, session | Pane indicator |
| `split.subagent.status` | single, session | Subagent indicator (owner state `active` or `review`) |
| `split.pane.header.actions` | list, session | Plugin header actions; register through `ctx.slots.inject` |

CSS classes use `dsh-split-*`; pane roots carry `data-split-pane`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Host no-op |
| [src/client/index.tsx](src/client/index.tsx) | Client entry: provides `splitView`, registers `main` / slots, hydration, navigation overrides, restore control. Re-exports `SplitStore`, `splitStore`, `ISplitView`, `SplitOverlay`, `SplitState` |
| [src/client/contract.ts](src/client/contract.ts) | Public types and Cordis/slot augmentations |
| [src/client/split-store.ts](src/client/split-store.ts) | `SplitStore`: membership, overlays, persistence, mobile rules |
| [src/client/SplitLayout.tsx](src/client/SplitLayout.tsx), [SplitPane.tsx](src/client/SplitPane.tsx), [SplitPaneHeader.tsx](src/client/SplitPaneHeader.tsx) | UI |
| [src/client/file-preview.ts](src/client/file-preview.ts) | Path to preview kind (`markdown`, `image`, `text`) |
| [src/client/styles.ts](src/client/styles.ts) | Stylesheet registration |

Each pane holds a `SessionReference` (source `splitView`) released on removal. The main view registers with key `split-view`; the registration precedes hydration because a re-applied fiber can restore a ready list synchronously. A pointer or focus interaction outside every pane (menus and dialogs excepted) clears the pointer origin.

Persisted: `localStorage` only. File overlays store address, owner session, path and title; loaded `contents` are not stored. Session overlays store target and title.

Tests: [tests/](tests/) (store, layout, overlays, header, hydration, styles).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).
- [`@lukstei/dsh-client-kanban`](../dsh-client-kanban/README.md): uses `splitView` for navigation and status.
- [`@lukstei/dsh-client-review-git`](../dsh-client-review-git/README.md): adds a header action and overlay.

<a id="model-experience"></a>
## Model Experience

No model-visible surface. This package adds no tools, prompt text, or context to the model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The mobile threshold (768 px) is fixed.
- Split state is per browser (`localStorage`), not per user or host.
- No Review or Kanban dependency exists in this package; those plugins plug in through the service and slots.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`pnpm run verify` runs Biome, build, typecheck and tests.

</details>
