import { describe, it, expect } from 'vitest';
import { actionsForStatus } from '../$taskId.js';

describe('actionsForStatus', () => {
  it('failed tasks can be retried or deleted', () => {
    expect(actionsForStatus('failed')).toEqual(['retry', 'delete']);
  });

  it('blocked tasks offer unblock first', () => {
    expect(actionsForStatus('blocked')).toEqual(['unblock', 'retry', 'complete', 'delete']);
  });

  it('needs_review tasks can be retried, completed, or deleted', () => {
    expect(actionsForStatus('needs_review')).toEqual(['retry', 'complete', 'delete']);
  });

  it('running tasks cannot be retried (server rejects 409)', () => {
    expect(actionsForStatus('running')).not.toContain('retry');
  });

  it('complete tasks have no recovery actions', () => {
    expect(actionsForStatus('complete')).toEqual([]);
  });

  it('unknown statuses have no actions', () => {
    expect(actionsForStatus('whatever')).toEqual([]);
  });
});
