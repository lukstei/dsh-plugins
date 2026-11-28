# @lukstei/dsh-log

## Summary

Routes Cordis logger output to stdout and/or log files, with per-logger severity thresholds for each destination. Use it to keep a persistent log of selected loggers.

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

Install with `dsh plugin --profile <profile> add @lukstei/dsh-log`. The shipped [`cordis.patch.yml`](cordis.patch.yml) mounts `id: file-log` with one `stdout` output (`default: 2`, INFO). To add file output or change levels, override `file-log` in your profile `cordis.patch.yml`:

```yaml
- id: file-log
  config:
    outputs:
      - target: stdout
        levels: { default: 2, jev-audit: -1 }
      - target: file
        filePath: ~/.dsh/cache/approvals.log
        levels: { default: -1, jev-audit: 2 }
```

| Field | Default | Meaning |
|---|---|---|
| `outputs` | none | Array of destinations. Each registers its own Cordis exporter. |
| `outputs[].target` | required | `stdout` or `file`. |
| `outputs[].filePath` | required for `file` | Log file path. `~` or `~/...` expands to the home directory. |
| `outputs[].levels` | required | Map of logger name to threshold. `default` is the catch-all. |

Levels: `-1` silenced, `0` ERROR, `1` WARN, `2` INFO, `3` DEBUG. A message is written when its level is at most the threshold. `default: -1` plus named loggers gives an include-list.

Line format: `<ISO timestamp> [<LEVEL padded to 5>] [<logger>] <message>`.

If the host already prints logs to the console, a `stdout` output duplicates them.

### Plugin dependencies

No plugin dependencies. The plugin has no `inject`; it registers `ctx.logger.exporter` on the Cordis context.

Non-plugin requirement: write access to any configured `outputs[].filePath` (the file target).

Used by: nothing mounts it as a dependency.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Single file: [`src/index.ts`](src/index.ts). Tests: [`src/index.test.js`](src/index.test.js). Exports `Config`, `formatMessage`, `expandHome`, `createFileWriter`, `apply`.

- `apply` loops over `outputs` and calls `ctx.logger.exporter({ colors: false, levels, export })` for each.
- File writes use `appendFileSync`. The parent directory is created recursively on the first write.
- Write errors are swallowed so a failing disk cannot trigger recursive logging.
- Config is a schemastery union on `target`; `filePath` and `levels` are required.

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

- No rotation or size limit on log files.
- File write failures are silent.
- A configured `outputs` entry with an empty array writes nothing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
