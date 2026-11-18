//! 应用信息与存储状态命令。

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub data_dir: String,
}

/// 返回应用名称、版本与数据目录。
#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
    })
}

#[derive(Debug, Serialize)]
pub struct TableStat {
    pub table: String,
    pub rows: i64,
}

/// 返回 SQLite 各业务表行数（用于设置页展示存储状态）。
#[tauri::command]
pub fn get_database_stats(state: State<'_, AppState>) -> AppResult<Vec<TableStat>> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Invalid("数据库连接锁已失效".into()))?;

    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != '_migrations'
         ORDER BY name",
    )?;
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|row| row.ok())
        .collect();

    let mut stats = Vec::with_capacity(tables.len());
    for table in tables {
        // 表名来自 sqlite_master，用双引号包裹防注入
        let sql = format!(r#"SELECT COUNT(*) FROM "{table}""#);
        let rows: i64 = conn.query_row(&sql, [], |row| row.get(0))?;
        stats.push(TableStat { table, rows });
    }
    Ok(stats)
}
