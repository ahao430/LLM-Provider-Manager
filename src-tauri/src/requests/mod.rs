//! 请求记录：Trace ID、RequestRecord 元数据、ProcessingEvent 查询。
//!
//! Raw 是事实记录，Preview 是解释结果，Preview 不得覆盖 Raw（PLAN.md）。
//! Raw 文件存 archives/，数据库只存相对引用。

pub mod cost;
pub mod repo;
