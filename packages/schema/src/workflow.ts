import { z } from 'zod';

const StepAgent = z.union([
  z.string(),
  z.object({
    route_by: z.literal('capabilities'),
    prefer: z.array(z.string()).optional(),
  }),
]);

const ParallelStep = z.lazy(() =>
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

const WorkflowStep = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(['agent', 'human_gate']).optional().default('agent'),
    agent: StepAgent.optional(),
    prompt: z.string().optional(),
    label: z.string().optional(),
    input: z.string().optional(),
    output: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    condition: z.string().optional(),
    parallel: z.array(ParallelStep).optional(),
    /** Controls what happens when one or more parallel sub-steps fail.
     *  abort (default): throw immediately, entire run fails.
     *  continue: collect all results (ok + error), pass as JSON to next step via outputs.
     *  resume-later: persist partial results and pause for human gate (stub — behaves like continue, see TODO).
     *  Default `'abort'` is applied at the engine level (engine.ts: `step.onStepFailure ?? def.onStepFailure ?? 'abort'`).
     */
    onStepFailure: z.enum(['abort', 'continue', 'resume-later']).optional(),
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
  /** Workflow-level default for onStepFailure; individual steps override this. Engine falls back to `'abort'` if neither level sets it. */
  onStepFailure: z.enum(['abort', 'continue', 'resume-later']).optional(),
});

// Zod schema + inferred type: import type { WorkflowStep } for the type, { WorkflowStepSchema } for the schema
export type WorkflowDef = z.infer<typeof WorkflowDef>;
export type WorkflowStep = z.infer<typeof WorkflowStep>;
export type TriggerConfig = z.infer<typeof TriggerConfig>;
export type OnStepFailure = 'abort' | 'continue' | 'resume-later';
