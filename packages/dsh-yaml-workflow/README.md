# @lukstei/dsh-yaml-workflow

## Summary

Runs multi-step prompt workflows defined in YAML files. Users start them with `/wf`; each step is sent to the agent in order, with typed arguments, human review gates, zero-token `print` steps, and subagent steps with captured outputs. Agents can also author and validate workflows through a skill and tools.

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

Install with `dsh plugin --profile <profile> add @lukstei/dsh-yaml-workflow`. The shipped [`cordis.patch.yml`](cordis.patch.yml) mounts:

```yaml
- insert:
    - id: dsh-workflow-runner
      name: '@lukstei/dsh-yaml-workflow'
      config: {}
```

No config fields. Required services (`inject`): `commands`, `sessionProjections`, `subagents`, `tools`, `skills`. The web client bundle (`./client`) renders the workflow card, step, print, error, and list nodes in the chat.

### Plugin dependencies

Server-side and client-side entries.

**Server-side** (`inject`: `commands`, `sessionProjections`, `subagents`, `tools`, `skills`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `commands` | Required | @deepseek-ai/dsh-commands | Plugin stays pending; never applies. No `/wf*` commands. |
| `sessionProjections` | Required | @deepseek-ai/dsh-session-projection | Plugin stays pending; never applies. |
| `subagents` | Required | @deepseek-ai/dsh-subagent | Plugin stays pending; never applies. |
| `tools`, `skills` | Required | @deepseek-ai/dsh-tools, @deepseek-ai/dsh-skill | Plugin stays pending; never applies. |
| `agentPresets` | Optional | @deepseek-ai/dsh-agent-preset-registry | `ctx.get('agentPresets')` at validation. Absent: any step with `preset` fails validation (`'agentPresets' service is unavailable`). Steps without `preset` are unaffected. |
| `llm` | Optional | @deepseek-ai/dsh-llm | `ctx.get('llm')` at validation. Absent: steps setting `llmProvider`/`model`/`thinking` fail validation (`'llm' service is unavailable`); other steps unaffected. |

**Client-side** (`inject`: `slots`, `conversation`, `uiConversation`, `sessions`):

| Plugin / service | Required? | Provided by | Effect without it |
|---|---|---|---|
| `slots`, `conversation`, `uiConversation` | Required | @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-conversation (also `-chat` in `dsh.client.inject`) | Plugin stays pending; never applies. No run cards. |
| `sessions` | Required | @deepseek-ai/dsh-api-session-controller | Plugin stays pending; never applies. |

Used by: nothing.

### Commands

| Command | Purpose |
|---|---|
| `/wf <workflow.yaml> [key=value ...] [instructions]` | Run a workflow. |
| `/wf-resume [instructions]` | Resume a paused or interrupted workflow. |
| `/wf-abort` | Discard the active or paused workflow. |
| `/wf-list` | List workflows in project and user directories. |
| `/wf-validate <workflow.yaml> [key=value ...] [instructions]` | Validate without running. |

#### `/wf`

- **Path resolution**, first match wins: path relative to the session working directory (or absolute), `.agents/wf/<target>` in the session working directory, `~/.agents/wf/<target>`. `.yaml` and `.yml` are tried when the extension is omitted.
- **Arguments:** `key=value`, quoted when the value has whitespace (`env=production tag="v1.0.0"`).
- **Trailing text** after the path and arguments maps to the `instructions` argument. If the workflow declares no `instructions` argument, trailing text is an argument error.
- **Validation up front:** file existence, YAML syntax, required arguments, choice options, and template coverage are checked before the command is accepted, including while another workflow runs. Invalid requests return an error immediately.
- **Queueing:** an accepted command returns "Workflow queued" and records a request in the session. Requests run FIFO by command arrival, after the active workflow completes or is discarded and finishes cleanup. A paused workflow holds the queue. With no active workflow, execution waits for the agent to be idle. Chat shows "Workflow queued" with the submitted command until the request starts or fails, including in restored history.
- **Queued file changes:** a pending request keeps the invocation, not the YAML or resolved defaults. The file is reloaded and validated when the request starts, so edits made while waiting apply. A missing or invalid file produces an error notification and the next request proceeds.
- **Session title:** the workflow `title` (or `name` when no `title`) sets the session title if unset. `{{args.*}}` is supported.
- **Copy:** the workflow card copies the original invocation without inserted defaults or derived arguments. Copy is disabled for historical runs whose input was not recorded.

```text
/wf deploy
/wf ./workflows/deploy.yaml environment=staging version="2.4.1"
/wf ./workflows/build.yaml target=release Run extra lint checks before building
```

#### `/wf-resume`

- Rebuilds the workflow document, invocation arguments, and step index from session events.
- After an interruption, the resumed step gets a `<workflow-resume>` notice telling the agent to inspect existing state and not redo completed work. Resuming from a review gate does not add it.
- Optional trailing instructions are passed to the resumed step.
- If a prompt is in progress, resumption waits until the agent is idle.
- Returns "Workflow resume accepted" and the workflow continues; follow it in the workflow card. Cancelling the submitting request after acceptance does not cancel the workflow. Use Stop to pause or `/wf-abort` to discard.
- Resume button: enter instructions in the prompt and click Resume. The prompt clears when the host admits the command. A rejected dispatch keeps the draft.

```text
/wf-resume
/wf-resume Re-run tests with verbose flags enabled
```

#### `/wf-abort`

Marks the workflow `aborted` in the session event log, appends a discarded `wf-step` notice to the chat, shows the discarded status on the command card, and removes the Resume and Discard buttons from the composer toolbar.

#### `/wf-list`

Scans `.agents/wf` and `~/.agents/wf` for `.yaml` and `.yml` files, parses each, and lists name, description, and parameters (names and descriptions) for valid ones. Files with invalid YAML or schema errors are skipped. Output is a Markdown command view, expanded by default, and works in a fresh session before any model turn, including after reload.

#### `/wf-validate`

Checks syntax, step schema, output wiring, and template bindings. It emits no session events, does not change the title, and does not need an idle runner.

- **Static check** (no arguments): YAML syntax, schema, output wiring, unused outputs, subagent restrictions, and that every `{{args.<name>}}` matches a declared argument.
- **Invocation check** (with arguments): static checks plus explicit values, required arguments, choice options, and interpolation.
- On success it prints a summary of steps, outputs, and parameters. On failure it prints the exact error, rendered as a code block to keep indentation.

```text
/wf-validate deploy
/wf-validate ./workflows/deploy.yaml environment=staging version="2.4.1"
```

### Agent skill and tools

| Name | Purpose |
|---|---|
| `yaml-workflow` skill | Registered in the skills catalog. Describes commands, tools, and a workflow file schema. |
| `wf_validate` | Same checks as `/wf-validate`. Params: `target` (required), `args` (optional string of `key=value` pairs or trailing instructions). Returns `{ success, message }`. |
| `save_output` | Records a declared `string` or `list` output for the running step. Params: `name`, `value` (both required strings; `list` values must be a JSON array string within `min`/`max`). Returns `{ success, message }`. |

`save_output` is only visible while a workflow is `running`. `wf_validate` is visible once a workflow has started in the session or the skill was invoked.

### Workflow file

Files are YAML (`.yaml` or `.yml`). Unknown top-level keys are rejected.

```yaml
name: "Workflow Name"         # Optional
title: "Workflow Title"       # Optional. Session title if unset; supports {{args.*}}
description: "Workflow goal"  # Optional
args:                         # Optional
  <arg_name>: <ArgDefinition>
steps:                        # Required, non-empty
  - <StepDefinition>
```

#### Arguments

Arguments validate `/wf` input and feed `{{args.<name>}}`.

```yaml
args:
  version:
    type: string          # string | choice | bool
    description: "Semantic version tag"
    default: "1.0.0"
    required: true
```

- `string`: free text, optional `default` and `required`.
- `choice`: `choices` list (non-empty strings), `default` must be one of them. Optional `mapping` or `mappings` (not both).
- `bool`: `true` or `false`; the default may be a boolean or the string `true`/`false`.
- An argument named `instructions` receives the unflagged trailing text of `/wf`.

Choice `mappings` (flat) replaces the value with an expanded one:

```yaml
args:
  effort:
    type: choice
    choices: [low, high]
    default: high
    mappings:
      low: "acp-codex-acp/gpt-6-luna:xhigh"
      high: "acp-codex-acp/gpt-6.1-sol:medium"
```

`{{args.effort}}` resolves to `acp-codex-acp/gpt-6.1-sol:medium` when `effort` is `high`.

Choice `mapping` (nested) derives extra arguments and keeps the original choice:

```yaml
args:
  environment:
    type: choice
    choices: [staging, production]
    default: staging
    mapping:
      cluster_url:
        staging: "https://staging.internal"
        production: "https://prod.internal"
```

`{{args.cluster_url}}` becomes available to later prompts, conditions, and titles. Derived keys are checked exhaustively at parse time and cannot be overridden on the command line.

#### Steps

Step forms:

```yaml
steps:
  - "Run the test suite"                       # bare string: prompt step
  - name: "Migrate"                            # prompt step
    prompt: "Run migrations for {{args.environment}}."
    gate: "Check the migration logs."          # optional review gate
  - print: "Done: {{outputs.summary}}"         # print step, no model call
  - gate: "Check the coverage report"          # gate-only: gate text is also the prompt
```

- **Prompt step** (`prompt`, also accepts `kind: prompt`): sends the prompt and waits for the agent to be idle.
- **Print step** (`print:`, or `kind: print` with `text:`): writes a message to the session without model inference.
- **Gate-only step** (`gate` without `prompt`): the gate string (or the step name when `gate: true`) is used as the prompt.
- `name` is optional and defaults to `Step N` (1-based).
- `if` skips the step when false. Forms: `"{{args.flag}}"`, `"!{{args.flag}}"`, `'{{args.mode}} == "review"'`, `'{{args.mode}} != "smell"'`. A bare value is true only when it equals `true`.
- `gate` is a boolean or string. After the step completes, the run pauses until `/wf-resume` or the Resume button. `false`, empty, or a template resolving to `"false"` means no pause; `true` pauses with the step name; a template can inject a flag, e.g. `gate: "{{args.wait}}"`.
- `subagent`, `output`, `outputs`, `foreach`: see the details below.

Templates `{{args.<name>}}` and `{{outputs.<name>}}` are interpolated in the workflow `name` and `title`, step `name`, `prompt`, `gate`, `print`/`text`, `if`, `subagent`, and `foreach`. `{{item}}` is available inside `foreach` subagent steps. An unresolved `{{args.*}}` fails validation before any step runs.

#### Examples

Sequential prompt and print:

```yaml
name: "Code Audit"
steps:
  - print: "Starting linting and static analysis..."
  - name: "Lint Check"
    prompt: "Run biome check on all source files and fix any formatting violations."
  - name: "Type Check"
    prompt: "Run tsc --noEmit and report any type errors."
  - print: "Audit complete."
```

Parametrized deployment:

```yaml
name: "Deploy to {{args.environment}}"
args:
  environment:
    type: choice
    choices: [staging, production]
    default: staging
    description: "Target deployment tier"
  version:
    type: string
    description: "Version string to publish"
  instructions:
    type: string
    description: "Additional operational notes"
    default: "Follow standard release protocols"
steps:
  - name: "Notify Release"
    print: "Deploying version {{args.version}} to {{args.environment}}"
  - name: "Execute Deployment"
    prompt: "Deploy version {{args.version}} to {{args.environment}}. Notes: {{args.instructions}}"
```

Review gate:

```yaml
name: "Production Release with Gate"
steps:
  - name: "Run Database Migrations"
    prompt: "Run pending database schema migrations."
    gate: "Check database migration logs in PostgreSQL console before proceeding."
  - name: "Deploy Service"
    prompt: "Switch traffic router to the newly deployed container instance."
```

Subagent delegation:

```yaml
name: "Parallel Architecture Review"
steps:
  - name: "Review Security"
    prompt: "Review authentication boundaries in src/auth for potential token leakage."
    subagent: "@security-auditor/deepseek-coder"
    output: security_findings
  - name: "Synthesize Findings"
    prompt: "Summarize findings: {{outputs.security_findings}} and propose actionable fixes."
```

More: [examples/](https://github.com/lukstei/dsh-plugins/tree/master/packages/dsh-yaml-workflow/examples).

#### Run states

The client card shows the state recorded in the session log:

- `running`: a step is executing.
- `paused`: stopped at a `gate`, or interrupted. Continue with `/wf-resume` or the Resume button.
- `completed`: all steps finished.
- `aborted`: discarded with `/wf-abort` or the Discard button, or cancelled by signal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Architecture

Functional core, imperative shell. Pure modules (`types.ts`, `parser.ts`, `boolean.ts`, `rules.ts`, `transitions.ts`, `fold.ts`, `requests.ts`) take inputs and return state plus declarative effects. `runner.ts` and `effects.ts` interpret effects against the agent, subagents, session, and filesystem.

| File | Role |
|---|---|
| `src/index.ts` | Plugin entry: projection `workflow`, skill, tools, five commands, `session/event` listener that starts pending workflows on `command/done`. |
| `src/runner.ts` | Request, validation, execution, resume, abort, list. |
| `src/effects.ts` | `DshWorkflowEffectContext`: workflow lookup, file reads, scratch dir, event append. |
| `src/transitions.ts` | Pure step transitions, pause/abort, state folding, projection. |
| `src/parser.ts` | YAML parsing, preprocessing, argument resolution, prompt formatting, list/summary formatting. |
| `src/rules.ts` | Static validation rules. |
| `src/requests.ts` | Selects the next pending workflow request from command history. |
| `src/client/` | Web client (store, cards, slots). |

### Persisted state

Workflow progress is stored as `command/run` + `command/done` pairs named `wf-event` (`WORKFLOW_EVENT_NAME`). The immutable workflow document and invocation are written once in an `init` event; later events carry only step index, status, gate, outputs, and errors. Title changes use `session/title`. The session projection `workflow` (state version 1) holds `status` (`idle`, `running`, `paused`, `aborted`, `completed`), `runId`, `stepIndex`, `skillInvoked`. Resume reconstructs everything from events.

### Validation rules

Run by `/wf`, `/wf-validate`, `wf_validate`, and when a queued request starts:

- Output names are globally unique, referenced outputs exist and are not forward references, and every declared output is referenced at least once in the workflow. Unused outputs fail static validation.
- Workflow `name`/`title` cannot reference outputs.
- `{{args.*}}` placeholders resolve to declared or derived arguments.
- Subagent steps must declare at least one output, cannot declare `list` outputs, and cannot reference outputs of earlier subagent steps (they run concurrently).
- `foreach` must reference a declared `list` output.
- Choice mappings are exhaustive, reference valid choices, and do not collide.
- A step cannot declare both `output` and `outputs`; `output` and `foreach` are subagent-only.

### Outputs

- **`output: <name>`** (subagent steps only): the subagent's last message is captured into `{{outputs.<name>}}`. No schema is enforced. Non-subagent prompt steps keep their context in the conversation and cannot use it.
- **`outputs:`** typed outputs, `string`, `list`, or `file`:
  - `string`: filled by the `save_output` tool (or the subagent's structured result).
  - `list`: array of strings, validated at write time (valid JSON array, strings only). Optional `min` and `max` (`min <= max`). Not allowed on subagent steps.
  - `file`: `path` plus optional `base` (`scratch` default, or `workspace`). `scratch` resolves to `<cwd>/.agents/scratch/<sessionId>/<path>` (the scratch dir is created with a `.gitignore` of `*`); `workspace` resolves against the session working directory. The step prompt tells the agent the resolved path. The file must exist and be non-empty; other filesystem errors (for example permissions) stop the run with the original diagnostic.
- Output verification retries the step up to 3 times (`Output Retry n/3`), then fails.
- A `list` output interpolated outside `foreach` renders as a Markdown bullet list (`- a\n- b`), empty string when empty.
- A step cannot declare both `output` and `outputs`.

### Subagent steps

`subagent` is `true`, a shorthand string, or an object.

- `true`: default subagent using the parent's provider, model, reasoning effort, and max tokens.
- Shorthand: `[@preset/][llmProvider/]model[:thinking] | :thinking | inherit[:thinking]`:
  - `deepseek-reasoner`, `deepseek-reasoner:high`, `:high`
  - `inherit`, `inherit:high` (same provider, model, effort, and max tokens as the parent)
  - `acp-codex-acp/gpt-6.1-sol`, `acp-codex-acp/gpt-6.1-sol:medium`
  - `@reviewer/deepseek-reasoner`, `@reviewer/deepseek-reasoner:high`, `@reviewer/acp-codex-acp/gpt-6.1-sol:medium`
  - templated: `"{{args.effort}}"`, `"@reviewer/{{args.model}}:{{args.thinking}}"`
- Object: `{ provider?, llmProvider?, preset?, model?, thinking? }`. `model: inherit` (or a template resolving to it) equals the `inherit` shorthand. Omitting `model` inherits the parent's provider and model. `inherit` is reserved and cannot name a model.
- Subagents run autonomously. Their output is not injected into later prompt steps unless referenced with `{{outputs.<name>}}`.

#### `foreach`

`foreach: "{{outputs.<list_name>}}"` runs one subagent per list item, concurrently in one wave. Rejected on non-subagent steps and non-list targets. Inside the prompt, `{{item}}` is the current item. Foreach subagent steps only support `string` outputs.

- With `output: <name>`, all subagent results are lifted into a list of strings.
- With `outputs: { ... }`, each declared property is lifted into a list of strings.
- An empty input list skips subagent execution and records `[]`.

```yaml
- name: "Discover Microservices"
  prompt: "Find candidate services to review"
  outputs:
    services:
      type: list
      min: 1
      max: 5
      description: "List of service directories"
- name: "Inspect Services"
  subagent: true
  foreach: "{{outputs.services}}"
  prompt: "Inspect service {{item}} and provide a status summary"
  output: service_summaries
- name: "Report"
  print: "{{outputs.service_summaries}}"
```

### Trust boundaries

Workflow files, arguments, and model output (via `save_output`) are untrusted input: they are schema-validated at the boundary (zod) before reaching the pure core. Workflow lookup reads only the three locations above.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Upstream: [DSH module graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md).
- Sibling: [@lukstei/dsh-schedule-script](https://github.com/lukstei/dsh-plugins/blob/master/packages/dsh-schedule-script/README.md)

<a id="model-experience"></a>
## Model Experience

### Step prompt

#### What the model sees

Each prompt step is sent as one message: a `[STEP n OF m: <name>]` header, a `<workflow-info>` block (workflow name, step number), optional `<workflow-resume>`, optional `<user-instructions>`, optional `<output-requirements>`, `<step-instructions>` with the interpolated prompt, and `<rules>` (do only this step, conclude when done, do not anticipate later steps). Output requirements name each output and how to produce it: file path to write, or `save_output` with `name` and value (JSON array string for lists). Failed output verification sends a retry prompt, up to 3 times. `print` steps are not sent to the model.

#### Token effect

One message per prompt step, plus up to 3 retry messages per step when outputs are missing. Print steps and gates cost nothing.

#### KV Cache effect

Messages are appended; earlier history is not rewritten.

### yaml-workflow skill

#### What the model sees

A catalog entry (`yaml-workflow`: "Author, validate, and execute declarative multi-step YAML prompt workflows in DSH."). The body is returned only when the model loads the skill.

#### Token effect

Catalog entry always; body on load.

#### KV Cache effect

Static catalog entry; the body extends the conversation.

### wf_validate, save_output

#### What the model sees

Two tools with `{ success, message }` results. `save_output` appears only while a workflow is `running`; `wf_validate` once a workflow has started or the skill was loaded.

#### Token effect

One schema per visible tool; one short result per call.

#### KV Cache effect

The tool list changes when a workflow starts or ends and when the skill is loaded, which invalidates the cached prefix at those points.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Input and output file checks as declared step fields are not implemented. File outputs exist (`outputs` with `type: file`), but there is no prerequisite-file check before a step.
- Subagent steps cannot use `list` outputs or depend on other subagent steps' outputs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- `pnpm run verify` runs check, build, typecheck, unit tests, and e2e tests (`test:e2e`, fixtures under `src/e2e/fixtures/`).
- This README must be updated when commands or schema change.

</details>
