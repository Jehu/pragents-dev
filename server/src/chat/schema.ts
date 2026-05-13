import { z } from 'zod';

// ---- Attachment Schema (R8) ----

export const SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'application/json',
  'text/markdown',
] as const;

export const AttachmentSchema = z.object({
  name: z.string().min(1),
  mimeType: z.enum(SUPPORTED_MIME_TYPES),
  data: z
    .string()
    .min(1)
    .refine(
      (val) => {
        // 10 MB in base64 ≈ 13,981,336 chars maximum
        // base64: 4 chars per 3 bytes → 10 MB = 10 * 1024 * 1024 * 4/3 ≈ 13,981,337
        // Use a generous threshold: 14 MB chars
        const MAX_BASE64_LENGTH = 14_000_000;
        return val.length <= MAX_BASE64_LENGTH;
      },
      { message: 'Attachment data exceeds 10 MB limit' },
    ),
});

export type Attachment = z.infer<typeof AttachmentSchema>;

// ---- Chat Request Schema (R1) ----

export const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message must not be empty'),
  conversationId: z.string().optional(),
  agentId: z.string().optional(),
  projectId: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
  confirm: z.boolean().optional(),
  modifications: z.string().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ---- Message Subtype Enum (R2) ----

export const MessageSubtype = z.enum([
  'text',
  'plan_proposal',
  'status',
  'error_message',
]);

export type MessageSubtype = z.infer<typeof MessageSubtype>;

// ---- Base SSE Event fields ----

const SSEBase = z.object({
  version: z.number().int().positive().optional().default(1),
});

// ---- SSE Event Schemas (discriminated union on type, R2) ----

export const ThinkingEventSchema = SSEBase.extend({
  type: z.literal('thinking'),
  data: z.object({
    message: z.string(),
  }),
});

export const ToolCallEventSchema = SSEBase.extend({
  type: z.literal('tool_call'),
  data: z.object({
    tool: z.string(),
    args: z.record(z.unknown()),
  }),
});

export const ToolResultEventSchema = SSEBase.extend({
  type: z.literal('tool_result'),
  data: z.object({
    tool: z.string(),
    result: z.string(),
  }),
});

export const MessageEventSchema = SSEBase.extend({
  type: z.literal('message'),
  data: z.object({
    subtype: MessageSubtype,
    content: z.string(),
    /**
     * For plan_proposal subtype: id of the plan persisted in the unified
     * `plans` store (#28). Clients can call POST /api/v1/plans/:id/approve
     * to dispatch execution. Optional — older clients can still use the
     * existing chat `confirm` flow without ever reading this field.
     */
    planId: z.string().optional(),
    plan: z
      .object({
        steps: z.array(
          z.object({
            description: z.string(),
            agentId: z.string(),
            dependsOn: z.number().int().optional(),
          }),
        ),
      })
      .optional(),
  }),
});

export const ErrorEventSchema = SSEBase.extend({
  type: z.literal('error'),
  data: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const DoneEventSchema = SSEBase.extend({
  type: z.literal('done'),
  data: z.object({
    conversationId: z.string(),
  }),
});

// ---- Discriminated Union ----

export const SSEEventSchema = z.discriminatedUnion('type', [
  ThinkingEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  MessageEventSchema,
  ErrorEventSchema,
  DoneEventSchema,
]);

export type ThinkingEvent = z.infer<typeof ThinkingEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type MessageEvent = z.infer<typeof MessageEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type DoneEvent = z.infer<typeof DoneEventSchema>;
export type SSEEvent = z.infer<typeof SSEEventSchema>;
/** Input type for SSE events — version is optional (defaulted by schema). */
export type SSEEventInput = z.input<typeof SSEEventSchema>;
