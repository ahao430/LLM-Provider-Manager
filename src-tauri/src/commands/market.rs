//! 市场信息命令。

use rusqlite::Connection;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::market::{self, ChannelPriceAnnotation, MarketFx, MarketSnapshot};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| AppError::Invalid("数据库连接锁已失效".into()))
}

/// 当前市场快照：优先「抓取数据」缓存，其次内置；统一叠加国内价快照层。
#[tauri::command]
pub fn list_market_prices(state: State<'_, AppState>) -> AppResult<MarketSnapshot> {
    let conn = db(&state)?;
    market::current_snapshot(&conn)
}

/// 抓取最新市场价格（models.dev）与 USD→CNY 汇率：
/// 异步 HTTP 不持锁；汇率获取失败不影响快照（保留旧汇率）。
#[tauri::command]
pub async fn fetch_market_prices(state: State<'_, AppState>) -> AppResult<MarketSnapshot> {
    let snapshot = market::fetch::fetch_snapshot().await?; // 锁外
    let fx = market::fetch::fetch_usd_cny_rate().await; // 尽力而为
    let conn = db(&state)?;
    market::save_cached_snapshot(&conn, &snapshot)?;
    if let Some(rate) = fx {
        market::save_fx(&conn, rate)?;
    }
    Ok(snapshot)
}

/// USD → CNY 汇率（市场页币种切换折算；从未获取过为 null，前端兜底 7.20）。
#[tauri::command]
pub fn get_market_fx(state: State<'_, AppState>) -> AppResult<MarketFx> {
    let conn = db(&state)?;
    market::load_fx(&conn)
}

/// 全部渠道模型的标注价格（仅展示比较用，不含凭证等敏感信息）。
#[tauri::command]
pub fn list_channel_price_annotations(
    state: State<'_, AppState>,
) -> AppResult<Vec<ChannelPriceAnnotation>> {
    let conn = db(&state)?;
    market::list_channel_price_annotations(&conn)
}
