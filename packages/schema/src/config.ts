import { z } from 'zod';

export const AgentType = z.enum(['office', 'pm', 'dev', 'seo', 'content']);

export const MemoryAccess = z.object({
  company: z.enum(['read', 'read/write']).optional(),
  project: z.enum(['read', 'read/write']).optional(),
  projects: z
    .object({
      all: z.enum(['read']).optional(),
    })
    .optional(),
});

/**
 * Per-agent platform-tool authorization. Evaluated in ToolExecutor.execute:
 * a tool named in `deny` is always blocked; if `allow` is set, only listed
 * tools are permitted. Absent policy (the default) permits every tool.
 * Distinct from `capabilities`, which is free-form routing keywords.
 */
export const ToolPolicy = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

export const AgentConfig = z.object({
  type: AgentType,
  role: z.enum(['fast', 'standard']).optional(),
  model: z.string().optional(),
  personality: z.string().optional(),
  memory: MemoryAccess.optional(),
  capabilities: z.array(z.string()).optional(),
  tools: ToolPolicy.optional(),
  tokenBudget: z.number().int().positive().max(10_000_000).optional(),
  /**
   * When true, the agent's session is pre-spawned on server boot and never
   * idle-shutdown. Useful for cron-driven goal agents that pay a high
   * cold-start cost on every wakeup. Default: false.
   */
  keepWarm: z.boolean().optional().default(false),
});

export const CompanyAgentConfig = AgentConfig.extend({
  memory: MemoryAccess.optional(),
});

export const ProjectAgentConfig = AgentConfig;

/** Agent types that may live under a project (excludes company-scope office/pm). */
export const PROJECT_AGENT_TYPES = ['dev', 'seo', 'content'] as const;
export const ProjectAgentType = z.enum(PROJECT_AGENT_TYPES);
export type ProjectAgentType = z.infer<typeof ProjectAgentType>;

export const ShortTermConfig = z.object({
  max_entries: z.number().int().positive().default(100),
});

export const MemoryConfig = z.object({
  short_term: ShortTermConfig.default({}),
  embeddings: z.object({
    provider: z.enum(['openai', 'pseudo']).default('pseudo'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().default('text-embedding-3-small'),
    dimensions: z.number().int().positive().default(384),
  }).optional(),
  vectorStore: z.enum(['simple', 'lancedb']).default('simple'),
});

export const CompanyConfig = z.object({
  name: z.string().min(1, 'Company name is required'),
  agents: z
    .object({
      office: CompanyAgentConfig.optional(),
      pm: CompanyAgentConfig.optional(),
    })
    .default({}),
  memory: MemoryConfig.optional(),
  autoApproveSkills: z.boolean().optional().default(false),
  similarityThreshold: z.number().min(0).max(1).optional().default(0.8),
  skillApproval: z.object({
    confidenceThreshold: z.number().min(0).max(1).default(0.9),
    blockedTools: z.array(z.string()).default(['bash', 'write', 'computer']),
  }).optional(),
});

export const ProjectConfig = z.object({
  name: z.string(),
  directory: z.string(),
  /**
   * Relative subdirectory (under `directory`) where the project's
   * workflow YAML files live. Defaults to `workflows`. Made explicit in
   * the schema so the config-UI workflow editor can resolve per-project
   * workflows without baking a constant into the server.
   */
  workflowDirectory: z.string().default('workflows'),
  agents: z
    .object({
      dev: ProjectAgentConfig.optional(),
      seo: ProjectAgentConfig.optional(),
      content: ProjectAgentConfig.optional(),
    })
    .default({}),
});

export const ChatConfig = z.object({
  /**
   * Model used by the IntentClassifier. Format: "provider/modelId"
   * (e.g. "anthropic/claude-haiku-3-5-20241022", "deepseek/deepseek-v4-flash").
   * Pick a fast, cheap model — the classifier prompt is short and only
   * needs to return a JSON object with a tool name. Falls back to the
   * first agent's model when omitted.
   */
  classifierModel: z.string().optional(),
  /**
   * Minimum confidence score (0.0–1.0) required for the IntentClassifier to
   * route to a specific tool. Results below this threshold fall back to the
   * "complex" (full agent) path. Defaults to 0.7.
   */
  classifierThreshold: z.number().min(0).max(1).default(0.7),
});

export const InterfacesConfig = z.object({
  web: z
    .object({
      port: z.number().int().default(3000),
      host: z.string().default('localhost'),
    })
    .default({}),
});

export const CostRate = z.object({
  in: z.number().nonnegative('in rate must be ≥ 0'),
  out: z.number().nonnegative('out rate must be ≥ 0'),
});

export const PoolConfig = z.object({
  /**
   * Maximum number of agent sessions that may be marked keepWarm at once.
   * If more agents request keepWarm than this cap allows, the extras stay
   * cold and a warning is logged. Default: 10.
   */
  maxWarmSessions: z.number().int().positive().default(10),
});

export const PragentsConfig = z.object({
  company: CompanyConfig,
  projects: z.record(z.string(), ProjectConfig).default({}),
  interfaces: InterfacesConfig.default({}),
  chat: ChatConfig.optional(),
  costs: z.record(z.string(), CostRate).optional(),
  pool: PoolConfig.optional(),
});

export type PragentsConfig = z.infer<typeof PragentsConfig>;
export type AgentType = z.infer<typeof AgentType>;
export type MemoryAccess = z.infer<typeof MemoryAccess>;
export type AgentConfig = z.infer<typeof AgentConfig>;
export type CompanyConfig = z.infer<typeof CompanyConfig>;
export type ProjectConfig = z.infer<typeof ProjectConfig>;
export type ChatConfig = z.infer<typeof ChatConfig>;
export type InterfacesConfig = z.infer<typeof InterfacesConfig>;
export type CostRate = z.infer<typeof CostRate>;
export type PoolConfig = z.infer<typeof PoolConfig>;
export type MemoryConfig = z.infer<typeof MemoryConfig>;
export type ToolPolicy = z.infer<typeof ToolPolicy>;

/**
 * Fully-resolved agent record materialized by the server from PragentsConfig.
 * This is a runtime type used by the agent manager, not a Zod schema.
 */
export interface ResolvedAgent {
  id: string;
  projectId: string;
  type: AgentType;
  role?: 'fast' | 'standard';
  model: string;
  personality: string;
  memory: MemoryAccess;
  capabilities: string[];
  /** Platform-tool authorization ({} = all tools permitted); see ToolPolicy. */
  tools: ToolPolicy;
  projectDir: string;
  tokenBudget: number;
  keepWarm: boolean;
}
