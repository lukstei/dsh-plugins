# @lukstei/dsh-client-pwa

## Summary

Makes DSH installable as a PWA and lets trusted reverse-proxy requests log in without a token. It serves the web manifest and icons, injects the manifest links into the index page, and wraps the connection's index authorization with header and IP trust checks. For deployments behind Tailscale or another authenticating proxy.

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

Host plugin. Requires `webServer` and `connection`. Mount (this is the bundle patch, [cordis.patch.yml](cordis.patch.yml)):

```yaml
- insert:
    - id: client-pwa
      name: '@lukstei/dsh-client-pwa'
      config:
        auth:
          userHeader: 'tailscale-user-login'
          trustedCidrs: ['127.0.0.1', '::1', '100.64.0.0/10', 'fd7a:115c:a1e0::/48']
          authRoutes: ['/login', '/auth/tailscale', '/auto-login']
          loginRedirectPath: '/login'
        pwa:
          pathPrefixes: ['/tsctl']
```

### Config: `auth`

| Field | Default | Meaning |
|---|---|---|
| `userHeader` | none | Request header carrying the verified user (e.g. `tailscale-user-login`, `x-forwarded-user`, `remote-user`) |
| `allowedUsers` | none | If non-empty, only these users are trusted |
| `trustedCidrs` | none | Trusted IPv4/IPv6 addresses or CIDR blocks |
| `authRoutes` | `['/login']` | Route paths that perform the token exchange |
| `loginRedirectPath` | `/login` | Where trusted but unauthenticated index requests are sent |
| `secureCookies` | `true` | Append `; Secure` to `Set-Cookie` when `x-forwarded-proto: https` |

### Config: `pwa`

| Field | Default | Meaning |
|---|---|---|
| `name` | `DeepSeek Harness` | Manifest `name` |
| `shortName` | `DSH` | Manifest `short_name` |
| `themeColor` | `#1f2430` | Manifest `theme_color` |
| `backgroundColor` | `#0f172a` | Manifest `background_color` |
| `startUrl` | `/login` | Manifest `start_url` |
| `scope` | `/` | Manifest `scope` |
| `display` | `standalone` | Manifest `display` |
| `pathPrefixes` | none | Extra prefixes (e.g. `/tsctl`) where routes are also mounted; the root mount always exists |

### Plugin dependencies

Server-side only (no client entry). `inject`: `webServer`, `connection`.

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `webServer` | Required | @deepseek-ai/dsh-host-webserver | Plugin stays pending; never applies. No manifest, icons, or head injection. |
| `connection` | Required | @deepseek-ai/dsh-client-connection | Plugin stays pending; never applies. Its `authorizeIndex`/`admit` wrapper (reverse-proxy login) is not installed. |

Non-plugin requirement: a reverse proxy that sets the configured `auth.userHeader` and connects from `auth.trustedCidrs`; otherwise trusted login never fires.

The package patch carries Tailscale defaults. Used by: nothing.

### Behavior

- Routes per prefix: `<prefix>/manifest.webmanifest` (`no-store`), `<prefix>/icons/{180,192,512}.png` (`max-age=86400`, 404 for other sizes), and each auth route as a prefix route. Auth routes without a leading `/` get one.
- The index HTML gets `<link rel="apple-touch-icon" href="/icons/180.png">` and `<link rel="manifest" href="/manifest.webmanifest">` (an existing manifest link is replaced). The injected links use root paths, not prefixed ones.
- Trust check (`isTrustedRequest`): if `userHeader` is set and present, the user must be in `allowedUsers` when that list is non-empty. If the header is missing and `allowedUsers` is non-empty, the request is untrusted. Otherwise the client IP must match `trustedCidrs`. The IP is the first `x-forwarded-for` entry, else the socket address (the socket address is passed on auth routes only).
- Auth route: 400 without `Host`, 403 if untrusted, else 303 to `connection.authenticatedUrl(https://<host><matched prefix>)` with `cache-control: no-store` and `referrer-policy: no-referrer`.
- Index request without a `token` query param that the connection rejects: if the request is trusted, answer 200 with a small HTML page that does `location.replace(loginRedirectPath)`. Otherwise the original authorization runs.
- The wrap of `connection.authorizeIndex` is restored on dispose.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Schemas (`Config`, `AuthConfig`, `PwaConfig`), trust helpers, `wrapAuthorizeIndex`, `handleAuthRedirect`, route registration |
| [src/pwa.ts](src/pwa.ts) | `DEFAULT_PWA_OPTIONS`, `pwaManifest`, `injectPwaHead`, `handleIconRequest` |
| [src/icons.ts](src/icons.ts) | Embedded base64 PNG icons for 180, 192, 512 |

`normalizePrefixes` trims slashes, drops empties and always includes `""`. `isIpInCidrs` uses `node:net` `BlockList`; it strips an IPv6 zone and `::ffff:` mapping, and skips invalid entries. Manifest icons: `/favicon.svg` (any), `/icons/192.png` and `/icons/512.png` (any maskable), served from the root paths.

Persisted state: none. Trust boundary: the user header and `x-forwarded-for` are trusted as sent, so the proxy in front must set or strip them.

Tests: [src/index.test.ts](src/index.test.ts), [src/pwa.test.ts](src/pwa.test.ts) (`node --test`).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).
- [`@lukstei/dsh-client-notify`](../dsh-client-notify/README.md): Service Worker, notifications and app-icon badge.

<a id="model-experience"></a>
## Model Experience

No model-visible surface. This package adds no tools, prompt text, or context to the model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The index bounce checks the user header and `x-forwarded-for` only. It does not pass the socket address, so CIDR trust at the index needs a proxy that sets `x-forwarded-for`.
- Injected manifest and touch-icon links always use root paths.
- The auth redirect always targets `https://`.
- Headers are trusted without signature; deploy only behind a proxy that controls them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`pnpm run verify` runs Biome, typecheck and `node --test`. There is no build step; `main` points at `src/index.ts`.

</details>
