/**
 * Pure marker computation for the workflow editor (Slice 4 / U12).
 *
 * Kept in its own module so unit tests can probe the logic without
 * importing `WorkflowEditor.tsx` (which transitively pulls in Monaco,
 * a Web-Worker bundle that does not survive jsdom).
 */

export interface AgentMarker {
  /** 1-based line. */
  line: number;
  /** 1-based column at the ref's first character. */
  column: number;
  /** Length of the agent ref token in characters. */
  length: number;
  message: string;
}

/**
 * Scan YAML source for `agent: <ref>` occurrences and flag refs that
 * are not in `known`. Returns positions suitable for Monaco's
 * `setModelMarkers`.
 *
 * Limitations:
 *  - Only catches scalar `agent:` lines; the structured
 *    `agent: { route_by: capabilities }` block-form is ignored (the
 *    scalar regex won't match an inline object).
 *  - Comments after the value are tolerated.
 */
export function computeAgentMarkers(
  source: string,
  known: readonly string[],
): AgentMarker[] {
  const out: AgentMarker[] = [];
  const lines = source.split(/\r?\n/);
  const agentLine = /^(\s*-?\s*agent\s*:\s*)(["'])?([^"'\s]+)\2?\s*(#.*)?$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = agentLine.exec(line);
    if (!m) continue;
    const prefix = m[1];
    const ref = m[3];
    if (!ref || ref === '|' || ref === '>') continue;
    if (known.includes(ref)) continue;
    out.push({
      line: i + 1,
      column: prefix.length + 1,
      length: ref.length,
      message: `Agent "${ref}" is not configured in pragents.yaml`,
    });
  }
  return out;
}
