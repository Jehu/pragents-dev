import { Hono } from 'hono';
import type { SkillRegistry } from '../../skills/registry.js';
import type { SkillExtractor } from '../../skills/extractor.js';
import type { EventBuffer } from '../../events/buffer.js';
import { SkillDef } from '../../skills/schema.js';

export function createSkillsRoute(
  registry: SkillRegistry,
  extractor: SkillExtractor,
  eventBuffer?: EventBuffer,
) {
  const r = new Hono();

  // List all skills
  r.get('/', (c) => {
    const tag = c.req.query('tag');
    const status = c.req.query('status');
    let skills = tag ? registry.findByTags([tag]) : registry.list();
    if (status) {
      skills = skills.filter((s) => s.status === status);
    }
    return c.json(
      skills.map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags,
        source_agent: s.source_agent,
        extracted_at: s.extracted_at,
        steps: s.steps.length,
        tools: s.tools,
        parameters: s.parameters?.length,
        scope: s.scope,
        status: s.status,
        version: s.version,
        extraction_metadata: s.extraction_metadata,
      })),
    );
  });

  // Get a specific skill
  r.get('/:name', (c) => {
    const skill = registry.get(c.req.param('name'));
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    return c.json(skill);
  });

  // Create a skill manually (POST with full skill definition)
  r.post('/', async (c) => {
    const body = await c.req.json();
    const parseResult = SkillDef.safeParse(body);
    if (!parseResult.success) {
      return c.json({ error: 'Invalid skill definition', details: parseResult.error.issues }, 400);
    }
    const skill = parseResult.data;
    // Prevent overwriting active skills via manual creation with same name
    const existing = registry.get(skill.name);
    if (existing && existing.status === 'active') {
      return c.json({ error: `Skill "${skill.name}" already exists and is active. Use a different name or reject it first.` }, 409);
    }
    registry.save(skill);
    return c.json({ created: skill.name, status: 'ok' }, 201);
  });

  // Extract skills from a completed session trace (LLM-powered, M5)
  r.post('/extract', async (c) => {
    const body = await c.req.json();
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      return c.json({ error: 'sessionId (string) is required' }, 400);
    }

    // Check if a skill was already extracted from this session
    const existing = registry.list().filter(
      (s) => s.extraction_metadata?.source_session_id === sessionId,
    );
    if (existing.length > 0) {
      return c.json({
        error: 'Skill already extracted from this session',
        existing: existing.map((s) => ({ name: s.name, status: s.status })),
      }, 409);
    }

    let skill;
    try {
      skill = await extractor.extract(sessionId);
    } catch (err: any) {
      if (err.message?.includes('No messages found')) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err.message || 'Extraction failed' }, 500);
    }

    // Check for name collision with an active skill
    const existingSkill = registry.get(skill.name);
    if (existingSkill && existingSkill.status === 'active') {
      // Append a suffix to avoid silent overwrite
      skill.name = `${skill.name}-${sessionId.substring(0, 8)}`;
    }

    registry.save(skill);

    // Emit event for feed invalidation
    eventBuffer?.push(
      skill.scope || 'company',
      skill.extraction_metadata?.source_agent_id,
      'skill.proposed',
      { name: skill.name, description: skill.description, sessionId },
    );

    return c.json({
      extracted: 1,
      skill: {
        name: skill.name,
        description: skill.description,
        steps: skill.steps.length,
        tools: skill.tools,
        parameters: skill.parameters?.length,
        confidence: skill.extraction_metadata?.confidence,
        status: skill.status,
      },
    });
  });

  // Approve an extracted skill
  r.post('/:name/approve', async (c) => {
    const skill = registry.get(c.req.param('name'));
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    if (skill.status === 'active') {
      return c.json({ error: 'Skill is already active' }, 409);
    }

    skill.status = 'active';
    registry.save(skill);

    eventBuffer?.push(
      skill.scope || 'company',
      skill.extraction_metadata?.source_agent_id,
      'skill.approved',
      { name: skill.name },
    );

    return c.json({ approved: skill.name, status: 'active' });
  });

  // Reject an extracted skill
  r.post('/:name/reject', async (c) => {
    const skill = registry.get(c.req.param('name'));
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    if (skill.status === 'active') {
      return c.json({ error: 'Skill is already active — cannot reject' }, 409);
    }

    const body = await c.req.json().catch(() => ({}));
    skill.status = 'rejected';
    registry.save(skill);

    eventBuffer?.push(
      skill.scope || 'company',
      skill.extraction_metadata?.source_agent_id,
      'skill.rejected',
      { name: skill.name, reason: body.reason },
    );

    return c.json({ rejected: skill.name, reason: body.reason || null });
  });

  // Delete a skill
  r.delete('/:name', (c) => {
    const deleted = registry.delete(c.req.param('name'));
    if (!deleted) return c.json({ error: 'Skill not found' }, 404);
    return c.json({ deleted: true });
  });

  return r;
}
