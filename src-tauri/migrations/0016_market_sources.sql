-- 自定义市场数据源（v0.25.0）：NewAPI 类站点「模型广场」价格抓取 + 内置源展示（只读）。
-- 源配置不含密钥；抓取结果缓存为 MarketSnapshot 形状（providers 单条）。
CREATE TABLE IF NOT EXISTS market_sources (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    -- newapi = NewAPI 类站点（/api/pricing）；sub2api = 预留（TODO）；builtin = 内置只读源
    kind      TEXT NOT NULL CHECK (kind IN ('newapi', 'sub2api', 'builtin')),
    base_url  TEXT NOT NULL DEFAULT '',
    enabled   INTEGER NOT NULL DEFAULT 1,
    builtin   INTEGER NOT NULL DEFAULT 0,
    -- 站点 favicon（data URL，抓取时顺带存）；NULL 时前端用字母回退
    icon_data TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_source_cache (
    source_id     TEXT PRIMARY KEY REFERENCES market_sources(id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,
    fetched_at    TEXT NOT NULL
);

-- 内置源种子（只读，前端不可新增 / 编辑 / 删除）
INSERT OR IGNORE INTO market_sources (id, name, kind, base_url, enabled, builtin, created_at)
    VALUES ('builtin_modelsdev', 'models.dev（国际价）', 'builtin', 'https://models.dev', 1, 1, ''),
           ('builtin_cn', '国内厂商官网价', 'builtin', '', 1, 1, '');
