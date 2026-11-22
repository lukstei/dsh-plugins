# @lukstei/dsh-client-notify

## Summary

Alerts you when an agent stops or needs input. It shows a desktop notification, plays a short synthesized chime, and sets the installed PWA's app-icon badge. For anyone who leaves the DSH tab in the background.

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
    - id: client-notify
      name: '@lukstei/dsh-client-notify'
```

No config. The package has a host part and a client part:

- Host (`inject: webServer`): serves the Service Worker script at `/sw.js` and `/tsctl/sw.js` with `service-worker-allowed: /` and `cache-control: no-cache`.
- Client (`platform: web`, `immediately: true`): needs `remote`, `remote.session`, `sessions`, `uiSession`.

### Plugin dependencies

Server-side and client-side entries.

**Server-side** (`inject: webServer`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `webServer` | Required | @deepseek-ai/dsh-host-webserver | Plugin stays pending; never applies. `/sw.js` and `/tsctl/sw.js` are not served, so the Service Worker cannot register. |

**Client-side** (`inject`: `remote`, `remote.session`, `sessions`, `uiSession`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `remote`, `remote.session` | Required | @deepseek-ai/dsh-api-remotes / @deepseek-ai/dsh-api-session-controller | Plugin stays pending; never applies. No notifications. |
| `sessions`, `uiSession` | Required | @deepseek-ai/dsh-api-session-controller, @deepseek-ai/dsh-client-ui-session | Plugin stays pending; never applies. |

Provides the client service `appBadge`.

Used by: [`dsh-client-kanban`](../dsh-client-kanban/README.md) (optional `appBadge` consumer).

### Triggers

| Event | Notification text | Sound |
|---|---|---|
| Session stops running | `Agent stopped` | pop chime |
| Pending approval (`approval` kind, `acp-permission:` key, or an approval question) | `Tool approval requested: <tool name or first question>` | alert chime |
| Pending question | `Question: <first question>` | alert chime |
| Any other pending interaction kind except `plan-review` | `Action required: <kind>` | alert chime |

Rules:

- Stop notifications are debounced by 3 s. A session that starts running again inside that window stays silent, so workflow steps and chained turns do not alert.
- A stop notifies only if the session appended a `user/message` or `assistant/message` within the last 60 s. Runs that append no chat message (command-driven work) stay silent. A failed events read fails open and notifies.
- A session with running subagents does not notify. When the last subagent stops, the parent is checked with the same debounce.
- Interactions from subagent sessions never notify. Each interaction key notifies once.
- On desktop, nothing is shown while the tab has focus and is visible (`document.hasFocus() && !document.hidden`). The chime still plays. On touch devices (`pointer: coarse` or `maxTouchPoints > 0`) this check is skipped.
- A notification needs `Notification.permission === 'granted'`. The chime plays regardless.

### Permission and Service Worker

On start the client registers `/sw.js` (scope `/`, falling back to `sw.js`). If notification permission is `default`, it requests permission on the first `click`, `touchend` or `keydown`. Notifications go through the Service Worker registration (`showNotification`) when one is ready within 300 ms, else `new Notification()`. Clicking a notification focuses an existing DSH window or opens `/`.

### App icon badge

The badge (`navigator.setAppBadge`) shows sessions with a pending interaction plus recent review sessions. It is cleared at 0 and on unload. [`@lukstei/dsh-client-kanban`](../dsh-client-kanban/README.md) supplies the review part through `appBadge.setRecentReviewCount(n)` (`IAppBadge`, from `@lukstei/dsh-client-notify/client-contract`). Without Kanban the badge counts pending interactions only. The browser rejects the call when the app is not installed or permission is missing; the error is ignored. iOS shows the badge only after notification permission is granted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Host: `SERVICE_WORKER_SCRIPT` and the two exact routes |
| [src/client/index.ts](src/client/index.ts) | Client: stop debounce, interaction watcher, `appBadge` provider |
| [src/client/notify.ts](src/client/notify.ts) | Service Worker registration, permission lifecycle, notification display |
| [src/client/sound.ts](src/client/sound.ts) | Web Audio chimes |
| [src/client/badge.ts](src/client/badge.ts) | `syncAppBadge` |
| [src/client/contract.ts](src/client/contract.ts) | `IAppBadge` and the `Context.appBadge` augmentation |

Chimes are sine oscillators, no audio files. The pop chime is 791 Hz with a fast pitch drop and about 70 ms decay. The alert chime is 587.33 Hz then 880 Hz, 120 ms apart. One `AudioContext` is created lazily, reused, and resumed when suspended. Audio errors are swallowed.

Stop detection listens to `api-session/status` on `remote`. Pending interactions come from `uiSession.sessionStatus`. Notification icon is `/favicon.svg`.

The Service Worker script handles `install` (`skipWaiting`), `activate` (`clients.claim`) and `notificationclick`. Persisted state: none.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).
- [`@lukstei/dsh-client-pwa`](../dsh-client-pwa/README.md): PWA manifest and icons for installed-app badges.
- [`@lukstei/dsh-client-favicon`](../dsh-client-favicon/README.md): tab favicon status.

<a id="model-experience"></a>
## Model Experience

No model-visible surface. This package adds no tools, prompt text, or context to the model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The Service Worker routes are fixed to `/sw.js` and `/tsctl/sw.js`. Other reverse-proxy prefixes are not served.
- Notification permission needs a user gesture, so no notification is shown before the first click, tap or key press.
- `plan-review` interactions do not notify.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`pnpm run verify` runs Biome, build, typecheck and tests (specs live beside the sources in `src/`).

</details>
