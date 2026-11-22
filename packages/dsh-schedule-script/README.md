# @lukstei/dsh-schedule-script

## Summary

Runs recurring TypeScript scripts in the background without calling the model. A script polls something, keeps state between runs, and only wakes the agent when it returns a `prompt`. Agents use it through the `schedule-script` skill and two tools; users see a status button and a command card in the chat.

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

Mount it in the agent's Cordis composition (also shipped as `cordis.patch.yml`):

```yaml
- id: schedule-script
  name: '@lukstei/dsh-schedule-script'
  config: {}
```

The plugin has no config fields. Required services (`inject`): `commands`, `sessionProjections`, `tools`, `skills`, `schedule`. The web client bundle (`./client`) needs `slots`, `remote`, `remote.schedule`.

### Plugin dependencies

Server-side and client-side entries.

**Server-side** (`inject`: `commands`, `sessionProjections`, `tools`, `skills`, `schedule`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `commands` | Required | @deepseek-ai/dsh-commands | Plugin stays pending; never applies. |
| `sessionProjections` | Required | @deepseek-ai/dsh-session-projection | Plugin stays pending; never applies. |
| `tools` | Required | @deepseek-ai/dsh-tools | Plugin stays pending; never applies. No schedule tools. |
| `skills` | Required | @deepseek-ai/dsh-skill | Plugin stays pending; never applies. The `schedule-script` skill is not registered. |
| `schedule` | Required | @deepseek-ai/dsh-schedule | Plugin stays pending; never applies. No automation tasks to create, list or delete. |

**Client-side** (`inject`: `slots`, `remote`, `remote.schedule`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `slots` | Required | @deepseek-ai/dsh-client-ui-slots | Plugin stays pending; never applies. |
| `remote`, `remote.schedule` | Required | @deepseek-ai/dsh-api-remotes / @deepseek-ai/dsh-schedule host Remote | Plugin stays pending; never applies. No popover or command view. |

Used by: nothing.

### Script contract

A script is a standalone `.ts` file that exports a named `main`. Zero imports are expected. The runner calls `main({ state, sessionId })`:

```ts
interface State {
  count: number;
}

export async function main(ctx: { state: State; sessionId: string }): Promise<{
  state: State;     // required, passed back as ctx.state on the next run
  prompt?: string;  // wakes the agent with this text
  error?: string;   // recoverable warning, schedule keeps running
  stop?: boolean;   // end recurrence
}> {
  const count = ctx.state.count + 1;
  return { state: { count }, stop: count >= 10 };
}
```

| Result field | Behavior |
|---|---|
| `state` | Required. Missing or `undefined` fails the run. |
| `prompt` | Must be a string. Injected into the session as `[Scheduled Task: <scriptPath>]` plus the text, waking the agent. |
| `error` | Must be a string. Run is marked `warning`; no model call, schedule continues. |
| `stop` | Must be a boolean. Records a `stop` event and deletes the schedule. |

Input `state` is mandatory. Uncaught exceptions, a missing `main`, an invalid result shape, or a timeout are fatal: the run records an `error` event, a `stop` event, and the schedule is deleted.

### Tools and skill

| Name | Purpose |
|---|---|
| `schedule-script` skill | Registered in the skills catalog. Teaches the contract and a two-turn workflow (write script and propose parameters, then test and schedule after the user confirms). |
| `test_schedule_script` | One isolated run of a script, as the scheduler would run it. Params: `script_path`, `state` (both required), `timeout_ms` (default `30000`). |
| `schedule_script` | Creates a recurring schedule through the `schedule` service. Params: `script_path`, `title`, `state` (required), `interval_seconds` (default and minimum `60`). |

`schedule_script` fails if the session already has an active script schedule, or if another create for the same session is in flight. The schedule prompt is a JSON payload (`kind: "dsh-schedule-script"`, `scriptPath`, `state`, optional `timeoutMs`); the schedule target is the current session.

### Runtime behavior

1. The schedule service delivers a `[SCHEDULE REMINDER BATCH]` message to the session.
2. On `agent/pre-step` the plugin parses the batch, checks each script reminder against the active schedules for the session, and runs verified scripts (timeout `30000` ms unless the payload sets `timeoutMs`).
3. Script prompts replace the batch text. Non-script reminders stay in the batch. If nothing remains and the message list has other messages, the batch message is removed; if it is the only message, the step is rejected so no model call happens.
4. If more than one active script schedule targets the session, no script runs and the agent gets a notice to pause or delete all but one.

Client UI: a status button in the prompt toolbar (`conversation.input.left`, order 85) and a command card for `dsh-schedule-script` events in the chat (`conversation.chat.commandview`).

### CLI runner

The subprocess entry can be run by hand. It reads input JSON and writes output JSON:

```bash
echo '{"state":{"count":0},"sessionId":"s"}' > /tmp/in.json
node src/runner-cli.ts path/to/script.ts /tmp/in.json /tmp/out.json
```

Usage: `runner-cli.ts <scriptPath> <inputPath> <outputPath>`. Output is `{ success: true, result }` or `{ success: false, error, stack }`. Requires a Node version that runs `.ts` files natively.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Files

| File | Role |
|---|---|
| `src/index.ts` | Plugin entry: projection, skill, tools, `agent/pre-step` hook, schedule verification and cleanup. |
| `src/executor.ts` | `executeScript`: writes `input.json` in a temp dir (`dsh-script-*`), spawns `process.execPath src/runner-cli.ts <script> <in> <out>` with the session `cwd` and an abort signal, reads `output.json`. Timeout is reported as `Script execution timed out after <n>ms`. |
| `src/runner-cli.ts` | Imports the script, calls `main`, validates the result, writes the output file. |
| `src/parser.ts` | Schedule prompt payload and reminder-batch parsing and formatting. |
| `src/fold.ts` | Folds session events into the projection state. |
| `src/types.ts` | Script types, event payloads, zod schemas for the summary. |
| `src/skill.ts` | Skill name, description, content. |
| `src/client.tsx` | Web client: slots, hooks, `ScheduleScriptPill`, command card. |

### Persisted state

Events are `command/run` + `command/done` pairs named `dsh-schedule-script`, with a JSON `args` payload whose `action` is `skill`, `start`, `iteration`, `error`, `stop`, or `cleanup`. A `command/done` is `error` only for fatal `error` actions.

The session projection key is `dshScheduleScript` (state version 1). The wire view is `null` until the skill was invoked, a run happened, or a script path is set. Summary fields: `scriptStatus` (`idle`, `running`, `warning`, `error`, `stopped`), `skillInvoked`, `scheduleId`, `cleanupPending`, `cleanupError`, `scriptPath`, `totalRuns`, `lastRunAt`, `lastDurationMs`, `state`, `lastPrompt`, `lastError`.

State owned by the session: `iteration` is `totalRuns + 1`, and the script's input state is the last recorded state, falling back to the payload's initial state. A session whose last status is `stopped` or `error` has its schedule deleted instead of run. Cleanup failures are recorded and `cleanupPending` stays set.

### Trust boundaries

Script path, state and timeout come from the model through `schedule_script` and are stored in the schedule prompt. Scripts run as a child Node process with the parent environment and the session working directory. There is no sandbox inside this package.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).
- Sibling: [@lukstei/dsh-yaml-workflow](../dsh-yaml-workflow/README.md)

<a id="model-experience"></a>
## Model Experience

### schedule-script skill

#### What the model sees

One catalog entry: `schedule-script` with the description "Schedule recurring TypeScript background scripts without consuming LLM tokens." Loading it returns the full skill text (script contract, return fields, error handling, two-turn workflow).

#### Token effect

Catalog entry always; skill body only after the model loads it.

#### KV Cache effect

Static catalog entry. The skill body extends the conversation after the load.

### test_schedule_script, schedule_script

#### What the model sees

Both tools are hidden until the session has loaded the skill, run a script, or has a script path recorded. Tool admission is resolved at turn boundaries, so they appear on the turn after the skill load. Results are a single message line (the test result also carries `state`, `prompt`, `error`, `stop`, `duration_ms`). When a script returns a `prompt`, the model receives it in place of the reminder batch message, prefixed `[Scheduled Task: <path>]`.

#### Token effect

Two tool schemas once admitted. Silent script runs cost no tokens. A wake-up costs the prompt text.

#### KV Cache effect

Admitting the tools changes the tool list, which invalidates the cached prefix once for that session. Wake-up prompts replace the reminder batch message in place.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- One script schedule per session. Another is refused while one is active.
- The minimum interval is 60 seconds; lower values are clamped.
- Scripts are not sandboxed by this package.
- Running `.ts` files depends on the Node binary supporting native type stripping; the package passes no flags.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- `pnpm run verify` runs check, build, typecheck, and tests. `pnpm run ladle` serves component stories (`src/stories/`).
- The skill text says scripts run in "Node 26 subprocesses"; `package.json` declares no `engines` field.

</details>
