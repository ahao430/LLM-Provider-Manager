//! 市场信息命令。

use rusqlite::Connection;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::market::{self, ChannelPriceAnnotation, MarketSnapshot};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| AppError::Invalid("数据库连接锁已失效".into()))
}

/// 当前市场快照：优先「抓取数据」缓存，其次内置。
#[tauri::command]
pub fn list_market_prices(state: State<'_, AppState>) -> AppResult<MarketSnapshot> {
    let conn = db(&state)?;
    market::current_snapshot(&conn)
}

/// 抓取最新市场价格（models.dev）：异步 HTTP 不持锁，完成后写入缓存并返回。
#[tauri::command]
pub async fn fetch_market_prices(state: State<'_, AppState>) -> AppResult<MarketSnapshot> {
    let snapshot = market::fetch::fetch_snapshot().await?; // 锁外
    let conn = db(&state)?;
    market::save_cached_snapshot(&conn, &snapshot)?;
    Ok(snapshot)
}

/// 全部渠道模型的标注价格（仅展示比较用，不含凭证等敏感信息）。
#[tauri::command]
pub fn list_channel_price_annotations(
    state: State<'_, AppState>,
) -> AppResult<Vec<ChannelPriceAnnotation>> {
    let conn = db(&state)?;
    market::list_channel_price_annotations(&conn)
}
