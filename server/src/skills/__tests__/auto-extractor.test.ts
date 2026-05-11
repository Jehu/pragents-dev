import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillAutoExtractor } from '../auto-extractor.js';
import type { SkillExtractor, ExtractedSkill } from '../extractor.js';
import type { SkillRegistry } from '../registry.js';
import type { EventBuffer, PragentsEvent } from '../../events/buffer.js';

// Test fixtures
const mockMessages = Array.from({ length: 15 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `Message ${i} content here.`,
}));

const mockExtractedSkill: ExtractedSkill = {
  frontmatter: {
    name: 'test-pattern',
    description: 'A test pattern extracted from session.',
    'x-pragents-scope': 'project',
    'x-pragents-status': 'draft',
    'x-pragents-version': 1,
    'x-pragents-tags': [],
    'x-pragents-agent-types': [],
    'x-pragents-extraction': {
      source: 'extracted',
      confidence: 0.7,
    },
  } as any,
  body: '## Test Pattern\n\nThis is a test body.',
};

function createMockExtractor(): SkillExtractor {
  return {
    extract: vi.fn().mockResolvedValue(mockExtractedSkill),
  } as unknown as SkillExtractor;
}

function createMockRegistry(
  existingSkills: Array<{ name: string; sourceSessionId?: string }> = [],
): SkillRegistry {
  return {
    list: () =>
      existingSkills.map((s) => ({
        name: s.name,
        'x-pragents-extraction': {
          source: 'extracted',
          source_session_id: s.sourceSessionId || undefined,
          confidence: 0.7,
        },
      })),
    get: (name: string) => {
      const s = existingSkills.find((x) => x.name === name);
      return s ? { name: s.name, 'x-pragents-extraction': { source_session_id: s.sourceSessionId } } : undefined;
    },
    save: vi.fn(),
  } as unknown as SkillRegistry;
}

function createMockEventBuffer(): EventBuffer {
  return {
    push: vi.fn().mockImplementation((projectId, agentId, type, data, taskId) => ({
      id: 999,
      type,
      projectId,
      agentId,
      taskId,
      data,
      timestamp: new Date().toISOString(),
    } as PragentsEvent)),
  } as unknown as EventBuffer;
}

function mockSkillItem(name: string, status: string, confidence = 0.7): any {
  return {
    name,
    description: `Description for ${name}`,
    'x-pragents-scope': 'project',
    'x-pragents-status': status,
    'x-pragents-version': 1,
    'x-pragents-tags': [],
    'x-pragents-agent-types': [],
    'x-pragents-extraction': { source: 'extracted', confidence },
  };
}

describe('SkillAutoExtractor', () => {
  let extractor: SkillExtractor;
  let registry: SkillRegistry;
  let eventBuffer: EventBuffer;

  beforeEach(() => {
    extractor = createMockExtractor();
    registry = createMockRegistry();
    eventBuffer = createMockEventBuffer();
  });

  describe('isEligible', () => {
    it('returns false for sessions with < 10 messages', () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      const shortMessages = mockMessages.slice(0, 5);
      expect((ae as any).isEligible('session-1', shortMessages)).toBe(false);
    });

    it('returns false for sessions already extracted', () => {
      const reg = createMockRegistry([
        { name: 'existing-skill', sourceSessionId: 'session-1' },
      ]);
      const ae = new SkillAutoExtractor(extractor, reg, eventBuffer, false);
      expect((ae as any).isEligible('session-1', mockMessages)).toBe(false);
    });

    it('returns true for eligible session with >= 10 messages and not extracted', () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      expect((ae as any).isEligible('session-1', mockMessages)).toBe(true);
    });

    it('returns true when session was extracted from a different session', () => {
      const reg = createMockRegistry([
        { name: 'existing-skill', sourceSessionId: 'session-2' },
      ]);
      const ae = new SkillAutoExtractor(extractor, reg, eventBuffer, false);
      expect((ae as any).isEligible('session-1', mockMessages)).toBe(true);
    });

    it('returns false when session has exactly 9 messages', () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      const nineMessages = mockMessages.slice(0, 9);
      expect((ae as any).isEligible('session-1', nineMessages)).toBe(false);
    });

    it('returns true when session has exactly 10 messages', () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      const tenMessages = mockMessages.slice(0, 10);
      expect((ae as any).isEligible('session-1', tenMessages)).toBe(true);
    });
  });

  describe('tryExtract', () => {
    it('does not block and returns immediately', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      // Mock extract to take some time
      (extractor.extract as any).mockImplementation(
        () => new Promise((r) => setTimeout(() => r(mockExtractedSkill), 100)),
      );

      const promise = ae.tryExtract('session-1', mockMessages);
      // Should return quickly (fire-and-forget semantics are internal)
      const result = await Promise.race([
        promise.then(() => 'resolved'),
        new Promise((r) => setTimeout(() => r('timeout'), 200)),
      ]);
      expect(result).toBe('resolved');
    });

    it('calls extractor.extract for eligible sessions', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      await ae.tryExtract('session-1', mockMessages);
      expect(extractor.extract).toHaveBeenCalledWith('session-1');
    });

    it('skips ineligible sessions (null messages)', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      await ae.tryExtract('session-1', null);
      expect(extractor.extract).not.toHaveBeenCalled();
    });

    it('skips ineligible sessions (< 10 messages)', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      await ae.tryExtract('session-1', mockMessages.slice(0, 5));
      expect(extractor.extract).not.toHaveBeenCalled();
    });

    it('saves skill with status "proposed" when autoApproveSkills is false', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      await ae.tryExtract('session-1', mockMessages);
      expect(registry.save).toHaveBeenCalled();
      const savedSkill = (registry.save as any).mock.calls[0][0];
      expect(savedSkill['x-pragents-status']).toBe('proposed');
      expect(savedSkill['x-pragents-extraction'].source).toBe('extracted');
    });

    it('saves skill with status "active" when autoApproveSkills is true', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, true);
      await ae.tryExtract('session-1', mockMessages);
      expect(registry.save).toHaveBeenCalled();
      const savedSkill = (registry.save as any).mock.calls[0][0];
      expect(savedSkill['x-pragents-status']).toBe('active');
    });

    it('emits skill.auto_proposed event when autoApproveSkills is false', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      await ae.tryExtract('session-1', mockMessages);
      expect(eventBuffer.push).toHaveBeenCalled();
      const call = (eventBuffer.push as any).mock.calls.find(
        (c: any[]) => c[2] === 'skill.auto_proposed',
      );
      expect(call).toBeDefined();
    });

    it('emits skill.auto_approved event when autoApproveSkills is true', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, true);
      await ae.tryExtract('session-1', mockMessages);
      const call = (eventBuffer.push as any).mock.calls.find(
        (c: any[]) => c[2] === 'skill.auto_approved',
      );
      expect(call).toBeDefined();
    });

    it('catches errors and does not throw', async () => {
      (extractor.extract as any).mockRejectedValue(new Error('Extraction failed'));
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      // Should not throw
      await expect(ae.tryExtract('session-1', mockMessages)).resolves.toBeUndefined();
    });

    it('sets extraction metadata with source_session_id', async () => {
      const ae = new SkillAutoExtractor(extractor, registry, eventBuffer, false);
      await ae.tryExtract('session-1', mockMessages);
      const savedSkill = (registry.save as any).mock.calls[0][0];
      expect(savedSkill['x-pragents-extraction'].source_session_id).toBe('session-1');
      expect(savedSkill['x-pragents-extraction'].source).toBe('extracted');
    });
  });

  describe('deduplication', () => {
    it('name-based: skips extraction when skill with same name exists', async () => {
      const reg = createMockRegistry([
        { name: 'test-pattern', sourceSessionId: 'session-0' },
      ]);
      const ae = new SkillAutoExtractor(extractor, reg, eventBuffer, false);
      await ae.tryExtract('session-1', mockMessages);

      // Should call extract but skip save due to name dedup
      expect(extractor.extract).toHaveBeenCalledWith('session-1');
      // Should emit deduplication event
      const call = (eventBuffer.push as any).mock.calls.find(
        (c: any[]) => c[2] === 'skill.deduplicated',
      );
      expect(call).toBeDefined();
      expect(call[3].reason).toBe('name_match');
      // Should not save a duplicate
      const saveCalls = (reg.save as any).mock.calls.filter(
        (c: any[]) => c[0]?.name === 'test-pattern',
      );
      expect(saveCalls).toHaveLength(0);
    });

    it('name-based: allows extraction when name does not exist', async () => {
      const reg = createMockRegistry([
        { name: 'different-skill', sourceSessionId: 'session-0' },
      ]);
      const ae = new SkillAutoExtractor(extractor, reg, eventBuffer, false);
      await ae.tryExtract('session-1', mockMessages);

      // Should save the new skill
      expect(reg.save).toHaveBeenCalled();
      const savedSkill = (reg.save as any).mock.calls[0][0];
      expect(savedSkill.name).toBe('test-pattern');
    });

    it('semantic: skips extraction when body matches existing skill', async () => {
      const reg = createMockRegistry([
        { name: 'different-name', sourceSessionId: 'session-0' },
      ]);
      // Override list to return active skills
      reg.list = () => [mockSkillItem('different-name', 'active', 0.7)];
      // Add getBody mock
      (reg as any).getBody = vi.fn().mockReturnValue('Similar body content here.');

      const semanticCompare = vi.fn().mockResolvedValue({
        match: true,
        confidence: 0.9,
        matchedSkillName: 'different-name',
      });

      const ae = new SkillAutoExtractor(extractor, reg, eventBuffer, false, semanticCompare);
      await ae.tryExtract('session-1', mockMessages);

      // Should NOT save a new skill (semantic duplicate)
      const saveCalls = (reg.save as any).mock.calls.filter(
        (c: any[]) => c[0]?.name === 'test-pattern',
      );
      expect(saveCalls).toHaveLength(0);

      // Should update existing skill confidence
      const updateCalls = (reg.save as any).mock.calls.filter(
        (c: any[]) => c[0]?.name === 'different-name',
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);

      // Should emit deduplication event
      const call = (eventBuffer.push as any).mock.calls.find(
        (c: any[]) => c[2] === 'skill.deduplicated',
      );
      expect(call).toBeDefined();
      expect(call[3].reason).toBe('semantic_match');
    });

    it('semantic: saves skill when no semantic match found', async () => {
      const reg = createMockRegistry([
        { name: 'active-skill', sourceSessionId: 'session-0' },
      ]);
      reg.list = () => [mockSkillItem('active-skill', 'active', 0.8)];
      (reg as any).getBody = vi.fn().mockReturnValue('Completely different body.');

      const semanticCompare = vi.fn().mockResolvedValue({
        match: false,
        confidence: 0.2,
      });

      const ae = new SkillAutoExtractor(extractor, reg, eventBuffer, false, semanticCompare);
      await ae.tryExtract('session-1', mockMessages);

      // Should save the new skill
      const saveCalls = (reg.save as any).mock.calls.filter(
        (c: any[]) => c[0]?.name === 'test-pattern',
      );
      expect(saveCalls.length).toBe(1);
    });

    it('semantic: skips comparison when no active skills exist', async () => {
      const reg = createMockRegistry([
        { name: 'proposed-skill', sourceSessionId: 'session-0' },
      ]);
      reg.list = () => [mockSkillItem('proposed-skill', 'proposed', 0.7)];

      const semanticCompare = vi.fn();
      const ae = new SkillAutoExtractor(extractor, reg, eventBuffer, false, semanticCompare);
      await ae.tryExtract('session-1', mockMessages);

      // Should not call semantic compare (no active skills)
      expect(semanticCompare).not.toHaveBeenCalled();
      // Should save normally
      expect(reg.save).toHaveBeenCalled();
    });

    it('semantic: handles missing semanticCompare gracefully', async () => {
      const reg = createMockRegistry([
        { name: 'active-skill', sourceSessionId: 'session-0' },
      ]);
      reg.list = () => [mockSkillItem('active-skill', 'active', 0.8)];

      // No semanticCompare provided
      const ae = new SkillAutoExtractor(extractor, reg, eventBuffer, false, null);
      await ae.tryExtract('session-1', mockMessages);

      // Should save normally (semantic dedup skipped)
      expect(reg.save).toHaveBeenCalled();
    });
  });
});

describe('createSemanticCompareFn', () => {
  it('returns a function that calls the LLM and parses JSON response', async () => {
    const { createSemanticCompareFn } = await import('../auto-extractor.js');

    // Mock pi SDK
    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => {
          cb({
            type: 'assistant_message',
            message: { content: '{"match":true,"confidence":0.92}' },
          });
          setTimeout(() => cb({ type: 'agent_end' }), 5);
        }, 5);
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };

    const mockCreateSession = vi.fn().mockResolvedValue({ session: mockSession });

    const mockResourceLoader = vi.fn().mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const compareFn = createSemanticCompareFn(mockCreateSession, mockResourceLoader);
    const result = await compareFn('Body A content', 'Body B content');

    expect(result.match).toBe(true);
    expect(result.confidence).toBe(0.92);
    expect(mockSession.prompt).toHaveBeenCalled();
    const promptArg = (mockSession.prompt as any).mock.calls[0][0];
    expect(promptArg).toContain('Body A content');
    expect(promptArg).toContain('Body B content');
  });

  it('returns no-match for LLM responses below threshold', async () => {
    const { createSemanticCompareFn } = await import('../auto-extractor.js');

    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => {
          cb({
            type: 'assistant_message',
            message: { content: '{"match":false,"confidence":0.3}' },
          });
          setTimeout(() => cb({ type: 'agent_end' }), 5);
        }, 5);
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };

    const mockCreateSession = vi.fn().mockResolvedValue({ session: mockSession });
    const mockResourceLoader = vi.fn().mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const compareFn = createSemanticCompareFn(mockCreateSession, mockResourceLoader);
    const result = await compareFn('Body A', 'Body B');

    expect(result.match).toBe(false);
    expect(result.confidence).toBe(0.3);
  });

  it('handles invalid JSON gracefully', async () => {
    const { createSemanticCompareFn } = await import('../auto-extractor.js');

    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => {
          cb({
            type: 'assistant_message',
            message: { content: 'not json at all' },
          });
          setTimeout(() => cb({ type: 'agent_end' }), 5);
        }, 5);
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };

    const mockCreateSession = vi.fn().mockResolvedValue({ session: mockSession });
    const mockResourceLoader = vi.fn().mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const compareFn = createSemanticCompareFn(mockCreateSession, mockResourceLoader);
    const result = await compareFn('Body A', 'Body B');

    // Should return no-match on parse failure
    expect(result.match).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('handles LLM errors gracefully', async () => {
    const { createSemanticCompareFn } = await import('../auto-extractor.js');

    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => cb({ type: 'error', error: 'LLM timeout' }), 5);
        return () => {};
      }),
      prompt: vi.fn().mockRejectedValue(new Error('LLM failure')),
      dispose: vi.fn(),
    };

    const mockCreateSession = vi.fn().mockResolvedValue({ session: mockSession });
    const mockResourceLoader = vi.fn().mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const compareFn = createSemanticCompareFn(mockCreateSession, mockResourceLoader);
    const result = await compareFn('Body A', 'Body B');

    // Should return no-match on error
    expect(result.match).toBe(false);
    expect(result.confidence).toBe(0);
  });
});
