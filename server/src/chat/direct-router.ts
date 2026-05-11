/**
 * DirectRouter — Keyword-based matching of chat messages to M6 tools.
 * No LLM involved. Falls back to NL Decomposer when no match is found.
 */

export interface RouteResult {
  tool: string;
  args: Record<string, unknown>;
}

interface KeywordRule {
  tool: string;
  keywords: string[];
  extractArg?: (tokens: string[], original: string) => Record<string, unknown>;
}

/**
 * Extract a workflow name from the message text.
 * Matches patterns like:
 * - "start den weekly-article Workflow"
 * - "deploy content-pipeline"
 * - "trigger deployment"
 */
function extractWorkflowName(tokens: string[], original: string): string | null {
  // Stop words that appear between trigger and workflow name
  const stopWords = new Set([
    'den', 'die', 'das', 'der', 'einen', 'eine', 'ein',
    'workflow', 'workflows', 'task', 'tasks',
  ]);

  // Search for names after trigger words, skipping stop words
  const triggerWords = ['start', 'deploy', 'trigger', 'ausführen', 'führ', 'starte'];
  for (let i = 0; i < tokens.length; i++) {
    if (triggerWords.includes(tokens[i])) {
      // Look ahead for the first non-stop word
      for (let j = i + 1; j < tokens.length; j++) {
        if (!stopWords.has(tokens[j])) {
          return tokens[j];
        }
      }
    }
  }

  // Fallback: look for any word that looks like a workflow name (kebab-case)
  const workflowPattern = /([a-z][a-z0-9-]*[a-z0-9])/gi;
  const matches = original.match(workflowPattern);
  const excludeWords = new Set([
    ...stopWords,
    'start', 'deploy', 'trigger', 'aus', 'von', 'für', 'mit',
    'agent', 'agents',
  ]);
  for (const m of matches || []) {
    if (!excludeWords.has(m.toLowerCase()) && m.length > 2 && m.includes('-')) {
      return m;
    }
  }
  return null;
}

/**
 * Extract a search query from the message text.
 * Returns the portion after keywords like "über", "about", "memory", etc.
 */
function extractSearchQuery(tokens: string[], original: string): string {
  const prefixWords = [
    'weißt', 'du', 'über', 'about', 'memory', 'facts', 'erinner', 'mich',
    'an', 'den', 'die', 'das', 'was',
  ];
  const remaining = tokens.filter((t) => !prefixWords.includes(t));
  return remaining.join(' ') || original;
}

/**
 * Extract status value from message tokens.
 */
function extractStatus(tokens: string[]): string | null {
  const statusMap: Record<string, string> = {
    failed: 'failed',
    pending: 'pending',
    running: 'running',
    complete: 'complete',
    completed: 'complete',
    blocked: 'blocked',
    review: 'needs_review',
    'needs_review': 'needs_review',
  };
  for (const token of tokens) {
    if (statusMap[token]) return statusMap[token];
  }
  // Check for "needs review" as two tokens
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === 'needs' && tokens[i + 1] === 'review') return 'needs_review';
  }
  return null;
}

const KEYWORD_RULES: KeywordRule[] = [
  // query_tasks
  {
    tool: 'query_tasks',
    keywords: [
      'tasks', 'task', 'zeig',
      'failed', 'pending', 'running', 'complete', 'blocked',
      'needs_review', 'needs review',
    ],
    extractArg: (tokens) => {
      const status = extractStatus(tokens);
      return status ? { status } : {};
    },
  },
  // create_task
  {
    tool: 'create_task',
    keywords: ['erstell', 'neuer', 'mach', 'create task', 'new task'],
  },
  // run_workflow
  {
    tool: 'run_workflow',
    keywords: [
      'start', 'workflow', 'führ', 'aus', 'trigger',
      'deploy', 'run workflow', 'start workflow',
    ],
    extractArg: (tokens, original) => {
      const name = extractWorkflowName(tokens, original);
      return name ? { name } : {};
    },
  },
  // list_workflows
  {
    tool: 'list_workflows',
    keywords: ['welche workflows', 'zeig workflows', 'workflows', 'list workflows'],
  },
  // search_memory
  {
    tool: 'search_memory',
    keywords: [
      'weißt', 'erinner', 'memory', 'facts',
      'was weißt', 'what do you know', 'search memory',
    ],
    extractArg: (tokens, original) => {
      return { query: extractSearchQuery(tokens, original) };
    },
  },
  // remember_fact
  {
    tool: 'remember_fact',
    keywords: ['merk', 'speicher', 'remember', 'save'],
  },
  // list_agents
  {
    tool: 'list_agents',
    keywords: [
      'agents', 'agent status', 'welche agents',
      'zeig agents', 'list agents',
    ],
  },
  // get_cost_summary
  {
    tool: 'get_cost_summary',
    keywords: ['kosten', 'cost', 'token verbrauch', 'token usage'],
  },
  // list_skills
  {
    tool: 'list_skills',
    keywords: ['skills', 'welche skills', 'zeig skills', 'list skills'],
  },
  // delete_fact
  {
    tool: 'delete_fact',
    keywords: [
      'lösch', 'vergiss', 'delete', 'entfern',
      'delete memory', 'delete fact', 'remove fact',
    ],
  },
  // list_pending_gates
  {
    tool: 'list_pending_gates',
    keywords: [
      'gates', 'genehmigung', 'genehmigungen', 'approval', 'approvals',
      'pending gates', 'open gates',
    ],
  },
  // list_goals
  {
    tool: 'list_goals',
    keywords: ['goals', 'ziele', 'goals', 'list goals'],
  },
  // list_events
  {
    tool: 'list_events',
    keywords: [
      'events', 'aktivität', 'passiert',
      'was ist passiert', 'what happened',
      'recent events', 'activity',
    ],
  },
];

/**
 * Check if a keyword matches a token using word-boundary matching.
 * Prevents substring false positives (e.g., "startup" matching "start").
 */
function tokenMatchesKeyword(token: string, keyword: string): boolean {
  return token === keyword;
}

export class DirectRouter {
  tryRoute(message: string): RouteResult | null {
    if (!message || !message.trim()) return null;

    const original = message;
    const normalized = message.toLowerCase().trim();
    // Use Unicode-aware tokenizer to preserve German umlauts (ä, ö, ü, ß)
    const tokens = normalized.split(/[^\p{L}0-9+#-]+/u).filter(Boolean);

    // Score each rule based on keyword matches in message text.
    // Use word-boundary matching to avoid substring false positives.
    let bestMatch: { rule: KeywordRule; score: number } | null = null;

    for (const rule of KEYWORD_RULES) {
      let score = 0;
      for (const keyword of rule.keywords) {
        const kw = keyword.toLowerCase();

        // Multi-word keywords: check if the whole phrase appears
        if (kw.includes(' ')) {
          if (normalized.includes(kw)) {
            score += kw.split(' ').length; // Multi-word matches are worth more
          }
        } else {
          // Single-word: check token-by-token
          for (const token of tokens) {
            if (tokenMatchesKeyword(token, kw)) {
              score++;
            }
          }
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { rule, score };
      }
    }

    if (!bestMatch) return null;

    // Special handling for ambiguous triggers:
    // If the only match is through common tokens like "task" in a
    // create_task context, prefer more specific intent.
    // "erstell einen task" → create_task, not query_tasks
    // "neuer task" → create_task, not query_tasks
    const createTriggers = ['erstell', 'neuer', 'mach'];
    const hasCreateIntent = createTriggers.some((t) => tokens.includes(t));
    if (hasCreateIntent && bestMatch.rule.tool === 'query_tasks') {
      // Check if create_task rule also matched (even with lower score)
      const createRule = KEYWORD_RULES.find((r) => r.tool === 'create_task')!;
      let createScore = 0;
      for (const keyword of createRule.keywords) {
        const kw = keyword.toLowerCase();
        for (const token of tokens) {
          if (tokenMatchesKeyword(token, kw)) createScore++;
        }
      }
      if (createScore > 0) {
        bestMatch = { rule: createRule, score: createScore };
      }
    }

    // Special case: "deploy" alone is ambiguous (needs a workflow name)
    if (
      bestMatch.rule.tool === 'run_workflow' &&
      tokens.length === 1 &&
      tokens[0] === 'deploy'
    ) {
      return null;
    }

    // Special case: "pending" or "review" in query_tasks context —
    // if the message is JUST about pending states with no task qualifier,
    // it should still route to query_tasks. But "approval pending" should
    // route to list_pending_gates.
    const hasGateWords = tokens.some((t) =>
      ['approval', 'approvals', 'genehmigung', 'genehmigungen'].includes(t),
    );
    if (hasGateWords && bestMatch.rule.tool !== 'list_pending_gates') {
      // Check if list_pending_gates matches
      const gateRule = KEYWORD_RULES.find((r) => r.tool === 'list_pending_gates')!;
      let gateScore = 0;
      for (const keyword of gateRule.keywords) {
        const kw = keyword.toLowerCase();
        if (kw.includes(' ')) {
          if (normalized.includes(kw)) gateScore += kw.split(' ').length;
        } else {
          for (const token of tokens) {
            if (tokenMatchesKeyword(token, kw)) gateScore++;
          }
        }
      }
      if (gateScore > 0) {
        bestMatch = { rule: gateRule, score: gateScore };
      }
    }

    // Special case: "zeig aktivität" should match list_events, not query_tasks
    const hasEventWords = tokens.some((t) =>
      ['aktivität', 'passiert', 'activity'].includes(t),
    );
    if (hasEventWords && bestMatch.rule.tool !== 'list_events') {
      const eventRule = KEYWORD_RULES.find((r) => r.tool === 'list_events')!;
      let eventScore = 0;
      for (const keyword of eventRule.keywords) {
        const kw = keyword.toLowerCase();
        if (kw.includes(' ')) {
          if (normalized.includes(kw)) eventScore += kw.split(' ').length;
        } else {
          for (const token of tokens) {
            if (tokenMatchesKeyword(token, kw)) eventScore++;
          }
        }
      }
      if (eventScore > 0) {
        bestMatch = { rule: eventRule, score: eventScore };
      }
    }

    const args = bestMatch.rule.extractArg
      ? bestMatch.rule.extractArg(tokens, original)
      : {};

    return { tool: bestMatch.rule.tool, args };
  }
}
