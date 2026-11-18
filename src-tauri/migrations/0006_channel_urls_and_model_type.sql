-- 渠道交互重构（v0.9.0）：
-- 1) 三协议独立 Base URL（chat 为主，anthropic / responses 默认同源可单独覆盖）。
--    旧 base_url 迁移为 chat_base_url；base_url 列保留为兼容（写入时同步）。
-- 2) 渠道模型增加类型标记（多模态 / 图像 / 文本 / 决策）。
-- 3) 内嵌 Agent 会话增加模式（claude_code / codex）。

ALTER TABLE channels ADD COLUMN chat_base_url      TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN anthropic_base_url TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN responses_base_url TEXT NOT NULL DEFAULT '';
UPDATE channels SET chat_base_url = base_url WHERE chat_base_url = '';

ALTER TABLE channel_models ADD COLUMN model_type TEXT NOT NULL DEFAULT 'text'
  CHECK (model_type IN ('multimodal', 'image', 'text', 'decision'));

ALTER TABLE agent_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'claude_code'
  CHECK (mode IN ('claude_code', 'codex'));
