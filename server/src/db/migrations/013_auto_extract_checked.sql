-- 013_auto_extract_checked.sql
-- Add auto_extract_checked column to sessions for PM monitor tracking

ALTER TABLE sessions ADD COLUMN auto_extract_checked INTEGER NOT NULL DEFAULT 0;
