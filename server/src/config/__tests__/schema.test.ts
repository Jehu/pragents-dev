import { describe, it, expect } from 'vitest';
import { PragentsConfig, resolveAllAgents } from '../schema.js';

describe('PragentsConfig schema', () => {
  it('validates minimal config', () => {
    const result = PragentsConfig.safeParse({
      company: { name: 'Test Agency' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.company.name).toBe('Test Agency');
    }
  });

  it('rejects config without company name', () => {
    const result = PragentsConfig.safeParse({
      company: {},
    });
    expect(result.success).toBe(false);
  });

  it('validates full config with projects', () => {
    const result = PragentsConfig.safeParse({
      company: {
        name: 'Test Agency',
        agents: {
          office: { type: 'office', model: 'claude-sonnet' },
          pm: { type: 'pm' },
        },
      },
      projects: {
        'my-project': {
          name: 'My Project',
          directory: '~/projects/my-project',
          agents: {
            dev: { type: 'dev', capabilities: ['typescript', 'react'] },
            seo: { type: 'seo', capabilities: ['keyword-research'] },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid agent type', () => {
    const result = PragentsConfig.safeParse({
      company: {
        name: 'Test',
        agents: {
          office: { type: 'invalid-type' },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('resolveAllAgents', () => {
  it('resolves company agents', () => {
    const config = PragentsConfig.parse({
      company: {
        name: 'Test',
        agents: {
          office: { type: 'office' },
          pm: { type: 'pm' },
        },
      },
    });
    const agents = resolveAllAgents(config);
    expect(agents).toHaveLength(2);
    expect(agents[0].id).toBe('office@company');
    expect(agents[1].id).toBe('pm@company');
  });

  it('resolves project agents with correct ids', () => {
    const config = PragentsConfig.parse({
      company: { name: 'Test' },
      projects: {
        'proj-a': {
          name: 'Project A',
          directory: '/tmp/a',
          agents: {
            dev: { type: 'dev', capabilities: ['ts'] },
          },
        },
      },
    });
    const agents = resolveAllAgents(config);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('dev@proj-a');
    expect(agents[0].projectId).toBe('proj-a');
    expect(agents[0].capabilities).toEqual(['ts']);
  });

  it('resolves the tools policy and defaults it to an empty object', () => {
    const config = PragentsConfig.parse({
      company: { name: 'Test' },
      projects: {
        'proj-a': {
          name: 'Project A',
          directory: '/tmp/a',
          agents: {
            dev: { type: 'dev', tools: { deny: ['approve_gate'], allow: ['query_tasks'] } },
            seo: { type: 'seo' },
          },
        },
      },
    });
    const agents = resolveAllAgents(config);
    const dev = agents.find((a) => a.id === 'dev@proj-a');
    const seo = agents.find((a) => a.id === 'seo@proj-a');
    expect(dev?.tools).toEqual({ deny: ['approve_gate'], allow: ['query_tasks'] });
    expect(seo?.tools).toEqual({});
  });

  it('applies config cascade: agent model > default', () => {
    const config = PragentsConfig.parse({
      company: { name: 'Test' },
      projects: {
        'proj-a': {
          name: 'Project A',
          directory: '/tmp/a',
          agents: {
            dev: { type: 'dev', model: 'custom-model' },
          },
        },
      },
    });
    const agents = resolveAllAgents(config);
    expect(agents[0].model).toBe('custom-model');
  });

  it('skips agents not in config', () => {
    const config = PragentsConfig.parse({
      company: { name: 'Test' },
    });
    const agents = resolveAllAgents(config);
    expect(agents).toHaveLength(0);
  });
});
