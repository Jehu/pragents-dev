import { describe, it, expect } from 'vitest';
import {
  ChatRequestSchema,
  AttachmentSchema,
  SSEEventSchema,
  MessageSubtype,
} from '../schema.js';

describe('ChatRequestSchema', () => {
  it('parses a minimal valid request (message only)', () => {
    const result = ChatRequestSchema.safeParse({ message: 'Hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Hello');
      expect(result.data.conversationId).toBeUndefined();
      expect(result.data.projectId).toBeUndefined();
      expect(result.data.attachments).toBeUndefined();
      expect(result.data.confirm).toBeUndefined();
      expect(result.data.modifications).toBeUndefined();
    }
  });

  it('parses a full request with all optional fields', () => {
    const result = ChatRequestSchema.safeParse({
      message: 'Hello with everything',
      conversationId: 'conv-123',
      projectId: 'proj-abc',
      attachments: [{ name: 'test.txt', mimeType: 'text/plain', data: 'SGVsbG8=' }],
      confirm: true,
      modifications: 'Add more tests',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversationId).toBe('conv-123');
      expect(result.data.projectId).toBe('proj-abc');
      expect(result.data.attachments).toHaveLength(1);
      expect(result.data.confirm).toBe(true);
      expect(result.data.modifications).toBe('Add more tests');
    }
  });

  it('rejects empty message string', () => {
    const result = ChatRequestSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing message field', () => {
    const result = ChatRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects message that is not a string', () => {
    const result = ChatRequestSchema.safeParse({ message: 123 });
    expect(result.success).toBe(false);
  });

  it('rejects confirm when not a boolean', () => {
    const result = ChatRequestSchema.safeParse({ message: 'Hello', confirm: 'yes' });
    expect(result.success).toBe(false);
  });
});

describe('AttachmentSchema', () => {
  const supportedMimes = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'application/json',
    'text/markdown',
  ];

  it.each(supportedMimes)('accepts valid MIME type: %s', (mimeType) => {
    const result = AttachmentSchema.safeParse({
      name: 'file',
      mimeType,
      data: 'SGVsbG8=',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unsupported MIME type', () => {
    const result = AttachmentSchema.safeParse({
      name: 'file',
      mimeType: 'video/mp4',
      data: 'SGVsbG8=',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(AttachmentSchema.safeParse({}).success).toBe(false);
    expect(AttachmentSchema.safeParse({ name: 'f' }).success).toBe(false);
    expect(AttachmentSchema.safeParse({ mimeType: 'text/plain' }).success).toBe(false);
  });

  it('rejects attachments with base64 data exceeding 10 MB (configurable limit)', () => {
    // 10 MB binary → ~13.98 MB base64 chars. The schema limit is 14,000,000 chars.
    // To trigger rejection, create 11 MB binary → ~15.4 MB base64 chars.
    const elevenMBBase64 = Buffer.alloc(11 * 1024 * 1024).toString('base64');
    const result = AttachmentSchema.safeParse({
      name: 'big.bin',
      mimeType: 'text/plain',
      data: elevenMBBase64,
    });
    expect(result.success).toBe(false);
  });

  it('accepts attachment under the size limit', () => {
    const smallData = Buffer.from('hello').toString('base64');
    const result = AttachmentSchema.safeParse({
      name: 'small.txt',
      mimeType: 'text/plain',
      data: smallData,
    });
    expect(result.success).toBe(true);
  });
});

describe('SSEEventSchema (discriminated union)', () => {
  it('parses a thinking event', () => {
    const result = SSEEventSchema.safeParse({
      type: 'thinking',
      data: { message: 'Processing...' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'thinking') {
        expect(evt.data.message).toBe('Processing...');
      }
    }
  });

  it('parses a tool_call event', () => {
    const result = SSEEventSchema.safeParse({
      type: 'tool_call',
      data: { tool: 'query_tasks', args: { status: 'failed' } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'tool_call') {
        expect(evt.data.tool).toBe('query_tasks');
        expect(evt.data.args).toEqual({ status: 'failed' });
      }
    }
  });

  it('parses a tool_result event', () => {
    const result = SSEEventSchema.safeParse({
      type: 'tool_result',
      data: { tool: 'query_tasks', result: '[]' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'tool_result') {
        expect(evt.data.tool).toBe('query_tasks');
        expect(evt.data.result).toBe('[]');
      }
    }
  });

  it('parses a message event with text subtype', () => {
    const result = SSEEventSchema.safeParse({
      type: 'message',
      data: { subtype: 'text', content: 'Here are your tasks' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'message') {
        expect(evt.data.subtype).toBe('text');
        expect(evt.data.content).toBe('Here are your tasks');
      }
    }
  });

  it('parses a message event with plan_proposal subtype', () => {
    const result = SSEEventSchema.safeParse({
      type: 'message',
      data: {
        subtype: 'plan_proposal',
        content: 'Proposed plan',
        plan: { steps: [{ description: 'Build X', agentId: 'dev' }] },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'message') {
        expect(evt.data.subtype).toBe('plan_proposal');
        expect(evt.data.plan).toBeDefined();
        expect(evt.data.plan.steps).toHaveLength(1);
      }
    }
  });

  it('parses a message event with status subtype', () => {
    const result = SSEEventSchema.safeParse({
      type: 'message',
      data: { subtype: 'status', content: 'Task completed' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'message') {
        expect(evt.data.subtype).toBe('status');
      }
    }
  });

  it('parses a message event with error_message subtype', () => {
    const result = SSEEventSchema.safeParse({
      type: 'message',
      data: { subtype: 'error_message', content: 'Something went wrong' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'message') {
        expect(evt.data.subtype).toBe('error_message');
      }
    }
  });

  it('parses an error event', () => {
    const result = SSEEventSchema.safeParse({
      type: 'error',
      data: { code: 'INTERNAL', message: 'Something broke' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'error') {
        expect(evt.data.code).toBe('INTERNAL');
        expect(evt.data.message).toBe('Something broke');
      }
    }
  });

  it('parses a done event', () => {
    const result = SSEEventSchema.safeParse({
      type: 'done',
      data: { conversationId: 'conv-123' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const evt = result.data;
      if (evt.type === 'done') {
        expect(evt.data.conversationId).toBe('conv-123');
      }
    }
  });

  it('rejects an event without type field', () => {
    const result = SSEEventSchema.safeParse({
      data: { message: 'no type' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown event type', () => {
    const result = SSEEventSchema.safeParse({
      type: 'unknown_event',
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it('includes version field on all event types (forward-compatible)', () => {
    // All events should accept version field
    const thinkingResult = SSEEventSchema.safeParse({
      type: 'thinking',
      version: 1,
      data: { message: 'Processing...' },
    });
    expect(thinkingResult.success).toBe(true);

    // version: 2 should also parse (forward-compatible)
    const futureResult = SSEEventSchema.safeParse({
      type: 'thinking',
      version: 2,
      data: { message: 'Future...' },
    });
    expect(futureResult.success).toBe(true);
  });
});

describe('MessageSubtype enum', () => {
  it('defines all expected subtype values', () => {
    const values = MessageSubtype.options;
    expect(values).toContain('text');
    expect(values).toContain('plan_proposal');
    expect(values).toContain('status');
    expect(values).toContain('error_message');
  });
});
