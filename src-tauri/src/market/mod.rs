//! 市场信息：各厂商模型价格快照（只读参考数据）。
//!
//! - 内置快照随应用打包（data.json，可用 `pnpm market:refresh` 脚本刷新）；
//!   「抓取数据」按钮实时拉取 models.dev 并存入 market_cache，展示优先用缓存。
//! - 价格以各官网价格页为准；与渠道模型「标注价格」配合并排展示供比较。
//! - 与 model_prices（价格历史 / 费用估算）完全独立，互不影响。

pub mod fetch;

use std::sync::LazyLock;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSnapshot {
    /// 数据快照日期（YYYY-MM），标注数据新旧程度
    pub snapshot_date: String,
    /// 数据来源：bundled（内置）或 models.dev（抓取）
    #[serde(default)]
    pub source: String,
    /// 抓取时间（RFC3339）；内置快照为打包前生成时间
    #[serde(default)]
    pub fetched_at: Option<String>,
    pub providers: Vec<MarketProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketProvider {
    pub id: String,
    pub name: String,
    /// global / cn
    pub region: String,
    /// 官方价格页（跳转查看最新价）
    pub pricing_url: String,
    pub models: Vec<MarketModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketModel {
    /// 模型 ID（与渠道模型 actualModelId 对齐，用于比较匹配）
    pub model: String,
    /// multimodal / image / text / decision
    pub model_type: String,
    /// 每百万 token 输入价；null = 按张计费或不公开
    pub input_per_1m: Option<f64>,
    /// 每百万 token 缓存输入价
    pub cached_input_per_1m: Option<f64>,
    pub output_per_1m: Option<f64>,
    /// USD / CNY
    pub currency: String,
    pub note: Option<String>,
}

/// 内置快照（编译期打包，进程内只解析一次）。
static SNAPSHOT: LazyLock<MarketSnapshot> = LazyLock::new(|| {
    serde_json::from_str(include_str!("data.json")).expect("内置市场数据 data.json 解析失败")
});

pub fn snapshot() -> &'static MarketSnapshot {
    &SNAPSHOT
}

// ------------------------------------------------------------------
// 抓取缓存（market_cache 单行表）
// ------------------------------------------------------------------

/// 读取已抓取的快照；从未抓取返回 None（调用方回退内置快照）。
pub fn load_cached_snapshot(conn: &Connection) -> AppResult<Option<MarketSnapshot>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT snapshot_json FROM market_cache WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    json.as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Invalid(format!("市场快照缓存解析失败: {e}")))
}

/// 覆盖保存抓取的快照（单行）。
pub fn save_cached_snapshot(conn: &Connection, snapshot: &MarketSnapshot) -> AppResult<()> {
    let json = serde_json::to_string(snapshot)
        .map_err(|e| AppError::Invalid(format!("市场快照序列化失败: {e}")))?;
    conn.execute(
        "INSERT INTO market_cache (id, snapshot_json, source, fetched_at) VALUES (1, ?1, ?2, ?3) \
         ON CONFLICT(id) DO UPDATE SET snapshot_json = ?1, source = ?2, fetched_at = ?3",
        params![
            json,
            snapshot.source,
            snapshot.fetched_at.clone().unwrap_or_default()
        ],
    )?;
    Ok(())
}

/// 当前展示的快照：优先抓取缓存，其次内置。
pub fn current_snapshot(conn: &Connection) -> AppResult<MarketSnapshot> {
    if let Some(cached) = load_cached_snapshot(conn)? {
        return Ok(cached);
    }
    Ok(snapshot().clone())
}

/// 渠道模型标注价（只返回已标注的行），供市场页并排比较。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPriceAnnotation {
    pub channel_id: String,
    pub channel_name: String,
    pub channel_model_id: String,
    pub actual_model_id: String,
    pub model_name: Option<String>,
    /// 每百万 token 标注价（仅展示比较，不参与任何费用计算）
    pub price_input_per_1m: Option<f64>,
    pub price_output_per_1m: Option<f64>,
    pub price_currency: String,
}

pub fn list_channel_price_annotations(conn: &Connection) -> AppResult<Vec<ChannelPriceAnnotation>> {
    let mut stmt = conn.prepare(
        "SELECT cm.channel_id, c.name, cm.id, cm.actual_model_id, m.name, \
         cm.price_input_per_1m, cm.price_output_per_1m, cm.price_currency \
         FROM channel_models cm \
         JOIN channels c ON c.id = cm.channel_id \
         LEFT JOIN models m ON m.id = cm.model_id \
         WHERE cm.price_input_per_1m IS NOT NULL OR cm.price_output_per_1m IS NOT NULL \
         ORDER BY c.name, cm.actual_model_id",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ChannelPriceAnnotation {
                channel_id: row.get(0)?,
                channel_name: row.get(1)?,
                channel_model_id: row.get(2)?,
                actual_model_id: row.get(3)?,
                model_name: row.get(4)?,
                price_input_per_1m: row.get(5)?,
                price_output_per_1m: row.get(6)?,
                price_currency: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn snapshot_is_wellformed() {
        let snap = snapshot();
        assert!(!snap.snapshot_date.is_empty());
        assert!(snap.providers.len() >= 8, "应至少内置 8 家厂商");
        for p in &snap.providers {
            assert!(!p.models.is_empty(), "{} 无模型", p.name);
            assert!(
                p.pricing_url.starts_with("https://"),
                "{} 缺价格页链接",
                p.name
            );
            for m in &p.models {
                assert!(
                    ["multimodal", "image", "text", "decision"].contains(&m.model_type.as_str()),
                    "{} 类型非法",
                    m.model
                );
                assert!(["USD", "CNY"].contains(&m.currency.as_str()));
            }
        }
    }

    #[test]
    fn market_cache_roundtrip_and_priority() {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::migrations::run(&conn).unwrap();

        // 无缓存 → 内置快照
        assert!(load_cached_snapshot(&conn).unwrap().is_none());
        let current = current_snapshot(&conn).unwrap();
        assert_eq!(current.source, "bundled");

        // 覆盖保存后 → 缓存优先
        let mut fetched = snapshot().clone();
        fetched.source = "models.dev".into();
        fetched.fetched_at = Some("2026-11-18T00:00:00Z".into());
        save_cached_snapshot(&conn, &fetched).unwrap();
        let cached = current_snapshot(&conn).unwrap();
        assert_eq!(cached.source, "models.dev");
        assert_eq!(cached.fetched_at.as_deref(), Some("2026-11-18T00:00:00Z"));

        // 再覆盖一次仍为单行
        save_cached_snapshot(&conn, &fetched).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM market_cache", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }
}
