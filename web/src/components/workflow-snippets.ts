/**
 * Hand-curated Monaco snippets for the workflow YAML editor (Slice 4 / U12).
 *
 * Each snippet's `body` follows Monaco's snippet syntax:
 *  - `${1:label}` is a placeholder tabstop
 *  - `${0}` is the final cursor position
 *  - Multi-line strings carry their own indentation; the snippet provider
 *    inserts them verbatim, so the indent must already match what the
 *    surrounding YAML expects.
 *
 * Surfaced via `registerCompletionItemProvider` in `WorkflowEditor.tsx`.
 * Kept in a plain TS module (no Monaco import) so unit tests can probe
 * the snippet shapes without touching the editor bundle.
 */

export interface WorkflowSnippet {
  /** Identifier shown in the autocomplete list. */
  label: string;
  /** One-line summary visible alongside the label. */
  description: string;
  /** Monaco snippet body — see syntax above. */
  body: string;
}

export const WORKFLOW_SNIPPETS: WorkflowSnippet[] = [
  {
    label: 'workflow',
    description: 'Top-level workflow skeleton with one agent step',
    body:
      'name: ${1:my-workflow}\n' +
      'description: ${2:Short summary}\n' +
      'steps:\n' +
      '  - id: ${3:first-step}\n' +
      '    agent: ${4:dev@project}\n' +
      '    prompt: "${5:What should the agent do?}"\n' +
      '    output: ${6:result}\n' +
      '${0}',
  },
  {
    label: 'step',
    description: 'Single agent step',
    body:
      '- id: ${1:step-id}\n' +
      '  agent: ${2:dev@project}\n' +
      '  prompt: "${3:Step instruction}"\n' +
      '  input: ${4:upstream-output}\n' +
      '  output: ${5:result}\n' +
      '${0}',
  },
  {
    label: 'parallel',
    description: 'Parallel block running two sub-steps concurrently',
    body:
      '- id: ${1:fan-out}\n' +
      '  parallel:\n' +
      '    - id: ${2:branch-a}\n' +
      '      agent: ${3:dev@project}\n' +
      '      prompt: "${4:Branch A instruction}"\n' +
      '      output: ${5:branch-a-result}\n' +
      '    - id: ${6:branch-b}\n' +
      '      agent: ${7:seo@project}\n' +
      '      prompt: "${8:Branch B instruction}"\n' +
      '      output: ${9:branch-b-result}\n' +
      '${0}',
  },
  {
    label: 'gate',
    description: 'Human-gate step (pauses for approval)',
    body:
      '- id: ${1:approval}\n' +
      '  type: human_gate\n' +
      '  label: "${2:Review the draft before publishing}"\n' +
      '${0}',
  },
  {
    label: 'conditional',
    description: 'Step that runs only when condition evaluates truthy',
    body:
      '- id: ${1:maybe-step}\n' +
      '  agent: ${2:dev@project}\n' +
      '  prompt: "${3:Run only when needed}"\n' +
      '  condition: "${4:upstream.status == \'ok\'}"\n' +
      '${0}',
  },
  {
    label: 'trigger',
    description: 'Top-level event trigger block',
    body:
      'trigger:\n' +
      '  event: ${1:task.completed}\n' +
      '  filter:\n' +
      '    projectId: ${2:project-id}\n' +
      '  cooldown_ms: ${3:60000}\n' +
      '${0}',
  },
];
