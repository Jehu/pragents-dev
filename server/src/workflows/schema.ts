import { z } from 'zod';

const StepAgent = z.union([
  z.string(),
  z.object({
    route_by: z.literal('skills'),
    prefer: z.array(z.string()).optional(),
  }),
]);

const ParallelStep: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    agent: StepAgent,
    prompt: z.string(),
    input: z.string().optional(),
    output: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    condition: z.string().optional(),
  }),
);

const WorkflowStep: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    agent: StepAgent.optional(),
    prompt: z.string().optional(),
    input: z.string().optional(),
    output: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    condition: z.string().optional(),
    parallel: z.array(ParallelStep).optional(),
  }),
);

const TriggerConfig = z.object({
  event: z.string(),
  filter: z
    .object({
      agentId: z.string().optional(),
      projectId: z.string().optional(),
    })
    .optional(),
  cooldown_ms: z.number().int().positive().default(60000),
});

export const WorkflowDef = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: TriggerConfig.optional(),
  steps: z.array(WorkflowStep),
});

export type WorkflowDef = z.infer<typeof WorkflowDef>;
export type WorkflowStep = z.infer<typeof WorkflowStep>;
export type TriggerConfig = z.infer<typeof TriggerConfig>;
