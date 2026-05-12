import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ConversationManager } from '../../chat/manager.js';
import type { DirectRouter } from '../../chat/direct-router.js';
import type { NLDecomposer } from '../../nl/decomposer.js';
import type { ToolExecutor } from '../../agents/tool-executor.js';
import type { ResolvedAgent } from '../../config/schema.js';
import type { EventBuffer } from '../../events/buffer.js';
import { ChatRequestSchema, SSEEventSchema } from '../../chat/schema.js';
import type { SSEEventInput } from '../../chat/schema.js';
import { logger } from '../../logging/index.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const TOOL_TIMEOUT_MS = 30_000;
const DECOMPOSER_TIMEOUT_MS = 120_000;
const MAX_BODY_SIZE = 50 * 1024 * 1024; // 50 MB

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
 * Create the Chat SSE route.
 *
 * Factory pattern matching the rest of the API routes — injects all
 * dependencies so the route module can be tested in isolation.
 */
export function createChatRoute(
  conversationManager: ConversationManager,
  directRouter: DirectRouter,
  decomposer: NLDecomposer,
  toolExecutor: ToolExecutor,
  agents: ResolvedAgent[],
  eventBuffer: EventBuffer,
): Hono {
  const app = new Hono();

  // Apply body size limit to prevent memory exhaustion DoS
  app.use('*', bodyLimit({ maxSize: MAX_BODY_SIZE }));

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

    const { message, conversationId, projectId, attachments, confirm, modifications } =
      parsed.data;

    // 2. Resolve conversation
    const convId = conversationManager.getOrCreate(conversationId, projectId);

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

            // 4c. Try DirectRouter
            const routeResult = directRouter.tryRoute(message);

            if (routeResult) {
              // Inject projectId into tool args if available
              const toolArgs = {
                ...routeResult.args,
                ...(projectId ? { projectId } : {}),
              };

              // Direct match — execute tool
              emit({
                type: 'tool_call',
                data: { tool: routeResult.tool, args: toolArgs },
              });

              let toolResult: string;
              try {
                toolResult = await withTimeout(
                  toolExecutor.execute(routeResult.tool, toolArgs),
                  TOOL_TIMEOUT_MS,
                  `Tool "${routeResult.tool}" timed out`,
                );
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new ToolError(routeResult.tool, message);
              }

              emit({
                type: 'tool_result',
                data: { tool: routeResult.tool, result: toolResult },
              });

              // Emit result as message
              const responseContent = formatToolResponse(routeResult.tool, toolResult);
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

              const planSteps = plan.steps.map((s) => ({
                description: s.description,
                agentId: s.agentId,
                dependsOn: s.dependsOn,
              }));

              emit({
                type: 'message',
                data: {
                  subtype: 'plan_proposal',
                  content: `Here is the proposed plan with ${planSteps.length} step(s):`,
                  plan: { steps: planSteps },
                },
              });

              // Persist assistant message with human-readable summary + plan JSON
              conversationManager.addMessage(
                convId,
                'assistant',
                `Proposed plan with ${planSteps.length} step(s):\n${planSteps.map((s, i) => `${i + 1}. ${s.agentId}: ${s.description}`).join('\n')}`,
                'plan_proposal',
              );
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
