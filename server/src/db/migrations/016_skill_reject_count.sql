-- 016_skill_reject_count.sql
-- Add reject_count tracking for skill auto-demotion (issue #23)
-- Skills are demoted back to 'proposed' after N rejections (default 3)

ALTER TABLE skills ADD COLUMN reject_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills ADD COLUMN last_rejected_at TEXT;
