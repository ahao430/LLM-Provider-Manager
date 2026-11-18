//! 工作台模块：API 测试工作台与画图工作台。
//!
//! 只有工作台路径允许调用 `super::adapters`（Provider / Protocol Adapter），
//! 且所有可能改变请求语义的处理必须记录 ProcessingEvent。
//!
//! - `api_testing`：Phase 3（OpenAI Chat / OpenAI Responses / Anthropic Messages）。
//! - `image`：Phase 4（生成 / 理解 / 编辑）。

pub mod api_testing;
pub mod image;
