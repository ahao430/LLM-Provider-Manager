-- 渠道模型接口类型默认规则落地：模型名含 claude → anthropic_messages。
-- 仅修正从未显式设置过（仍为 openai_chat）的行，不动人工已标记的值。
UPDATE channel_models
SET protocol = 'anthropic_messages'
WHERE protocol = 'openai_chat'
  AND lower(actual_model_id) LIKE '%claude%';
