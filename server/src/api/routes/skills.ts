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
      skills.map((s) => {
        const extraction = s['x-pragents-extraction'];
        const tools = (s['allowed-tools'] || '').split(' ').filter(Boolean);
        return {
          name: s.name,
          description: s.description,
          tags: s['x-pragents-tags'],
          source_agent: extraction?.source_agent_id || null,
          extracted_at: extraction?.extracted_at || null,
          tools,
          parameters: s['x-pragents-parameters']?.length || 0,
          scope: s['x-pragents-scope'],
          status: s['x-pragents-status'],
          version: s['x-pragents-version'],
          extraction_metadata: extraction || null,
        };
      }),
    );
  });

  // Get a specific skill (frontmatter + body)
  r.get('/:name', (c) => {
    const full = registry.getFullSkill(c.req.param('name'));
    if (!full) return c.json({ error: 'Skill not found' }, 404);
    return c.json({
      frontmatter: full.frontmatter,
      body: full.body,
    });
  });

  // Create a skill manually
  r.post('/', async (c) => {
    const body = await c.req.json();
    // Strip 'body' from frontmatter — it's markdown content, not a frontmatter field
    const { body: mdBody, ...frontmatterRaw } = body;
    const parseResult = PragentsSkillFrontmatter.safeParse(frontmatterRaw);
    if (!parseResult.success) {
      return c.json({ error: 'Invalid skill definition', details: parseResult.error.issues }, 400);
    }
    const frontmatter = parseResult.data;
    // Enforce body size limit
    const bodyStr = typeof mdBody === 'string' ? mdBody : undefined;
    if (bodyStr && bodyStr.length > 1_000_000) {
      return c.json({ error: 'Body exceeds maximum size of 1MB' }, 400);
    }
    // Prevent overwriting active skills
    const existing = registry.get(frontmatter.name);
    if (existing && existing['x-pragents-status'] === 'active') {
      return c.json({ error: `Skill "${frontmatter.name}" already exists and is active. Use a different name or reject it first.` }, 409);
    }
    registry.save(frontmatter, bodyStr);
    return c.json({ created: frontmatter.name, status: 'ok' }, 201);
  });

  // Extract skills from a completed session trace
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
      // Normalize session ID suffix to valid kebab-case
      const suffix = sessionId
        .substring(0, 8)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      (frontmatter as any).name = `${frontmatter.name}-${suffix}`;
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

    const tools = (frontmatter['allowed-tools'] || '').split(' ').filter(Boolean);
    return c.json({
      extracted: 1,
      skill: {
        name: frontmatter.name,
        description: frontmatter.description,
        tools,
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
    // Body is preserved from stored body in registry (no need to pass explicitly)
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

  // Reject a skill (increments reject_count; demotes active skills to proposed on threshold)
  r.post('/:name/reject', async (c) => {
    const skillName = c.req.param('name');
    const skill = registry.get(skillName);
    if (!skill) return c.json({ error: 'Skill not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const isActive = skill['x-pragents-status'] === 'active';

    if (isActive) {
      // Active skills use the counter-based demotion path
      const result = registry.rejectSkill(skillName);
      if (!result) return c.json({ error: 'Skill not found' }, 404);

      const extraction = skill['x-pragents-extraction'];
      const eventName = result.demoted ? 'skill.demoted' : 'skill.reject_counted';
      eventBuffer?.push(
        skill['x-pragents-scope'] || 'company',
        extraction?.source_agent_id,
        eventName,
        {
          name: skillName,
          reason: body.reason,
          rejectCount: result.rejectCount,
          demoted: result.demoted,
        },
      );

      return c.json({
        name: skillName,
        rejectCount: result.rejectCount,
        demoted: result.demoted,
        status: result.demoted ? 'proposed' : 'active',
        reason: body.reason || null,
      });
    }

    // Non-active skills: immediate rejection (existing behaviour)
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
