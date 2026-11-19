-- 渠道运维四件套（v0.33.0）：健康状态 / 模型获取快照 / 故障事件。
-- 运维档案（控制台链接 / 联系方式 / 有效期）存 config_json.ops（serde default，向后兼容，无需建列）。

-- 渠道运维状态：normal=正常 / suspect 不落库（前端按最近测试推导）/ fault=故障确认 /
-- maintenance=维护中 / deprecated=已弃用。枚举校验在 repo 层（ALTER 无法带 CHECK）。
ALTER TABLE channels ADD COLUMN ops_status TEXT NOT NULL DEFAULT 'normal';

-- 模型获取快照：每次成功拉取远端模型列表后存一份 id 集合（每渠道只留最新一条），
-- 供「上次获取以来」的上下架 diff（新增 / 疑似下架）。不删任何 channel_models 行。
CREATE TABLE IF NOT EXISTS channel_model_fetches (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id     TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    fetched_at     TEXT NOT NULL,
    model_ids_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_fetch_channel ON channel_model_fetches(channel_id, fetched_at DESC);

-- 故障事件：把一组相关失败记录聚合为一次故障（起止 / 根因），供复盘与统计。
-- request_records.incident_id 可空关联；记录本身的状态字段不变。
CREATE TABLE IF NOT EXISTS incidents (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    resolved_at TEXT,
    root_cause  TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_channel ON incidents(channel_id, started_at DESC);

ALTER TABLE request_records ADD COLUMN incident_id TEXT REFERENCES incidents(id);
CREATE INDEX IF NOT EXISTS idx_records_incident ON request_records(incident_id);
