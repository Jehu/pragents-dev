-- 019_task_cost_duration.sql
-- M6: add task_id to cost_log for per-task cost rollups (issue #64)
-- and add started_at / completed_at columns to tasks for duration tracking

ALTER TABLE cost_log ADD COLUMN task_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cost_task ON cost_log(task_id);

ALTER TABLE tasks ADD COLUMN started_at TEXT;
ALTER TABLE tasks ADD COLUMN completed_at TEXT;
