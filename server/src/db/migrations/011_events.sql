-- 011_events.sql
-- Persistent event storage for dashboard trace views (M7 — Dashboard UX)

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  agent_id TEXT,
  task_id TEXT,
  type TEXT NOT NULL,
  data TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_project_timestamp ON events(project_id, timestamp);
