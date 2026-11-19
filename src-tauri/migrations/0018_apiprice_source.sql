-- 内置汇总数据源扩充（v0.31.0）：apiprice.app 开放数据（CC BY 4.0，需署名）。
-- 数据端点 https://apiprice.app/data/prices.json：官方 / 国内官方(CNY) / OpenRouter
-- 三通道、带缓存价与分时段字段、日更。抓取缓存走 market_source_cache（同自定义源机制）。
INSERT OR IGNORE INTO market_sources (id, name, kind, base_url, enabled, builtin, created_at)
    VALUES ('builtin_apiprice', 'apiprice.app（官方+OpenRouter 双通道）', 'builtin',
            'https://apiprice.app/zh/', 1, 1, '');
