//! 工作台模块：API 测试工作台、画图工作台与内嵌 Agent。
//!
//! 只有工作台路径允许调用 `super::adapters`（Provider / Protocol Adapter），
//! 且所有可能改变请求语义的处理必须记录 ProcessingEvent。
//!
//! - `api_testing`：Phase 3（OpenAI Chat / OpenAI Responses / Anthropic Messages）。
//! - `image`：Phase 4（生成 / 理解 / 编辑）。
//! - `assistant`：内嵌 Agent（LCM 自身的多轮对话，请求照常记录）。

pub mod api_testing;
pub mod assistant;
pub mod image;
