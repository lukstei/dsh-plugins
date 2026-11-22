# @lukstei/dsh-resilient-persistence

## Summary

Hides sessions with corrupt event logs from `sessionPersistence.list()` so one bad log cannot crash session listing. Mount it in any profile that has long-lived session history.

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
    - id: resilient-session-persistence
      name: '@lukstei/dsh-resilient-persistence'
      config: {}
```

No config fields. Required service: `sessionPersistence`.

Behavior:

- Every session returned by `sessionPersistence.list()` is test-opened in `read` mode and closed again. A session whose open throws is dropped from the result.
- Verified results are cached per `${sessionId}:${revision}`. A session is re-checked only when its revision changes.
- A dropped session logs one warning (on first detection of that revision):

```text
[resilient-persistence] Corrupt session "<sessionId>" omitted: <error>
```

To remove a corrupt session for good, delete its folder under `~/.dsh/sessions/<sessionId>`.

### Plugin dependencies

Server-side only. `inject: sessionPersistence`.

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `sessionPersistence` | Required | @deepseek-ai/dsh-session-persistence | Plugin stays pending; never applies. No batch verification or corrupt-log filtering; upstream persistence runs unwrapped. |

Used by: nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Single file: [`src/index.ts`](src/index.ts). Tests: [`src/index.test.js`](src/index.test.js).

- `apply` replaces `persistence.list` inside `ctx.effect`. The original `list` is restored on dispose.
- A `Symbol.for("dsh.resilientSessionPersistence.wrapped")` marker on the service makes wrapping idempotent; it is removed on dispose.
- Uncached snapshots are verified in batches of 16 with `Promise.all`; `open` is the original, bound method.
- Cache values are `true` (valid) or `false` (corrupt). A cached `false` is omitted silently on later lists; the warning is not repeated.
- The cache lives in the `apply` closure and is never evicted.
- `list` options are passed through to both the original `list` and `open`.

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

- Monkey patch of `sessionPersistence.list`; upstream has no soft-fail hook for corrupt logs.
- Only failures at `open` are detected. A log that opens but breaks later is not filtered.
- Verification opens every uncached session once, so the first list after start is slower with many sessions.
- Corrupt sessions are hidden, not repaired. This includes logs written by a newer harness with unknown event types.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
