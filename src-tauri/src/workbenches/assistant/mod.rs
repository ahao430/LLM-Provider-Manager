//! 内嵌 Agent：LCM 应用内多轮对话。
//!
//! 定位（与 PLAN.md 原则一致）：
//! - 属于工作台路径，允许协议适配；对话存储于 agent_conversations / agent_messages。
//! - 每轮请求写入 request_records（request_type = agent_chat，parent_trace_id = 会话 ID），
//!   原始请求 / 响应照常归档——内嵌 Agent 不绕过透明度原则。
//! - 凭证受控读取注入，不落任何持久化明文。

pub mod engine;
pub mod repo;
