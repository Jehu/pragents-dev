-- 021_budget_resets.sql
-- Operator override for an agent's token-budget window (#100). Token
-- budgets are enforced per calendar month; this table lets an operator
-- pull the window start forward to unblock an agent before the monthly
-- rollover instead of waiting or editing the database by hand.
CREATE TABLE IF NOT EXISTS budget_resets (
  agent_id TEXT PRIMARY KEY,
  reset_at TEXT NOT NULL
);
