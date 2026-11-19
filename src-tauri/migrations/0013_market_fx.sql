-- 0013: 市场汇率缓存（USD → CNY 展示折算用）
-- 单行表；「抓取数据」时顺带从 frankfurter 更新。仅用于市场页币种切换显示，
-- 绝不参与任何金额相加（红线：无明确汇率不相加、估算必须标注）。

CREATE TABLE IF NOT EXISTS market_fx (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  rate       REAL NOT NULL,
  fetched_at TEXT NOT NULL
);
