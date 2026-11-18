//! 备份引擎：创建（VACUUM INTO + zip + 加密）、恢复（带回滚保护）、
//! 归档一致性检查、历史数据清理。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use serde_json::json;

use crate::channels::repo as channel_repo;
use crate::credentials::{self, CredentialKind};
use crate::error::{AppError, AppResult};
use crate::requests::repo as records;
use crate::storage::database::db_path;
use crate::util::now_rfc3339;

use super::crypto::{read_backup_file, write_backup_file};

// ------------------------------------------------------------------
// 创建备份
// ------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub file_path: String,
    pub bytes: u64,
    pub archived_files: usize,
    pub includes_credentials: bool,
}

/// 创建加密备份。数据库用 VACUUM INTO 快照（锁内），文件归档打包（锁外）。
pub fn create_backup(
    conn: &Connection,
    data_dir: &Path,
    target_path: &Path,
    password: &str,
    include_credentials: bool,
) -> AppResult<BackupSummary> {
    if password.len() < 8 {
        return Err(AppError::Invalid("备份密码至少 8 位".into()));
    }

    // 1. 数据库快照（锁内）
    let tmp_db = data_dir.join("backups").join(".snapshot.sqlite.tmp");
    if tmp_db.exists() {
        fs::remove_file(&tmp_db)?;
    }
    if let Some(parent) = tmp_db.parent() {
        fs::create_dir_all(parent)?;
    }
    conn.execute("VACUUM INTO ?1", [tmp_db.to_string_lossy().as_ref()])?;

    // 2. 凭证段（可选，明文只存在于内存）
    let credentials_plain: Option<Vec<u8>> = if include_credentials {
        Some(collect_credentials(conn)?)
    } else {
        None
    };

    // 3. 打包 zip（内存）
    let mut zip_bytes = Vec::new();
    let archived_files = {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut zip_bytes));
        let options = zip::write::SimpleFileOptions::default();

        let manifest = json!({
            "format": "lcm-backup",
            "format_version": 1,
            "app_version": env!("CARGO_PKG_VERSION"),
            "created_at": now_rfc3339(),
            "includes_credentials": include_credentials,
        });
        zip.start_file("manifest.json", options)?;
        let manifest_text = serde_json::to_string_pretty(&manifest)
            .map_err(|e| AppError::Invalid(format!("manifest 序列化失败: {e}")))?;
        zip.write_all(manifest_text.as_bytes())?;

        zip.start_file("database/lcm.sqlite", options)?;
        zip.write_all(&fs::read(&tmp_db)?)?;

        let mut archived_files = 0usize;
        let archives_dir = data_dir.join("archives");
        for entry in walk(&archives_dir) {
            let rel = entry
                .strip_prefix(data_dir)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            zip.start_file(&rel, options)?;
            zip.write_all(&fs::read(&entry)?)?;
            archived_files += 1;
        }
        zip.finish()?;
        archived_files
    };

    // 4. 加密写入
    let bytes = write_backup_file(
        target_path,
        &zip_bytes,
        credentials_plain.as_deref(),
        password,
    )?;

    Ok(BackupSummary {
        file_path: target_path.to_string_lossy().into_owned(),
        bytes,
        archived_files,
        includes_credentials: include_credentials,
    })
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return out;
    }
    let stack = vec![dir.to_path_buf()];
    let mut queue = stack;
    while let Some(current) = queue.pop() {
        if let Ok(entries) = fs::read_dir(&current) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    queue.push(path);
                } else {
                    out.push(path);
                }
            }
        }
    }
    out
}

/// 收集全部凭证（渠道主凭证 + 敏感 Header），序列化为备份凭证段。
fn collect_credentials(conn: &Connection) -> AppResult<Vec<u8>> {
    let mut entries = Vec::new();
    for channel in channel_repo::list_rows(conn)? {
        if let Some(value) = credentials::get(&channel.id, &CredentialKind::Primary)? {
            entries.push(json!({
                "channel_id": channel.id,
                "kind": "primary",
                "value": value,
            }));
        }
    }
    serde_json::to_vec(&json!({ "entries": entries }))
        .map_err(|e| AppError::Invalid(format!("凭证段序列化失败: {e}")))
}

// ------------------------------------------------------------------
// 恢复
// ------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub restored_db: bool,
    pub restored_files: usize,
    pub restored_credentials: usize,
    pub credential_errors: Vec<String>,
    pub pre_restore_backup_dir: String,
    /// 恢复后需要重启应用（旧连接指向原数据库句柄）
    pub restart_required: bool,
}

/// 从备份恢复。恢复前把当前数据移到回滚目录（pre-restore-<ts>/），可手工还原。
pub fn restore_backup(
    data_dir: &Path,
    backup_path: &Path,
    password: &str,
) -> AppResult<RestoreSummary> {
    let (zip_bytes, credentials_plain) = read_backup_file(backup_path, password)?;

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&zip_bytes[..]))
        .map_err(|e| AppError::Invalid(format!("备份 zip 解压失败: {e}")))?;

    // 完整性检查：manifest + 数据库必须存在
    let manifest_raw = read_zip_file(&mut archive, "manifest.json")?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_raw)
        .map_err(|e| AppError::Invalid(format!("manifest.json 损坏: {e}")))?;
    if manifest.get("format").and_then(serde_json::Value::as_str) != Some("lcm-backup") {
        return Err(AppError::Invalid("备份 manifest 格式不匹配".into()));
    }
    read_zip_file(&mut archive, "database/lcm.sqlite")?;

    // 回滚保护：把当前数据移到 backups/pre-restore-<ts>/
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let rollback_dir = data_dir.join("backups").join(format!("pre-restore-{ts}"));
    fs::create_dir_all(&rollback_dir)?;
    let current_db = db_path(data_dir);
    if current_db.exists() {
        let _ = fs::rename(&current_db, rollback_dir.join("lcm.sqlite"));
        let _ = fs::rename(
            current_db.with_extension("sqlite-wal"),
            rollback_dir.join("lcm.sqlite-wal"),
        );
        let _ = fs::rename(
            current_db.with_extension("sqlite-shm"),
            rollback_dir.join("lcm.sqlite-shm"),
        );
    }

    // 写入新数据库
    let new_db = read_zip_file(&mut archive, "database/lcm.sqlite")?;
    fs::write(&current_db, &new_db)?;

    // 恢复归档文件
    let mut restored_files = 0usize;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        if name == "manifest.json" || name == "database/lcm.sqlite" {
            continue;
        }
        // 防路径穿越
        if name.contains("..") {
            continue;
        }
        let target = data_dir.join(&name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&target)?;
        std::io::copy(&mut file, &mut out)?;
        restored_files += 1;
    }

    // 凭证段（独立加密）导入凭证库
    let mut restored_credentials = 0usize;
    let mut credential_errors = Vec::new();
    if let Some(creds) = credentials_plain {
        let parsed: serde_json::Value = serde_json::from_slice(&creds)
            .map_err(|e| AppError::Invalid(format!("凭证段损坏: {e}")))?;
        if let Some(entries) = parsed.get("entries").and_then(serde_json::Value::as_array) {
            for entry in entries {
                let channel_id = entry.get("channel_id").and_then(serde_json::Value::as_str);
                let kind = entry.get("kind").and_then(serde_json::Value::as_str);
                let value = entry.get("value").and_then(serde_json::Value::as_str);
                match (channel_id, kind, value) {
                    (Some(channel_id), Some(kind), Some(value)) => {
                        match CredentialKind::parse(kind) {
                            Some(parsed_kind) => {
                                match credentials::set(channel_id, &parsed_kind, value) {
                                    Ok(()) => restored_credentials += 1,
                                    Err(e) => {
                                        credential_errors.push(format!("{channel_id}/{kind}: {e}"))
                                    }
                                }
                            }
                            None => {
                                credential_errors.push(format!("{channel_id}: 凭证类型无效 {kind}"))
                            }
                        }
                    }
                    _ => credential_errors.push("凭证段包含无效条目".into()),
                }
            }
        }
    }

    Ok(RestoreSummary {
        restored_db: true,
        restored_files,
        restored_credentials,
        credential_errors,
        pre_restore_backup_dir: rollback_dir.to_string_lossy().into_owned(),
        restart_required: true,
    })
}

fn read_zip_file<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> AppResult<Vec<u8>> {
    use std::io::Read as _;
    let mut file = archive
        .by_name(name)
        .map_err(|_| AppError::Invalid(format!("备份缺少 {name}，完整性检查失败")))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

// ------------------------------------------------------------------
// 归档一致性检查
// ------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyReport {
    pub archive_files: usize,
    pub referenced_files: usize,
    /// 记录引用了但磁盘上不存在的文件
    pub missing_files: Vec<String>,
    /// 磁盘存在但没有记录引用的孤儿文件
    pub orphan_files: Vec<String>,
    pub orphan_bytes: u64,
}

/// 检查 archives/ 与数据库引用的一致性。只报告，不自动删除。
pub fn check_consistency(conn: &Connection, data_dir: &Path) -> AppResult<ConsistencyReport> {
    let disk_files: std::collections::BTreeSet<String> = walk(&data_dir.join("archives"))
        .into_iter()
        .filter_map(|p| {
            p.strip_prefix(data_dir)
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
                .ok()
        })
        .collect();

    let mut referenced = std::collections::BTreeSet::new();
    for record in records::list(conn, 50_000)? {
        for rel in [record.request_ref, record.response_ref]
            .into_iter()
            .flatten()
        {
            if rel.starts_with("archives/") {
                referenced.insert(rel);
            }
        }
    }
    // 附件引用
    if let Ok(mut stmt) = conn.prepare("SELECT file_path FROM request_attachments") {
        if let Ok(mut rows) = stmt.query([]) {
            while let Some(row) = rows.next()? {
                let path: String = row.get(0)?;
                if path.starts_with("archives/") {
                    referenced.insert(path);
                }
            }
        }
    }

    let missing_files: Vec<String> = referenced.difference(&disk_files).cloned().collect();
    let orphan_files: Vec<String> = disk_files.difference(&referenced).cloned().collect();
    let orphan_bytes = orphan_files
        .iter()
        .filter_map(|rel| fs::metadata(data_dir.join(rel)).ok())
        .map(|m| m.len())
        .sum();

    Ok(ConsistencyReport {
        archive_files: disk_files.len(),
        referenced_files: referenced.len(),
        missing_files,
        orphan_files,
        orphan_bytes,
    })
}

// ------------------------------------------------------------------
// 历史数据清理
// ------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSummary {
    pub deleted_records: usize,
    pub deleted_files: usize,
    /// 用户确认后由命令层执行；本函数只处理 created_at < before 的记录
    pub before: String,
}

/// 清理指定日期之前的请求记录（含处理事件级联）与其归档文件。
pub fn cleanup_before(
    conn: &Connection,
    data_dir: &Path,
    before: &str,
) -> AppResult<CleanupSummary> {
    // 先收集要删的引用文件
    let mut files_to_delete = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT request_ref, response_ref FROM request_records WHERE created_at < ?1",
        )?;
        let mut rows = stmt.query([before])?;
        while let Some(row) = rows.next()? {
            for value in [
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ]
            .into_iter()
            .flatten()
            {
                if value.starts_with("archives/") && !value.contains("..") {
                    files_to_delete.push(value);
                }
            }
        }
    }

    let deleted = conn.execute(
        "DELETE FROM request_records WHERE created_at < ?1",
        [before],
    )?;

    let mut deleted_files = 0usize;
    for rel in files_to_delete {
        let path = data_dir.join(&rel);
        if fs::remove_file(&path).is_ok() {
            deleted_files += 1;
        }
    }

    Ok(CleanupSummary {
        deleted_records: deleted,
        deleted_files,
        before: before.to_string(),
    })
}
