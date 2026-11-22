# @lukstei/dsh-client-review-git

## Summary

Read-only Git review for DSH sessions. A Workspace Review sidebar tab and a split-pane overlay compare branches, single commits, and staged or unstaged changes in the repositories a session touched. The agent can post a review card into the chat with `git_review_present`.

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
    - id: dsh-client-git-diff
      name: '@lukstei/dsh-client-review-git'
      config: {}
```

No config. Host entry `inject`: `sessionController`, `workingDirectory`, `sessions`, `sessionPersistence`; the tool part also needs `tools` and `agents`. Client (`platform: web`, `immediately: true`) needs `sidebarRightTabs`, `slots`, `remote`, `uiConversation`. It mounts the typed, session-addressed `workspaceReview` Remote (methods `catalog`, `resolve`, `commits`, `view`, `file`). Reload host and client together after an upgrade.

### Plugin dependencies

Server-side and client-side entries. Patch row id: `dsh-client-git-diff`.

**Server-side** (`inject`: `sessionController`, `workingDirectory`, `sessions`, `sessionPersistence`; child plugin for the tool injects `tools`, `agents`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `sessionController` | Required | @deepseek-ai/dsh-api-session-controller | Plugin stays pending; never applies. No `workspaceReview` Remote service and no `git_review_present` tool. |
| `workingDirectory` | Required | @deepseek-ai/dsh-working-directory | Plugin stays pending; never applies. |
| `sessions` | Required | @deepseek-ai/dsh-session | Plugin stays pending; never applies. |
| `sessionPersistence` | Required | @deepseek-ai/dsh-session-persistence | Plugin stays pending; never applies. |
| `tools`, `agents` | Required for the tool | @deepseek-ai/dsh-tools, @deepseek-ai/dsh-agent | Child plugin stays pending: `git_review_present` not registered; the Remote service still runs. |

**Client-side** (`inject`: `sidebarRightTabs`, `slots`, `remote`, `uiConversation`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `sidebarRightTabs`, `slots`, `remote`, `uiConversation` | Required | @deepseek-ai/dsh-client-ui-sidebar-right, @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-api-gateway, @deepseek-ai/dsh-client-ui-conversation (also `-chat` in `dsh.client.inject`) | Plugin stays pending; never applies. No review UI. |
| `splitView` + `remote.workspaceReview` | Optional | [`@lukstei/dsh-client-split-view`](../dsh-client-split-view/README.md); `workspaceReview` is this package's host service | Nested plugin stays pending: review cards cannot open the split-pane overlay (`opener` stays unset) and the pane-header review action is not registered. |

Code imports (no mount): [`@lukstei/util-review-ui`](../util-review-ui/README.md) (`review`, `types`, client components). Declared deps `@deepseek-ai/dsh-tool-present` are libraries; no `present` service is injected.

Used by: nothing.

### UI

- **Workspace Review** tab in the right sidebar (id `dsh-client-git-diff`), plus the `gitdiff.review` slot factory used by split-view overlays.
- With [`@lukstei/dsh-client-split-view`](../dsh-client-split-view/README.md), a sub-plugin adds a header button (`split.pane.header.actions`) that toggles the `gitdiff.review` overlay on that pane's session.
- The toolbar offers a repository dropdown when the session touched several repositories (a static label for one), then scopes: **Branches** (default **All commits**, with a separate commit dropdown) and **Working tree** (**Staged**, **Unstaged**).
- One file tree combines navigation and contents. Files start collapsed; click to expand inline. Rows show addition and deletion counts. File contents load on expansion and are cached until refresh.
- Selecting code offers a quote that is inserted into the conversation composer (clipboard copy when no composer is available).
- View state (repository, scope, expanded files, scroll, wrap) is kept per session in `localStorage` (`dsh-client-review-git:state:v1:<sessionId>`) for 24 hours.

### Scopes

- **Branch vs baseline.** Ordinary Git branches compare against the merge base with the remote's recorded default branch. Without exactly one `refs/remotes/*/HEAD` target, pick a baseline manually. GitButler-managed branches compare against the branch directly below them; bottom and standalone branches use `but --json config target`. A GitButler failure is shown without blocking plain Git comparisons.
- When GitButler inspection succeeds, `gitbutler/workspace`, `gitbutler/target` and `main` are hidden from the branch list but stay available as baselines. Branches without a commit in the last 7 days are not offered.
- **Commit.** Compares a commit with its first parent; a root commit shows its initial files. History loads 50 entries at a time.
- **Staged** compares HEAD with the index (including before the first commit). **Unstaged** compares the index with the working tree and includes non-ignored untracked files as additions. Both cover the current checkout, including a GitButler workspace.
- Git supplies changed-file metadata and counts. Hunks are computed client-side from both complete files, so expanding context needs no further reads. Binary or non-UTF-8 files and unresolved conflicts show a notice.
- Refresh reloads the repository and branch list. Reads never check out, fetch, or change Git state.

### Repository discovery

The session's current directory repository is always included. Further repositories come from files written or edited through the native `write`/`edit` tools (including calls via `run_code`) after the last working-directory change, with no file-count limit. Directory lookups are memoized. Refresh retries discovery. Shell edits and tools without path metadata are not discovered. A request for a repository outside this list is rejected.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Host entry: mounts `WorkspaceReviewService`, registers the tool, persists presented cards |
| [src/review-tool.ts](src/review-tool.ts) | `createGitReviewTool` (`git_review_present`) |
| [src/workspace-review-service.ts](src/workspace-review-service.ts) | `workspaceReview` Remote: session repository discovery and methods |
| [src/git-service.ts](src/git-service.ts) | `git` and `but` calls: repositories, scopes, commits, compare, file contents |
| [src/client/index.tsx](src/client/index.tsx) | Client entry: sidebar tab, slot factory, card slots, split sub-plugin |
| [src/client/contract.ts](src/client/contract.ts) | `gitdiff.review` factory and `tool.call.toolview` slot augmentations |
| [src/client/review-turn.ts](src/client/review-turn.ts) | Turn data node `git-review`, built from `command/run` events |
| `src/client/GitDiffPane.tsx`, `ReviewToolbar.tsx`, `FileInspector.tsx`, `GitReviewCard.tsx`, `GitReviewRow.tsx`, `useReviewViewState.ts` | UI and view state |
| [scripts/gen-typert.ts](scripts/gen-typert.ts) | Generates `lib/typert.host.*` and `lib/typert.remote-client.*` (`pnpm run gen:typert`, part of build/typecheck) |

On a successful `git_review_present` result the host appends a `command/run` (`git-review`, args `{ turn, callId, target }`) and a `command/done` event to the session. The client rebuilds cards from those events, so reloads and replays show the same cards. Review scope resolution is deferred to click time through `workspaceReview.resolve`. Cards render in `conversation.chat.turnTail`; the tool call row renders in `tool.call.toolview`.

Shared components and schemas come from [`@lukstei/util-review-ui`](../util-review-ui/README.md). Trust boundary: every Remote call is session-scoped and `repository` must be in the session's discovered list; git and `but` run as read-only commands.

Tests: unit specs beside sources; integration specs in [src/integration/](src/integration/) (`pnpm run test:integration`).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).
- [`@lukstei/util-review-ui`](../util-review-ui/README.md), [`@lukstei/dsh-client-split-view`](../dsh-client-split-view/README.md).

<a id="model-experience"></a>
## Model Experience

### git_review_present

#### What the model sees

Description: "Present a Git review card in the transcript. Always use it instead of writing the branch and commit into the reply when the user should inspect them." Parameters: `repository` (optional absolute path, or path relative to the session working directory, to a file or directory inside the repo; defaults to the working directory), `branch` (required, local branch name or full ref), `commit` (optional SHA or ref on `branch`; reviews that commit alone). Result text: `Git review ready: <branch> @ <short sha> (<repo name>)`, the commit and repo parts only when present.

#### Token effect

One tool schema per mounted agent and one short result line per call.

#### KV Cache effect

The schema is static for the mount lifetime. Results extend the conversation without rewriting its prefix.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The review card's open button needs Split View. Without it the call succeeds and the card shows, but it has no open action.
- Repository discovery ignores shell edits and tools without file path metadata.
- GitButler support relies on the `but` CLI being on the host `PATH`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`pnpm run verify` runs Biome, typert generation and build, typecheck, unit and integration tests. `pnpm run ladle` serves component stories.

</details>
