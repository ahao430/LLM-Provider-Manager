-- Agent 启动配置快照（Agent Launcher，见 PLAN.md「Agent 启动器」与 docs/agent-launcher.md）
--
-- 规则：
-- - 不保存 Token 明文，只保存 credential_ref。
-- - config_snapshot_json 为脱敏快照（变量名与非敏感值），不含任何凭证值。
-- - 历史启动记录不随默认渠道切换而改变。

CREATE TABLE IF NOT EXISTS agent_launches (
  launch_id         TEXT PRIMARY KEY,
  agent_type        TEXT NOT NULL,            -- claude_code_cli / codex_cli / ...
  channel_id        TEXT REFERENCES channels(id),
  channel_model_id  TEXT REFERENCES channel_models(id),
  working_directory TEXT,
  launch_method     TEXT NOT NULL
                    CHECK (launch_method IN ('env_injection', 'codex_home', 'profile', 'native_config')),
  base_url          TEXT,
  model             TEXT,
  credential_ref    TEXT,                     -- 凭证引用，非明文
  config_snapshot_json TEXT,                  -- 脱敏配置快照
  process_id        INTEGER,
  started_at        TEXT NOT NULL,
  exited_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_launches_channel ON agent_launches(channel_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_launches_agent   ON agent_launches(agent_type, started_at);
