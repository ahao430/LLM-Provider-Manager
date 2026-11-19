-- 主地址语义升级（v0.26.0）：chat_base_url 填基础域名（不带 /v1），
-- 新增 Chat Completions 专用地址（三协议展开编辑的第三项）；
-- 留空时 completions / responses 由请求侧自动拼 /v1（ensure_v1，已带 /vN 的旧地址不重复拼）。
ALTER TABLE channels ADD COLUMN chat_completions_url TEXT NOT NULL DEFAULT '';
