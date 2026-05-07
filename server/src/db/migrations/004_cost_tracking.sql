-- pragents M3: cost tracking
CREATE TABLE IF NOT EXISTS cost_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cost_project ON cost_log(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_agent ON cost_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_cost_date ON cost_log(created_at);
