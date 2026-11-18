//! 存储层：SQLite 数据库与本地文件归档。
//!
//! - `database`：连接初始化、PRAGMA、迁移。
//! - `migrations`：内嵌 SQL 迁移（只追加，不修改已发布的迁移）。
//! - `paths`：应用数据目录布局。
//!
//! 目录布局见 PLAN.md「数据存储」：
//! app-data/ = database/ + archives/{requests,responses,streams,images} + backups/ + logs/

pub mod database;
pub mod migrations;
pub mod paths;
