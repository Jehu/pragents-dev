import type { ResolvedAgent } from '../config/schema.js';
import type { PragentsSkillFrontmatter } from '../skills/schema.js';

export class SkillRouter {
  constructor(private agents: ResolvedAgent[]) {}

  /**
   * Resolve the best agent for a task based on keyword matching against agent capabilities.
   * @param task - Task description to match
   * @param projectId - Project ID to scope agents
   * @param prefer - Optional preferred capability keywords (boosted 2x)
   * @param skillTags - Optional x-pragents-tags from loaded skills for additional matching
   */
  async resolveAgent(task: string, projectId: string, prefer?: string[], skillTags?: string[]): Promise<string> {
    // projectId='*' (or empty) means "consider every configured agent".
    // Used by the manual-dispatch entry point where the caller hasn't
    // committed to a project yet — the agent that wins the keyword match
    // implicitly carries its own project with it.
    const projectAgents = !projectId || projectId === '*'
      ? this.agents
      : this.agents.filter((a) => a.projectId === projectId || a.projectId === 'company');
    if (projectAgents.length === 0) {
      throw new Error(`No agents available for project "${projectId}"`);
    }

    // Keyword matching — only tokens ≥ 3 chars participate, otherwise short
    // stopwords like 'a', 'to', 'of', 'with' produce false-positive
    // substring matches against any skill containing those letters.
    const STOPWORDS = new Set([
      'and','the','for','with','from','that','this','have','will','your','their',
      'into','onto','about','some','more','than','then','also','just','only','must',
      'should','would','could','make','make','run','new','use','using','via','per',
    ]);
    const tokens = task
      .toLowerCase()
      .split(/[^a-z0-9+#-]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    const scored = projectAgents.map((agent) => {
      const matches = agent.capabilities.filter((cap) => {
        const c = cap.toLowerCase();
        return tokens.some((t) => c.includes(t) || t.includes(c));
      });
      return { agent, matches, score: matches.length };
    });

    // Boost preferred capabilities
    if (prefer?.length) {
      for (const s of scored) {
        const preferMatches = prefer.filter((p) =>
          s.agent.capabilities.some((c) => c.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(c.toLowerCase())),
        );
        s.score += preferMatches.length * 2;
      }
    }

    // Boost by x-pragents-tags from loaded skills
    if (skillTags?.length) {
      for (const s of scored) {
        const tagMatches = skillTags.filter((tag) =>
          s.agent.capabilities.some((c) => c.toLowerCase().includes(tag.toLowerCase()) || tag.toLowerCase().includes(c.toLowerCase())),
        );
        s.score += tagMatches.length;
      }
    }

    scored.sort((a, b) => b.score - a.score);

    // Single clear winner
    if (scored.length > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
      return scored[0].agent.id;
    }

    // Ambiguous: fall back to first agent (LLM fallback skipped for M2 — add in M2.5)
    return scored[0]?.agent.id || projectAgents[0].id;
  }

  /**
   * Find agents whose types match the given x-pragents-agent-types.
   * Used to pre-filter agents before routing skills.
   */
  filterByAgentTypes(agentTypes: string[]): ResolvedAgent[] {
    if (!agentTypes.length) return this.agents;
    return this.agents.filter((a) =>
      agentTypes.some((t) => a.type?.toLowerCase() === t.toLowerCase()),
    );
  }

  /**
   * Get skill tags from a loaded skill frontmatter for routing.
   */
  static getSkillTags(skill: PragentsSkillFrontmatter): string[] {
    return skill['x-pragents-tags'] || [];
  }
}
