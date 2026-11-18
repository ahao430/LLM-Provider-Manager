//! 全局模型与渠道模型管理：模型列表获取、导入（用户确认后写入）、能力标记、价格。
//!
//! 规则（PLAN.md「模型管理」「价格管理」）：
//! - 能力状态只用 supported / unsupported / unknown，不做跨渠道推断。
//! - 模型获取和模型导入分离：获取后由用户选择确认是否写入。
//! - 导入不覆盖已有备注、价格、参数配置等人工维护信息。
//! - 价格以 ChannelModel 为维度，历史追加式，不覆盖不删除。

pub mod domain;
pub mod fetch;
pub mod repo;
pub mod service;
