-- LCM 初始数据库结构（Phase 0）
--
-- 约定：
-- - 主键为 TEXT（UUID v4），由应用层生成。
-- - 时间戳为 TEXT（RFC 3339 / ISO 8601，UTC）。
-- - 约束与设计对应 PLAN.md，表结构说明见 docs/database.md。
-- - 迁移一经发布只追加新迁移，不修改本文件。

-- ------------------------------------------------------------------
-- 服务商与渠道
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS providers (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,           -- bailian / newapi / volcano / siliconflow / custom ...
  name       TEXT NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id               TEXT PRIMARY KEY,
  provider_id      TEXT REFERENCES providers(id),
  name             TEXT NOT NULL,
  channel_type     TEXT NOT NULL DEFAULT 'custom',
  base_url         TEXT NOT NULL,
  default_protocol TEXT NOT NULL DEFAULT 'openai_chat',
  enabled          INTEGER NOT NULL DEFAULT 1,
  notes            TEXT,
  config_json      TEXT NOT NULL DEFAULT '{}', -- api_path、认证方式、自定义 Header/Query、超时、TLS 等（不含明文凭证）
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channels_provider ON channels(provider_id);

-- ------------------------------------------------------------------
-- 模型与渠道模型
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS models (              -- 全局模型（统一身份）
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  family     TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_models (      -- 渠道模型（某渠道实际提供）
  id                TEXT PRIMARY KEY,
  channel_id        TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  model_id          TEXT NOT NULL REFERENCES models(id),
  actual_model_id   TEXT NOT NULL,               -- 渠道实际使用的模型 ID
  protocol          TEXT NOT NULL DEFAULT 'openai_chat',
  capabilities_json TEXT NOT NULL DEFAULT '{}',  -- vision / tools / thinking / stream ...，值为 supported / unsupported / unknown
  parameters_json   TEXT NOT NULL DEFAULT '{}',  -- 参数范围等人工维护信息
  enabled           INTEGER NOT NULL DEFAULT 1,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(channel_id, actual_model_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_models_channel ON channel_models(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_models_model   ON channel_models(model_id);

-- ------------------------------------------------------------------
-- 价格（以 ChannelModel 为维度，历史追加式，不覆盖）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS model_prices (
  id                 TEXT PRIMARY KEY,
  channel_model_id   TEXT NOT NULL REFERENCES channel_models(id) ON DELETE CASCADE,
  input_price        REAL,
  output_price       REAL,
  cache_read_price   REAL,
  cache_write_price  REAL,
  image_price        REAL,
  other_usage_price  REAL,
  currency           TEXT NOT NULL DEFAULT 'CNY',
  pricing_unit       TEXT NOT NULL DEFAULT 'per_1m_tokens',
  discount_percent   REAL,                       -- 80 表示按原价 80% 计算
  effective_date     TEXT NOT NULL,              -- 生效日期（YYYY-MM-DD）
  notes              TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_prices_model ON model_prices(channel_model_id, effective_date);

-- ------------------------------------------------------------------
-- 资金与账单
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS channel_recharges (   -- 充值记录
  id             TEXT PRIMARY KEY,
  channel_id     TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  amount         REAL NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'CNY',
  payment_method TEXT,
  transaction_id TEXT,
  recharged_at   TEXT NOT NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_recharges_channel ON channel_recharges(channel_id, recharged_at);

CREATE TABLE IF NOT EXISTS channel_bills (       -- 供应商账单（手工录入 / 导入）
  id             TEXT PRIMARY KEY,
  channel_id     TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  billing_period TEXT NOT NULL,                  -- 如 2026-11
  amount         REAL NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'CNY',
  source         TEXT NOT NULL DEFAULT 'manual', -- manual / csv_import / excel_import
  imported_file  TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE(channel_id, billing_period, source)
);

CREATE INDEX IF NOT EXISTS idx_channel_bills_channel ON channel_bills(channel_id, billing_period);

CREATE TABLE IF NOT EXISTS channel_balance_snapshots ( -- 人工抄录余额快照
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  balance     REAL NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'CNY',
  captured_at TEXT NOT NULL,
  notes       TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_balance_snapshots_channel ON channel_balance_snapshots(channel_id, captured_at);

-- ------------------------------------------------------------------
-- Agent 兼容性
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_compatibility (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  agent       TEXT NOT NULL,                     -- claude_code / codex / other:*:*
  status      TEXT NOT NULL DEFAULT 'unverified'
              CHECK (status IN ('supported', 'unsupported', 'unverified')),
  evidence    TEXT,                              -- 实际测试或可靠证据的说明
  tested_at   TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(channel_id, agent)
);

-- ------------------------------------------------------------------
-- 请求记录（Raw 存文件，元数据存库）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS request_records (
  trace_id            TEXT PRIMARY KEY,
  parent_trace_id     TEXT REFERENCES request_records(trace_id), -- 重放时指向原请求
  channel_id          TEXT REFERENCES channels(id),
  channel_model_id    TEXT REFERENCES channel_models(id),
  protocol            TEXT NOT NULL,
  request_type        TEXT NOT NULL,             -- chat / responses / messages / image_generation / vision ...
  status              TEXT NOT NULL
                      CHECK (status IN ('pending', 'success', 'http_error', 'protocol_error', 'stream_error', 'storage_error', 'failed')),
  request_ref         TEXT,                      -- Raw 请求文件相对路径
  response_ref        TEXT,                      -- Raw 响应 / SSE 文件相对路径
  error_code          TEXT,
  error_message       TEXT,
  provider_request_id TEXT,
  http_status         INTEGER,
  ttfb_ms             INTEGER,                   -- 首次收到 HTTP 响应字节的时间
  ttft_ms             INTEGER,                   -- 首次收到模型内容片段的时间；未产生首 Token 时为 NULL 而非 0
  duration_ms         INTEGER,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cache_tokens        INTEGER,
  tokens_per_second   REAL,                      -- 仅在数据足够可靠时计算
  created_at          TEXT NOT NULL,
  completed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_records_channel ON request_records(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_request_records_created ON request_records(created_at);
CREATE INDEX IF NOT EXISTS idx_request_records_status  ON request_records(status);
CREATE INDEX IF NOT EXISTS idx_request_records_parent  ON request_records(parent_trace_id);

-- ------------------------------------------------------------------
-- 处理透明度
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS processing_events (
  event_id       TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL REFERENCES request_records(trace_id) ON DELETE CASCADE,
  stage          TEXT NOT NULL,                  -- request_serialization / auth_header / http_request / sse_parsing ...
  operation      TEXT NOT NULL,
  input_ref      TEXT,
  output_ref     TEXT,
  status         TEXT NOT NULL CHECK (status IN ('ok', 'changed', 'failed', 'skipped')),
  changed        INTEGER NOT NULL DEFAULT 0,     -- 是否改变了请求/响应语义
  description    TEXT,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processing_events_trace ON processing_events(trace_id, created_at);

CREATE TABLE IF NOT EXISTS request_attachments ( -- 图片等二进制附件（文件存 archives/，这里存元数据）
  id             TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL REFERENCES request_records(trace_id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,                  -- input_image / generated_image / archive ...
  file_path      TEXT NOT NULL,                  -- 相对数据目录的归档路径
  mime_type      TEXT,
  size_bytes     INTEGER,
  checksum       TEXT,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_attachments_trace ON request_attachments(trace_id);

-- ------------------------------------------------------------------
-- 错误诊断（事实、推测与置信度分开）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS error_diagnoses (
  id             TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL REFERENCES request_records(trace_id) ON DELETE CASCADE,
  error_type     TEXT NOT NULL,                  -- DNS_ERROR / TIMEOUT / HTTP_ERROR ...
  source         TEXT NOT NULL DEFAULT 'unknown'
                 CHECK (source IN ('client', 'gateway', 'upstream_gateway', 'nested_gateway', 'provider', 'local_tool', 'unknown')),
  confidence     TEXT NOT NULL DEFAULT 'unknown'
                 CHECK (confidence IN ('confirmed', 'probable', 'unknown')),
  summary        TEXT,
  evidence_json  TEXT,                           -- 证据（原始 status / code / headers / request_id ...）
  conclusion_json TEXT,                          -- 可能原因与排查建议
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_diagnoses_trace ON error_diagnoses(trace_id);

-- ------------------------------------------------------------------
-- 设置
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
