-- 内置汇总数据源扩充（v0.31.1）：OpenRouter 公开 models 端点。
-- https://openrouter.ai/api/v1/models：全球托管平台转售价（USD/token 字符串，×1M 折算），
-- 69 家厂商、带缓存价 / 模态 / 推理标记。多家比价站（gpuprice / aimap）的数据上游。
INSERT OR IGNORE INTO market_sources (id, name, kind, base_url, enabled, builtin, created_at)
    VALUES ('builtin_openrouter', 'OpenRouter（全球托管平台转售价）', 'builtin',
            'https://openrouter.ai/models', 1, 1, '');
