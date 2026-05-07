import { Hono } from 'hono';
import type { SkillRegistry } from '../../skills/registry.js';
import type { SkillExtractor } from '../../skills/extractor.js';
import { SkillDef } from '../../skills/schema.js';

export function createSkillsRoute(registry: SkillRegistry, extractor: SkillExtractor) {
  const r = new Hono();

  // List all skills
  r.get('/', (c) => {
    const tag = c.req.query('tag');
    const skills = tag ? registry.findByTags([tag]) : registry.list();
    return c.json(
      skills.map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags,
        source_agent: s.source_agent,
        extracted_at: s.extracted_at,
        steps: s.steps.length,
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
    registry.save(skill);
    return c.json({ created: skill.name, status: 'ok' }, 201);
  });

  // Extract skills from session output
  r.post('/extract', async (c) => {
    const body = await c.req.json();
    const { output, agentId, sessionId } = body;

    if (!output || typeof output !== 'string') {
      return c.json({ error: 'output (string) is required' }, 400);
    }
    if (!agentId || typeof agentId !== 'string') {
      return c.json({ error: 'agentId (string) is required' }, 400);
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return c.json({ error: 'sessionId (string) is required' }, 400);
    }

    const skills = extractor.extract(output, agentId, sessionId);

    // Persist extracted skills
    for (const skill of skills) {
      registry.save(skill);
    }

    return c.json({
      extracted: skills.length,
      skills: skills.map((s) => ({ name: s.name, steps: s.steps.length, tags: s.tags })),
    });
  });

  // Delete a skill
  r.delete('/:name', (c) => {
    const deleted = registry.delete(c.req.param('name'));
    if (!deleted) return c.json({ error: 'Skill not found' }, 404);
    return c.json({ deleted: true });
  });

  return r;
}
