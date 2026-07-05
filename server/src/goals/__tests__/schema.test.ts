import { describe, expect, it } from 'vitest';
import { GoalDef } from '../schema.js';

describe('GoalDef', () => {
  it('keeps outcome criteria', () => {
    const goal = GoalDef.parse({
      id: 'weekly-article',
      description: 'Publish one high-quality article per week',
      cadence: '0 8 * * 1',
      deadline: '0 16 * * 5',
      workflow: 'content-pipeline',
      acceptance: [
        'article is published',
        'min 1500 words',
      ],
    });

    expect(goal.acceptance).toEqual(['article is published', 'min 1500 words']);
  });

  it('defaults optional outcome metadata to empty lists', () => {
    const goal = GoalDef.parse({
      id: 'weekly-article',
      description: 'Publish one article per week',
      cadence: '0 8 * * 1',
      workflow: 'content-pipeline',
    });

    expect(goal.acceptance).toEqual([]);
  });
});
