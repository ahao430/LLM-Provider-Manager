-- 内嵌 Agent 对话（Phase 8 前置：LCM 自身发起的请求同样如实记录）。
-- 每轮对话请求写入 request_records（request_type = agent_chat，parent_trace_id = 会话 ID），
-- 原始请求/响应照常归档——内嵌 Agent 不绕过透明度原则。

CREATE TABLE IF NOT EXISTS agent_conversations (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '新对话',
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  channel_model_id TEXT REFERENCES channel_models(id),
  model           TEXT NOT NULL,
  protocol        TEXT NOT NULL DEFAULT 'openai_chat',
  system          TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_updated ON agent_conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  trace_id        TEXT REFERENCES request_records(trace_id),
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id, created_at);
