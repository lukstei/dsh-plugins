export const WORKFLOW_SKILL_NAME = "yaml-workflow";
export const WORKFLOW_SKILL_DESCRIPTION =
	"Author, validate, and execute declarative multi-step YAML prompt workflows in DSH.";

export const WORKFLOW_SKILL_CONTENT = `
# YAML Workflow Skill

Author, validate, and execute multi-step prompt workflows defined in YAML files.
Workflows provide sequential agent orchestration, typed argument interpolation, human review gates, zero-token status printing, and delegated subagent execution.

## Commands

- \`/wf <workflow.yaml> [key=value ...] [instructions]\`: Execute a workflow.
- \`/wf-resume [instructions]\`: Resume an interrupted workflow or continue from a human review gate.
- \`/wf-abort\`: Discard an active or paused workflow.
- \`/wf-list\`: Discover and list workflows in project (\`.agents/wf\`) and user (\`~/.agents/wf\`) directories.
- \`/wf-validate <workflow.yaml> [key=value ...]\`: Validate syntax and argument coverage without running.

## Agent Tools

- \`wf_validate\`: Validate a workflow file programmatically without executing it:
  \`\`\`json
  { "target": "deploy.yaml", "args": "env=production version=1.0.0" }
  \`\`\`
- \`save_output\`: Save a declared output value during a workflow prompt step:
  - For string output: \`{ "name": "tag", "value": "v1.2.0" }\`
  - For list output: \`{ "name": "items", "value": "[\\"item1\\", \\"item2\\"]" }\`

## Workflow File Schema

\`\`\`yaml
name: "Deploy Service"
description: "Build and deploy service to target environment"
args:
  env:
    type: string
    description: "Target environment (staging | production)"
    required: true
  dryRun:
    type: bool
    default: false
steps:
  - kind: prompt
    name: "Prepare"
    prompt: "Prepare deployment artifacts for {{args.env}}."
    outputs:
      release_tag:
        type: string
        description: "Computed release tag"

  - kind: print
    name: "Status"
    text: "Artifact ready: {{outputs.release_tag}}"

  - name: "Approval"
    gate: "Approve deployment to {{args.env}} with tag {{outputs.release_tag}}?"

  - kind: prompt
    name: "Deploy"
    prompt: "Execute deployment for {{outputs.release_tag}}."
\`\`\`

## Best Practices

1. **Always Validate First**: Before running or scheduling a workflow, test it with the \`wf_validate\` tool to catch schema errors, missing arguments, or invalid template references.
2. **Output Recording**: Prompt steps with declared outputs require calling \`save_output\` for each output before completing the turn.
`.trim();
