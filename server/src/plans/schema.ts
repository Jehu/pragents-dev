import { z } from 'zod';

/**
 * A single step in a plan. Matches the shape produced by `nl/decomposer.ts`
 * (PlanStepSchema there) so the same object can flow through both paths
 * without translation. `dependsOn` is intentionally permissive: the
 * decomposer normalises numeric-string values but downstream consumers may
 * accept arrays or single numbers.
 */
export const PlanStepSchema = z.object({
  description: z.string(),
  agentId: z.string(),
  dependsOn: z.any().optional(),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanStatusSchema = z.enum([
  'draft',
  'approved',
  'executing',
  'done',
  'failed',
  'cancelled',
]);

export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanOriginSchema = z.enum(['nl', 'chat', 'tasks', 'workflow']);

export type PlanOrigin = z.infer<typeof PlanOriginSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  status: PlanStatusSchema,
  origin: PlanOriginSchema,
  agentId: z.string().nullable(),
  projectId: z.string().nullable(),
  conversationId: z.string().nullable(),
  prompt: z.string(),
  steps: z.array(PlanStepSchema),
  result: z.any().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

export type Plan = z.infer<typeof PlanSchema>;

export const PlanCreateSchema = z.object({
  origin: PlanOriginSchema,
  agentId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  prompt: z.string(),
  steps: z.array(PlanStepSchema),
});

export type PlanCreate = z.infer<typeof PlanCreateSchema>;
