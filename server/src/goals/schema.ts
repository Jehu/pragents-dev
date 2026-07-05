import { z } from 'zod';

export const GoalDef = z.object({
  id: z.string().min(1),
  description: z.string(),
  cadence: z.string(), // cron expression
  deadline: z.string().optional(), // cron expression
  workflow: z.string(), // references workflows/*.yaml name
  acceptance: z.array(z.string().min(1)).default([]),
  warn_before_ms: z.number().int().positive().default(7200000), // 2h default
});

export type GoalDef = z.infer<typeof GoalDef>;
