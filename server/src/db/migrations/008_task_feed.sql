-- pragents M8: agent-native task feed — blocked status, reason, external_ref
-- Requirements: R1, R10, R11

-- Step 1: Add new nullable columns (SQLite ALTER TABLE limitation — can't add CHECK)
ALTER TABLE tasks ADD COLUMN reason TEXT;
ALTER TABLE tasks ADD COLUMN external_ref TEXT;

-- Step 2: Migrate existing needs_review tasks — move reason from result to dedicated column
UPDATE tasks SET reason = result WHERE status = 'needs_review' AND result IS NOT NULL;

-- Step 3: Rebuild table with updated CHECK constraint including 'blocked'
CREATE TABLE tasks_v2 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','complete','failed','needs_review','blocked')),
  description TEXT NOT NULL,
  result TEXT,
  reason TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tasks_v2 (id, project_id, agent_id, status, description, result, reason, external_ref, created_at, updated_at)
  SELECT id, project_id, agent_id, status, description, result, reason, external_ref, created_at, updated_at FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_v2 RENAME TO tasks;

-- Re-create indexes
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
