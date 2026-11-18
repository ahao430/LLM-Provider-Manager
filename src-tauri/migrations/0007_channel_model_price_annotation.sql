-- 渠道模型「标注价格」：仅供人工标注与市场比较展示。
-- 明确不参与本地测试费用估算（估算走 model_prices 价格历史，两套独立）。
ALTER TABLE channel_models ADD COLUMN price_input_per_1m REAL;
ALTER TABLE channel_models ADD COLUMN price_output_per_1m REAL;
ALTER TABLE channel_models ADD COLUMN price_currency TEXT NOT NULL DEFAULT '';
