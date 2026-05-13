-- 017_task_type.sql
-- Add type column to tasks for distinguishing escalation tasks from regular agent tasks (issue #27)

ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'agent';
