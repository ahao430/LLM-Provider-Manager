//! 画图工作台：图片生成与图片理解（Vision）。
//!
//! 规则（PLAN.md「画图工作台」）：
//! - 不自动压缩、裁剪或转换用户图片。
//! - 图片二进制不进 SQLite：归档到 archives/images/YYYY/MM/trace-id/，元数据入 request_attachments。
//! - URL 图片只在用户允许归档时下载；下载有限制（防 SSRF，Phase 7 完善）。
//! - 原始响应完整归档，Preview 只做解释。

pub mod attachments;
pub mod generator;
pub mod vision;
