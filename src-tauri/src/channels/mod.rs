//! 渠道管理：服务商、渠道实例、连接配置、外部链接。
//!
//! - `domain`：领域类型（含 config_json 的结构与校验）。
//! - `repo`：纯 SQL 读写（不含凭证逻辑）。
//! - `service`：业务编排（凭证写入、敏感字段清洗、快照视图）。
//! - `templates`：内置服务商模板（仅用于新建渠道时的初始化预填）。

pub mod domain;
pub mod repo;
pub mod service;
pub mod templates;
