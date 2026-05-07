-- pragents M4: human gates for workflow steps
CREATE TABLE IF NOT EXISTS human_gates (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','timed_out')),
  approved_by TEXT,
  approved_at TEXT,
  timeout_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gates_status ON human_gates(status);
CREATE INDEX IF NOT EXISTS idx_gates_run ON human_gates(workflow_run_id);
