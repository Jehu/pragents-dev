import { describe, it, expect } from 'vitest';
import { WORKFLOW_SNIPPETS } from '../workflow-snippets.js';

describe('WORKFLOW_SNIPPETS', () => {
  it('exposes at least one snippet per requested form (R16 — workflow / step / parallel / gate / conditional)', () => {
    const labels = WORKFLOW_SNIPPETS.map((s) => s.label);
    expect(labels).toContain('workflow');
    expect(labels).toContain('step');
    expect(labels).toContain('parallel');
    expect(labels).toContain('gate');
    expect(labels).toContain('conditional');
  });

  it('every snippet has a description and a non-empty body', () => {
    for (const s of WORKFLOW_SNIPPETS) {
      expect(s.description).toBeTruthy();
      expect(s.body.length).toBeGreaterThan(0);
    }
  });

  it('snippet bodies place a final `${0}` tabstop so the cursor lands at a known position', () => {
    for (const s of WORKFLOW_SNIPPETS) {
      expect(s.body).toContain('${0}');
    }
  });

  it('the workflow skeleton includes the canonical top-level keys', () => {
    const skel = WORKFLOW_SNIPPETS.find((s) => s.label === 'workflow')!;
    expect(skel.body).toMatch(/^name:/);
    expect(skel.body).toContain('description:');
    expect(skel.body).toContain('steps:');
  });
});
