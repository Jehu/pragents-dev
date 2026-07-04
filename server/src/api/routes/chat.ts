import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ConversationManager } from '../../chat/manager.js';
import type { IntentClassifier } from '../../chat/intent-classifier.js';
import type { NLDecomposer } from '../../nl/decomposer.js';
import type { ToolExecutor } from '../../agents/tool-executor.js';
import type { TaskTracker } from '../../tasks/tracker.js';
import type { ResolvedAgent } from '../../config/schema.js';
import type { EventBuffer } from '../../events/buffer.js';
import type { PlanStore } from '../../plans/store.js';
import { ChatRequestSchema, SSEEventSchema } from '../../chat/schema.js';
import type { SSEEventInput } from '../../chat/schema.js';
import { logger } from '../../logging/index.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const TOOL_TIMEOUT_MS = 30_000;
const DECOMPOSER_TIMEOUT_MS = 120_000;
const TASK_COMPLETION_TIMEOUT_MS = 10 * 60_000; // 10 min per dispatched step
const TASK_POLL_INTERVAL_MS = 500;
const MAX_BODY_SIZE = 50 * 1024 * 1024; // 50 MB

const TERMINAL_TASK_STATUSES = new Set(['complete', 'failed', 'needs_review', 'blocked']);

/**
 * Race a promise against a timeout. Rejects with the provided message if the
 * promise doesn't settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);
}

/**
 * Poll the tracker until the given task reaches a terminal status. Sequential
 * step execution lets the confirm path honour declared dependsOn ordering even
 * though the create_task tool itself has no dependency awareness.
 */
async function waitForTaskCompletion(
  tracker: TaskTracker,
  taskId: string,
  timeoutMs: number,
  pollIntervalMs: number,
  isAborted: () => boolean,
): Promise<{ status: string; result: string | null; reason: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (!isAborted()) {
    const task = tracker.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found while waiting for completion`);
    }
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      return { status: task.status, result: task.result, reason: task.reason };
    }
    if (Date.now() >= deadline) {
      throw new Error(`Task ${taskId} did not reach terminal state within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Wait for task ${taskId} aborted`);
}

/**
 * Create the Chat SSE route.
 *
 * Factory pattern matching the rest of the API routes — injects all
 * dependencies so the route module can be tested in isolation.
 */
export function createChatRoute(
  conversationManager: ConversationManager,
  classifier: IntentClassifier,
  decomposer: NLDecomposer,
  toolExecutor: ToolExecutor,
  agents: ResolvedAgent[],
  eventBuffer: EventBuffer,
  tracker: TaskTracker,
  /**
   * Optional. When provided, every plan_proposal emitted on the SSE stream is
   * persisted to the unified plan store (#28) and its `planId` is included in
   * the envelope so the client can call POST /api/v1/plans/:id/approve to
   * approve+execute. Older clients that don't read `planId` keep working via
   * the existing `confirm` flow.
   */
  planStore?: PlanStore,
  /**
   * Project IDs from config. Used to enforce project-scope on /conversations
   * and /conversations/:id/messages. The current API-token auth layer does not
   * carry per-user project membership (commit 2169422), so the enforcement is:
   * a caller may scope to one of the configured projects via ?projectId= or
   * request all configured projects via ?scope=all. The endpoint never returns
   * conversations whose project_id is outside the configured list (legacy NULL
   * project rows remain accessible as "no-project" data).
   */
  configuredProjectIds: string[] = [],
): Hono {
  const app = new Hono();

  // Apply body size limit to prevent memory exhaustion DoS
  app.use('*', bodyLimit({ maxSize: MAX_BODY_SIZE }));

  // When no projects are configured (legacy / single-tenant setup without
  // explicit project membership), scope enforcement is bypassed for
  // backwards compatibility. Production deployments must pass a non-empty
  // `configuredProjectIds` to get the hard enforcement.
  const enforceScope = configuredProjectIds.length > 0;

  /**
   * Resolve the caller's project-scope intent from query params.
   *  - ?projectId=<id>   → narrow to that single project (must be configured)
   *  - ?scope=all        → all configured projects
   *  - neither           → 400 in enforcement mode, or "all-permissive" in legacy mode
   *
   * Returns either an array of allowed project IDs OR an error response to return.
   */
  function resolveScope(c: any): { ok: true; projects: string[]; legacy?: boolean } | { ok: false; res: Response } {
    const projectId = c.req.query('projectId');
    const scope = c.req.query('scope');
    if (projectId) {
      if (enforceScope && !configuredProjectIds.includes(projectId)) {
        return { ok: false, res: c.json({ error: `Unknown project "${projectId}"` }, 400) };
      }
      return { ok: true, projects: [projectId] };
    }
    if (scope === 'all') {
      return { ok: true, projects: configuredProjectIds };
    }
    if (!enforceScope) {
      // Legacy mode (no configured projects): pass-through. Used by older
      // tests and single-tenant boot before config is loaded.
      return { ok: true, projects: [], legacy: true };
    }
    return { ok: false, res: c.json({ error: 'projectId or scope=all is required' }, 400) };
  }

  // GET /api/v1/chat/conversations — list recent conversations
  app.get('/conversations', (c) => {
    const limit = z.coerce.number().int().min(1).max(100).safeParse(c.req.query('limit'));
    const scope = resolveScope(c);
    if (!scope.ok) return scope.res;
    const projectId = c.req.query('projectId') || undefined;
    const agentId = c.req.query('agentId') || undefined;

    // Legacy mode delegates to listRecent which keeps the old projectId filter
    // semantics intact (return all when no filter is supplied). scope=all also
    // includes NULL-project rows (company-agent conversations) so the list
    // matches what the messages endpoint already grants access to.
    const isScopeAll = c.req.query('scope') === 'all';
    const conversations = scope.legacy
      ? conversationManager.listRecent(limit.success ? limit.data : 20, projectId, agentId)
      : conversationManager.listRecentForProjects(
          scope.projects,
          limit.success ? limit.data : 20,
          agentId,
          isScopeAll,
        );

    return c.json({ conversations });
  });

  // GET /api/v1/chat/conversations/:id/messages — return message history.
  // Project scope is hard-enforced: the requested project must match the
  // conversation's project_id (or the conversation must be in the allowed set
  // when scope=all). A mismatch returns 404 to avoid leaking existence.
  app.get('/conversations/:id/messages', (c) => {
    const convId = c.req.param('id');
    const limit = z.coerce.number().int().min(1).max(500).safeParse(c.req.query('limit'));
    const scope = resolveScope(c);
    if (!scope.ok) return scope.res;

    const conv = conversationManager.getConversation(convId);
    if (!conv) return c.json({ error: 'Conversation not found' }, 404);
    if (!scope.legacy) {
      // Enforcement mode: conversation's project_id must be in the resolved
      // scope. Legacy NULL-project rows are accessible only through scope=all
      // (which carries every configured project id, never an empty list here).
      const inScope = conv.projectId
        ? scope.projects.includes(conv.projectId)
        : scope.projects.length === configuredProjectIds.length;
      if (!inScope) {
        return c.json({ error: 'Conversation not found' }, 404);
      }
    } else {
      // Legacy mode: if the caller passed ?projectId=, still enforce a match —
      // otherwise pass through (the original soft-check behaviour for tests).
      const requestedProject = c.req.query('projectId');
      if (requestedProject && conv.projectId !== requestedProject) {
        return c.json({ error: 'Conversation not found' }, 404);
      }
    }

    const messages = conversationManager.getHistory(convId, limit.success ? limit.data : 50);
    return c.json({ conversation: conv, messages });
  });

  app.post('/', async (c) => {
    // 1. Parse and validate body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, 400);
    }

    const { message, conversationId, agentId, projectId, attachments, confirm, modifications } =
      parsed.data;

    // 2. Resolve conversation — scoped per agentId when provided so that
    //    parallel users of different agents never share the same conversation,
    //    and reconnecting clients recover their prior session automatically.
    const convId = conversationManager.getOrCreate(conversationId, projectId, agentId);

    // 3. Build SSE stream
    const encoder = new TextEncoder();
    let streamClosed = false;
    let heartbeatId: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      start(controller) {
        const emit = (event: SSEEventInput) => {
          if (streamClosed) return;
          // Runtime validation: ensure emitted events match schema
          const parsed = SSEEventSchema.safeParse(event);
          if (!parsed.success) {
            logger.warn({ issues: parsed.error.issues, eventType: (event as any).type },
              'SSE event failed schema validation — emitting anyway');
          }
          try {
            const payload = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          } catch {
            streamClosed = true;
            if (heartbeatId) { clearInterval(heartbeatId); heartbeatId = undefined; }
            try { controller.close(); } catch { /* ignore */ }
          }
        };

        // Heartbeat
        heartbeatId = setInterval(() => {
          if (streamClosed) {
            clearInterval(heartbeatId!);
            heartbeatId = undefined;
            return;
          }
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            streamClosed = true;
            clearInterval(heartbeatId!);
            heartbeatId = undefined;
            try { controller.close(); } catch { /* ignore */ }
          }
        }, HEARTBEAT_INTERVAL_MS);

        // Cleanup on abort
        const onClose = () => {
          streamClosed = true;
          if (heartbeatId) { clearInterval(heartbeatId); heartbeatId = undefined; }
          try { controller.close(); } catch { /* ignore */ }
        };

        // Check already-aborted signal before adding listener
        if (c.req.raw.signal) {
          if (c.req.raw.signal.aborted) {
            onClose();
          } else {
            c.req.raw.signal.addEventListener('abort', onClose, { once: true });
          }
        }

        // 4. Process the message
        (async () => {
          try {
            // 4a. Persist user message (inside try/catch so DB failures become SSE error events)
            conversationManager.addMessage(
              convId,
              'user',
              message,
              undefined,
              attachments,
            );

            // 4b. Emit thinking event
            emit({
              type: 'thinking',
              data: { message: 'Processing your request...' },
            });

            // 4c. Classify intent via LLM classifier
            const classification = await classifier.classify(message);

            if (classification && classification.tool === 'chat') {
              // Conversational message — answer directly. Routing this
              // through the decomposer produced approvable "greet the user"
              // plans (usability report K3). Fall back to a static
              // capability blurb when the reply model is unavailable.
              const replyText =
                (await classifier.reply(message)) ??
                'Hi! I can dispatch tasks to agents, run workflows, track goals, ' +
                'search the shared memory, and show costs, skills, and pending approvals. ' +
                'Tell me what you need.';

              emit({
                type: 'message',
                data: { subtype: 'text', content: replyText },
              });
              conversationManager.addMessage(convId, 'assistant', replyText, 'text');
            } else if (classification && classification.tool !== 'complex') {
              // Inject projectId into tool args if available
              const toolArgs = {
                ...classification.args,
                ...(projectId ? { projectId } : {}),
              };

              // Direct match — execute tool
              emit({
                type: 'tool_call',
                data: { tool: classification.tool, args: toolArgs },
              });

              let toolResult: string;
              try {
                toolResult = await withTimeout(
                  toolExecutor.execute(classification.tool, toolArgs),
                  TOOL_TIMEOUT_MS,
                  `Tool "${classification.tool}" timed out`,
                );
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new ToolError(classification.tool, message);
              }

              emit({
                type: 'tool_result',
                data: { tool: classification.tool, result: toolResult },
              });

              // Emit result as message
              const responseContent = formatToolResponse(classification.tool, toolResult);
              emit({
                type: 'message',
                data: { subtype: 'text', content: responseContent },
              });

              // Persist assistant message
              conversationManager.addMessage(
                convId,
                'assistant',
                responseContent,
                'text',
              );
            } else {
              // No direct match — use NL Decomposer
              let plan;
              try {
                // If confirming a previous plan, include modifications context
                const prompt = confirm
                  ? `Previous plan was accepted. Confirm: ${modifications ? `User modifications: ${modifications}. ` : ''}Original request: ${message}`
                  : message;

                plan = await withTimeout(
                  decomposer.decompose(prompt, agents),
                  DECOMPOSER_TIMEOUT_MS,
                  'NL decomposition timed out',
                );
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new DecomposerError(message);
              }

              if (confirm) {
                // ── Confirm path: dispatch each plan step as a task ──
                //
                // Steps run sequentially (await each task to terminal state
                // before dispatching the next). This linearisation honours any
                // dependsOn the LLM produced — create_task itself has no
                // dependency awareness, so the chat route enforces it here.

                // Resolve projectId from conversation if not in request
                const conv = conversationManager.getConversation(convId);
                const effectiveProjectId = projectId || conv?.projectId;

                if (!effectiveProjectId) {
                  throw new ConfirmError(
                    'projectId is required to execute a plan — provide it in the request or via the conversation',
                  );
                }

                const stepResults: Array<{
                  agentId: string;
                  description: string;
                  taskId?: string;
                  status?: string;
                  error?: string;
                }> = [];

                for (let i = 0; i < plan.steps.length; i++) {
                  const step = plan.steps[i];

                  emit({
                    type: 'tool_call',
                    data: {
                      tool: 'create_task',
                      args: {
                        projectId: effectiveProjectId,
                        agentId: step.agentId,
                        description: step.description,
                      },
                    },
                  });

                  let result: string;
                  let dispatchedTaskId: string | undefined;
                  try {
                    result = await toolExecutor.execute('create_task', {
                      projectId: effectiveProjectId,
                      agentId: step.agentId,
                      description: step.description,
                    });
                    const parsed = JSON.parse(result);
                    dispatchedTaskId = parsed.taskId;
                  } catch (err) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    result = JSON.stringify({ error: errorMsg });
                    stepResults.push({
                      agentId: step.agentId,
                      description: step.description,
                      error: errorMsg,
                    });
                    emit({
                      type: 'tool_result',
                      data: { tool: 'create_task', result },
                    });
                    continue;
                  }

                  emit({
                    type: 'tool_result',
                    data: { tool: 'create_task', result },
                  });

                  if (!dispatchedTaskId) {
                    stepResults.push({
                      agentId: step.agentId,
                      description: step.description,
                      error: 'create_task returned no taskId',
                    });
                    continue;
                  }

                  try {
                    const final = await waitForTaskCompletion(
                      tracker,
                      dispatchedTaskId,
                      TASK_COMPLETION_TIMEOUT_MS,
                      TASK_POLL_INTERVAL_MS,
                      () => streamClosed,
                    );
                    stepResults.push({
                      agentId: step.agentId,
                      description: step.description,
                      taskId: dispatchedTaskId,
                      status: final.status,
                      ...(final.status !== 'complete'
                        ? { error: final.reason || `task ended in status ${final.status}` }
                        : {}),
                    });
                  } catch (err) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    stepResults.push({
                      agentId: step.agentId,
                      description: step.description,
                      taskId: dispatchedTaskId,
                      error: errorMsg,
                    });
                  }
                }

                // Emit summary message
                const summaryLines = stepResults.map((r, i) => {
                  const idRef = r.taskId ? ` (${r.taskId})` : '';
                  if (r.error) {
                    return `${i + 1}. ${r.agentId}: ${r.description} — FAILED${idRef}: ${r.error}`;
                  }
                  return `${i + 1}. ${r.agentId}: ${r.description} — ${r.status || 'dispatched'}${idRef}`;
                });
                const successCount = stepResults.filter((r) => !r.error).length;
                const summary = `Plan executed: ${successCount}/${stepResults.length} step(s) completed.\n${summaryLines.join('\n')}`;

                emit({
                  type: 'message',
                  data: { subtype: 'text', content: summary },
                });

                conversationManager.addMessage(convId, 'assistant', summary, 'text');
              } else {
                // ── Proposal path: emit plan for user confirmation ──

                const planSteps = plan.steps.map((s) => ({
                  description: s.description,
                  agentId: s.agentId,
                  ...(s.dependsOn != null
                    ? { dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn[0] : s.dependsOn }
                    : {}),
                }));

                // Persist plan in the unified store so the client can
                // approve+execute via POST /api/v1/plans/:id/approve.
                // Best-effort: if persistence fails we still surface the
                // plan_proposal to keep the existing confirm flow working.
                let planId: string | undefined;
                if (planStore) {
                  try {
                    // Fall back to the conversation's project so chat plans
                    // stay visible under the project scope they came from.
                    const conv = conversationManager.getConversation(convId);
                    const persisted = planStore.create({
                      origin: 'chat',
                      conversationId: convId,
                      projectId: projectId ?? conv?.projectId ?? null,
                      agentId: agentId ?? null,
                      prompt: message,
                      steps: planSteps,
                    });
                    planId = persisted.id;
                  } catch (err) {
                    logger.warn(
                      { err, convId },
                      'Chat: failed to persist plan_proposal to plan store — continuing',
                    );
                  }
                }

                emit({
                  type: 'message',
                  data: {
                    subtype: 'plan_proposal',
                    content: `Here is the proposed plan with ${planSteps.length} step(s):`,
                    ...(planId ? { planId } : {}),
                    plan: { steps: planSteps },
                  },
                });

                // Persist assistant message with human-readable summary
                conversationManager.addMessage(
                  convId,
                  'assistant',
                  `Proposed plan with ${planSteps.length} step(s):\n${planSteps.map((s, i) => `${i + 1}. ${s.agentId}: ${s.description}`).join('\n')}`,
                  'plan_proposal',
                );
              }
            }

            // 4d. Emit done
            emit({
              type: 'done',
              data: { conversationId: convId },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const code =
              err instanceof ToolError ? 'TOOL_ERROR'
              : err instanceof DecomposerError ? 'DECOMPOSER_ERROR'
              : err instanceof ConfirmError ? 'CONFIRM_ERROR'
              : 'INTERNAL_ERROR';

            // For INTERNAL_ERROR, don't leak raw error details
            const safeMessage = code === 'INTERNAL_ERROR'
              ? 'An internal error occurred'
              : message;

            emit({
              type: 'error',
              data: { code, message: safeMessage },
            });

            // Still emit done so client can close cleanly
            emit({
              type: 'done',
              data: { conversationId: convId },
            });

            logger.error({ err, convId, code }, 'Chat processing error');
          }

          // Cleanup
          if (heartbeatId) { clearInterval(heartbeatId); heartbeatId = undefined; }
          streamClosed = true;
          try { controller.close(); } catch { /* ignore */ }
        })();
      },

      cancel() {
        streamClosed = true;
        if (heartbeatId) { clearInterval(heartbeatId); heartbeatId = undefined; }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });

  return app;
}

// ---- Error classes ----

class ToolError extends Error {
  constructor(
    public tool: string,
    message: string,
  ) {
    super(`Tool "${tool}" error: ${message}`);
    this.name = 'ToolError';
  }
}

class DecomposerError extends Error {
  constructor(message: string) {
    super(`Decomposer error: ${message}`);
    this.name = 'DecomposerError';
  }
}

class ConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmError';
  }
}

// ---- Helper ----

/**
 * Format a tool execution result into a human-readable message
 * for the SSE message event.
 */
function formatToolResponse(tool: string, resultJson: string): string {
  try {
    const result = JSON.parse(resultJson);

    // Handle error strings
    if (typeof result === 'string' && result.startsWith('Error:')) {
      return result;
    }

    switch (tool) {
      case 'query_tasks':
        if (Array.isArray(result) && result.length === 0) return 'No tasks found.';
        if (Array.isArray(result)) return `Found ${result.length} task(s).`;
        return resultJson;
      case 'list_agents':
        if (Array.isArray(result)) {
          const names = result.map((a: any) => `${a.id} (${a.type})`).join(', ');
          return `Available agents: ${names}`;
        }
        return resultJson;
      case 'list_workflows':
        if (Array.isArray(result) && result.length === 0) return 'No workflows available.';
        if (Array.isArray(result)) {
          const names = result.map((w: any) => w.name).join(', ');
          return `Available workflows: ${names}`;
        }
        return resultJson;
      case 'list_skills':
        if (Array.isArray(result) && result.length === 0) return 'No skills available.';
        if (Array.isArray(result)) return `Found ${result.length} skill(s).`;
        return resultJson;
      case 'list_goals':
        if (Array.isArray(result) && result.length === 0) return 'No goals configured.';
        if (Array.isArray(result)) return `Found ${result.length} goal(s).`;
        return resultJson;
      case 'list_events':
        if (Array.isArray(result) && result.length === 0) return 'No recent events.';
        if (Array.isArray(result)) return `Found ${result.length} event(s).`;
        return resultJson;
      case 'list_pending_gates':
        if (Array.isArray(result) && result.length === 0) return 'No pending gates.';
        if (Array.isArray(result)) return `Found ${result.length} pending gate(s).`;
        return resultJson;
      case 'get_cost_summary':
        return `Cost summary: ${resultJson}`;
      case 'run_workflow':
        if (result.status === 'started') return `Workflow "${result.workflow}" started (run: ${result.runId}).`;
        return resultJson;
      case 'create_task':
        if (result.taskId) return `Task created (${result.taskId}) with status: ${result.status}.`;
        return resultJson;
      case 'search_memory':
        if (Array.isArray(result) && result.length === 0) return 'No memories found.';
        if (Array.isArray(result)) return `Found ${result.length} memory/memories.`;
        return resultJson;
      case 'remember_fact':
        if (result.status === 'remembered') return 'Memory stored.';
        return resultJson;
      case 'delete_fact':
        if (result.status === 'deleted') return 'Memory deleted.';
        return resultJson;
      default:
        return resultJson;
    }
  } catch {
    // Not valid JSON — return as-is (might be an error string or simple output)
    if (resultJson.startsWith('Error:')) return resultJson;
    return resultJson;
  }
}
