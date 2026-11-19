-- 渠道模型「标注价格」格式扩展（v0.24.0）：与市场价统一支持单一 / 阶梯 / 分时段，
-- 新增倍率（拿到渠道折扣时按原价 × 倍率得到实际价）。依旧仅展示比较，不参与费用估算。
ALTER TABLE channel_models ADD COLUMN price_multiplier REAL NOT NULL DEFAULT 1.0;
-- 阶梯价 JSON 数组：[{"upTo":0.128,"input":4,"output":16},{"upTo":null,"input":2,"output":8}]
-- upTo = 累计输入 token 上限（单位：百万），null = 无上限最后一档
ALTER TABLE channel_models ADD COLUMN price_tiers_json TEXT;
-- 分时段价 JSON 对象：{"window":"00:30–08:30 UTC+8","input":1,"output":4}
ALTER TABLE channel_models ADD COLUMN price_off_peak_json TEXT;
