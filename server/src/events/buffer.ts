import { getDb } from '../db/sqlite.js';
import { logger } from '../logging/index.js';

export interface PragentsEvent {
  id: number;
  type: string;
  projectId: string;
  agentId?: string;
  taskId?: string;
  data: any;
  timestamp: string;
}

/** Map a raw DB row to PragentsEvent shape. */
function rowToEvent(row: any): PragentsEvent {
  return {
    id: row.id as number,
    type: row.type as string,
    projectId: row.project_id as string,
    agentId: row.agent_id ?? undefined,
    taskId: row.task_id ?? undefined,
    data: row.data ? JSON.parse(row.data as string) : null,
    timestamp: row.timestamp as string,
  };
}

export class EventBuffer {
  private buffer: PragentsEvent[] = [];
  /** Monotonic counter used as id when DB is unavailable. */
  private nextId = 1;
  private maxEvents: number;

  constructor(maxEvents: number = 1000) {
    this.maxEvents = maxEvents;
  }

  push(
    projectId: string,
    agentId: string | undefined,
    type: string,
    data: any,
    taskId?: string,
  ): PragentsEvent {
    const timestamp = new Date().toISOString();

    // Attempt DB write first. When successful, use the DB AUTOINCREMENT rowid
    // as the canonical event id so that Last-Event-ID headers stay consistent
    // with DB rowids for reliable replay after a ring-buffer overflow.
    let eventId: number;
    try {
      const db = getDb();
      const result = db.prepare(
        'INSERT INTO events (project_id, agent_id, task_id, type, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        projectId,
        agentId ?? null,
        taskId ?? null,
        type,
        JSON.stringify(data),
        timestamp,
      );
      eventId = Number(result.lastInsertRowid);
      // Keep nextId ahead of the DB sequence so in-memory fallback stays consistent.
      if (eventId >= this.nextId) {
        this.nextId = eventId + 1;
      }
    } catch (err) {
      // Best-effort: don't block event emission on DB write failure.
      logger.warn({ err }, 'EventBuffer: DB write failed, event will be in-memory only');
      eventId = this.nextId++;
    }

    const event: PragentsEvent = {
      id: eventId,
      type,
      projectId,
      agentId,
      taskId,
      data,
      timestamp,
    };

    this.buffer.push(event);
    while (this.buffer.length > this.maxEvents) {
      this.buffer.shift();
    }

    return event;
  }

  /**
   * Returns all events after `lastEventId`.
   * Queries the DB first so replay survives ring-buffer overflow; falls back
   * to the in-memory ring only when the DB is unavailable.
   */
  getSince(lastEventId: number, projectId?: string): PragentsEvent[] {
    try {
      const db = getDb();
      let rows: any[];
      if (projectId) {
        rows = db.prepare(
          'SELECT * FROM events WHERE id > ? AND project_id = ? ORDER BY id ASC',
        ).all(lastEventId, projectId);
      } else {
        rows = db.prepare(
          'SELECT * FROM events WHERE id > ? ORDER BY id ASC',
        ).all(lastEventId);
      }
      return rows.map(rowToEvent);
    } catch {
      // DB unavailable — fall back to in-memory ring.
      logger.warn('EventBuffer.getSince: DB unavailable, falling back to in-memory ring');
      let events = this.buffer.filter((e) => e.id > lastEventId);
      if (projectId) {
        events = events.filter((e) => e.projectId === projectId);
      }
      return events;
    }
  }

  getRecent(limit: number = 50, projectId?: string): PragentsEvent[] {
    let events = this.buffer;
    if (projectId) {
      events = events.filter((e) => e.projectId === projectId);
    }
    return events.slice(-limit);
  }
}
