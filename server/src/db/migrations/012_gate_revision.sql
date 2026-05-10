-- Migration 012: add feedback column to human_gates for gate revision feature
-- Supports R1 (revision_requested status) and R2 (feedback TEXT) from plan 2026-05-10-001
-- NOTE: SQLite ALTER TABLE cannot modify CHECK constraints. The new status value
-- 'revision_requested' is validated at the application level (routes + engine).

ALTER TABLE human_gates ADD COLUMN feedback TEXT;
