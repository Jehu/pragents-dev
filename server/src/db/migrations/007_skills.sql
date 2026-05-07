-- Skills storage for extracted skill templates
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  source_session TEXT,
  source_agent TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  steps_yaml TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_agent ON skills(source_agent);
