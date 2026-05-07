import type { ResolvedAgent } from '../config/schema.js';

export class SkillRouter {
  constructor(private agents: ResolvedAgent[]) {}

  async resolveAgent(task: string, projectId: string, prefer?: string[]): Promise<string> {
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

    scored.sort((a, b) => b.score - a.score);

    // Single clear winner
    if (scored.length > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
      return scored[0].agent.id;
    }

    // Ambiguous: fall back to first agent (LLM fallback skipped for M2 — add in M2.5)
    return scored[0]?.agent.id || projectAgents[0].id;
  }
}
