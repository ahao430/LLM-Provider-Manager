-- 0012: 渠道分组 + 首页仪表盘置顶
-- channel_groups：命名分组（如「上游百炼渠道」「上游中转站」「自建聚合中转」），渠道可归属一个分组。
-- channels.group_id 可空：NULL = 未分组（分组删除时渠道自动回到未分组）。
-- channels.dashboard_pinned：置顶到首页仪表盘的渠道卡片。

CREATE TABLE IF NOT EXISTS channel_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

ALTER TABLE channels ADD COLUMN group_id TEXT REFERENCES channel_groups(id);
ALTER TABLE channels ADD COLUMN dashboard_pinned INTEGER NOT NULL DEFAULT 0;
