-- 020_skill_usage_index.sql
-- M6: index to speed up skill usage counter queries (issue #66)
-- Composite index on events(type, data) for fast skill.used lookups

CREATE INDEX IF NOT EXISTS idx_events_type_data ON events(type, data);
