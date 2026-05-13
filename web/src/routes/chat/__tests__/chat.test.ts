import { describe, it, expect } from 'vitest';
import { parseSSELine, escapeMarkdown } from '../index.js';

// ---------------------------------------------------------------------------
// parseSSELine
// ---------------------------------------------------------------------------

describe('parseSSELine', () => {
  it('returns null for empty lines', () => {
    expect(parseSSELine('')).toBeNull();
    expect(parseSSELine('   ')).toBeNull();
  });

  it('returns null for SSE comment lines', () => {
    expect(parseSSELine(': keep-alive')).toBeNull();
    expect(parseSSELine(':')).toBeNull();
  });

  it('returns null for non-data lines', () => {
    expect(parseSSELine('event: message')).toBeNull();
    expect(parseSSELine('id: 42')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseSSELine('data: not json')).toBeNull();
    expect(parseSSELine('data: {broken')).toBeNull();
  });

  it('parses a text message envelope', () => {
    const payload = JSON.stringify({
      type: 'message',
      data: { subtype: 'text', content: 'Hello world' },
    });
    const result = parseSSELine(`data: ${payload}`);
    expect(result).not.toBeNull();
    expect((result as { type: string }).type).toBe('message');
    const data = (result as { data: { subtype: string; content: string } }).data;
    expect(data.subtype).toBe('text');
    expect(data.content).toBe('Hello world');
  });

  it('parses a status envelope', () => {
    const payload = JSON.stringify({
      type: 'message',
      data: { subtype: 'status', content: 'thinking…' },
    });
    const result = parseSSELine(`data: ${payload}`);
    expect(result).not.toBeNull();
    const data = (result as { data: { subtype: string } }).data;
    expect(data.subtype).toBe('status');
  });

  it('parses an error_message envelope', () => {
    const payload = JSON.stringify({
      type: 'message',
      data: { subtype: 'error_message', content: 'Something went wrong' },
    });
    const result = parseSSELine(`data: ${payload}`);
    expect(result).not.toBeNull();
    const data = (result as { data: { subtype: string } }).data;
    expect(data.subtype).toBe('error_message');
  });

  it('parses a plan_proposal envelope with steps', () => {
    const payload = JSON.stringify({
      type: 'message',
      data: {
        subtype: 'plan_proposal',
        content: '',
        planId: 'plan-123',
        plan: {
          steps: [
            { description: 'Research topic', agentId: 'research-agent' },
            { description: 'Write article', agentId: 'content-agent' },
          ],
        },
      },
    });
    const result = parseSSELine(`data: ${payload}`);
    expect(result).not.toBeNull();
    const data = (result as {
      data: {
        subtype: string;
        planId: string;
        plan: { steps: Array<{ description: string }> };
      };
    }).data;
    expect(data.subtype).toBe('plan_proposal');
    expect(data.planId).toBe('plan-123');
    expect(data.plan.steps).toHaveLength(2);
  });

  it('parses a done envelope', () => {
    const payload = JSON.stringify({
      type: 'done',
      data: { conversationId: 'conv-abc' },
    });
    const result = parseSSELine(`data: ${payload}`);
    expect(result).not.toBeNull();
    expect((result as { type: string }).type).toBe('done');
  });

  it('parses a thinking envelope', () => {
    const payload = JSON.stringify({
      type: 'thinking',
      data: { message: 'Analyzing request…' },
    });
    const result = parseSSELine(`data: ${payload}`);
    expect(result).not.toBeNull();
    expect((result as { type: string }).type).toBe('thinking');
  });

  it('trims leading/trailing whitespace around data:', () => {
    const payload = JSON.stringify({ type: 'done', data: { conversationId: 'x' } });
    const result = parseSSELine(`  data:   ${payload}  `);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// escapeMarkdown
// ---------------------------------------------------------------------------

describe('escapeMarkdown', () => {
  it('escapes ampersands', () => {
    expect(escapeMarkdown('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeMarkdown('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than', () => {
    expect(escapeMarkdown('3 > 2')).toBe('3 &gt; 2');
  });

  it('escapes double quotes', () => {
    expect(escapeMarkdown('"hello"')).toBe('&quot;hello&quot;');
  });

  it('does not modify plain text', () => {
    expect(escapeMarkdown('Hello world')).toBe('Hello world');
  });

  it('escapes multiple characters in the same string', () => {
    expect(escapeMarkdown('<b>"test" & example</b>')).toBe(
      '&lt;b&gt;&quot;test&quot; &amp; example&lt;/b&gt;',
    );
  });
});
