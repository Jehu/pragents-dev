-- pragents M2.5: NL delegation plans
CREATE TABLE IF NOT EXISTS nl_plans (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','executed','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
