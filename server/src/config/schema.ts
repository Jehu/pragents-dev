import { z } from 'zod';

const AgentType = z.enum(['office', 'pm', 'dev', 'seo', 'content']);

const MemoryAccess = z.object({
  company: z.enum(['read', 'read/write']).optional(),
  project: z.enum(['read', 'read/write']).optional(),
  projects: z
    .object({
      all: z.enum(['read']).optional(),
    })
    .optional(),
});

const AgentConfig = z.object({
  type: AgentType,
  model: z.string().optional(),
  personality: z.string().optional(),
  memory: MemoryAccess.optional(),
  skills: z.array(z.string()).optional(),
  tokenBudget: z.number().int().positive().optional(),
});

const CompanyAgentConfig = AgentConfig.extend({
  memory: MemoryAccess.optional(),
});

const ProjectAgentConfig = AgentConfig;

const ShortTermConfig = z.object({
  max_entries: z.number().int().positive().default(100),
});

const MemoryConfig = z.object({
  short_term: ShortTermConfig.default({}),
});

const CompanyConfig = z.object({
  name: z.string().min(1, 'Company name is required'),
  agents: z
    .object({
      office: CompanyAgentConfig.optional(),
      pm: CompanyAgentConfig.optional(),
    })
    .default({}),
  memory: MemoryConfig.optional(),
});

const ProjectConfig = z.object({
  name: z.string(),
  directory: z.string(),
  agents: z
    .object({
      dev: ProjectAgentConfig.optional(),
      seo: ProjectAgentConfig.optional(),
      content: ProjectAgentConfig.optional(),
    })
    .default({}),
});

const InterfacesConfig = z.object({
  web: z
    .object({
      port: z.number().int().default(3000),
      host: z.string().default('localhost'),
    })
    .default({}),
});

export const PragentsConfig = z.object({
  company: CompanyConfig,
  projects: z.record(z.string(), ProjectConfig).default({}),
  interfaces: InterfacesConfig.default({}),
});

export type PragentsConfig = z.infer<typeof PragentsConfig>;
export type AgentType = z.infer<typeof AgentType>;
export type MemoryAccess = z.infer<typeof MemoryAccess>;
export type AgentConfig = z.infer<typeof AgentConfig>;

export interface ResolvedAgent {
  id: string;
  projectId: string;
  type: AgentType;
  model: string;
  personality: string;
  memory: MemoryAccess;
  skills: string[];
  projectDir: string;
  tokenBudget: number;
}

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
  agentConfig: AgentConfig,
  projectConfig: ProjectConfig,
  companyConfig: z.infer<typeof CompanyConfig>,
): ResolvedAgent {
  return {
    id: agentId,
    projectId,
    type: agentConfig.type,
    model:
      resolveModel(agentConfig.model || SYSTEM_DEFAULTS.model),
    personality:
      agentConfig.personality ?? SYSTEM_DEFAULTS.personality,
    memory: agentConfig.memory ?? { project: 'read/write', company: 'read' },
    skills: agentConfig.skills ?? [],
    tokenBudget: (agentConfig as any).tokenBudget || TOKEN_BUDGETS[agentConfig.type] || TOKEN_BUDGETS.default,
  };
}

export function resolveAllAgents(config: PragentsConfig): ResolvedAgent[] {
  const agents: ResolvedAgent[] = [];

  // Company agents
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

  // Project agents
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
