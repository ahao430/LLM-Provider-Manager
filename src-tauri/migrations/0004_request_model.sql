-- request_records 增加实际使用的模型名（反规范化，便于列表展示与统计）。
-- 0001 迁移遗漏该列（此前记录模型经 channel_models 关联），Phase 3 代码已引用，需补齐。

ALTER TABLE request_records ADD COLUMN model TEXT;
