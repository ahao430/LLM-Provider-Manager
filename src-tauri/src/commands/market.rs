//! 市场信息命令。

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::market::sources::{MarketSourceInput, MarketSourceRow};
use crate::market::{self, sources, ChannelPriceAnnotation, MarketFx, MarketSnapshot};
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

// ------------------------------------------------------------------
// 自定义市场数据源（v0.25.0）
// ------------------------------------------------------------------

/// 列出全部市场数据源（内置只读在前）。
#[tauri::command]
pub fn list_market_sources(state: State<'_, AppState>) -> AppResult<Vec<MarketSourceRow>> {
    let conn = db(&state)?;
    sources::list_market_sources(&conn)
}

/// 新增 / 编辑源（builtin 拒绝编辑）。
#[tauri::command]
pub fn save_market_source(
    state: State<'_, AppState>,
    input: MarketSourceInput,
) -> AppResult<String> {
    let conn = db(&state)?;
    sources::upsert_market_source(&conn, &input)
}

/// 删除源（builtin 拒绝；缓存级联删除）。
#[tauri::command]
pub fn delete_market_source(state: State<'_, AppState>, source_id: String) -> AppResult<()> {
    let conn = db(&state)?;
    sources::delete_market_source(&conn, &source_id)
}

/// 切换源启用状态（停用后其快照不再并入市场展示）。
#[tauri::command]
pub fn toggle_market_source(
    state: State<'_, AppState>,
    source_id: String,
    enabled: bool,
) -> AppResult<()> {
    let conn = db(&state)?;
    sources::set_source_enabled(&conn, &source_id, enabled)
}

/// 抓取市场数据源：NewAPI 类走 /api/pricing，builtin_apiprice 走开放数据端点；
/// 其余内置源（models.dev / 国内叠加层）由市场页「抓取数据」按钮统一处理。
/// 异步 HTTP 不持锁；favicon 失败不影响价格抓取。
#[tauri::command]
pub async fn fetch_market_source(
    state: State<'_, AppState>,
    source_id: String,
) -> AppResult<MarketSnapshot> {
    // 内置汇总源 apiprice：单独分派（端点固定，无 favicon 概念）
    if source_id == "builtin_apiprice" {
        let snapshot = sources::fetch_apiprice(&source_id, "apiprice.app").await?;
        let conn = db(&state)?;
        sources::save_source_cache(&conn, &source_id, &snapshot)?;
        return Ok(snapshot);
    }

    // 锁内先读源配置（base_url / 名称），锁外做 HTTP
    let (name, page_url) = {
        let conn = db(&state)?;
        let row: (String, String, i64) = conn
            .query_row(
                "SELECT name, base_url, builtin FROM market_sources WHERE id = ?1",
                rusqlite::params![source_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| AppError::Invalid("源不存在".into()))?;
        if row.2 == 1 {
            return Err(AppError::Invalid("内置源由「抓取数据」按钮统一抓取".into()));
        }
        if sources::origin_of(&row.1).is_err() {
            return Err(AppError::Invalid("页面地址无效（须为 http(s) URL）".into()));
        }
        (row.0, row.1)
    };
    let snapshot = sources::fetch_newapi_pricing(&page_url, &source_id, &name).await?;
    let favicon = sources::fetch_favicon(&page_url).await;

    let conn = db(&state)?;
    sources::save_source_cache(&conn, &source_id, &snapshot)?;
    if let Some(data) = favicon {
        sources::save_source_icon(&conn, &source_id, &data)?;
    }
    Ok(snapshot)
}

/// 国内厂商官网价明细（data_cn 叠加层每家厂商的官网链接与条目数），
/// 供设置页「国内官网价」分区逐家展示。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CnVendorRow {
    pub name: String,
    pub pricing_url: String,
    pub model_count: usize,
}

#[tauri::command]
pub fn list_cn_vendors() -> Vec<CnVendorRow> {
    crate::market::cn_vendors()
        .into_iter()
        .map(|(name, url, count)| CnVendorRow {
            name,
            pricing_url: url,
            model_count: count,
        })
        .collect()
}
