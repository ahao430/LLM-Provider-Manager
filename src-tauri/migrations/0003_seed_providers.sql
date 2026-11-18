-- 内置服务商种子（模板只是初始化配置，不代表所有渠道都具有相同能力）。
-- 使用固定 ID + INSERT OR IGNORE 保证幂等。

INSERT OR IGNORE INTO providers (id, code, name, notes, created_at, updated_at) VALUES
  ('prov_bailian', 'bailian', '阿里云百炼', 'DashScope，OpenAI 兼容模式', '2026-11-18T00:00:00+00:00', '2026-11-18T00:00:00+00:00'),
  ('prov_newapi', 'newapi', 'NewAPI', '自建或第三方 NewAPI 网关', '2026-11-18T00:00:00+00:00', '2026-11-18T00:00:00+00:00'),
  ('prov_volcano', 'volcano', '火山方舟', 'Ark API v3', '2026-11-18T00:00:00+00:00', '2026-11-18T00:00:00+00:00'),
  ('prov_siliconflow', 'siliconflow', '硅基流动', 'SiliconCloud API', '2026-11-18T00:00:00+00:00', '2026-11-18T00:00:00+00:00'),
  ('prov_custom', 'custom', '自定义渠道', '任意 OpenAI / Anthropic 兼容渠道', '2026-11-18T00:00:00+00:00', '2026-11-18T00:00:00+00:00');
