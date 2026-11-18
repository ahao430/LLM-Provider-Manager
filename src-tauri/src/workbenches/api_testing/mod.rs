//! API 测试工作台引擎。
//!
//! 只有本模块（与画图工作台）允许调用 adapters；Agent 原生调用路径禁止经过这里。
//! 本 Phase 3 阶段尚未引入独立 Adapter 层——序列化即协议适配的最小实现，
//! 全部映射规则通过 ProcessingEvent 透明记录（见 builder.rs）。

pub mod builder;
pub mod engine;
pub mod parser;
