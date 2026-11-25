# @lukstei/dsh-session-handoff

## Summary

Adds a `/handoff` command that turns a session log into a short resume brief. Bare `/handoff` starts a new session beside the current one with the brief loaded; `/handoff <session-id>` writes another session's brief into the current session.

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

Mount through the bundle patch ([`cordis.patch.yml`](cordis.patch.yml)) and add the package to the profile:

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: session-handoff
      name: '@lukstei/dsh-session-handoff'
      config: {}
```

```json
// ~/.dsh/profiles/desktop/package.json
{
  "dsh": { "profile": { "bundles": ["@lukstei/dsh-session-handoff"] } },
  "dependencies": {
    "@lukstei/dsh-session-handoff": "^0.1.0"
  }
}
```

Then `pnpm install` in the profile directory and restart the harness. No config fields.

Required Host services (`inject`): `commands`, `sessionQuery`, `workingDirectory`, `sessionController`, `sessionTitle`, `workspaceRegistry`. Workspace dependency: [`@lukstei/dsh-scratch-dir`](../dsh-scratch-dir/README.md) (`scratchDirectory()`).

The client half needs `@deepseek-ai/dsh-api-session-controller` and [`@lukstei/dsh-client-split-view`](../dsh-client-split-view/README.md). Build it with `pnpm build` (emits `dist/client.js`); rebuild and restart after changing `src/client/`. The client bundle is marked `immediately` because no route lazily pulls it in; without stage-one prefetch its watcher would never register.

```text
/handoff
/handoff 06542298
/handoff 06542298-c989-417d-9ed4-fa5877768140
```

### Plugin dependencies

Server-side and client-side entries.

**Server-side** (`inject`: `commands`, `sessionQuery`, `workingDirectory`, `sessionController`, `sessionTitle`, `workspaceRegistry`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `commands` | Required | @deepseek-ai/dsh-commands | Plugin stays pending; never applies. No `/handoff`. |
| `sessionQuery` | Required | @deepseek-ai/dsh-session-query | Plugin stays pending; never applies. |
| `workingDirectory` | Required | @deepseek-ai/dsh-working-directory | Plugin stays pending; never applies. |
| `sessionController` | Required | @deepseek-ai/dsh-api-session-controller | Plugin stays pending; never applies. |
| `sessionTitle` | Required | @deepseek-ai/dsh-session-title | Plugin stays pending; never applies. |
| `workspaceRegistry` | Required | @deepseek-ai/dsh-workspace | Plugin stays pending; never applies. |

**Client-side** (`inject`: `sessions`, `splitView`, `slots`; all required):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `sessions` | Required | @deepseek-ai/dsh-api-session-controller | Plugin stays pending; never applies. |
| `splitView` | Required | [`@lukstei/dsh-client-split-view`](../dsh-client-split-view/README.md) (also in `dsh.client.inject`) | Plugin stays pending; never applies. The client entry (launch into a pane) does not activate; the host `/handoff` command still works. |

| `slots` | Required | @deepseek-ai/dsh-client-ui-renderer | Plugin stays pending; never applies. |

### Handoff ring

A small ring beside the send button marks a session worth handing off: yellow at 70k prompt tokens, red at 100k. After 5 idle minutes the prompt cache is cold and the bars drop to 40k and 70k. Both bars are also capped at 60% and 80% of the model's context window. For ACP agent sessions, which never report usage to DSH, it reads the agent's context usage from `@zaimokuza/dsh-acp-adapter` once per finished turn. The adapter is an optional peer dependency: without it the ring only covers regular DSH sessions. Display only; run `/handoff` yourself. Thresholds live in `src/client/level.ts`.

Code import (no mount): [`@lukstei/dsh-scratch-dir`](../dsh-scratch-dir/README.md) (`scratchDirectory`).

Used by: nothing.

### Modes

| Input | Brief describes | Brief lands in | Then |
|---|---|---|---|
| `/handoff` | this session | scratch directory of a newly created session | New session opens as a split pane; the source is marked done in Kanban and its pane is closed. |
| `/handoff <id-or-prefix>` | that session | `<cwd>/.agents/scratch/<current-session-id>/HANDOFF.md` | Current agent is told to read it. |

Id resolution: exact id first, then unique prefix over `sessionQuery.listSessions()`. Unknown ids return an error listing the 5 most recent sessions; ambiguous prefixes list candidates. Passing the current session's id is an error. Any non-id text, including `launch`, is treated as an id. A session with no turns returns an error. All I/O failures return `{ kind: "error" }`.

### Bare `/handoff` launch

1. Renders this session's brief.
2. Creates a session via `sessionController.create()` in the current workspace (falls back to `cwd` when the session has no workspace), same `agentPreset`.
3. Replays the current model selection onto the new agent.
4. Titles it with the full source title (or `Handoff <first 8 id chars>` when untitled) and renames the source to `<title> (Resumed)` unless it already ends with that. A user title pins it against auto-generated titles. Adds a Kanban link `Resumed from <source id>` (`dsh://sessions/<id>`, opens the source session) to record the origin.
5. Runs `/kanban {"action":"init","createdAt":…}` against the new agent so it appears on the Kanban board. No `prompt` is sent, since that would seed the composer draft with the follow-up text.
6. Copies the source session's kanban links by replaying its `add-link` commands against the new agent.
7. Writes `HANDOFF.md` into the new session's scratch directory and queues the read-the-brief follow-up.
8. Returns `Handoff launched: <id>`.

The client opens the pane. Without the client bundle the session is created but not opened.

### Brief layout

| Section | Contents |
| --- | --- |
| Header | session id, cwd, creation time, event and turn counts |
| `## Goal` | first user prompt, head 500 + tail 300 chars |
| `## Turns` | one `### T<n> [end reason]` block per turn: ask and final reply. Last 5 turns quote each 1200 head + 400 tail chars; older turns flatten to the ask (500/300) and reply (240 chars) |
| `## Failures` | every `tool/result` with `isError`: turn, tool name, reason (200 chars) |
| `## Artifacts` | deduped paths from tool call arguments (`path`, `file_path`, `filePath`, `notebook_path`), max 12 |

Empty sections render `none`. Output is deterministic for a given log. `request/header`, `agent/inbox/spliced` and reasoning blocks are excluded.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Files:

- [`src/index.ts`](src/index.ts): command registration, target resolution, `deliver` (write brief + queue follow-up), `createBeside` (launch).
- [`src/handoff.ts`](src/handoff.ts): `renderHandoff` and `handoffInstruction`, pure.
- [`src/launch.ts`](src/launch.ts): `LAUNCH_PREFIX`, `formatLaunchResult`, `launchedSessionId`.
- [`src/client/index.ts`](src/client/index.ts): client watcher. Tests sit beside each file.

Details:

- The command declares `input: { hint: "[session-id]" }`. Without a declared input the client sends the raw line to the model as a prompt and the handler never runs.
- A slash command has no structured return channel to the client, so the Host encodes the new id in the command result text, which is persisted in the `command/done` event. The client subscribes to every open session's event source and calls `ctx.splitView.replaceSession()` when it sees a successful `command/done` starting with `Handoff launched: `, replacing the pane in-place atomically. It then sends `/kanban {"action":"done"}` to the source session, as the Kanban Done button does. A source never initialised in Kanban ignores the done action.
- The pane is added through the split store, not `uiWorkspace.openSession()`. The split view patches that method into a read-only overlay without its own composer, so prompts would keep landing in the pane underneath.
- The client reacts only to `append` changes. A `replace` replays the whole window on first open and after reconnect gaps and would reopen panes the user closed; the split view restores its panes from local storage.
- Kanban membership is a session-log fact: the board lists only sessions whose `kanban` projection is initialized, which happens when `/kanban` runs in that session. Hence the explicit `init`.
- A session created by `cwd` alone is attached to no workspace and stays out of the sidebar tree until the next Host start, so the workspace id is used when available.
- Turn attribution: `user/message` carries no turn number, so it is attributed to the most recently opened turn.
- Artifact extraction parses tool arguments as JSON; non-JSON payloads are ignored.
- The scratch path comes from `scratchDirectory()`; an unsafe id throws and the command returns an error.

Trust boundary: the session id argument and session log contents are untrusted text; output is markdown written under the scratch directory only.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@lukstei/dsh-scratch-dir`](../dsh-scratch-dir/README.md) — scratch path convention.
- [`@lukstei/dsh-client-split-view`](../dsh-client-split-view) — pane host.
- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).

<a id="model-experience"></a>
## Model Experience

### /handoff

#### What the model sees

One queued follow-up user message in the receiving session:

```text
The handoff brief for session <id> is at <path>/HANDOFF.md.

Read that file now, then reply with three lines and stop:
Goal: <one line>
State: <one line>
Next: <one line>

Do not start the work until the user confirms the next action.
```

The model then reads `HANDOFF.md` with its own file tools. It gets no tool, system prompt section or other injected context from this package. A follow-up is used because the system prompt is fixed at the first request; `agent.followup()` writes a logged `user/message`, so the instruction is replayable and visible in the transcript.

#### Token effect

About 60 tokens for the message, plus the brief when read. Brief size grows with turn count (one `## Turns` block per turn, up to about 1,000 chars each for older turns; the last 5 turns are quoted longer).

#### KV Cache effect

Appended message only; the prompt prefix is untouched. In a launched session this is the first turn.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Opening the new pane needs the client bundle and the split-view plugin.
- The brief is a heuristic summary of the log; tool outputs, reasoning and request headers are not included.
- `## Turns` size is unbounded in turn count.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
