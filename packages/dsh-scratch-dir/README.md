# @lukstei/dsh-scratch-dir

## Summary

Creates a per-session scratch directory at `.agents/scratch/<sessionId>` in the session working directory and tells the agent its path through a system prompt section. Agents use it for plans, notes and throwaway files instead of the repo root.

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

Install with `dsh plugin --profile <profile> add @lukstei/dsh-scratch-dir`. The shipped [`cordis.patch.yml`](cordis.patch.yml) mounts:

```yaml
- insert:
    - id: scratch-dir
      name: '@lukstei/dsh-scratch-dir'
      config: {}
```

No config fields. Required services: `systemPrompt`, `workingDirectory`.

Behavior, on each `agent/created`:

- Creates `<workingDirectory>/.agents/scratch/<sessionId>` (recursive).
- Creates `.agents/scratch/.gitignore` containing `*` if it does not exist (`wx` flag; an existing file is left alone). Scratch files stay out of git.
- Adds the system prompt section described under [Model Experience](#model-experience).
- Rejects a session id that would resolve outside `.agents/scratch` (parent directory must equal the scratch root). No directory and no prompt section; a warning is logged.
- Any filesystem error is logged as a warning and the agent starts without the section.

Exported helper `scratchDirectory(cwd, sessionId)` returns the directory or `undefined` for an unsafe id. [`@lukstei/dsh-session-handoff`](../dsh-session-handoff/README.md) imports it.

### Plugin dependencies

Server-side only. `inject`: `systemPrompt`, `workingDirectory`.

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `systemPrompt` | Required | @deepseek-ai/dsh-system-prompt | Plugin stays pending; never applies. No prompt section. |
| `workingDirectory` | Required | @deepseek-ai/dsh-working-directory | Plugin stays pending; never applies. No directory created. |

Exports `scratchDirectory()` (pure function).

Used by: [`dsh-session-handoff`](../dsh-session-handoff/README.md) imports `scratchDirectory`; that is a code import, so mounting `scratch-dir` is not required.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Single file: [`src/index.ts`](src/index.ts). Tests: [`src/index.test.ts`](src/index.test.ts).

- The working directory is read with `ctx.workingDirectory.get(agent.session)` at agent creation. Later directory changes do not move the scratch directory.
- The section is registered on `agent.ctx.systemPrompt` with `interpolate: false`.
- Trust boundary: the session id is used as a path segment, so `scratchDirectory` checks `path.dirname(resolved) === scratchRoot`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).

<a id="model-experience"></a>
## Model Experience

### Scratch directory section

#### What the model sees

One system prompt section, name `lukstei-dsh-plugins:scratch-directory`, order `10300`:

```text
The scratch directory is located at <cwd>/.agents/scratch/<sessionId>.
```

#### Token effect

One sentence plus an absolute path, roughly 20 tokens per agent.

#### KV Cache effect

The text is fixed for the agent's lifetime, so it does not invalidate the cache within a session. It contains the session id, so the prompt differs from other sessions from this section onward; content ordered after it cannot share a prefix across sessions.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Directories are never cleaned up.
- The `.gitignore` is created only once; an existing one is not checked for content.
- Nothing stops the agent from writing elsewhere; the section is advisory.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
