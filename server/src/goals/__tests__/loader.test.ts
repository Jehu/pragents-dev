import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GoalRegistry } from '../loader.js';

const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-goal-loader-test-'));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GoalRegistry', () => {
  it('replaces the registry on reload so removed goal files disappear', () => {
    const weekly = join(tmpDir, 'weekly.yaml');
    writeFileSync(weekly, [
      'id: weekly-article',
      'description: Publish one article per week',
      'cadence: "0 8 * * 1"',
      'workflow: content-pipeline',
    ].join('\n'));

    const registry = new GoalRegistry();
    expect(registry.load(tmpDir).loaded).toEqual(['weekly-article']);
    expect(registry.get('weekly-article')).toBeTruthy();

    unlinkSync(weekly);
    expect(registry.load(tmpDir).loaded).toEqual([]);
    expect(registry.get('weekly-article')).toBeUndefined();
  });
});
