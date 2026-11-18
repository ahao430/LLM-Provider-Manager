//! 备份与恢复（Phase 7）。
//!
//! 完整备份使用 .lcmbackup 格式：整包密码加密（AES-256-GCM + PBKDF2），
//! 凭证可选且独立加密段；普通配置导出不含凭证。恢复带回滚保护。

pub mod crypto;
pub mod engine;
