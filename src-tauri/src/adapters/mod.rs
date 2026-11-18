//! Provider 与 Protocol Adapter。
//!
//! 架构边界（PLAN.md「Agent 与工作台严格隔离」）：
//! - Adapter 只服务于工作台（`workbenches/api_testing` 与 `workbenches/image`）。
//! - Agent 原生调用路径（`agent` 模块）禁止依赖本模块，
//!   由 `tests/architecture_boundaries.rs` 自动化测试强制执行。
//! - Adapter 不得隐藏渠道实际返回的错误和不兼容行为。

pub mod protocols;
pub mod providers;
