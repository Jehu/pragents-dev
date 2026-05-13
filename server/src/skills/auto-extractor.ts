import type { SkillExtractor, ExtractedSkill } from './extractor.js';
import type { SkillRegistry } from './registry.js';
import type { EventBuffer } from '../events/buffer.js';
import type { PragentsSkillFrontmatterInput } from './schema.js';
import { getDb } from '../db/sqlite.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../logging/index.js';

/**
 * Result of a semantic similarity check.
 */
export interface SimilarityResult {
  match: boolean;
  confidence: number;
  matchedSkillName?: string;
}

/**
 * Function signature for semantic comparison between two skill bodies.
 * Returns a SimilarityResult indicating match status and confidence.
 */
export type SemanticCompareFn = (
  bodyA: string,
  bodyB: string,
) => Promise<SimilarityResult>;

/**
 * Default semantic similarity threshold for deduplication.
 */
const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

/**
 * SkillAutoExtractor handles automatic skill extraction from completed
 * agent sessions. It checks eligibility heuristics, triggers asynchronous
 * LLM-based extraction, performs deduplication, and emits lifecycle events.
 *
 * Extraction is fire-and-forget — it never blocks session disposal.
 */
export class SkillAutoExtractor {
  private semanticCompare: SemanticCompareFn | null;
  private similarityThreshold: number;

  constructor(
    private extractor: SkillExtractor,
    private registry: SkillRegistry,
    private eventBuffer: EventBuffer,
    private autoApprove: boolean,
    semanticCompare?: SemanticCompareFn | null,
    similarityThreshold?: number,
  ) {
    this.semanticCompare = semanticCompare ?? null;
    this.similarityThreshold = similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  }

  /**
   * Check whether a session is eligible for automatic extraction.
   *
   * Rules (R2):
   * - Session must have >= 10 messages
   * - Session must not have already been extracted (R10 409 protection)
   */
  private isEligible(sessionId: string, messages: any[]): boolean {
    if (messages.length < 10) return false;

    // Check if any existing skill already references this session
    const allSkills = this.registry.list();
    if (allSkills.some((s: any) => s['x-pragents-extraction']?.source_session_id === sessionId)) {
      return false;
    }

    return true;
  }

  /**
   * Attempt automatic skill extraction from a completed session.
   *
   * This is fire-and-forget: it returns immediately and runs extraction
   * asynchronously. Errors are caught and logged — they never propagate
   * to the caller (R9).
   *
   * @param sessionId - The session ID to extract from
   * @param messages - Optional pre-loaded messages; if omitted, loads from DB
   */
  async tryExtract(sessionId: string, messages?: any[] | null): Promise<void> {
    try {
      // Heuristic pre-filter: check eligibility
      // Prefer caller-supplied messages; fall back to DB only when undefined (not null)
      const msgs = messages !== undefined ? messages : this.loadMessages(sessionId);
      if (!msgs || !this.isEligible(sessionId, msgs)) {
        return;
      }

      // Run LLM extraction (async, but we await inside this method)
      const extracted: ExtractedSkill = await this.extractor.extract(sessionId);

      // Name-based deduplication (U4 — first stage)
      const existingByName = this.registry.get(extracted.frontmatter.name);
      if (existingByName) {
        this.eventBuffer.push(
          'company',
          undefined,
          'skill.deduplicated',
          {
            name: extracted.frontmatter.name,
            sessionId,
            reason: 'name_match',
            existingSkill: extracted.frontmatter.name,
          },
        );
        return;
      }

      // Semantische Deduplication (U4 — second stage, R6/R7)
      if (this.semanticCompare) {
        const activeSkills = this.registry.list().filter(
          (s: any) => s['x-pragents-status'] === 'active',
        );

        // Only compare if there are active skills (R7 — skip if none)
        if (activeSkills.length > 0) {
          // Sample if too many active skills (>20)
          const toCompare = activeSkills.length > 20
            ? activeSkills.sort(() => Math.random() - 0.5).slice(0, 5)
            : activeSkills;

          for (const existing of toCompare) {
            const existingBody = this.registry.getBody(existing.name) || '';

            const similarity = await this.semanticCompare(
              extracted.body,
              existingBody || '',
            );

            if (similarity.match && similarity.confidence > this.similarityThreshold) {
              // R7: Raise confidence on existing skill
              const updatedConfidence = Math.min(
                1,
                (existing['x-pragents-extraction']?.confidence || 0.7) + 0.1,
              );
              const updated: any = {
                ...existing,
                'x-pragents-extraction': {
                  ...existing['x-pragents-extraction'],
                  confidence: updatedConfidence,
                },
              };
              this.registry.save(updated, existingBody || undefined);

              this.eventBuffer.push(
                'company',
                undefined,
                'skill.deduplicated',
                {
                  name: extracted.frontmatter.name,
                  sessionId,
                  reason: 'semantic_match',
                  existingSkill: existing.name,
                  confidence: similarity.confidence,
                },
              );
              return;
            }
          }
        }
      }

      // Build skill metadata — always proposed initially; quarantine guards activation
      const skillInput: PragentsSkillFrontmatterInput = {
        name: extracted.frontmatter.name,
        description: extracted.frontmatter.description,
        'x-pragents-scope': extracted.frontmatter['x-pragents-scope'] || 'project',
        'x-pragents-status': 'proposed' as any,
        'x-pragents-version': 1,
        'x-pragents-tags': extracted.frontmatter['x-pragents-tags'] || [],
        'x-pragents-agent-types': extracted.frontmatter['x-pragents-agent-types'] || [],
        'x-pragents-extraction': {
          source: 'extracted',
          source_session_id: sessionId,
          extracted_at: new Date().toISOString(),
          confidence: extracted.frontmatter['x-pragents-extraction']?.confidence || 0.7,
        },
        'x-pragents-parameters': extracted.frontmatter['x-pragents-parameters'],
      };

      // Write to quarantine — never to the active skills directory directly.
      // This prevents prompt injection via workflow-generated skill content (U17).
      const quarantinePath = this.registry.saveToQuarantine(skillInput, extracted.body);
      logger.warn(
        { name: extracted.frontmatter.name, sessionId, quarantinePath },
        'skill quarantined, requires review before activation',
      );

      // Emit lifecycle event (R8)
      this.eventBuffer.push(
        'company',
        undefined,
        'skill.quarantined',
        {
          name: extracted.frontmatter.name,
          sessionId,
          confidence: extracted.frontmatter['x-pragents-extraction']?.confidence || 0.7,
          quarantinePath,
        },
      );
    } catch (err: any) {
      // Fire-and-forget: log but never throw (R9)
      logger.error({ sessionId, err: err?.message || String(err) }, 'Auto-extraction failed for session');
    }
  }

  /**
   * Load persisted messages for a session.
   * Returns the parsed message array, or null if not found.
   */
  private loadMessages(sessionId: string): any[] | null {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT messages_json FROM session_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get(sessionId) as { messages_json: string } | undefined;

      if (!row) return null;
      return JSON.parse(row.messages_json);
    } catch (err) {
      logger.error({ sessionId, err }, 'Failed to load messages for session');
      return null;
    }
  }
}

/**
 * Creates an LLM-backed semantic comparison function for skill deduplication.
 *
 * Uses an isolated pi SDK session with a minimal system prompt to compare
 * two skill bodies and determine whether they represent the same repeatable
 * pattern. Returns { match: boolean, confidence: 0-1 }.
 *
 * The function is injectable into SkillAutoExtractor for testability;
 * the actual pi SDK imports are passed as factory parameters so tests
 * can mock them without requiring a running pi environment.
 *
 * @param createAgentSession - pi SDK's createAgentSession (or mock)
 * @param DefaultResourceLoader - pi SDK's DefaultResourceLoader (or mock)
 * @param SessionManager - pi SDK's SessionManager (or mock)
 * @returns SemanticCompareFn that calls the LLM for comparison
 */
export function createSemanticCompareFn(
  createAgentSession: any,
  DefaultResourceLoader: any,
  SessionManager: any,
): SemanticCompareFn {
  return async (bodyA: string, bodyB: string): Promise<SimilarityResult> => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pragents-semcmp-'));
    mkdirSync(join(tempDir, '.pi'), { recursive: true });

    try {
      const systemPrompt = [
        'You are a semantic similarity engine. Compare two skill descriptions and determine',
        'whether they describe the same repeatable pattern. Two skills match when they:',
        '- Solve the same problem using the same approach',
        '- Target the same workflow or use case',
        '- Would be redundant if both existed in the catalog',
        '',
        'Return ONLY a JSON object: {"match": true/false, "confidence": 0.0-1.0}',
        'Do not include any other text, explanation, or markdown formatting.',
      ].join('\n');

      const loader = new DefaultResourceLoader({
        cwd: tempDir,
        agentDir: join(tempDir, '.pi'),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPromptOverride: () => systemPrompt,
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd: tempDir,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory() as any,
        model: undefined as any,
      });

      try {
        let responseText = '';
        const responsePromise = new Promise<string>((resolve) => {
          const unsubscribe = session.subscribe((event: any) => {
            if (event.type === 'message_end' && event.message?.role === 'assistant') {
              const content = event.message.content;
              responseText += typeof content === 'string'
                ? content
                : Array.isArray(content)
                  ? content.map((b: any) => b.text || '').join('')
                  : '';
            }
            if (event.type === 'agent_end') {
              unsubscribe();
              resolve(responseText);
            }
          });
        });

        const userMessage = [
          'Skill A:',
          bodyA.slice(0, 2000),
          '',
          'Skill B:',
          bodyB.slice(0, 2000),
          '',
          'Are these the same skill pattern? Return JSON only.',
        ].join('\n');

        await session.prompt(userMessage);
        const text = await responsePromise;

        // Parse JSON from response (strip potential markdown fences)
        const cleaned = text.replace(/```(?:json)?\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return {
          match: !!parsed.match,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : (parsed.match ? 0.5 : 0),
          matchedSkillName: undefined,
        };
      } finally {
        try { session.dispose(); } catch {}
      }
    } catch (err: any) {
      logger.error({ err: err?.message || String(err) }, 'Semantic comparison failed');
      return { match: false, confidence: 0 };
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  };
}
