export const SCHEDULE_SCRIPT_SKILL_NAME = "schedule-script";
export const SCHEDULE_SCRIPT_SKILL_DESCRIPTION =
	"Schedule recurring TypeScript background scripts without consuming LLM tokens.";

export const SCHEDULE_SCRIPT_SKILL_CONTENT = `
# Schedule Script Skill

Run TypeScript scripts periodically in the background using DSH Automation Tasks.
Iterations execute in isolated Node 26 subprocesses and consume 0 LLM tokens during silent monitoring.

## Script Contract

Scripts are standalone files with **zero imports**. Define your script-specific \`State\` interface, with the runner contract inlined directly on \`main\`:

\`\`\`ts
// 1. Define your custom State shape (mandatory initial state passed when scheduled)
interface State {
  target: string;
  count: number;
  lastChecked?: string;
}

// 2. Export main with the inlined runner contract
export async function main(ctx: {
  state: State;                      // Preserved state (mandatory, seeded when scheduled)
  sessionId: string;                 // Active DSH session ID
}): Promise<{
  state: State;                      // REQUIRED: state preserved for next run
  prompt?: string;                   // OPTIONAL: awakens agent in chat with this prompt
  error?: string;                    // OPTIONAL: recoverable warning shown in UI row
  stop?: boolean;                    // OPTIONAL: stops recurrence when true
}> {
  const count = ctx.state.count + 1;

  // Case 1: Silent poll (0 LLM tokens, updates status pill quietly)
  if (count < 3) {
    return {
      state: { ...ctx.state, count, lastChecked: new Date().toISOString() },
    };
  }

  // Case 2: Recoverable warning (surfaces in UI row, keeps schedule active)
  if (count === 3) {
    return {
      state: { ...ctx.state, count, lastChecked: new Date().toISOString() },
      error: "Temporary network timeout while checking endpoint (will retry)",
    };
  }

  // Case 3: Prompt (awakens agent in chat to reason and take action)
  return {
    state: { ...ctx.state, count, lastChecked: new Date().toISOString() },
    prompt: \`Polled run #\${count}: found 3 tasks ready for processing.\`,
    stop: true, // auto-stops further recurrence
  };
}
\`\`\`

### Summary of Inlined Return Fields
| Field | Type | Behavior |
| :--- | :--- | :--- |
| \`state\` | \`State\` (required) | Preserved and passed back into \`ctx.state\` on the next run. |
| \`prompt\` | \`string\` (optional) | Replaces automation prompt with this text and **awakens the agent** to respond. |
| \`error\` | \`string\` (optional) | Marks run with a recoverable warning in the UI row; **keeps schedule running** without LLM call. |
| \`stop\` | \`boolean\` (optional) | If \`true\`, cleanly stops further recurrence. |

### Critical vs Recoverable Errors
- **Recoverable Errors**: Handled in your script and returned via \`error: "..."\`. Surfaced in the UI status row without stopping the schedule or invoking the LLM.
- **Critical Errors**: Uncaught exceptions, syntax errors, or execution timeouts automatically halt recurrence, mark the schedule as stopped, and surface the error in the UI.

## Tool Activation Notice

The tools \`test_schedule_script\` and \`schedule_script\` are conditionally activated by loading this skill. Tool admissions are resolved at turn boundaries, which means **these tools are only visible to the agent on the NEXT turn**. They cannot be called within the same turn that invokes the skill.

## Mandatory Two-Step Workflow

Scheduling scripts is strictly a **two-step conversational process**.

### Step 1: Prepare Script & Propose Parameters (Turn 1)

1. Write or update the standalone TypeScript script in the workspace (e.g. \`.agents/scripts/<name>.ts\`).
2. Do **NOT** attempt to call \`test_schedule_script\` or \`schedule_script\` in this turn (they are not admitted yet).
3. Present the proposed schedule parameters to the user and request confirmation. End the turn immediately.

#### Example Output to the User:
\`\`\`markdown
I have created the background poller script at \`.agents/scripts/poller.ts\`.

**Proposed Schedule:**
- **Script Path:** \`.agents/scripts/poller.ts\`
- **Title:** Check Endpoint Health
- **Interval:** 60s
- **Initial State:** \`{ "target": "https://api.example.com/health", "count": 0 }\`

Please confirm to proceed with testing and scheduling this task.
\`\`\`

### Step 2: Test & Schedule Upon Confirmation (Turn 2)

Once the user confirms in the next turn, \`test_schedule_script\` and \`schedule_script\` are admitted and ready to use:

1. **Test the script**: Execute \`test_schedule_script\` with the script path and initial state:
\`\`\`json
{
  "script_path": ".agents/scripts/poller.ts",
  "state": { "target": "https://api.example.com/health", "count": 0 }
}
\`\`\`
Verify \`success: true\`. Fix any syntax or runtime errors before proceeding.

2. **Schedule the script**: Only after \`test_schedule_script\` succeeds, call \`schedule_script\`:
\`\`\`json
{
  "script_path": ".agents/scripts/poller.ts",
  "title": "Check Endpoint Health",
  "interval_seconds": 60,
  "state": { "target": "https://api.example.com/health", "count": 0 }
}
\`\`\`
`.trim();
