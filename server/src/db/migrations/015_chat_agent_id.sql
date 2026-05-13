-- 015_chat_agent_id.sql
-- Attach agent_id to chat_conversations (U16: per-agent conversation isolation)
-- Allows ConversationManager to look up the active conversation for a given
-- agentId on reconnect, so clients that drop their SSE stream do not lose context.

ALTER TABLE chat_conversations ADD COLUMN agent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_conv_agent ON chat_conversations(agent_id);
