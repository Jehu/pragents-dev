/**
 * Server-local config schema entry point.
 *
 * Zod schemas and ResolvedAgent type live in the shared workspace
 * `@pragents/schema/config` so the web bundle can import the same definitions
 * for client-side validation (R3 in the config-ui plan).
 *
 * This file re-exports them and keeps the server-only runtime helpers
 * (resolveAgent, resolveAllAgents, model/budget defaults) that depend on
 * `process.env` and would pull node-only code into the web bundle.
 */
export {
  AgentType,
  MemoryAccess,
  AgentConfig,
  CompanyAgentConfig,
  ProjectAgentConfig,
  ShortTermConfig,
  MemoryConfig,
  CompanyConfig,
  ProjectConfig,
  ChatConfig,
  InterfacesConfig,
  CostRate,
  PoolConfig,
  PragentsConfig,
} from '@pragents/schema/config';
export type { ResolvedAgent } from '@pragents/schema/config';

import type {
  AgentConfig as AgentConfigType,
  CompanyConfig as CompanyConfigType,
  PragentsConfig,
  ResolvedAgent,
} from '@pragents/schema/config';

const TOKEN_BUDGETS: Record<string, number> = {
  dev: 40000,
  seo: 20000,
  content: 30000,
  pm: 30000,
  office: 20000,
  default: 20000,
};

const MODEL_MAP: Record<string, string> = {
  'claude-sonnet': 'anthropic/claude-sonnet-4-20250514',
  'claude-haiku': 'anthropic/claude-haiku-3-5-20241022',
  'claude-opus': 'anthropic/claude-opus-4-20250514',
};

function resolveModel(model: string): string {
  return MODEL_MAP[model] || model;
}

const SYSTEM_DEFAULTS: Record<string, string> = {
  model: 'claude-sonnet',
  personality: 'You are a helpful coding agent.',
};

export function resolveAgent(
  agentId: string,
  projectId: string,
  agentConfig: AgentConfigType,
  projectConfig: { name?: string; directory?: string },
  _companyConfig: CompanyConfigType,
): ResolvedAgent {
  return {
    id: agentId,
    projectId,
    type: agentConfig.type,
    role: agentConfig.role,
    model: resolveModel(agentConfig.model || SYSTEM_DEFAULTS.model),
    personality:
      agentConfig.personality ?? SYSTEM_DEFAULTS.personality,
    memory: agentConfig.memory ?? { project: 'read/write', company: 'read' },
    skills: agentConfig.skills ?? [],
    projectDir: (projectConfig.directory || process.env.HOME || '/tmp').replace(/^~/, process.env.HOME || ''),
    tokenBudget: agentConfig.tokenBudget || TOKEN_BUDGETS[agentConfig.type] || TOKEN_BUDGETS.default,
    keepWarm: agentConfig.keepWarm ?? false,
  };
}

export function resolveAllAgents(config: PragentsConfig): ResolvedAgent[] {
  const agents: ResolvedAgent[] = [];

  const company = config.company;
  for (const [type, agentCfg] of Object.entries(company.agents)) {
    if (agentCfg) {
      agents.push(
        resolveAgent(`${type}@company`, 'company', agentCfg, {
          name: 'Company',
          directory: process.env.HOME || '~',
        }, company),
      );
    }
  }

  for (const [projectId, projectCfg] of Object.entries(config.projects)) {
    for (const [type, agentCfg] of Object.entries(projectCfg.agents)) {
      if (agentCfg) {
        agents.push(
          resolveAgent(`${type}@${projectId}`, projectId, agentCfg, projectCfg, company),
        );
      }
    }
  }

  return agents;
}
