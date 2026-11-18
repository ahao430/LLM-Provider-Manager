//! 凭证管理：系统凭证库（macOS Keychain / Windows Credential Manager / Linux Secret Service）。
//!
//! 红线（PLAN.md「凭证安全」）：
//! - 明文只存在于系统凭证库与子进程环境变量。
//! - 不进入 SQLite、日志、诊断上下文、导出文件。
//! - 默认掩码显示；明文读取（编辑回显 / 眼睛图标）通过受控的 Tauri Command。

use keyring::Entry;

use crate::error::{AppError, AppResult};

/// 系统凭证库中的 service 名。
const SERVICE: &str = "com.wanghao.lcm";

/// 凭证种类：主凭证（按 auth_type 使用）或敏感自定义 Header。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialKind<'a> {
    Primary,
    Header(&'a str),
}

impl CredentialKind<'_> {
    pub fn parse(kind: &str) -> Option<CredentialKind<'_>> {
        if kind == "primary" {
            Some(CredentialKind::Primary)
        } else if let Some(name) = kind.strip_prefix("header:") {
            (!name.is_empty()).then_some(CredentialKind::Header(name))
        } else {
            None
        }
    }
}

/// 凭证库条目名（同时作为 SQLite 中的 credential_ref）。
pub fn entry_name(channel_id: &str, kind: &CredentialKind) -> String {
    match kind {
        CredentialKind::Primary => format!("channel/{channel_id}/primary"),
        CredentialKind::Header(name) => format!("channel/{channel_id}/header/{name}"),
    }
}

fn entry(channel_id: &str, kind: &CredentialKind) -> AppResult<Entry> {
    Entry::new(SERVICE, &entry_name(channel_id, kind))
        .map_err(|e| AppError::Invalid(format!("凭证库不可用: {e}")))
}

fn map_keyring_err(e: keyring::Error) -> AppError {
    AppError::Invalid(format!("凭证库错误: {e}"))
}

/// 写入凭证。
pub fn set(channel_id: &str, kind: &CredentialKind, value: &str) -> AppResult<()> {
    entry(channel_id, kind)?
        .set_password(value)
        .map_err(map_keyring_err)
}

/// 读取明文（受控操作：仅编辑回显 / Agent 启动注入使用）。不存在返回 None。
pub fn get(channel_id: &str, kind: &CredentialKind) -> AppResult<Option<String>> {
    match entry(channel_id, kind)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(map_keyring_err(e)),
    }
}

/// 删除凭证（不存在视为成功，幂等）。
pub fn delete(channel_id: &str, kind: &CredentialKind) -> AppResult<()> {
    match entry(channel_id, kind)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(map_keyring_err(e)),
    }
}

/// 掩码显示（PLAN.md 示例：sk-********************）。
pub fn mask(value: &str) -> String {
    let len = value.chars().count();
    if len <= 8 {
        "*".repeat(8)
    } else {
        let prefix: String = value.chars().take(3).collect();
        format!("{prefix}{}", "*".repeat(12))
    }
}

/// 读取并返回掩码；不存在返回 None。
pub fn describe(channel_id: &str, kind: &CredentialKind) -> Option<String> {
    match get(channel_id, kind) {
        Ok(Some(value)) => Some(mask(&value)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_covers_value() {
        assert_eq!(mask("short"), "********");
        let masked = mask("sk-abcdefgh1234");
        assert!(masked.starts_with("sk-"));
        assert!(!masked.contains("abcdefgh"));
    }

    #[test]
    fn credential_kind_roundtrip() {
        assert_eq!(
            CredentialKind::parse("primary"),
            Some(CredentialKind::Primary)
        );
        assert!(matches!(
            CredentialKind::parse("header:X-Extra"),
            Some(CredentialKind::Header("X-Extra"))
        ));
        assert!(CredentialKind::parse("unknown").is_none());
        assert_eq!(
            entry_name("c1", &CredentialKind::Primary),
            "channel/c1/primary"
        );
    }
}
