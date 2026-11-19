-- 0014: 测试记录会话列（Agent 探针多轮续接）
-- agent_probe 记录记录该轮所属的 Agent 会话 id（claude CLI --resume 的会话标识），
-- 同一会话的多轮探针在测试记录列表合并展示。其余请求类型恒为 NULL。

ALTER TABLE request_records ADD COLUMN session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_request_session ON request_records(session_id);
