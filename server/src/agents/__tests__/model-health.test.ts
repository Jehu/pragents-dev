import { describe, it, expect, afterEach } from 'vitest';
import { checkModelHealth } from '../model-health.js';
import type { ResolvedAgent } from '../../config/schema.js';

function agent(id: string, model: string): ResolvedAgent {
  return {
    id,
    projectId: 'p1',
    type: 'dev',
    model,
    personality: '',
    memory: {},
    capabilities: [],
    tools: {},
    projectDir: '/tmp',
    tokenBudget: 1000,
    keepWarm: false,
  };
}

describe('checkModelHealth', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('groups agents by model and reports key + resolvability', () => {
    process.env.ZAI_API_KEY = 'test-key';
    const result = checkModelHealth([
      agent('dev@a', 'zai/glm-5.1'),
      agent('dev@b', 'zai/glm-5.1'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].agents).toEqual(['dev@a', 'dev@b']);
    expect(result[0].provider).toBe('zai');
    expect(result[0].resolvable).toBe(true);
    expect(result[0].keyPresent).toBe(true);
    expect(result[0].ok).toBe(true);
  });

  it('flags a missing API key', () => {
    delete process.env.ZAI_API_KEY;
    const result = checkModelHealth([agent('dev@a', 'zai/glm-5.1')]);
    expect(result[0].keyPresent).toBe(false);
    expect(result[0].ok).toBe(false);
  });

  it('flags an unresolvable model id', () => {
    const result = checkModelHealth([agent('dev@a', 'zai/not-a-real-model')]);
    expect(result[0].resolvable).toBe(false);
    expect(result[0].ok).toBe(false);
  });

  it('flags a model string without provider prefix', () => {
    const result = checkModelHealth([agent('dev@a', 'claude-sonnet')]);
    expect(result[0].resolvable).toBe(false);
    expect(result[0].keyPresent).toBe(false);
    expect(result[0].ok).toBe(false);
  });
});
