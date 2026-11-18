/**
 * 领域类型定义。
 *
 * 这些类型与 src-tauri/migrations/ 中的数据库结构保持对应，
 * 详见 docs/database.md。字段会随各 Phase 逐步补充。
 */

/** 支持的 API 协议 */
export type Protocol = "openai_chat" | "openai_responses" | "anthropic_messages";

/** 模型能力状态：支持 / 不支持 / 未知（不做跨渠道推断） */
export type CapabilityStatus = "supported" | "unsupported" | "unknown";

/** Agent 兼容性状态：支持 / 不支持 / 未验证 */
export type AgentCompatStatus = "supported" | "unsupported" | "unverified";

/** 请求记录状态 */
export type RequestStatus =
  | "pending"
  | "success"
  | "http_error"
  | "protocol_error"
  | "stream_error"
  | "storage_error"
  | "failed";
