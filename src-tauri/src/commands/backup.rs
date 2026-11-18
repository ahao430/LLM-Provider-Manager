//! 备份与维护命令：创建 / 恢复备份、一致性检查、数据清理。

use rusqlite::Connection;
use std::path::PathBuf;
use tauri::State;

use crate::backup::engine::{
    self, BackupSummary, CleanupSummary, ConsistencyReport, RestoreSummary,
};
use crate::error::AppResult;
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

/// 创建加密备份（.lcmbackup）。凭证仅在用户显式勾选时打包（独立加密段）。
#[tauri::command]
pub fn create_backup(
    state: State<'_, AppState>,
    target_path: String,
    password: String,
    include_credentials: bool,
) -> AppResult<BackupSummary> {
    let conn = db(&state)?;
    engine::create_backup(
        &conn,
        &state.data_dir,
        &PathBuf::from(target_path),
        &password,
        include_credentials,
    )
}

/// 从备份恢复（覆盖前自动回滚备份；恢复后需重启应用）。
#[tauri::command]
pub fn restore_backup(
    state: State<'_, AppState>,
    backup_path: String,
    password: String,
) -> AppResult<RestoreSummary> {
    // 快照连接先释放，避免恢复时文件被占用
    drop(db(&state)?);
    engine::restore_backup(&state.data_dir, &PathBuf::from(backup_path), &password)
}

/// 归档一致性检查：只报告缺失与孤儿文件，不自动处理。
#[tauri::command]
pub fn check_archive_consistency(state: State<'_, AppState>) -> AppResult<ConsistencyReport> {
    let conn = db(&state)?;
    engine::check_consistency(&conn, &state.data_dir)
}

/// 清理指定日期之前的请求记录与归档文件。
#[tauri::command]
pub fn cleanup_old_data(state: State<'_, AppState>, before: String) -> AppResult<CleanupSummary> {
    let conn = db(&state)?;
    engine::cleanup_before(&conn, &state.data_dir, &before)
}
