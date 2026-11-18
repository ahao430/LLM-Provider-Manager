-- 市场信息抓取缓存（单行）：保存「抓取数据」按钮拉取的最新 models.dev 快照。
-- list_market_prices 优先返回缓存；无缓存时回退内置 data.json。
CREATE TABLE IF NOT EXISTS market_cache (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot_json TEXT NOT NULL,
    source        TEXT NOT NULL,
    fetched_at    TEXT NOT NULL
);
