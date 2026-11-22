# dsh-plugins

Plugins and client extensions for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH), published as `@lukstei/*` packages.

Plugin versions follow the DSH release they target: `<dsh-version>.<n>`, for example `0.2.3-alpha.2.1` targets DSH `0.2.3-alpha.2`.

## Install a plugin

```sh
dsh plugin --profile <profile-name> add github:lukstei/dsh-plugins#path:packages/<package>
```

## Packages

| Package | Description |
| --- | --- |
| [`@lukstei/dsh-client-favicon`](packages/dsh-client-favicon/README.md) | Browser favicon status badges for DeepSeek Harness |
| [`@lukstei/dsh-client-kanban`](packages/dsh-client-kanban/README.md) | Multi-session vertical Kanban board plugin for DeepSeek Harness with native host persistence |
| [`@lukstei/dsh-client-notify`](packages/dsh-client-notify/README.md) | Client-side browser desktop notification plugin for DeepSeek Harness |
| [`@lukstei/dsh-client-pwa`](packages/dsh-client-pwa/README.md) | Progressive Web App assets and reverse proxy authentication for DSH |
| [`@lukstei/dsh-client-review-git`](packages/dsh-client-review-git/README.md) | Git diff and GitButler change view client plugin for DeepSeek Harness |
| [`@lukstei/dsh-client-split-view`](packages/dsh-client-split-view/README.md) | Concurrent multi-session split view and overlay layout plugin for DeepSeek Harness |
| [`@lukstei/dsh-debug`](packages/dsh-debug/README.md) | Debug commands and transcript tools for DSH |
| [`@lukstei/dsh-log`](packages/dsh-log/README.md) | File logging exporter for DSH |
| [`@lukstei/dsh-resilient-persistence`](packages/dsh-resilient-persistence/README.md) | Corrupt session protection for DSH session persistence |
| [`@lukstei/dsh-schedule-script`](packages/dsh-schedule-script/README.md) | Background script executor and prompt loop for DSH |
| [`@lukstei/dsh-scratch-dir`](packages/dsh-scratch-dir/README.md) | Scratch directory provisioner for DSH sessions |
| [`@lukstei/dsh-session-handoff`](packages/dsh-session-handoff/README.md) | Session handoff brief command for DSH |
| [`@lukstei/dsh-yaml-workflow`](packages/dsh-yaml-workflow/README.md) | Execute sequential prompt workflows from YAML |
| [`@lukstei/util-review-ui`](packages/util-review-ui/README.md) | Shared review UI components, types and styles for DSH review and split-view plugins |

## Development

```sh
pnpm install
pnpm run verify
```

The packages live in [`packages/`](packages/). This repository is generated from a private monorepo; history starts at the first release.

## License

[MIT](LICENSE)
