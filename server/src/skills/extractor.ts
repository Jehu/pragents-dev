import { randomUUID } from 'node:crypto';
import type { SkillDef, SkillStep } from './schema.js';

/**
 * Pattern heuristics used to detect repeatable steps in agent output.
 */
interface DetectedPattern {
  stepType: string;
  agentHint: string;
  prompt: string;
  output?: string;
}

/**
 * SkillExtractor analyzes completed session output to identify
 * repeatable patterns and extract them as skill templates.
 *
 * The extraction works by:
 * 1. Looking for structured step indicators in the output
 *    (e.g., numbered steps, bullet-point plans, section headers)
 * 2. Detecting action verbs and agent-task patterns
 * 3. Packaging discovered patterns into SkillDef templates
 */
export class SkillExtractor {
  /**
   * Analyze a completed session's output and extract skill templates.
   *
   * @param sessionOutput - The full text response from a completed agent session
   * @param agentId - The agent that produced the output (for provenance)
   * @param sessionId - The session identifier (for provenance)
   * @returns Array of extracted skill definitions (may be empty)
   */
  extract(sessionOutput: string, agentId: string, sessionId: string): SkillDef[] {
    const patterns = this.detectPatterns(sessionOutput);
    if (patterns.length < 2) {
      // Not enough structure to form a useful skill
      return [];
    }

    const tags = this.inferTags(sessionOutput);
    const steps: SkillStep[] = patterns.map((p, i) => ({
      id: `step-${i + 1}`,
      agent: p.agentHint || undefined,
      prompt: p.prompt,
      output: p.output,
    }));

    const skillName = this.generateSkillName(sessionOutput, tags);
    const skill: SkillDef = {
      name: skillName,
      description: this.generateDescription(sessionOutput),
      source_session: sessionId,
      source_agent: agentId,
      extracted_at: new Date().toISOString(),
      tags,
      steps,
    };

    return [skill];
  }

  /**
   * Detect repeatable action patterns in agent output.
   *
   * Looks for:
   * - Numbered step patterns: "1. ..." or "Step 1: ..."
   * - Bullet-point action items
   * - Section headers followed by descriptions
   * - Action-verb-led sentences that suggest distinct tasks
   */
  detectPatterns(text: string): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Strategy 1: Numbered steps (e.g., "1. Research...", "2. Draft...")
    const numberedStepRegex = /(?:^|\n)\s*(?:step\s*)?(\d+)[.:)\]]\s+(.+)/gi;
    let match: RegExpExecArray | null;
    while ((match = numberedStepRegex.exec(text)) !== null) {
      const prompt = match[2].trim();
      if (prompt.length > 10) {
        patterns.push({
          stepType: 'numbered',
          agentHint: this.detectAgentHint(prompt),
          prompt,
          output: `step-${match[1]}-output`,
        });
      }
    }

    if (patterns.length >= 2) return patterns;

    // Strategy 2: Bullet-point action items
    const bulletRegex = /(?:^|\n)\s*[-*•]\s+(.+)/gi;
    patterns.length = 0;
    while ((match = bulletRegex.exec(text)) !== null) {
      const prompt = match[1].trim();
      if (prompt.length > 10 && this.isActionable(prompt)) {
        patterns.push({
          stepType: 'bullet',
          agentHint: this.detectAgentHint(prompt),
          prompt,
        });
      }
    }

    if (patterns.length >= 2) return patterns;

    // Strategy 3: Section headers (## or ### followed by content)
    const sectionRegex = /(?:^|\n)#{1,3}\s+(.+)\n([^\n#]+(?:\n(?![#])[^\n]+)*)/gi;
    patterns.length = 0;
    while ((match = sectionRegex.exec(text)) !== null) {
      const title = match[1].trim();
      const body = match[2].trim();
      if (body.length > 10) {
        patterns.push({
          stepType: 'section',
          agentHint: this.detectAgentHint(title + ' ' + body),
          prompt: `${title}: ${body.substring(0, 200)}`,
        });
      }
    }

    return patterns;
  }

  /**
   * Detect if a prompt suggests a specific agent type.
   */
  private detectAgentHint(text: string): string {
    const lower = text.toLowerCase();
    if (/\b(seo|keyword|meta|search rank| SERP)\b/i.test(text)) return 'seo';
    if (/\b(write|draft|article|blog|content|copy)\b/i.test(text)) return 'content';
    if (/\b(review|feedback|quality|check)\b/i.test(text)) return 'pm';
    if (/\b(code|implement|debug|build|deploy|test)\b/i.test(text)) return 'dev';
    return '';
  }

  /**
   * Check if a sentence is action-oriented (starts with a verb or contains
   * action-oriented language).
   */
  private isActionable(text: string): boolean {
    const actionVerbs = /^(?:create|write|build|implement|review|analyze|research|design|test|deploy|optimize|generate|draft|check|fix|update|refactor|configure|setup|install|run|execute|monitor|track|collect|extract|transform|process|validate|verify|document|plan|schedule|notify|send|prepare|organize|structure|compile|package|publish|release)/i;
    return actionVerbs.test(text.trim());
  }

  /**
   * Infer tags from the session output content.
   */
  private inferTags(text: string): string[] {
    const tags: string[] = [];
    const lower = text.toLowerCase();

    const tagPatterns: Record<string, RegExp> = {
      testing: /\b(tests?|spec|vitest|jest|coverage)\b/i,
      deployment: /\b(deploy|release|ci\/?cd|pipeline)\b/i,
      documentation: /\b(doc|readme|guide|tutorial|apidoc)\b/i,
      code_review: /\b(review|pr|pull request|feedback)\b/i,
      debugging: /\b(debug|error|bug|fix|stack trace)\b/i,
      research: /\b(research|investigate|analyze|explore)\b/i,
      content: /\b(blog|article|content|draft|writing)\b/i,
      seo: /\b(seo|keyword|meta|ranking)\b/i,
      refactoring: /\b(refactor|clean|simplify|restructure)\b/i,
      security: /\b(security|vulnerability|auth|permission)\b/i,
      performance: /\b(performance|optimize|speed|latency|benchmark)\b/i,
    };

    for (const [tag, regex] of Object.entries(tagPatterns)) {
      if (regex.test(text)) {
        tags.push(tag);
      }
    }

    if (tags.length === 0) {
      tags.push('general');
    }

    return tags;
  }

  /**
   * Generate a descriptive skill name from the session output.
   */
  private generateSkillName(text: string, tags: string[]): string {
    // Take first meaningful line or first 60 chars
    const firstLine = text.split('\n').find((l) => l.trim().length > 10)?.trim() || text.substring(0, 60);
    // Clean up for use as a name
    let name = firstLine
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50)
      .toLowerCase()
      .replace(/^-+|-+$/g, '');

    if (!name) {
      name = `skill-${tags.join('-')}-${randomUUID().substring(0, 8)}`;
    }

    return name;
  }

  /**
   * Generate a short description from the output text.
   */
  private generateDescription(text: string): string {
    const firstParagraph = text.split('\n\n')[0]?.trim() || '';
    if (firstParagraph.length <= 200) return firstParagraph;
    return firstParagraph.substring(0, 197) + '...';
  }
}
