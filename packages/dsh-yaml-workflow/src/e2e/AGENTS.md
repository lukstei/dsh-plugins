# E2E Testing Guidelines

## Fixture-Driven Scenario Testing

- **Do NOT write custom or ad-hoc tests directly in `e2e.spec.ts`** unless strictly required for edge cases that cannot be expressed via fixture scenarios.
- All testing of workflow features, states, errors, outputs, subagents, gates, and lifecycle must be defined as **realistic scenarios** in `src/e2e/fixtures/<scenario-name>/`.
- Each fixture directory must contain:
  - `case.json`: defines scenario options, session ID, inputs, simulation behavior, and action sequence.
  - `workflow.yaml`: the realistic workflow file being executed.
- When running `npm run test:e2e`, the test suite automatically discovers each scenario in `fixtures/`, executes the workflow, validates state and event invariants, verifies optional scenario assertions (`expectedState`, `expectedEvents` in `case.json`), and validates recorded events and state against `events.json` and `state.json`.
- Baseline snapshots (`events.json` and `state.json`) are generated only when running with `UPDATE_FIXTURES=1` (or `UPDATE_SNAPSHOTS=1`). During standard test runs, missing snapshot files trigger explicit test failures to prevent silent, unreviewed snapshot generation.
