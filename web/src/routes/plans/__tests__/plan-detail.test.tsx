import { describe, it, expect } from 'vitest';
import { planArtifacts } from '../$planId.js';

describe('planArtifacts', () => {
  it('returns workflow steps that produced output', () => {
    const artifacts = planArtifacts({
      id: 'plan-1',
      prompt: 'Do work',
      status: 'done',
      createdAt: new Date().toISOString(),
      workflowRun: {
        id: 'run-1',
        workflowName: 'plan-plan-1',
        status: 'complete',
        startedAt: new Date().toISOString(),
        steps: [
          { id: 's1', stepId: 'step-0', agentId: 'dev', status: 'complete', output: 'Artifact' },
          { id: 's2', stepId: 'step-1', agentId: 'pm', status: 'complete', output: '' },
        ],
      },
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ stepId: 'step-0', output: 'Artifact' });
  });
});
