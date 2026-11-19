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

// ------------------------------------------------------------------
// 日历（仪表盘「运维日历」卡）：按本地日期聚合日志/待办。
// created_at 一律 UTC RFC3339 存储，展示与分桶用 SQLite 'localtime' 修饰符换算本地日期，
// 避免 UTC 0-8 点（本地凌晨）的记录落到前一天。
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    /// 本地日期 YYYY-MM-DD
    pub date: String,
    pub log_count: i64,
    /// 当日到期待办总数（含已完成）
    pub todo_count: i64,
    /// 当日到期且未完成
    pub todo_open: i64,
}

#[tauri::command]
pub fn ops_calendar_month(
    state: State<'_, AppState>,
    year: i32,
    month: i32,
) -> AppResult<Vec<CalendarDay>> {
    if !(1..=12).contains(&month) {
        return Err(AppError::Invalid("月份超出范围".into()));
    }
    if !(1970..=2999).contains(&year) {
        return Err(AppError::Invalid("年份超出范围".into()));
    }
    let prefix = format!("{year:04}-{month:02}");
    let conn = db(&state)?;
    let mut map: std::collections::HashMap<String, CalendarDay> = std::collections::HashMap::new();
    // 日志按本地日期聚合（LIKE 保证跨月边界的时区偏移不漏记）
    let mut stmt = conn.prepare(
        "SELECT date(created_at, 'localtime') AS d, COUNT(*) FROM ops_logs \
         WHERE date(created_at, 'localtime') LIKE ?1 || '-%' GROUP BY d",
    )?;
    let mut rows = stmt.query(rusqlite::params![prefix])?;
    while let Some(r) = rows.next()? {
        let d: String = r.get(0)?;
        let n: i64 = r.get(1)?;
        let entry = map.entry(d.clone()).or_insert(CalendarDay {
            date: d,
            log_count: 0,
            todo_count: 0,
            todo_open: 0,
        });
        entry.log_count = n;
    }
    // 待办按 due_date（本身就是本地日期）聚合
    let mut stmt = conn.prepare(
        "SELECT due_date, COUNT(*), SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) FROM todos \
         WHERE due_date LIKE ?1 || '-%' GROUP BY due_date",
    )?;
    let mut rows = stmt.query(rusqlite::params![prefix])?;
    while let Some(r) = rows.next()? {
        let d: String = r.get(0)?;
        let n: i64 = r.get(1)?;
        let open: i64 = r.get(2)?;
        let entry = map.entry(d.clone()).or_insert(CalendarDay {
            date: d,
            log_count: 0,
            todo_count: 0,
            todo_open: 0,
        });
        entry.todo_count = n;
        entry.todo_open = open;
    }
    let mut days: Vec<CalendarDay> = map.into_values().collect();
    days.sort_by_key(|d| d.date.clone());
    Ok(days)
}

/// 某一天的明细：当天日志（本地日期口径）+ 当日到期待办（含已完成）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsDayItems {
    pub logs: Vec<OpsLogRow>,
    pub todos: Vec<TodoRow>,
}

fn is_yyyy_mm_dd(date: &str) -> bool {
    let b = date.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

#[tauri::command]
pub fn ops_day_items(state: State<'_, AppState>, date: String) -> AppResult<OpsDayItems> {
    if !is_yyyy_mm_dd(&date) {
        return Err(AppError::Invalid("日期格式应为 YYYY-MM-DD".into()));
    }
    let conn = db(&state)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {LOG_COLUMNS} WHERE date(l.created_at, 'localtime') = ?1 ORDER BY l.created_at ASC"
    ))?;
    let logs: Vec<OpsLogRow> = stmt
        .query_map(rusqlite::params![date], log_from)?
        .filter_map(|r| r.ok())
        .collect();
    let mut stmt = conn.prepare(&format!(
        "SELECT {TODO_COLUMNS} WHERE t.due_date = ?1 ORDER BY t.done ASC, t.created_at ASC"
    ))?;
    let todos: Vec<TodoRow> = stmt
        .query_map(rusqlite::params![date], todo_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(OpsDayItems { logs, todos })
}
