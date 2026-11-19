//! 运维日志与待办：渠道管理者的每日工作记录（日志只追加）与行动计划（待办可勾选）。
//! 都是本机轻量记录，不与渠道数据强绑定（channel_id 可空）。

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| AppError::Invalid("数据库连接锁已失效".into()))
}

// ------------------------------------------------------------------
// 运维日志
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsLogRow {
    pub id: String,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub content: String,
    pub created_at: String,
}

const LOG_COLUMNS: &str = "l.id, l.channel_id, c.name, l.content, l.created_at \
                           FROM ops_logs l LEFT JOIN channels c ON l.channel_id = c.id";

fn log_from(r: &rusqlite::Row) -> rusqlite::Result<OpsLogRow> {
    Ok(OpsLogRow {
        id: r.get(0)?,
        channel_id: r.get(1)?,
        channel_name: r.get(2)?,
        content: r.get(3)?,
        created_at: r.get(4)?,
    })
}

#[tauri::command]
pub fn list_ops_logs(state: State<'_, AppState>, limit: u32) -> AppResult<Vec<OpsLogRow>> {
    let conn = db(&state)?;
    let sql = format!("SELECT {LOG_COLUMNS} ORDER BY l.created_at DESC LIMIT ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params![limit.clamp(1, 200)], log_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLogInput {
    pub content: String,
    pub channel_id: Option<String>,
}

#[tauri::command]
pub fn add_ops_log(state: State<'_, AppState>, input: AddLogInput) -> AppResult<String> {
    let content = input.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::Invalid("日志内容不能为空".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let conn = db(&state)?;
    conn.execute(
        "INSERT INTO ops_logs (id, channel_id, content, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, input.channel_id, content, crate::util::now_rfc3339()],
    )?;
    Ok(id)
}

#[tauri::command]
pub fn delete_ops_log(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    conn.execute("DELETE FROM ops_logs WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

// ------------------------------------------------------------------
// 待办
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoRow {
    pub id: String,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub title: String,
    pub note: Option<String>,
    pub due_date: Option<String>,
    pub done: bool,
    pub done_at: Option<String>,
    pub created_at: String,
}

const TODO_COLUMNS: &str =
    "t.id, t.channel_id, c.name, t.title, t.note, t.due_date, t.done, t.done_at, t.created_at \
                            FROM todos t LEFT JOIN channels c ON t.channel_id = c.id";

fn todo_from(r: &rusqlite::Row) -> rusqlite::Result<TodoRow> {
    Ok(TodoRow {
        id: r.get(0)?,
        channel_id: r.get(1)?,
        channel_name: r.get(2)?,
        title: r.get(3)?,
        note: r.get(4)?,
        due_date: r.get(5)?,
        done: r.get::<_, i64>(6)? != 0,
        done_at: r.get(7)?,
        created_at: r.get(8)?,
    })
}

#[tauri::command]
pub fn list_todos(state: State<'_, AppState>, include_done: bool) -> AppResult<Vec<TodoRow>> {
    let conn = db(&state)?;
    let sql = format!(
        "SELECT {TODO_COLUMNS} WHERE {} ORDER BY t.done ASC, (t.due_date IS NULL) ASC, t.due_date ASC, t.created_at DESC",
        if include_done { "1=1" } else { "t.done = 0" }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], todo_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTodoInput {
    pub title: String,
    pub channel_id: Option<String>,
    pub note: Option<String>,
    pub due_date: Option<String>,
}

#[tauri::command]
pub fn add_todo(state: State<'_, AppState>, input: AddTodoInput) -> AppResult<String> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("待办标题不能为空".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let conn = db(&state)?;
    conn.execute(
        "INSERT INTO todos (id, channel_id, title, note, due_date, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id,
            input.channel_id,
            title,
            input.note.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            input.due_date.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            crate::util::now_rfc3339()
        ],
    )?;
    Ok(id)
}

/// 勾选完成 / 重开。
#[tauri::command]
pub fn toggle_todo(state: State<'_, AppState>, id: String, done: bool) -> AppResult<()> {
    let conn = db(&state)?;
    conn.execute(
        "UPDATE todos SET done = ?2, done_at = ?3 WHERE id = ?1",
        rusqlite::params![id, done as i64, done.then(crate::util::now_rfc3339)],
    )?;
    Ok(())
}

#[tauri::command]
pub fn delete_todo(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    conn.execute("DELETE FROM todos WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}
