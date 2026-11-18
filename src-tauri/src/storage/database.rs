//! SQLite 数据库连接与初始化。

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::AppResult;

use super::{migrations, paths};

/// 数据库文件路径（位于数据目录的 database/ 下）。
pub fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("database").join("lcm.sqlite")
}

/// 打开连接并应用基础 PRAGMA（WAL + 外键）。启动期与启动器守护线程共用。
pub fn open_connection(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    // journal_mode 会返回结果行，需要用 query_row 执行
    conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// 初始化数据目录布局、打开（或创建）数据库并应用迁移。
pub fn init(data_dir: &Path) -> AppResult<Connection> {
    paths::ensure_layout(data_dir)?;
    let conn = open_connection(&db_path(data_dir))?;
    migrations::run(&conn)?;
    Ok(conn)
}
