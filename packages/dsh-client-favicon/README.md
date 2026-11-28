# @lukstei/dsh-client-favicon

## Summary

Draws the browser tab favicon as an eight-tick status ring. Green ticks show running sessions, orange ticks show sessions awaiting review, and a centre pip shows pending interactions. For anyone running several DSH sessions in one tab.

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

Install with `dsh plugin --profile <profile> add @lukstei/dsh-client-favicon`. The shipped [`cordis.patch.yml`](cordis.patch.yml) mounts:

```yaml
- insert:
    - id: favicon
      name: '@lukstei/dsh-client-favicon'
```

No config. Client plugin (`platform: web`, `immediately: true`). It needs `sessions` and `uiSession`, from `@deepseek-ai/dsh-api-session-controller` and `@deepseek-ai/dsh-client-ui-session`. It needs no notification or audio permission.

| Signal | Source | Rendering |
|---|---|---|
| Running | `sessionStatus.running`, else `sessions.list` summary `running` | Green ticks, filled from the bottom |
| Review | `faviconBadge.setBadge({ reviewCount })` | Orange ticks, filled from the top |
| Pending interaction | `sessionStatus.pendingInteraction` | Red centre pip |
| Review overflow | `reviewCount` larger than the free ticks | Orange centre pip (the red pip wins) |

- The ring has 8 ticks. Running ticks take priority; review fills the remaining ticks. Counts are not drawn as numbers.
- Sessions are the union of ids in the session list and the status store, so subagents count.
- With no running session, no pending interaction and `reviewCount` 0, the original favicon is restored.
- If the page has `link[rel~='icon']` elements, their `href` is replaced. Otherwise one `<link rel="icon" type="image/svg+xml">` is created. Disposal restores the original hrefs and removes the created link.

Other client plugins can inject `faviconBadge` (`IFaviconBadge`, from `@lukstei/dsh-client-favicon/client-contract`) and call `setBadge({ reviewCount })`. Reset it to 0 when the caller unloads. [`@lukstei/dsh-client-kanban`](../dsh-client-kanban/README.md) does this with its review lane count.

### Plugin dependencies

Client-side only (`dsh.client`, no host entry). Client `inject`: `sessions`, `uiSession` (all required; the client plugin stays pending without them).

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `sessions` | Required | @deepseek-ai/dsh-api-session-controller | Plugin stays pending; never applies. |
| `uiSession` | Required | @deepseek-ai/dsh-client-ui-session | Plugin stays pending; never applies. |

Provides the client service `faviconBadge`.

Used by: [`dsh-client-kanban`](../dsh-client-kanban/README.md) (optional `faviconBadge` consumer; its review count only reaches the favicon when this is mounted).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Host entry, a no-op `apply` |
| [src/client/index.tsx](src/client/index.tsx) | Client entry: subscribes to the session list and status store, swaps favicon hrefs, provides `faviconBadge` |
| [src/client/favicon.ts](src/client/favicon.ts) | Pure `generateFaviconSvg` / `renderFaviconBadgeUri` (SVG data URI) |
| [src/client/contract.ts](src/client/contract.ts) | `IFaviconBadge` and the `Context.faviconBadge` augmentation |

The renderer takes `{ running, review, alert }`. Tick order is clockwise from north: running fills S, SW, SE, W, E, NW, NE, N; review fills N, NW, NE, W, E, SW, SE, S. Inputs are floored and clamped at 0. It never throws.

Persisted state: none. The effect re-renders on every session-list and status-store change.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).
- [`@lukstei/dsh-client-kanban`](../dsh-client-kanban/README.md): supplies the review count.
- [`@lukstei/dsh-client-notify`](../dsh-client-notify/README.md): app-icon badge and desktop notifications.

<a id="model-experience"></a>
## Model Experience

No model-visible surface. This package adds no tools, prompt text, or context to the model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Browsers differ in whether they show dynamic SVG tab favicons. Mobile launch icons and pinned tabs follow browser-specific behavior.
- An existing `link[rel~='icon']` is overwritten in place; with several icon links, all get the same SVG.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`pnpm run verify` runs Biome, build, typecheck and tests ([tests/favicon.spec.ts](tests/favicon.spec.ts) for the renderer, [tests/lifecycle.spec.ts](tests/lifecycle.spec.ts) for restore/dispose).

</details>
