-- 类型默认规则落地：多模态家族命名 → multimodal（与 default_model_type_for 保持一致）。
-- 覆盖：Claude 3+ 全系、Gemini 全系、GPT-4o / 4.1 / 4-turbo / 5 系、OpenAI o 系（o1/o3/o4 前缀）、
--       视觉系命名（omni / vision / -vl / vl- / qvq / 4o）及已知多模态型号。
-- 仅纠正仍为 text 的行，不动人工已标记的其他类型（与 0009 同一原则）。
UPDATE channel_models
SET model_type = 'multimodal'
WHERE model_type = 'text'
  AND (
    lower(actual_model_id) LIKE '%claude%'
    OR lower(actual_model_id) LIKE '%gemini%'
    OR lower(actual_model_id) LIKE '%4o%'
    OR lower(actual_model_id) LIKE '%gpt-4.1%'
    OR lower(actual_model_id) LIKE '%gpt-4-turbo%'
    OR lower(actual_model_id) LIKE '%gpt-5%'
    OR lower(actual_model_id) LIKE '%omni%'
    OR lower(actual_model_id) LIKE '%vision%'
    OR lower(actual_model_id) LIKE '%-vl%'
    OR lower(actual_model_id) LIKE '%vl-%'
    OR lower(actual_model_id) LIKE '%qvq%'
    OR lower(actual_model_id) LIKE '%deepseek-v4.1-flash%'
    OR lower(actual_model_id) LIKE '%glm-5.3-flash%'
    OR lower(actual_model_id) LIKE 'o1%'
    OR lower(actual_model_id) LIKE 'o3%'
    OR lower(actual_model_id) LIKE 'o4%'
  );
