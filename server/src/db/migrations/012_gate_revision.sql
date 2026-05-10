-- Migration 012: add feedback column and expand status values for gate revision feature
-- Supports R1 (revision_requested status) and R2 (feedback TEXT) from plan 2026-05-10-001
-- SQLite cannot ALTER CHECK constraints, so we rebuild the table.

-- Step 1: create new table with expanded schema
CREATE TABLE human_gates_new (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','timed_out','revision_requested')),
  approved_by TEXT,
  approved_at TEXT,
  timeout_at TEXT,
  feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: copy existing data
INSERT INTO human_gates_new (id, workflow_run_id, step_id, label, status, approved_by, approved_at, timeout_at, created_at)
  SELECT id, workflow_run_id, step_id, label, status, approved_by, approved_at, timeout_at, created_at
  FROM human_gates;

-- Step 3: drop old table
DROP TABLE human_gates;

-- Step 4: rename new table
ALTER TABLE human_gates_new RENAME TO human_gates;

-- Step 5: recreate indexes
CREATE INDEX IF NOT EXISTS idx_gates_status ON human_gates(status);
CREATE INDEX IF NOT EXISTS idx_gates_run ON human_gates(workflow_run_id);
