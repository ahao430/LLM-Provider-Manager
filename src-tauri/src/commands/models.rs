//! 模型与价格相关命令。

use rusqlite::Connection;
use tauri::State;

use crate::channels::domain::{ChannelModelInput, ChannelModelRow};
use crate::error::{AppError, AppResult};
use crate::models::domain::{
    AddPriceInput, EffectivePrice, GlobalModelRow, ImportOutcome, ModelPriceRow, RemoteModelList,
};
use crate::models::fetch::{self, FetchTarget};
use crate::models::service::ImportItem;
use crate::models::{repo, service};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

/// 今天（本地时区）日期，用于生效价格与历史保护。
fn today() -> String {
    chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string()
}

// ------------------------------------------------------------------
// 全局模型
// ------------------------------------------------------------------

#[tauri::command]
pub fn list_global_models(state: State<'_, AppState>) -> AppResult<Vec<GlobalModelRow>> {
    let conn = db(&state)?;
    repo::list_global_models(&conn)
}

#[tauri::command]
pub fn create_global_model(
    state: State<'_, AppState>,
    name: String,
    family: Option<String>,
) -> AppResult<GlobalModelRow> {
    let conn = db(&state)?;
    let name = name.trim();
    if name.is_empty() {
        return Err(crate::error::AppError::Invalid("模型名称不能为空".into()));
    }
    if repo::find_global_model_by_name(&conn, name)?.is_some() {
        return Err(crate::error::AppError::Invalid(format!(
            "全局模型「{name}」已存在"
        )));
    }
    let id = repo::insert_global_model(&conn, name, family.as_deref())?;
    Ok(GlobalModelRow {
        id,
        name: name.to_string(),
        family,
        notes: None,
        created_at: crate::util::now_rfc3339(),
        updated_at: crate::util::now_rfc3339(),
        channel_model_count: 0,
    })
}

#[tauri::command]
pub fn rename_global_model(
    state: State<'_, AppState>,
    id: String,
    name: String,
    family: Option<String>,
) -> AppResult<()> {
    let conn = db(&state)?;
    let name = name.trim();
    if name.is_empty() {
        return Err(crate::error::AppError::Invalid("模型名称不能为空".into()));
    }
    repo::rename_global_model(&conn, &id, name, family.as_deref())
}

#[tauri::command]
pub fn delete_global_model(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete_global_model(&conn, &id)
}

// ------------------------------------------------------------------
// 渠道模型
// ------------------------------------------------------------------

#[tauri::command]
pub fn list_channel_models(
    state: State<'_, AppState>,
    channel_id: String,
) -> AppResult<Vec<ChannelModelRow>> {
    let conn = db(&state)?;
    repo::list_channel_models(&conn, &channel_id)
}

#[tauri::command]
pub fn upsert_channel_model(
    state: State<'_, AppState>,
    input: ChannelModelInput,
) -> AppResult<ChannelModelRow> {
    let conn = db(&state)?;
    service::upsert_channel_model(&conn, &input)
}

#[tauri::command]
pub fn delete_channel_model(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete_channel_model(&conn, &id)
}

/// 全渠道模型平铺（模型列表页按模型聚合用）。
#[tauri::command]
pub fn list_all_channel_models(
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::channels::domain::AllChannelModelRow>> {
    let conn = db(&state)?;
    repo::list_all_channel_models(&conn)
}

// ------------------------------------------------------------------
// 模型列表获取与导入
// ------------------------------------------------------------------

/// 获取渠道远端模型列表（异步 HTTP，不持有数据库锁）。
#[tauri::command]
pub async fn fetch_channel_model_list(
    state: State<'_, AppState>,
    channel_id: String,
) -> AppResult<RemoteModelList> {
    let target: FetchTarget = {
        let conn = db(&state)?;
        fetch::prepare(&conn, &channel_id)?
    }; // 锁在此释放
    let mut list = fetch::perform(target).await?;

    // 上下架 diff 基线：读上次获取快照（锁内），并把本次成功结果写成新快照（每渠道只留最新一条）
    let previous_ids: Option<Vec<String>> = {
        let conn = db(&state)?;
        let prev: Option<String> = conn
            .query_row(
                "SELECT model_ids_json FROM channel_model_fetches channel_model_fetches_ WHERE channel_id = ?1",
                rusqlite::params![channel_id],
                |r| r.get(0),
            )
            .ok();
        let prev: Option<Vec<String>> = prev.and_then(|json| serde_json::from_str(&json).ok());
        let ids_json =
            serde_json::to_string(&list.models.iter().map(|m| m.id.clone()).collect::<Vec<_>>())
                .map_err(|e| AppError::Invalid(e.to_string()))?;
        conn.execute(
            "INSERT INTO channel_model_fetches (channel_id, fetched_at, model_ids_json) VALUES (?1, ?2, ?3)",
            rusqlite::params![channel_id, crate::util::now_rfc3339(), ids_json],
        )?;
        conn.execute(
            "DELETE FROM channel_model_fetches WHERE channel_id = ?1 AND id NOT IN (SELECT id FROM channel_model_fetches WHERE channel_id = ?1 ORDER BY id DESC LIMIT 1)",
            rusqlite::params![channel_id],
        )?;
        prev
    };
    list.previous_ids = previous_ids;
    Ok(list)
}

#[tauri::command]
pub fn import_channel_models(
    state: State<'_, AppState>,
    channel_id: String,
    items: Vec<ImportItem>,
) -> AppResult<ImportOutcome> {
    let conn = db(&state)?;
    service::import_channel_models(&conn, &channel_id, &items)
}

// ------------------------------------------------------------------
// 价格
// ------------------------------------------------------------------

#[tauri::command]
pub fn list_model_prices(
    state: State<'_, AppState>,
    channel_model_id: String,
) -> AppResult<Vec<ModelPriceRow>> {
    let conn = db(&state)?;
    repo::list_prices(&conn, &channel_model_id)
}

#[tauri::command]
pub fn get_effective_price(
    state: State<'_, AppState>,
    channel_model_id: String,
) -> AppResult<Option<EffectivePrice>> {
    let conn = db(&state)?;
    service::effective_price(&conn, &channel_model_id, &today())
}

#[tauri::command]
pub fn add_model_price(state: State<'_, AppState>, input: AddPriceInput) -> AppResult<String> {
    let conn = db(&state)?;
    service::add_price(&conn, &input)
}

#[tauri::command]
pub fn delete_model_price(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    service::delete_price(&conn, &id, &today())
}
