//! Agent 原生调用支持模块。
//!
//! 架构铁律（PLAN.md「Agent 与工作台严格隔离」）：
//! - Agent 使用渠道原生 API，本模块不得依赖任何适配器代码。
//! - 本模块只负责：兼容性信息管理、使用说明、配置生成或导出（用户确认后执行）、
//!   Agent 原生进程启动（Agent Launcher）、兼容性测试结果展示。
//! - 边界由 `tests/architecture_boundaries.rs` 自动化测试强制执行。

pub mod compat;
pub mod launcher;
