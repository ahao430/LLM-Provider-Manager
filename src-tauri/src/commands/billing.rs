//! 资金与账单命令：充值 / 账单 / 余额快照的 CRUD 与渠道资金汇总。

use rusqlite::Connection;
use tauri::State;

use crate::billing::repo::{self, BillRow, ChannelFunds, RechargeInput, RechargeRow, SnapshotRow};
use crate::error::AppResult;
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

#[tauri::command]
pub fn list_recharges(
    state: State<'_, AppState>,
    channel_id: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<RechargeRow>> {
    let conn = db(&state)?;
    repo::list_recharges(&conn, channel_id.as_deref(), limit.unwrap_or(200).min(2000))
}

#[tauri::command]
pub fn add_recharge(state: State<'_, AppState>, input: RechargeInput) -> AppResult<String> {
    let conn = db(&state)?;
    repo::insert_recharge(&conn, &input)
}

#[tauri::command]
pub fn update_recharge(
    state: State<'_, AppState>,
    id: String,
    input: RechargeInput,
) -> AppResult<()> {
    let conn = db(&state)?;
    repo::update_recharge(&conn, &id, &input)
}

#[tauri::command]
pub fn delete_recharge(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete_recharge(&conn, &id)
}

#[tauri::command]
pub fn list_bills(
    state: State<'_, AppState>,
    channel_id: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<BillRow>> {
    let conn = db(&state)?;
    repo::list_bills(&conn, channel_id.as_deref(), limit.unwrap_or(200).min(2000))
}

#[tauri::command]
pub fn add_bill(
    state: State<'_, AppState>,
    channel_id: String,
    billing_period: String,
    amount: f64,
    currency: String,
    source: Option<String>,
    notes: Option<String>,
) -> AppResult<String> {
    let conn = db(&state)?;
    repo::insert_bill(
        &conn,
        &channel_id,
        &billing_period,
        amount,
        &currency,
        source.as_deref().unwrap_or("manual"),
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn update_bill(
    state: State<'_, AppState>,
    id: String,
    amount: f64,
    notes: Option<String>,
) -> AppResult<()> {
    let conn = db(&state)?;
    repo::update_bill(&conn, &id, amount, notes.as_deref())
}

#[tauri::command]
pub fn delete_bill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete_bill(&conn, &id)
}

#[tauri::command]
pub fn list_balance_snapshots(
    state: State<'_, AppState>,
    channel_id: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<SnapshotRow>> {
    let conn = db(&state)?;
    repo::list_snapshots(&conn, channel_id.as_deref(), limit.unwrap_or(200).min(2000))
}

#[tauri::command]
pub fn add_balance_snapshot(
    state: State<'_, AppState>,
    channel_id: String,
    balance: f64,
    currency: String,
    captured_at: String,
    notes: Option<String>,
) -> AppResult<String> {
    let conn = db(&state)?;
    repo::insert_snapshot(
        &conn,
        &channel_id,
        balance,
        &currency,
        &captured_at,
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn delete_balance_snapshot(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete_snapshot(&conn, &id)
}

/// 渠道资金汇总：充值 / 账单 / 快照 / 估算余额。
#[tauri::command]
pub fn get_channel_funds(
    state: State<'_, AppState>,
    channel_id: String,
) -> AppResult<ChannelFunds> {
    let conn = db(&state)?;
    repo::channel_funds(&conn, &channel_id)
}
