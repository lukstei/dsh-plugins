# @lukstei/dsh-client-kanban

## Summary

A Kanban board for DSH sessions with four lanes: To Do, Active, Review, Done. It replaces the workspace list in the sidebar when switched on, and is also a main panel. Lane state is derived from session events, so it survives reloads without browser storage. It also gives the agent a tool to attach links to a session.

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
    - id: kanban
      name: '@lukstei/dsh-client-kanban'
      config:
        kanban_add_link_tool_enabled: true
        kanban_add_link_tool_instructions: 'Collect task tickets and pull requests. Use concise labels.'
```

Host entry (`inject`: `commands`, `sessionProjections`, `tools`) registers the `kanban` session projection, the `/kanban` command, the optional `kanban_add_link` tool and scoped search. The client entry (`platform: web`, `immediately: true`) needs `slots`, `uiWorkspace`, `sessions`, `workspaces`, `uiSession`, `layout`, `remote`.

| Field | Default | Meaning |
|---|---|---|
| `kanban_add_link_tool_enabled` | `true` | Register `kanban_add_link`. `false` stops advertising it; existing links stay visible |
| `kanban_add_link_tool_instructions` | See [Model Experience](#model-experience) | Guidance appended to the tool description |

### Plugin dependencies

Server-side and client-side entries.

**Server-side** (`inject`: `commands`, `sessionProjections`, `tools`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `commands` | Required | @deepseek-ai/dsh-commands | Plugin stays pending; never applies. No `/kanban` command. |
| `sessionProjections` | Required | @deepseek-ai/dsh-session-projection | Plugin stays pending; never applies. No board state. |
| `tools` | Required | @deepseek-ai/dsh-tools | Plugin stays pending; never applies. No `kanban_add_link` tool. |
| `sessionQuery`, `remoteAccess`, `typert` (child plugin `KanbanSearch`) | Required for search only | @deepseek-ai/dsh-session-query (+ a backend such as `session-query-sqlite`), @deepseek-ai/dsh-api-remote-access, @deepseek-ai/dsh-typert-registry | `KanbanSearch` is mounted with `ctx.plugin(KanbanSearch)` and not awaited: it stays pending and board search is unavailable. Board, command and tool still work. |

**Client-side** (`inject`: `slots`, `uiWorkspace`, `sessions`, `workspaces`, `uiSession`, `layout`, `remote`, plus `remote.kanban` for the nested board plugin):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `slots`, `uiWorkspace`, `sessions`, `workspaces`, `uiSession`, `layout`, `remote` | Required | @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-workspace, @deepseek-ai/dsh-api-session-controller, @deepseek-ai/dsh-api-workspace-controller, @deepseek-ai/dsh-client-ui-session, @deepseek-ai/dsh-client-ui-layout, @deepseek-ai/dsh-api-gateway (also `dsh-api-remotes`, `dsh-client-ui-sidebar`, `-chat`, `-conversation` in `dsh.client.inject`) | Plugin stays pending; never applies. No board. |
| `remote.kanban` | Required | This package's host `KanbanSearch` (via the Gateway) | Nested board plugin stays pending. |
| `splitView` | Optional | [`@lukstei/dsh-client-split-view`](../dsh-client-split-view/README.md) | Nested `ctx.plugin({inject: ['splitView']})` stays pending. Sessions open through `uiWorkspace.openSession`; no pane focus, fallback panel, or pane status dots. |
| `faviconBadge` | Optional | [`@lukstei/dsh-client-favicon`](../dsh-client-favicon/README.md) | Nested plugin stays pending. Review count is not shown in the favicon. |
| `appBadge` | Optional | [`@lukstei/dsh-client-notify`](../dsh-client-notify/README.md) | Nested plugin stays pending. Recent-review count is not set on the app icon. |

Type-only imports of the sibling client contracts (`split-view`, `favicon`, `notify`) exist for typing; they do not mount anything.

Used by: nothing.

### Board

Only sessions started from Kanban (`/kanban` init) appear. Unmanaged sessions are not shown.

| Lane | Derivation |
|---|---|
| Review | Pending interaction, or stopped without `doneAt` and (`reviewAt` set, or neither blank nor held) |
| Active | The session runs, or one of its subagents runs (and no interaction is pending) |
| Done | Stopped with `doneAt` set |
| To Do | Stopped, no `doneAt`/`reviewAt`, and blank or held |

Order of checks: pending interaction (Review), running or active subagent (Active), `doneAt` (Done), `reviewAt` (Review), blank or held (To Do), else Review. Sending a user message clears `doneAt`, `heldAt` and `reviewAt`.

- Done cards expire seven days after `doneAt` and are hidden from the board unless pinned. The session itself is not deleted.
- A blank session with no prompt, hold, review or done marker is hidden.
- Moves: drag cards between lane drop zones, or use the card buttons and the prompt-bar transition dropdown (`conversation.input.left`). Allowed between distinct stopped lanes, plus To Do → Active (starts the prepared prompt). Active cards cannot be moved; Review and Done cannot go straight to Active.
- Quick actions: Done, Reopen (back to Review), Hold, Unhold, Pin (Done only), Delete. Moves do not send a prompt.
- Lanes fold individually. The search box filters cards and runs a scoped content search over the board's sessions (user and assistant messages, 20 hits max).
- The in-flight sidebar lists in-flight sessions. Double-click a sidebar row to maximize its pane in split view; again to restore.
- Sidebar mode (workspaces or kanban) is kept in `localStorage` (`dsh-sidebar-view-mode`). The sidebar icon (`sidebar.panellist`) shows only while the mode is not kanban.
- Prepared task prompts are seeded as the session draft (`dsh.conversation.<id>` in `localStorage`) until the task starts.

### `/kanban` command

`/kanban` with no argument enables the session. `/kanban <json>` takes an action payload: `init` (`createdAt`, optional `prompt`), `done`, `reopen`, `delete`, `hold`, `unhold`, `pin`, `unpin`, `add-link` (see [`src/types.ts`](src/types.ts)). Invalid JSON or schema returns an error result. The client sends these through the session; the command card is suppressed in the chat.

### Session links

The agent saves links with `kanban_add_link`:

```json
{"label":"Task Ticket: EXAMPLE-1232","url":"https://jira.example/browse/EXAMPLE-1232","priority":-10}
```

- Only absolute `http(s)` URLs and non-empty labels are accepted. One call saves one link to the caller's session. The same URL again updates its label and priority.
- Lower `priority` sorts first (default `0`). Ties keep collection order.
- The link icon on a card or in-flight row opens the list; a row opens its URL in a new tab. Sessions without links show no icon.
- Links are stored in `/kanban` command events, so they reload with the session. Adding a link does not change the lane or enroll an unmanaged session. Deleted tasks reject links.

### Optional integrations

All are optional and activation does not wait for them.

- [`@lukstei/dsh-client-split-view`](../dsh-client-split-view/README.md): pane navigation and status dots. Board card click adds or focuses the pane and maximizes it. Expanded sidebar row click adds or focuses the pane and keeps the others. In the collapsed rail, a dot click focuses; Command/Control-click toggles membership. Sessions open in a pane stay listed in the sidebar even when Done or On Hold. Closing the last pane returns to Kanban (`setFallbackPanelId('kanban')`). Without it, sessions open through `uiWorkspace.openSession`.
- [`@lukstei/dsh-client-favicon`](../dsh-client-favicon/README.md): receives the review lane count (`faviconBadge`), reset to 0 on unload.
- [`@lukstei/dsh-client-notify`](../dsh-client-notify/README.md): receives the count of recent review sessions (30-minute window, refreshed every 60 s) through `appBadge`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Architecture: functional core, imperative shell.

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Host: projection, `/kanban`, `kanban_add_link`, mounts `KanbanSearch` |
| [src/fold.ts](src/fold.ts) | Pure fold of `command/run` (`kanban`) and message events into `KanbanState`; `toKanbanRecord` sorts links by priority |
| [src/types.ts](src/types.ts) | Link and payload schemas, `KanbanRecord`, `ONE_WEEK_MS` |
| [src/search.ts](src/search.ts), [src/search-host.ts](src/search-host.ts) | Strict `kanban/search` remote (`SEARCH_RESULT_LIMIT` 20) and its host service, filtered by `remoteAccess` |
| [src/client/index.tsx](src/client/index.tsx) | Client entry: slots, hydration, commands, badges |
| [src/client/store.ts](src/client/store.ts) | Pure classification, filtering, sorting, transitions |
| [src/client/navigation.ts](src/client/navigation.ts) | Navigation shim, replaced by split view when present |
| `src/client/Kanban*.tsx`, `InFlightSidebar.tsx`, `SessionLinks.tsx`, `styles.ts`, `sidebar-mode.ts` | UI |

Persisted state is the `kanban` session projection (`stateVersion` 12), folded from session events, with no host KV domain or other storage. `initialized`/`deleted` flags are internal; `toKanbanRecord` returns `null` for uninitialized or deleted sessions. Fold rules: `done` and `hold` clear `reviewAt`; `reopen` clears `doneAt` and sets `reviewAt`; `unhold` is ignored if `doneAt` or `reviewAt` is set; `pin` needs `doneAt`.

The client hydrates projections lazily for sessions relevant to the sidebar (see `isSessionRelevantToSidebar` in [src/client/store.ts](src/client/store.ts)). UI registrations: `main` key `kanban`, `sidebar.workspaces` (priority -10, kanban mode only), `sidebar.panellist`, `conversation.input.left`, `conversation.chat.commandview`, and the split slots when `splitView` is present.

Tests: [tests/](tests/). Stories: `pnpm run ladle`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).
- Sibling packages linked under Optional integrations.

<a id="model-experience"></a>
## Model Experience

### kanban_add_link

#### What the model sees

Tool description: "Collect a confirmed HTTP(S) URL for the current session. Reusing a URL updates its label and priority without duplicating it. Does not change Kanban status." followed by `kanban_add_link_tool_instructions`. The default instructions ask for important task-related links, concise unambiguous labels, negative priority for task links, zero or positive for context links, with examples. Parameters: `label` (required), `url` (required), `priority` (number, default 0). Result text: `Saved session link: <label> (<url>)`.

The tool is offered only in sessions that are initialized in Kanban and not deleted.

#### Token effect

One tool schema plus the instruction text (a few hundred characters by default) for Kanban sessions, and one short result line per saved link. Sessions outside Kanban pay nothing.

#### KV Cache effect

The schema is static for the mount lifetime; changing the instructions config changes the tool description and invalidates cached prefixes. Because availability depends on session state, the tool list differs between a session before and after `/kanban` init.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Expired Done cards are hidden, not deleted.
- Links saved before priority support read as priority `0`.
- The old `workspaceLinks` config and first-message link extraction are gone. Projection consumers use the `links` array, not a singular `link`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Bumping the projection shape requires a `stateVersion` change in [src/index.ts](src/index.ts). `pnpm run verify` runs Biome, build, typecheck and tests.

</details>
