import { Hono } from 'hono';
import type { SkillRegistry } from '../../skills/registry.js';
import type { SkillExtractor } from '../../skills/extractor.js';
import type { EventBuffer } from '../../events/buffer.js';
import {
  PragentsSkillFrontmatter,
  type PragentsSkillFrontmatter as SkillFM,
  type PragentsSkillFrontmatterInput,
} from '../../skills/schema.js';

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
      skills = skills.filter((s) => s['x-pragents-status'] === status);
    }
    return c.json(
      skills.map((s) => ({
        name: s.name,
        description: s.description,
        tags: s['x-pragents-tags'],
        tools: s['allowed-tools']?.split(' ') || [],
        parameters: s['x-pragents-parameters']?.length || 0,
        scope: s['x-pragents-scope'],
        status: s['x-pragents-status'],
        version: s['x-pragents-version'],
        extraction_metadata: s['x-pragents-extraction'],
      })),
    );
  });

  // Get a specific skill (frontmatter + body from SKILL.md)
  r.get('/:name', (c) => {
    const skill = registry.get(c.req.param('name'));
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    return c.json({
      frontmatter: skill,
      // body is not stored in the registry Map — only in SKILL.md files
      body: null,
    });
  });

  // Create a skill manually (POST with full frontmatter definition)
  r.post('/', async (c) => {
    const body = await c.req.json();
    const parseResult = PragentsSkillFrontmatter.safeParse(body);
    if (!parseResult.success) {
      return c.json({ error: 'Invalid skill definition', details: parseResult.error.issues }, 400);
    }
    const frontmatter = parseResult.data;
    // Prevent overwriting active skills via manual creation with same name
    const existing = registry.get(frontmatter.name);
    if (existing && existing['x-pragents-status'] === 'active') {
      return c.json({ error: `Skill "${frontmatter.name}" already exists and is active. Use a different name or reject it first.` }, 409);
    }
    registry.save(frontmatter, body.body);
    return c.json({ created: frontmatter.name, status: 'ok' }, 201);
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
      (s) => s['x-pragents-extraction']?.source_session_id === sessionId,
    );
    if (existing.length > 0) {
      return c.json({
        error: 'Skill already extracted from this session',
        existing: existing.map((s) => ({ name: s.name, status: s['x-pragents-status'] })),
      }, 409);
    }

    let extracted;
    try {
      extracted = await extractor.extract(sessionId);
    } catch (err: any) {
      if (err.message?.includes('No messages found')) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err.message || 'Extraction failed' }, 500);
    }

    const { frontmatter, body: skillBody } = extracted;

    // Check for name collision with an active skill
    const existingSkill = registry.get(frontmatter.name);
    if (existingSkill && existingSkill['x-pragents-status'] === 'active') {
      // Append a suffix to avoid silent overwrite
      (frontmatter as any).name = `${frontmatter.name}-${sessionId.substring(0, 8)}`;
    }

    registry.save(frontmatter, skillBody);

    // Emit event for feed invalidation
    const extraction = frontmatter['x-pragents-extraction'];
    eventBuffer?.push(
      frontmatter['x-pragents-scope'] || 'company',
      extraction?.source_agent_id,
      'skill.proposed',
      { name: frontmatter.name, description: frontmatter.description, sessionId },
    );

    return c.json({
      extracted: 1,
      skill: {
        name: frontmatter.name,
        description: frontmatter.description,
        tools: frontmatter['allowed-tools']?.split(' ') || [],
        parameters: frontmatter['x-pragents-parameters']?.length,
        confidence: extraction?.confidence,
        status: frontmatter['x-pragents-status'],
        body_length: skillBody.length,
      },
    });
  });

  // Approve an extracted skill
  r.post('/:name/approve', async (c) => {
    const skill = registry.get(c.req.param('name'));
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    if (skill['x-pragents-status'] === 'active') {
      return c.json({ error: 'Skill is already active' }, 409);
    }

    const updated: SkillFM = { ...skill, 'x-pragents-status': 'active' };
    registry.save(updated);

    const extraction = skill['x-pragents-extraction'];
    eventBuffer?.push(
      skill['x-pragents-scope'] || 'company',
      extraction?.source_agent_id,
      'skill.approved',
      { name: skill.name },
    );

    return c.json({ approved: skill.name, status: 'active' });
  });

  // Reject an extracted skill
  r.post('/:name/reject', async (c) => {
    const skill = registry.get(c.req.param('name'));
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    if (skill['x-pragents-status'] === 'active') {
      return c.json({ error: 'Skill is already active — cannot reject' }, 409);
    }

    const body = await c.req.json().catch(() => ({}));
    const updated: SkillFM = { ...skill, 'x-pragents-status': 'rejected' };
    registry.save(updated);

    const extraction = skill['x-pragents-extraction'];
    eventBuffer?.push(
      skill['x-pragents-scope'] || 'company',
      extraction?.source_agent_id,
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
