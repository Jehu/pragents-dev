-- pragents: unified plan store (#28)
-- Canonical record of every plan crossing the system, regardless of entry door.
-- Lifecycle: draft -> approved -> executing -> done | failed | cancelled
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft','approved','executing','done','failed','cancelled')),
  origin TEXT NOT NULL CHECK (origin IN ('nl','chat','tasks','workflow')),
  agent_id TEXT,
  project_id TEXT,
  conversation_id TEXT,
  prompt TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  started_at TEXT,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_conversation ON plans(conversation_id);
