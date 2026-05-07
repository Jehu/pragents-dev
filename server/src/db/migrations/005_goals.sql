-- pragents M4: goal tracking
CREATE TABLE IF NOT EXISTS goal_runs (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  workflow_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'triggered' CHECK(status IN ('triggered','running','complete','failed','escalated')),
  triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
