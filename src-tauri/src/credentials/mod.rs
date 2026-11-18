//! 凭证管理：应用数据目录下的独立凭证文件（`credentials.json`，0600 权限）。
//!
//! 红线（PLAN.md「凭证安全」）：
//! - 明文只存在于凭证文件、内存与子进程环境变量。
//! - 不进入 SQLite、日志、诊断上下文、普通导出。
//! - 默认掩码显示；明文读取（编辑回显 / 眼睛图标 / 复制）通过受控的 Tauri Command。
//!
//! 为什么不用系统凭证库（Keychain / Credential Manager）：macOS 开发期二进制每次重编译
//! ad-hoc 签名（cdhash）都会变化，Keychain ACL 无法识别为同一应用，导致每次读写都弹
//! 「允许访问钥匙串」。改为 0600 权限的独立文件（与 ~/.aws/credentials 同类做法），
//! 彻底消除询问。首次启动自动从 Keychain 迁移一次（不删除旧条目，避免再次弹窗）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// 旧 Keychain 条目的 service 名（仅迁移期读取）。
const LEGACY_KEYCHAIN_SERVICE: &str = "com.wanghao.lcm";
const FILE_NAME: &str = "credentials.json";
/// 迁移完成标记（存在即不再尝试读 Keychain）。
const MIGRATED_MARKER: &str = "credentials.keychain-migrated";

static STORE: OnceLock<Store> = OnceLock::new();

/// 凭证种类：主凭证（按协议派生认证）、敏感自定义 Header、
/// 或费用查询凭证（阿里云 AccessKey 对 / NewAPI 系统访问令牌）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialKind<'a> {
    Primary,
    Header(&'a str),
    /// 阿里云费用中心查询用 AccessKey ID
    BillingAccessKeyId,
    /// 阿里云费用中心查询用 AccessKey Secret
    BillingAccessKeySecret,
    /// NewAPI 用户额度查询用系统访问令牌
    BillingSystemToken,
}

impl CredentialKind<'_> {
    pub fn parse(kind: &str) -> Option<CredentialKind<'_>> {
        if kind == "primary" {
            Some(CredentialKind::Primary)
        } else if let Some(name) = kind.strip_prefix("header:") {
            (!name.is_empty()).then_some(CredentialKind::Header(name))
        } else if kind == "billing_access_key_id" {
            Some(CredentialKind::BillingAccessKeyId)
        } else if kind == "billing_access_key_secret" {
            Some(CredentialKind::BillingAccessKeySecret)
        } else if kind == "billing_system_token" {
            Some(CredentialKind::BillingSystemToken)
        } else {
            None
        }
    }
}

/// 凭证条目名（凭证文件中的 key；备份加密段的标识）。
pub fn entry_name(channel_id: &str, kind: &CredentialKind) -> String {
    match kind {
        CredentialKind::Primary => format!("channel/{channel_id}/primary"),
        CredentialKind::Header(name) => format!("channel/{channel_id}/header/{name}"),
        CredentialKind::BillingAccessKeyId => format!("channel/{channel_id}/billing/access_key_id"),
        CredentialKind::BillingAccessKeySecret => {
            format!("channel/{channel_id}/billing/access_key_secret")
        }
        CredentialKind::BillingSystemToken => format!("channel/{channel_id}/billing/system_token"),
    }
}

/// 启动时初始化：确保凭证文件存在、执行一次性 Keychain 迁移。重复调用无副作用。
pub fn init(data_dir: &Path, conn: &Connection) -> AppResult<()> {
    let store = Store {
        file: data_dir.join(FILE_NAME),
    };
    if !store.file.exists() {
        store.save(&BTreeMap::new())?;
    } else {
        restrict_permissions(&store.file);
    }

    let marker = data_dir.join(MIGRATED_MARKER);
    if !marker.exists() {
        // 迁移失败不阻断启动（Keychain 不可用时保留现状；删除标记可重试）
        if let Err(e) = migrate_from_keychain(conn, &store) {
            eprintln!("[credentials] Keychain 迁移未完成：{e}");
        }
        let _ = std::fs::write(&marker, chrono::Utc::now().to_rfc3339());
    }

    let _ = STORE.set(store); // 已初始化时保留首个（重复调用场景）
    Ok(())
}

/// 一次性迁移：把各渠道的 Keychain 主凭证复制进凭证文件（不删除旧条目——删除同样会弹窗）。
fn migrate_from_keychain(conn: &Connection, store: &Store) -> AppResult<()> {
    let channel_ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM channels")?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };
    let mut map = store.load()?;
    let mut moved = 0;
    for id in channel_ids {
        let name = entry_name(&id, &CredentialKind::Primary);
        if map.contains_key(&name) {
            continue;
        }
        if let Ok(Some(value)) = legacy_keychain_get(&name) {
            map.insert(name, value);
            moved += 1;
        }
    }
    if moved > 0 {
        store.save(&map)?;
    }
    Ok(())
}

fn legacy_keychain_get(name: &str) -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(LEGACY_KEYCHAIN_SERVICE, name)
        .map_err(|e| AppError::Invalid(format!("凭证库不可用: {e}")))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Invalid(format!("凭证库错误: {e}"))),
    }
}

fn global() -> &'static Store {
    STORE.get().expect("credentials::init 未在启动时调用")
}

/// 文件型凭证存储（entry_name → 明文）。写入原子（临时文件 + rename）。
struct Store {
    file: PathBuf,
}

impl Store {
    fn load(&self) -> AppResult<BTreeMap<String, String>> {
        if !self.file.exists() {
            return Ok(BTreeMap::new());
        }
        let text = std::fs::read_to_string(&self.file)
            .map_err(|e| AppError::Invalid(format!("凭证文件读取失败: {e}")))?;
        serde_json::from_str(&text)
            .map_err(|e| AppError::Invalid(format!("凭证文件解析失败（可能损坏）: {e}")))
    }

    fn save(&self, map: &BTreeMap<String, String>) -> AppResult<()> {
        let dir = self
            .file
            .parent()
            .ok_or_else(|| AppError::Invalid("路径异常".into()))?;
        let tmp = dir.join(format!(
            "{}.{}.tmp",
            FILE_NAME,
            uuid::Uuid::new_v4().simple()
        ));
        let text = serde_json::to_string(map)
            .map_err(|e| AppError::Invalid(format!("凭证序列化失败: {e}")))?;
        std::fs::write(&tmp, text)
            .map_err(|e| AppError::Invalid(format!("凭证文件写入失败: {e}")))?;
        restrict_permissions(&tmp);
        // Windows 的 rename 不能覆盖已存在文件，先移除
        #[cfg(windows)]
        if self.file.exists() {
            let _ = std::fs::remove_file(&self.file);
        }
        std::fs::rename(&tmp, &self.file)
            .map_err(|e| AppError::Invalid(format!("凭证文件替换失败: {e}")))?;
        Ok(())
    }
}

/// Unix 下收紧为仅属主可读写。
fn restrict_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// 写入凭证。
pub fn set(channel_id: &str, kind: &CredentialKind, value: &str) -> AppResult<()> {
    let store = global();
    let mut map = store.load()?;
    map.insert(entry_name(channel_id, kind), value.to_string());
    store.save(&map)
}

/// 读取明文（受控操作：仅编辑回显 / 复制 / Agent 启动注入 / 请求认证使用）。不存在返回 None。
pub fn get(channel_id: &str, kind: &CredentialKind) -> AppResult<Option<String>> {
    Ok(global().load()?.get(&entry_name(channel_id, kind)).cloned())
}

/// 删除凭证（不存在视为成功，幂等）。
pub fn delete(channel_id: &str, kind: &CredentialKind) -> AppResult<()> {
    let store = global();
    let mut map = store.load()?;
    if map.remove(&entry_name(channel_id, kind)).is_some() {
        store.save(&map)?;
    }
    Ok(())
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

    fn temp_store() -> Store {
        let dir = std::env::temp_dir().join(format!("lcm-cred-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Store {
            file: dir.join(FILE_NAME),
        }
    }

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
        assert_eq!(CredentialKind::parse("unknown"), None);
        assert_eq!(
            entry_name("c1", &CredentialKind::Primary),
            "channel/c1/primary"
        );
    }

    #[test]
    fn store_roundtrip_and_permissions() {
        let store = temp_store();
        let dir = store.file.parent().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::migrations::run(&conn).unwrap();

        // init 语义：建文件 + 迁移标记
        init(dir, &conn).unwrap();
        assert!(store.file.exists());
        assert!(dir.join(MIGRATED_MARKER).exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&store.file).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "凭证文件应为 0600");
        }

        // 读写删（经 Store 直测，不依赖全局）
        let mut map = BTreeMap::new();
        map.insert(entry_name("c1", &CredentialKind::Primary), "sk-test".into());
        store.save(&map).unwrap();
        assert_eq!(
            store.load().unwrap().get("channel/c1/primary"),
            Some(&"sk-test".to_string())
        );

        map.remove("channel/c1/primary");
        store.save(&map).unwrap();
        assert!(store.load().unwrap().is_empty());

        let _ = std::fs::remove_dir_all(dir);
    }
}
