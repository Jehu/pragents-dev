-- 010_skill_extraction_fields.sql
-- Add M5 LLM extraction fields to the skills table

ALTER TABLE skills ADD COLUMN parameters_yaml TEXT;
ALTER TABLE skills ADD COLUMN tools TEXT;
ALTER TABLE skills ADD COLUMN examples_yaml TEXT;
ALTER TABLE skills ADD COLUMN scope TEXT DEFAULT 'project';
ALTER TABLE skills ADD COLUMN status TEXT DEFAULT 'draft';
ALTER TABLE skills ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE skills ADD COLUMN extraction_metadata_yaml TEXT;
