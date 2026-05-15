import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { SkillExtractor } from '../../skills/extractor.js';
import type { EventBuffer } from '../../events/buffer.js';
import type { ResolvedAgent } from '../../config/schema.js';
import {
  PragentsSkillFrontmatter,
  type PragentsSkillFrontmatter as SkillFM,
  type PragentsSkillFrontmatterInput,
} from '../../skills/schema.js';
import { SkillOperations, SkillNotFoundError } from '../../skills/operations.js';
import { EtagMismatchError } from '../../config/yaml-rw.js';

/** In-memory cache for the full skills list with usage stats. TTL: 60 s. */
interface SkillListCache {
  data: any[];
  expiresAt: number;
  since?: string;
}
let skillListCache: SkillListCache | null = null;

function getSkillUsageStats(skillName: string, since?: string): { usageCount: number; lastUsedAt: string | null } {
  const db = getDb();
  const params: any[] = [skillName];
  let sinceClause = '';
  if (since) {
    sinceClause = ' AND timestamp >= ?';
    params.push(since);
  }
  const row = db.prepare(
    `SELECT COUNT(*) as usageCount,
            MAX(timestamp) as lastUsedAt
     FROM events
     WHERE type = 'skill.used' AND json_extract(data, '$.skill') = ?${sinceClause}`,
  ).get(...params) as { usageCount: number; lastUsedAt: string | null };
  return { usageCount: row?.usageCount ?? 0, lastUsedAt: row?.lastUsedAt ?? null };
}

export function createSkillsRoute(
  registry: SkillRegistry,
  extractor: SkillExtractor,
  eventBuffer?: EventBuffer,
  agents: ResolvedAgent[] = [],
) {
  const r = new Hono();

  /**
   * Collect skills declared in pragents.yaml that are not in the registry yet.
   * Returns only the skill name (string) — never spreads other agent config
   * fields like `model`, `tokenBudget`, or `apiKey` into the response.
   */
  function configOnlySkills(registeredNames: Set<string>): Array<{ name: string }> {
    const seen = new Set<string>();
    for (const a of agents) {
      for (const name of a.skills ?? []) {
        if (!registeredNames.has(name) && !seen.has(name)) seen.add(name);
      }
    }
    return [...seen].map((name) => ({ name }));
  }

  // List all skills
  r.get('/', (c) => {
    const tag = c.req.query('tag');
    const status = c.req.query('status');
    const since = c.req.query('since') || undefined;

    // Cache applies only to the unfiltered list (no tag/status/since) — invalidate on mismatch
    if (!tag && !status && !since && skillListCache && skillListCache.expiresAt > Date.now()) {
      return c.json(skillListCache.data);
    }

    let skills = tag ? registry.findByTags([tag]) : registry.list();
    if (status) {
      skills = skills.filter((s) => s['x-pragents-status'] === status);
    }

    const registeredNames = new Set(skills.map((s) => s.name));

    const result: any[] = skills.map((s) => {
      const extraction = s['x-pragents-extraction'];
      const tools = (s['allowed-tools'] || '').split(' ').filter(Boolean);
      const usage = getSkillUsageStats(s.name, since);
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
        usageCount: usage.usageCount,
        lastUsedAt: usage.lastUsedAt,
        source: 'registry' as const,
      };
    });

    // Surface config-declared skills that aren't yet in the registry. They show
    // as read-only Active entries (the UI disables approve/reject for them).
    if (!tag) {
      const configSkills = configOnlySkills(registeredNames);
      const filteredConfig = status && status !== 'active' ? [] : configSkills;
      for (const cs of filteredConfig) {
        result.push({
          name: cs.name,
          description: null,
          tags: [],
          source_agent: null,
          extracted_at: null,
          tools: [],
          parameters: 0,
          scope: null,
          status: 'active',
          version: null,
          extraction_metadata: null,
          usageCount: 0,
          lastUsedAt: null,
          source: 'config' as const,
        });
      }
    }

    // Cache only the unfiltered response
    if (!tag && !status && !since) {
      skillListCache = { data: result, expiresAt: Date.now() + 60_000 };
    }

    return c.json(result);
  });

  const ops = new SkillOperations({ skillsRoot: registry.skillsDir });

  // ----- Quarantine read + mutation API (config-UI Slice 1) ---------------
  //
  // Quarantined skills (`<skillsRoot>/_quarantine/<name>/SKILL.md`) are
  // intentionally hidden from the registry's in-memory map so they never
  // leak into prompt assembly. The endpoints below give the config-UI a
  // dedicated read+edit surface without changing that boundary.

  r.get('/quarantine', (c) => {
    try {
      const list = ops.listQuarantined().map((s) => ({
        name: s.name,
        frontmatter: s.frontmatter,
        etag: s.etag,
      }));
      return c.json(list);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  r.get('/quarantine/:name', (c) => {
    try {
      const skill = ops.getQuarantined(c.req.param('name'));
      c.header('ETag', skill.etag);
      return c.json({
        name: skill.name,
        frontmatter: skill.frontmatter,
        body: skill.body,
        etag: skill.etag,
      });
    } catch (err) {
      if (err instanceof SkillNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  r.put('/quarantine/:name', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be { frontmatter, body }' }, 400);
    }
    try {
      const result = ops.updateSkill(
        c.req.param('name'),
        'quarantine',
        { frontmatter: body.frontmatter, body: body.body ?? '' },
        { ifMatch },
      );
      c.header('ETag', result.etag);
      return c.json({ name: result.name, etag: result.etag });
    } catch (err) {
      if (err instanceof SkillNotFoundError) return c.json({ error: err.message }, 404);
      if (err instanceof EtagMismatchError) {
        return c.json({ error: err.message, expected: err.expected, actual: err.actual }, 412);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  r.post('/quarantine/:name/approve', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const name = c.req.param('name');
    try {
      const result = ops.approveQuarantined(
        name,
        (n) => registry.promoteFromQuarantine(n),
        { ifMatch },
      );
      eventBuffer?.push('company', undefined, 'skill.approved', { name });
      c.header('ETag', result.etag);
      return c.json({ approved: name, status: 'active', etag: result.etag });
    } catch (err) {
      if (err instanceof SkillNotFoundError) return c.json({ error: err.message }, 404);
      if (err instanceof EtagMismatchError) {
        return c.json({ error: err.message, expected: err.expected, actual: err.actual }, 412);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  r.post('/quarantine/:name/reject', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const name = c.req.param('name');
    try {
      const result = ops.rejectQuarantined(name, { ifMatch });
      eventBuffer?.push('company', undefined, 'skill.rejected', { name, source: 'quarantine' });
      c.header('ETag', result.etag);
      return c.json({ rejected: name, status: 'rejected', etag: result.etag });
    } catch (err) {
      if (err instanceof SkillNotFoundError) return c.json({ error: err.message }, 404);
      if (err instanceof EtagMismatchError) {
        return c.json({ error: err.message, expected: err.expected, actual: err.actual }, 412);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // PUT for active skills (inline-edit of frontmatter+body) — bypasses the
  // registry's `save()` so we can attach ETag/If-Match semantics.
  r.put('/:name', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be { frontmatter, body }' }, 400);
    }
    try {
      const result = ops.updateSkill(
        c.req.param('name'),
        'active',
        { frontmatter: body.frontmatter, body: body.body ?? '' },
        { ifMatch },
      );
      c.header('ETag', result.etag);
      return c.json({ name: result.name, etag: result.etag });
    } catch (err) {
      if (err instanceof SkillNotFoundError) return c.json({ error: err.message }, 404);
      if (err instanceof EtagMismatchError) {
        return c.json({ error: err.message, expected: err.expected, actual: err.actual }, 412);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // Get a specific skill (frontmatter + body) — emits ETag header so
  // useEtagFetch on the web side can drive conflict detection.
  r.get('/:name', (c) => {
    const name = c.req.param('name');
    try {
      const fileResult = ops.getActive(name);
      c.header('ETag', fileResult.etag);
      return c.json({
        frontmatter: fileResult.frontmatter,
        body: fileResult.body,
        etag: fileResult.etag,
      });
    } catch (err) {
      if (err instanceof SkillNotFoundError) {
        // Fall back to the registry-based path for skills that bypass the
        // _quarantine flow (manually-saved skills, legacy entries).
        const full = registry.getFullSkill(name);
        if (!full) return c.json({ error: 'Skill not found' }, 404);
        return c.json({ frontmatter: full.frontmatter, body: full.body });
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
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
