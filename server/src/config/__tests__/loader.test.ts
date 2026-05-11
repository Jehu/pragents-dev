import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../config/loader.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const minimalYaml = `
company:
  name: TestCo
projects:
  proj-a:
    directory: "/tmp/test-project"
    name: "Test Project"
    agents:
      dev:
        type: dev
        skills: [typescript]
        model: deepseek/deepseek-v4-flash
`;

const fullYaml = `
company:
  name: FullCo
projects:
  proj-a:
    directory: "/tmp/test-project"
    name: "Full Project"
    agents:
      dev:
        type: dev
        skills: [typescript, react]
        model: deepseek/deepseek-v4-flash
      seo:
        type: seo
        skills: [keyword-research]
        model: deepseek/deepseek-v4-flash
  proj-b:
    directory: "/tmp/test-project-b"
    name: "Second Project"
    agents:
      content:
        type: content
        skills: [writing]
        model: deepseek/deepseek-v4-flash
costs:
  deepseek/deepseek-v4-flash:
    in: 0.14
    out: 0.28
`;

const envYaml = `
company:
  name: EnvCo
projects:
  proj-a:
    directory: "/tmp/test-project"
    name: "Env Project"
    agents:
      dev:
        type: dev
        skills: [typescript]
        model: deepseek/deepseek-v4-flash
`;

describe('ConfigLoader', () => {
  it('loads and parses minimal config', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-config-test-'));
    const path = join(tmpDir, 'minimal.yaml');
    writeFileSync(path, minimalYaml);
    const { config, agents } = loadConfig(path);
    expect(config.company.name).toBe('TestCo');
    expect(config.projects['proj-a']).toBeDefined();
    expect(agents.length).toBe(1);
    expect(agents[0].id).toContain('dev');
    rmSync(tmpDir, { recursive: true });
  });

  it('resolves agents with skills and projectDir', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-config-test-'));
    const path = join(tmpDir, 'full.yaml');
    writeFileSync(path, fullYaml);
    const { agents } = loadConfig(path);
    expect(agents.length).toBe(3);
    const dev = agents.find(a => a.id.includes('dev'));
    expect(dev?.skills).toContain('typescript');
    expect(dev?.projectDir).toBe('/tmp/test-project');
    expect(dev?.projectId).toBe('proj-a');
    rmSync(tmpDir, { recursive: true });
  });

  it('parses cost rates', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-config-test-'));
    const path = join(tmpDir, 'full.yaml');
    writeFileSync(path, fullYaml);
    const { config } = loadConfig(path);
    expect(config.costs).toBeDefined();
    expect(config.costs!['deepseek/deepseek-v4-flash'].in).toBe(0.14);
    expect(config.costs!['deepseek/deepseek-v4-flash'].out).toBe(0.28);
    rmSync(tmpDir, { recursive: true });
  });

  it('resolves env: variables in config strings', () => {
    process.env.PRAGENTS_TEST_KEY = 'DynamicCo';
    const yaml = 'company:\n  name: "env:PRAGENTS_TEST_KEY"\nprojects:\n  p:\n    name: "P"\n    directory: "/tmp"\n';
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-config-test-'));
    const path = join(tmpDir, 'env.yaml');
    writeFileSync(path, yaml);
    const { config } = loadConfig(path);
    expect(config.company.name).toBe('DynamicCo');
    delete process.env.PRAGENTS_TEST_KEY;
    rmSync(tmpDir, { recursive: true });
  });

  it('defaults autoApproveSkills to false when not set', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-config-test-'));
    const path = join(tmpDir, 'auto.yaml');
    writeFileSync(path, minimalYaml);
    const { config } = loadConfig(path);
    expect(config.company.autoApproveSkills).toBe(false);
    rmSync(tmpDir, { recursive: true });
  });

  it('accepts autoApproveSkills: true on company config', () => {
    const yaml = `company:
  name: AutoCo
  autoApproveSkills: true
projects:
  proj-a:
    directory: "/tmp/test-project"
    name: "Auto Project"
    agents:
      dev:
        type: dev
        skills: [typescript]
        model: deepseek/deepseek-v4-flash
`;
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-config-test-'));
    const path = join(tmpDir, 'auto.yaml');
    writeFileSync(path, yaml);
    const { config } = loadConfig(path);
    expect(config.company.autoApproveSkills).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it('accepts explicit autoApproveSkills: false', () => {
    const yaml = `company:
  name: ManualCo
  autoApproveSkills: false
projects:
  proj-a:
    directory: "/tmp/test-project"
    name: "Manual Project"
    agents:
      dev:
        type: dev
        skills: [typescript]
        model: deepseek/deepseek-v4-flash
`;
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-config-test-'));
    const path = join(tmpDir, 'manual.yaml');
    writeFileSync(path, yaml);
    const { config } = loadConfig(path);
    expect(config.company.autoApproveSkills).toBe(false);
    rmSync(tmpDir, { recursive: true });
  });

  it('throws on missing env var', () => {
    delete process.env.PRAGENTS_MISSING;
    const yaml = 'company:\n  name: Bad\n  api_key: "env:PRAGENTS_MISSING"\nprojects:\n  p:\n    name: "P"\n    directory: "/tmp"\n';
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-config-test-'));
    const path = join(tmpDir, 'missing.yaml');
    writeFileSync(path, yaml);
    expect(() => loadConfig(path)).toThrow('PRAGENTS_MISSING');
    rmSync(tmpDir, { recursive: true });
  });
});
