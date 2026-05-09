import { getDb } from '../db/sqlite.js';

export interface PragentsEvent {
  id: number;
  type: string;
  projectId: string;
  agentId?: string;
  taskId?: string;
  data: any;
  timestamp: string;
}

export class EventBuffer {
  private buffer: PragentsEvent[] = [];
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
    const event: PragentsEvent = {
      id: this.nextId++,
      type,
      projectId,
      agentId,
      taskId,
      data,
      timestamp: new Date().toISOString(),
    };

    this.buffer.push(event);
    while (this.buffer.length > this.maxEvents) {
      this.buffer.shift();
    }

    // Write-through to SQLite for persistence
    try {
      const db = getDb();
      db.prepare(
        'INSERT INTO events (project_id, agent_id, task_id, type, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        event.projectId,
        event.agentId || null,
        event.taskId || null,
        event.type,
        JSON.stringify(event.data),
        event.timestamp,
      );
    } catch {
      // Best-effort: don't block event emission on DB write failure
    }

    return event;
  }

  getSince(lastEventId: number, projectId?: string): PragentsEvent[] {
    let events = this.buffer.filter((e) => e.id > lastEventId);
    if (projectId) {
      events = events.filter((e) => e.projectId === projectId);
    }
    return events;
  }

  getRecent(limit: number = 50, projectId?: string): PragentsEvent[] {
    let events = this.buffer;
    if (projectId) {
      events = events.filter((e) => e.projectId === projectId);
    }
    return events.slice(-limit);
  }
}
