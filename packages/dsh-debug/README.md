# @lukstei/dsh-debug

## Summary

Adds two slash commands that copy the current session's transcript or ID to the clipboard. Use them to attach a session to a bug report.

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

Mount through the bundle patch ([`cordis.patch.yml`](cordis.patch.yml)):

```yaml
- insert:
    - id: debug
      name: '@lukstei/dsh-debug'
      config: {}
```

Required service: `commands`.

| Field | Default | Meaning |
|---|---|---|
| `copy` | `pbcopy` writer | Hidden, programmatic only: `(text: string) => Promise<void>`. Not settable from YAML. |

Commands:

| Command | Result |
|---|---|
| `/copy-transcript` | Copies all events of the session's in-memory snapshot as JSON Lines. Success text: `Copied <n> session events to clipboard`. Error `Session contains no events to copy` if empty; the clipboard is left untouched. |
| `/copy-session-id` | Copies the session id. |

The default clipboard writer spawns `pbcopy` and works on macOS only. Other platforms fail with `Clipboard copy is unsupported on <platform>; expected darwin`, returned as a command error (`Failed to copy ...`). To support Linux, pass a `copy` function when mounting programmatically:

```typescript
ctx.plugin(debugPlugin, {
  copy: async (text: string) => {
    // pipe to wl-copy, xclip, or a test sink
  },
});
```

### Plugin dependencies

Server-side only. `inject: commands`.

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `commands` | Required | @deepseek-ai/dsh-commands | Plugin stays pending; never applies. No `/copy-transcript` or `/copy-session-id`. |

Non-plugin requirement: default clipboard export spawns `pbcopy` (macOS only; other platforms reject with an error; `config.copy` replaces it).

Used by: nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Single file: [`src/index.ts`](src/index.ts). Tests: [`src/index.test.js`](src/index.test.js). Exports `Config`, `serializeEventsToJsonl`, `copyToClipboard`, `apply`.

- `/copy-transcript` reads `invocation.agent.session.snapshotEvents()` (live in-memory events, deprecated upstream API) and serializes one `JSON.stringify(event)` per line, trailing newline.
- Handlers return `{ kind: "success" | "error", text }`; clipboard failures never throw.
- `Config.copy` is `Schema.any().hidden()`: no type validation of the supplied function.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).

<a id="model-experience"></a>
## Model Experience

No model-visible surface. This package adds no tools, prompt text, or context to the model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Clipboard support is macOS only unless a custom `copy` is supplied.
- The transcript is the in-memory snapshot, not the persisted log.
- Uses the deprecated `snapshotEvents()`; no replacement is wired.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
