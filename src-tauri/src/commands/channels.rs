//! 渠道相关命令。

use rusqlite::Connection;
use tauri::State;

use crate::channels::{
    domain::{ChannelDetail, ChannelGroupRow, ChannelInput, ChannelRow},
    repo::{self, ProviderRow},
    service,
    templates::{self, ProviderTemplate},
};
use crate::error::AppResult;
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
