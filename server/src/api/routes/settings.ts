import { Hono } from 'hono';
import type { Context } from 'hono';
import * as YAML from 'yaml';
import { z } from 'zod';
import {
  ChatConfig,
  CompanyAgentConfig,
  InterfacesConfig,
  PoolConfig,
  CostRate,
} from '../../config/schema.js';
import {
  readYamlDoc,
  writeYamlDoc,
  applyMutation,
  EtagMismatchError,
} from '../../config/yaml-rw.js';
import { logger } from '../../logging/index.js';

/**
 * Config-UI: write API for global settings sections (Slice 3 / U9).
 *
 * Settings live under multiple top-level keys in `pragents.yaml`:
 *  - `costs` (record map of model → {in, out})
 *  - `pool` (max warm sessions)
 *  - `chat` (intent-classifier knobs)
 *  - `interfaces` (web port/host)
 *  - `company.skillApproval` (auto-extraction guardrails)
 *  - `company` top-level fields (name, autoApproveSkills, similarityThreshold)
 *  - `company.agents.{office,pm}` (system-level agents)
 *
 * Each endpoint validates against the matching shared schema before going
 * through the round-trip helper, so block comments and section order in
 * `pragents.yaml` survive (R2). Writes use `If-Match` for optimistic
 * concurrency and trip the watcher-suppression channel (R17) so a UI save
 * does not look like an external edit.
 */

const COMPANY_AGENT_TYPES = ['office', 'pm'] as const;
type CompanyAgentType = (typeof COMPANY_AGENT_TYPES)[number];

function isCompanyAgentType(value: string): value is CompanyAgentType {
  return (COMPANY_AGENT_TYPES as readonly string[]).includes(value);
}

const CompanyStammdaten = z.object({
  name: z.string().min(1, 'Company name is required'),
  autoApproveSkills: z.boolean().optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
});

const SkillApprovalSection = z.object({
  confidenceThreshold: z.number().min(0).max(1),
  blockedTools: z.array(z.string()),
});

const CostsRecord = z.record(z.string(), CostRate);

interface SettingsRouteOptions {
  configPath: string;
}

function zodError(c: Context, parseResult: z.SafeParseError<unknown>, message: string) {
  return c.json({ error: message, issues: parseResult.error.issues }, 400);
}

function mapWriteError(c: Context, err: unknown) {
  if (err instanceof EtagMismatchError) {
    return c.json(
      { error: err.message, expected: err.expected, actual: err.actual },
      412,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'settings route write failed');
  return c.json({ error: message }, 500);
}

/** Helper: read top-level YAMLMap node for a key, or null. */
function getMapNode(doc: YAML.Document, key: string): YAML.YAMLMap | null {
  const node = doc.get(key) as YAML.YAMLMap | undefined;
  return node && YAML.isMap(node) ? node : null;
}

/** Coerce a YAML pair's `key` (Scalar | string) to its plain string value. */
function pairKeyString(item: { key: unknown }): string {
  const k = item.key;
  if (k && typeof k === 'object' && 'value' in (k as object)) {
    return String((k as { value: unknown }).value);
  }
  return String(k);
}

export function createSettingsRoute(opts: SettingsRouteOptions) {
  const { configPath } = opts;
  const r = new Hono();

  // GET / — read all settings sections in a single response. The web SPA
  // hydrates each form from this snapshot; per-section saves still go to
  // their own PUT below so we can reject one form without losing edits in
  // the sibling forms.
  r.get('/', (c) => {
    try {
      const { doc, etag } = readYamlDoc(configPath);
      const value = (doc.toJSON?.() ?? {}) as Record<string, any>;
      const companyRaw = (value.company ?? {}) as Record<string, any>;
      c.header('ETag', etag);
      return c.json({
        costs: value.costs ?? {},
        pool: value.pool ?? null,
        chat: value.chat ?? null,
        interfaces: value.interfaces ?? null,
        company: {
          name: companyRaw.name ?? '',
          autoApproveSkills: companyRaw.autoApproveSkills,
          similarityThreshold: companyRaw.similarityThreshold,
          skillApproval: companyRaw.skillApproval ?? null,
          agents: companyRaw.agents ?? {},
        },
      });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /costs — replace the whole costs map.
  r.put('/costs', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const parsed = CostsRecord.safeParse(body);
    if (!parsed.success) return zodError(c, parsed, 'Invalid costs map');
    try {
      const { doc } = readYamlDoc(configPath);
      // Update per-key rather than replacing the whole `costs:` block so
      // trailing comments attached to individual model rows
      // (e.g. `anthropic/x: { in: 3, out: 15 } # GA pricing`) survive.
      // Keys absent from the new map are deleted; new keys are appended in
      // the order the client sent them.
      applyMutation(doc, (d) => {
        const existing = d.get('costs') as YAML.YAMLMap | undefined;
        if (!existing || !YAML.isMap(existing)) {
          d.set('costs', d.createNode(parsed.data));
          return;
        }
        const newKeys = new Set(Object.keys(parsed.data));
        for (const item of [...existing.items]) {
          const key = pairKeyString(item);
          if (!newKeys.has(key)) existing.delete(key);
        }
        for (const [model, rate] of Object.entries(parsed.data)) {
          // Find the existing pair so we can replace its value in place
          // and preserve the trailing/leading comments attached to that
          // specific row (e.g. `anthropic/x: { ... } # GA pricing`).
          const existingPair = existing.items.find(
            (i) => pairKeyString(i) === model,
          );
          if (existingPair) {
            // Preserve `# comment` attached to the value node (yaml v2
            // parks trailing comments on `value.comment`, not on the pair).
            const newValue = d.createNode(rate);
            const prev = existingPair.value as { comment?: string; commentBefore?: string } | null;
            if (prev && typeof prev === 'object') {
              if (prev.comment) (newValue as any).comment = prev.comment;
              if (prev.commentBefore) (newValue as any).commentBefore = prev.commentBefore;
            }
            existingPair.value = newValue;
          } else {
            existing.set(model, d.createNode(rate));
          }
        }
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ models: Object.keys(parsed.data) }, 'Costs map updated via API');
      return c.json({ section: 'costs', etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /pool — validate against PoolConfig.
  r.put('/pool', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const parsed = PoolConfig.safeParse(body);
    if (!parsed.success) return zodError(c, parsed, 'Invalid pool config');
    try {
      const { doc } = readYamlDoc(configPath);
      applyMutation(doc, (d) => {
        d.set('pool', d.createNode(parsed.data));
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      return c.json({ section: 'pool', etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /chat — validate against ChatConfig.
  r.put('/chat', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const parsed = ChatConfig.safeParse(body);
    if (!parsed.success) return zodError(c, parsed, 'Invalid chat config');
    try {
      const { doc } = readYamlDoc(configPath);
      applyMutation(doc, (d) => {
        d.set('chat', d.createNode(parsed.data));
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      return c.json({ section: 'chat', etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /interfaces — validate against InterfacesConfig.
  r.put('/interfaces', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const parsed = InterfacesConfig.safeParse(body);
    if (!parsed.success) return zodError(c, parsed, 'Invalid interfaces config');
    try {
      const { doc } = readYamlDoc(configPath);
      applyMutation(doc, (d) => {
        d.set('interfaces', d.createNode(parsed.data));
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      return c.json({ section: 'interfaces', etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /skill-approval — replaces `company.skillApproval`.
  r.put('/skill-approval', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const parsed = SkillApprovalSection.safeParse(body);
    if (!parsed.success) return zodError(c, parsed, 'Invalid skillApproval config');
    try {
      const { doc } = readYamlDoc(configPath);
      const company = getMapNode(doc, 'company');
      if (!company) {
        return c.json({ error: 'company section missing in pragents.yaml' }, 404);
      }
      applyMutation(doc, (d) => {
        const c2 = getMapNode(d, 'company')!;
        c2.set('skillApproval', d.createNode(parsed.data));
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      return c.json({ section: 'skill-approval', etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /company — top-level Stammdaten only (name, autoApproveSkills,
  // similarityThreshold). The nested `agents` and `skillApproval` blocks
  // have their own endpoints so this PUT never silently wipes them.
  r.put('/company', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const parsed = CompanyStammdaten.safeParse(body);
    if (!parsed.success) return zodError(c, parsed, 'Invalid company config');
    try {
      const { doc } = readYamlDoc(configPath);
      const company = getMapNode(doc, 'company');
      if (!company) {
        return c.json({ error: 'company section missing in pragents.yaml' }, 404);
      }
      applyMutation(doc, (d) => {
        const c2 = getMapNode(d, 'company')!;
        c2.set('name', parsed.data.name);
        // Optional booleans/numbers: set when present, remove when explicitly
        // null/undefined in the request to keep the YAML clean.
        if (parsed.data.autoApproveSkills === undefined) {
          c2.delete('autoApproveSkills');
        } else {
          c2.set('autoApproveSkills', parsed.data.autoApproveSkills);
        }
        if (parsed.data.similarityThreshold === undefined) {
          c2.delete('similarityThreshold');
        } else {
          c2.set('similarityThreshold', parsed.data.similarityThreshold);
        }
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ name: parsed.data.name }, 'Company stammdaten updated via API');
      return c.json({ section: 'company', etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /company/agents/:agentType — replace a single company-scope agent
  // block (office or pm). Mirrors the project-agent endpoint shape so the
  // shared AgentForm can talk to both surfaces without branching.
  r.put('/company/agents/:agentType', async (c) => {
    const agentType = c.req.param('agentType');
    if (!isCompanyAgentType(agentType)) {
      return c.json({ error: 'Invalid agentType (must be office or pm)' }, 400);
    }
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    // Reject when the body's `type` disagrees with the URL — silently
    // coercing it (the previous behaviour) means a buggy client could PUT
    // an `office` payload to `/pm` and write it to the wrong slot.
    const bodyType = (body as any).type;
    if (bodyType !== undefined && bodyType !== agentType) {
      return c.json(
        { error: `Body \`type\` (${bodyType}) does not match URL agentType (${agentType})` },
        400,
      );
    }
    const parsed = CompanyAgentConfig.safeParse({
      ...(body as object),
      type: agentType,
    });
    if (!parsed.success) return zodError(c, parsed, 'Invalid agent config');
    try {
      const { doc } = readYamlDoc(configPath);
      const company = getMapNode(doc, 'company');
      if (!company) {
        return c.json({ error: 'company section missing in pragents.yaml' }, 404);
      }
      applyMutation(doc, (d) => {
        const c2 = getMapNode(d, 'company')!;
        const agents = c2.get('agents') as YAML.YAMLMap | undefined;
        if (!agents || !YAML.isMap(agents)) {
          c2.set('agents', d.createNode({ [agentType]: parsed.data }));
        } else {
          agents.set(agentType, d.createNode(parsed.data));
        }
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ agentType }, 'Company agent updated via API');
      return c.json({ section: 'company.agents', agentType, etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // DELETE /company/agents/:agentType — drop a company-scope agent slot.
  r.delete('/company/agents/:agentType', (c) => {
    const agentType = c.req.param('agentType');
    if (!isCompanyAgentType(agentType)) {
      return c.json({ error: 'Invalid agentType (must be office or pm)' }, 400);
    }
    const ifMatch = c.req.header('If-Match');
    try {
      const { doc } = readYamlDoc(configPath);
      const company = getMapNode(doc, 'company');
      if (!company) {
        return c.json({ error: 'company section missing in pragents.yaml' }, 404);
      }
      const agents = company.get('agents') as YAML.YAMLMap | undefined;
      if (!agents || !YAML.isMap(agents) || !agents.has(agentType)) {
        return c.json({ error: `Company agent "${agentType}" not configured` }, 404);
      }
      applyMutation(doc, (d) => {
        const c2 = getMapNode(d, 'company')!;
        const a = c2.get('agents') as YAML.YAMLMap;
        a.delete(agentType);
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ agentType }, 'Company agent deleted via API');
      return c.json({ deleted: agentType, etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  return r;
}
