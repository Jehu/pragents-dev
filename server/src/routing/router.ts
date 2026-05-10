import type { ResolvedAgent } from '../config/schema.js';
import type { PragentsSkillFrontmatter } from '../skills/schema.js';

export class SkillRouter {
  constructor(private agents: ResolvedAgent[]) {}

  /**
   * Resolve the best agent for a task based on keyword matching against agent skills.
   * @param task - Task description to match
   * @param projectId - Project ID to scope agents
   * @param prefer - Optional preferred skill keywords (boosted 2x)
   * @param skillTags - Optional x-pragents-tags from loaded skills for additional matching
   */
  async resolveAgent(task: string, projectId: string, prefer?: string[], skillTags?: string[]): Promise<string> {
    const projectAgents = this.agents.filter((a) => a.projectId === projectId || a.projectId === 'company');
    if (projectAgents.length === 0) {
      throw new Error(`No agents available for project "${projectId}"`);
    }

    // Keyword matching
    const tokens = task.toLowerCase().split(/[^a-z0-9+#-]+/).filter(Boolean);
    const scored = projectAgents.map((agent) => {
      const matches = agent.skills.filter((skill) =>
        tokens.some((t) => skill.toLowerCase().includes(t) || t.includes(skill.toLowerCase())),
      );
      return { agent, matches, score: matches.length };
    });

    // Boost preferred skills
    if (prefer?.length) {
      for (const s of scored) {
        const preferMatches = prefer.filter((p) =>
          s.agent.skills.some((sk) => sk.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(sk.toLowerCase())),
        );
        s.score += preferMatches.length * 2;
      }
    }

    // Boost by x-pragents-tags from loaded skills
    if (skillTags?.length) {
      for (const s of scored) {
        const tagMatches = skillTags.filter((tag) =>
          s.agent.skills.some((sk) => sk.toLowerCase().includes(tag.toLowerCase()) || tag.toLowerCase().includes(sk.toLowerCase())),
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
