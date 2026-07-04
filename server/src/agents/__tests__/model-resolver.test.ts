import { describe, it, expect, afterEach } from 'vitest';
import { resolveModel, setProviderOverrides } from '../model-resolver.js';

interface ModelLike {
  id: string;
  provider: string;
  baseUrl: string;
}

describe('resolveModel', () => {
  afterEach(() => {
    setProviderOverrides({});
  });

  it('returns null without a provider prefix', () => {
    expect(resolveModel('glm-5.1')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(resolveModel(undefined)).toBeNull();
  });

  it('resolves a built-in model to an object with provider and baseUrl', () => {
    const model = resolveModel('zai/glm-5.1') as ModelLike | null;
    expect(model).not.toBeNull();
    expect(model!.provider).toBe('zai');
    expect(model!.id).toBe('glm-5.1');
    expect(model!.baseUrl).toMatch(/^https:\/\//);
  });

  it('applies a provider baseUrl override', () => {
    setProviderOverrides({ zai: { baseUrl: 'https://example.test/coding/v4' } });
    const model = resolveModel('zai/glm-5.1') as ModelLike | null;
    expect(model!.baseUrl).toBe('https://example.test/coding/v4');
  });

  it('leaves other providers untouched by an override', () => {
    setProviderOverrides({ zai: { baseUrl: 'https://example.test/coding/v4' } });
    const before = resolveModel('deepseek/deepseek-chat') as ModelLike | null;
    if (before) {
      expect(before.baseUrl).not.toBe('https://example.test/coding/v4');
    }
  });

  it('clearing overrides restores the registry baseUrl', () => {
    const original = (resolveModel('zai/glm-5.1') as ModelLike).baseUrl;
    setProviderOverrides({ zai: { baseUrl: 'https://example.test/coding/v4' } });
    expect((resolveModel('zai/glm-5.1') as ModelLike).baseUrl).toBe('https://example.test/coding/v4');
    setProviderOverrides({});
    expect((resolveModel('zai/glm-5.1') as ModelLike).baseUrl).toBe(original);
  });
});
