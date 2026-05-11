import { Hono } from 'hono';
import type { ConversationManager } from '../../chat/manager.js';
import type { DirectRouter } from '../../chat/direct-router.js';
import type { NLDecomposer } from '../../nl/decomposer.js';
import type { ToolExecutor } from '../../agents/tool-executor.js';
import type { ResolvedAgent } from '../../config/schema.js';
import type { EventBuffer } from '../../events/buffer.js';
import { ChatRequestSchema } from '../../chat/schema.js';
import type { SSEEventInput } from '../../chat/schema.js';
import { logger } from '../../logging/index.js';

const HEARTBEAT_INTERVAL_MS = 15_000;

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

    // 3. Persist user message
    conversationManager.addMessage(
      convId,
      'user',
      message,
      undefined,
      attachments,
    );

    // 4. Build SSE stream
    const encoder = new TextEncoder();
    let streamClosed = false;

    const stream = new ReadableStream({
      start(controller) {
        const emit = (event: SSEEventInput) => {
          if (streamClosed) return;
          try {
            const payload = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          } catch {
            streamClosed = true;
            try { controller.close(); } catch { /* ignore */ }
          }
        };

        // Heartbeat
        const heartbeat = setInterval(() => {
          if (streamClosed) {
            clearInterval(heartbeat);
            return;
          }
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            streamClosed = true;
            clearInterval(heartbeat);
            try { controller.close(); } catch { /* ignore */ }
          }
        }, HEARTBEAT_INTERVAL_MS);

        // Cleanup on abort
        const onClose = () => {
          streamClosed = true;
          clearInterval(heartbeat);
          try { controller.close(); } catch { /* ignore */ }
        };

        if (c.req.raw.signal) {
          c.req.raw.signal.addEventListener('abort', onClose, { once: true });
        }

        // 5. Process the message
        (async () => {
          try {
            // 5a. Emit thinking event
            emit({
              type: 'thinking',
              data: { message: 'Processing your request...' },
            });

            // 5b. Try DirectRouter
            const routeResult = directRouter.tryRoute(message);

            if (routeResult) {
              // Direct match — execute tool
              emit({
                type: 'tool_call',
                data: { tool: routeResult.tool, args: routeResult.args },
              });

              let toolResult: string;
              try {
                toolResult = await toolExecutor.execute(
                  routeResult.tool,
                  routeResult.args,
                );
              } catch (err: any) {
                throw new ToolError(routeResult.tool, err?.message || String(err));
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

                plan = await decomposer.decompose(prompt, agents);
              } catch (err: any) {
                throw new DecomposerError(err?.message || String(err));
              }

              emit({
                type: 'message',
                data: {
                  subtype: 'plan_proposal',
                  content: 'Here is the proposed plan:',
                  plan: {
                    steps: plan.steps.map((s: any) => ({
                      description: s.description,
                      agentId: s.agentId,
                      dependsOn: s.dependsOn,
                    })),
                  },
                },
              });

              // Persist assistant message with plan
              conversationManager.addMessage(
                convId,
                'assistant',
                JSON.stringify(plan),
                'plan_proposal',
              );
            }

            // 5c. Emit done
            emit({
              type: 'done',
              data: { conversationId: convId },
            });
          } catch (err: any) {
            const code = err instanceof ToolError
              ? 'TOOL_ERROR'
              : err instanceof DecomposerError
                ? 'DECOMPOSER_ERROR'
                : 'INTERNAL_ERROR';

            emit({
              type: 'error',
              data: { code, message: err.message },
            });

            // Still emit done so client can close cleanly
            emit({
              type: 'done',
              data: { conversationId: convId },
            });

            logger.error({ err, convId, code }, 'Chat processing error');
          }

          // Cleanup
          clearInterval(heartbeat);
          streamClosed = true;
          try { controller.close(); } catch { /* ignore */ }
        })();
      },

      cancel() {
        streamClosed = true;
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
