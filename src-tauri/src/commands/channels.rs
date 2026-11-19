//! 渠道相关命令。

use rusqlite::{Connection, OptionalExtension};
use tauri::State;

use crate::channels::{
    domain::{ChannelDetail, ChannelGroupRow, ChannelInput, ChannelRow},
    repo::{self, ProviderRow},
    service,
    templates::{self, ProviderTemplate},
};
use crate::error::{AppError, AppResult};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

#[tauri::command]
pub fn list_providers(state: State<'_, AppState>) -> AppResult<Vec<ProviderRow>> {
    let conn = db(&state)?;
    repo::list_providers(&conn)
}

#[tauri::command]
pub fn provider_templates() -> Vec<ProviderTemplate> {
    templates::TEMPLATES.to_vec()
}

#[tauri::command]
pub fn list_channels(state: State<'_, AppState>) -> AppResult<Vec<ChannelRow>> {
    let conn = db(&state)?;
    service::list(&conn)
}

#[tauri::command]
pub fn get_channel(state: State<'_, AppState>, id: String) -> AppResult<ChannelDetail> {
    let conn = db(&state)?;
    service::get(&conn, &id)
}

#[tauri::command]
pub fn create_channel(state: State<'_, AppState>, input: ChannelInput) -> AppResult<ChannelRow> {
    let conn = db(&state)?;
    service::create(&conn, input)
}

#[tauri::command]
pub fn update_channel(
    state: State<'_, AppState>,
    id: String,
    input: ChannelInput,
) -> AppResult<ChannelRow> {
    let conn = db(&state)?;
    service::update(&conn, &id, input)
}

#[tauri::command]
pub fn delete_channel(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    service::delete(&conn, &id)
}

#[tauri::command]
pub fn set_channel_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> AppResult<()> {
    let conn = db(&state)?;
    service::set_enabled(&conn, &id, enabled)
}

// ------------------------------------------------------------------
// 分组与仪表盘置顶（v0.17.0）
// ------------------------------------------------------------------

#[tauri::command]
pub fn list_channel_groups(state: State<'_, AppState>) -> AppResult<Vec<ChannelGroupRow>> {
    let conn = db(&state)?;
    repo::list_groups(&conn)
}

#[tauri::command]
pub fn create_channel_group(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<ChannelGroupRow> {
    let conn = db(&state)?;
    service::create_group(&conn, &name)
}

#[tauri::command]
pub fn rename_channel_group(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<ChannelGroupRow> {
    let conn = db(&state)?;
    service::rename_group(&conn, &id, &name)
}

#[tauri::command]
pub fn delete_channel_group(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    service::delete_group(&conn, &id)
}

#[tauri::command]
pub fn set_channel_dashboard_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> AppResult<()> {
    let conn = db(&state)?;
    service::set_dashboard_pinned(&conn, &id, pinned)
}

/// 设置渠道运维状态（normal / fault / maintenance / deprecated；suspect 为前端推导态）。
#[tauri::command]
pub fn set_channel_ops_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> AppResult<()> {
    let conn = db(&state)?;
    repo::set_ops_status(&conn, &id, &status)
}

/// 保存渠道运维档案（config_json.ops；只改 ops 键，不影响其余配置）。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelOpsInput {
    pub console_url: Option<String>,
    pub contact: Option<String>,
    pub expires_at: Option<String>,
    pub key_rotation_note: Option<String>,
}

#[tauri::command]
pub fn save_channel_ops(
    state: State<'_, AppState>,
    id: String,
    ops: ChannelOpsInput,
    tls_verify: Option<bool>,
) -> AppResult<()> {
    let conn = db(&state)?;
    let mut config = repo::load_config(&conn, &id)?;
    config.ops = Some(crate::channels::domain::ChannelOps {
        console_url: ops
            .console_url
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        contact: ops
            .contact
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        expires_at: ops
            .expires_at
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        key_rotation_note: ops
            .key_rotation_note
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    });
    if let Some(v) = tls_verify {
        config.tls_verify = v;
    }
    conn.execute(
        "UPDATE channels SET config_json = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![
            id,
            serde_json::to_string(&config).map_err(|e| AppError::Invalid(e.to_string()))?,
            crate::util::now_rfc3339()
        ],
    )?;
    Ok(())
}

/// 故障事件：把一组相关失败记录聚合为一次故障（起止 / 根因），供复盘与统计。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentRow {
    pub id: String,
    pub channel_id: String,
    pub title: String,
    pub started_at: String,
    pub resolved_at: Option<String>,
    pub root_cause: Option<String>,
    pub created_at: String,
    /// 关联的失败记录数
    pub record_count: i64,
}

#[tauri::command]
pub fn create_incident(
    state: State<'_, AppState>,
    channel_id: String,
    title: String,
    trace_ids: Vec<String>,
    root_cause: Option<String>,
) -> AppResult<String> {
    if trace_ids.is_empty() {
        return Err(AppError::Invalid("请选择要归入故障的记录".into()));
    }
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("请填写故障标题".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let conn = db(&state)?;
    let now = crate::util::now_rfc3339();
    conn.execute(
        "INSERT INTO incidents (id, channel_id, title, started_at, root_cause, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?4)",
        rusqlite::params![id, channel_id, title, now, root_cause],
    )?;
    let placeholders = trace_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql =
        format!("UPDATE request_records SET incident_id = ?1 WHERE trace_id IN ({placeholders})");
    conn.execute(&sql, rusqlite::params_from_iter(trace_ids.iter()))?;
    Ok(id)
}

/// 标记故障解决（记录结束时间与根因）。
#[tauri::command]
pub fn resolve_incident(
    state: State<'_, AppState>,
    id: String,
    root_cause: Option<String>,
) -> AppResult<()> {
    let conn = db(&state)?;
    conn.execute(
        "UPDATE incidents SET resolved_at = ?2, root_cause = COALESCE(?3, root_cause) WHERE id = ?1",
        rusqlite::params![id, crate::util::now_rfc3339(), root_cause],
    )?;
    Ok(())
}

/// 故障事件列表（按渠道过滤可选；未解决在前）。
#[tauri::command]
pub fn list_incidents(
    state: State<'_, AppState>,
    channel_id: Option<String>,
) -> AppResult<Vec<IncidentRow>> {
    let conn = db(&state)?;
    let sql = match channel_id.is_some() {
        true => "SELECT i.id, i.channel_id, i.title, i.started_at, i.resolved_at, i.root_cause, i.created_at,                  (SELECT COUNT(*) FROM request_records r WHERE r.incident_id = i.id) AS record_count                  FROM incidents i WHERE i.channel_id = ?1                  ORDER BY (i.resolved_at IS NULL) DESC, i.started_at DESC",
        false => "SELECT i.id, i.channel_id, i.title, i.started_at, i.resolved_at, i.root_cause, i.created_at,                  (SELECT COUNT(*) FROM request_records r WHERE r.incident_id = i.id) AS record_count                  FROM incidents i                  ORDER BY (i.resolved_at IS NULL) DESC, i.started_at DESC",
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = match channel_id.as_deref() {
        Some(cid) => stmt
            .query_map(rusqlite::params![cid], row_incident)?
            .filter_map(|r| r.ok())
            .collect(),
        None => stmt
            .query_map([], row_incident)?
            .filter_map(|r| r.ok())
            .collect(),
    };
    Ok(rows)
}

fn row_incident(r: &rusqlite::Row) -> rusqlite::Result<IncidentRow> {
    Ok(IncidentRow {
        id: r.get(0)?,
        channel_id: r.get(1)?,
        title: r.get(2)?,
        started_at: r.get(3)?,
        resolved_at: r.get(4)?,
        root_cause: r.get(5)?,
        created_at: r.get(6)?,
        record_count: r.get(7)?,
    })
}

/// 单条记录所属故障事件（详情页徽章）。
#[tauri::command]
pub fn get_record_incident(
    state: State<'_, AppState>,
    trace_id: String,
) -> AppResult<Option<IncidentRow>> {
    let conn = db(&state)?;
    conn.query_row(
        "SELECT i.id, i.channel_id, i.title, i.started_at, i.resolved_at, i.root_cause, i.created_at,          (SELECT COUNT(*) FROM request_records r WHERE r.incident_id = i.id) AS record_count          FROM request_records r JOIN incidents i ON i.id = r.incident_id WHERE r.trace_id = ?1",
        rusqlite::params![trace_id],
        row_incident,
    )
    .optional()
    .map_err(AppError::from)
}
