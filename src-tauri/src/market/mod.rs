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
    /// 低谷时段折扣价（deepseek / 智谱等分时段计费）；旧快照无此字段
    #[serde(default)]
    pub off_peak: Option<OffPeakPrice>,
}

/// 低谷（分时段）价格：window 描述时段（如「00:30–08:30 UTC+8」），
/// 三项价格与主价同币种；None = 该项不分时段。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OffPeakPrice {
    pub window: String,
    pub input_per_1m: Option<f64>,
    pub cached_input_per_1m: Option<f64>,
    pub output_per_1m: Option<f64>,
}

/// 内置快照（编译期打包，进程内只解析一次）。
static SNAPSHOT: LazyLock<MarketSnapshot> = LazyLock::new(|| {
    serde_json::from_str(include_str!("data.json")).expect("内置市场数据 data.json 解析失败")
});

/// 国内价快照叠加层（data_cn.json，人工维护 + `pnpm market:cn-refresh` 官网抓取辅助刷新）。
/// models.dev 只有折算 USD；国内厂商官方以 CNY 计价（部分还有低谷分时段价），
/// 本层在读取时叠加：renames 改海外版名、replacements 整体替换为 CNY 版、additions 补国内条。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CnOverlay {
    snapshot_date: String,
    #[serde(default)]
    renames: std::collections::HashMap<String, String>,
    #[serde(default)]
    replacements: std::collections::HashMap<String, MarketProvider>,
    #[serde(default)]
    additions: Vec<MarketProvider>,
}

static CN_OVERLAY: LazyLock<CnOverlay> = LazyLock::new(|| {
    serde_json::from_str(include_str!("data_cn.json")).expect("国内价快照 data_cn.json 解析失败")
});

pub fn snapshot() -> &'static MarketSnapshot {
    &SNAPSHOT
}

/// 把国内价叠加层合并进基础快照（纯函数）：
/// renames → replacements（按 id 替换）→ additions（`*_cn` 双定价条插到对应海外版之后）。
fn merge_cn_snapshot(mut base: MarketSnapshot) -> MarketSnapshot {
    let overlay = &*CN_OVERLAY;
    for p in base.providers.iter_mut() {
        if let Some(name) = overlay.renames.get(&p.id) {
            p.name = name.clone();
        }
        if let Some(repl) = overlay.replacements.get(&p.id) {
            *p = repl.clone();
        }
    }
    for add in &overlay.additions {
        // 双定价国内条紧挨海外版（id 去掉 _cn 后缀即锚点）
        let anchor = add.id.strip_suffix("_cn").unwrap_or(&add.id);
        let pos = base
            .providers
            .iter()
            .position(|p| p.id == anchor)
            .map(|i| i + 1)
            .unwrap_or(base.providers.len());
        base.providers.insert(pos, add.clone());
    }
    base.source = format!("{} + cn/{}", base.source, overlay.snapshot_date);
    base
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

/// 当前展示的快照：优先抓取缓存，其次内置；统一叠加国内价快照层。
pub fn current_snapshot(conn: &Connection) -> AppResult<MarketSnapshot> {
    let base = match load_cached_snapshot(conn)? {
        Some(cached) => cached,
        None => snapshot().clone(),
    };
    Ok(merge_cn_snapshot(base))
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

// ------------------------------------------------------------------
// 汇率缓存（market_fx 单行表；只做展示折算，绝不相加金额）
// ------------------------------------------------------------------

/// USD → CNY 汇率（抓取数据时顺带更新；从未成功过为 None，前端兜底 7.20）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketFx {
    pub rate: Option<f64>,
    pub fetched_at: Option<String>,
}

pub fn load_fx(conn: &Connection) -> AppResult<MarketFx> {
    let row = conn
        .query_row(
            "SELECT rate, fetched_at FROM market_fx WHERE id = 1",
            [],
            |r| {
                Ok(MarketFx {
                    rate: r.get(0)?,
                    fetched_at: r.get(1)?,
                })
            },
        )
        .optional()?;
    Ok(row.unwrap_or(MarketFx {
        rate: None,
        fetched_at: None,
    }))
}

pub fn save_fx(conn: &Connection, rate: f64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO market_fx (id, rate, fetched_at) VALUES (1, ?1, ?2) \
         ON CONFLICT(id) DO UPDATE SET rate = ?1, fetched_at = ?2",
        params![rate, crate::util::now_rfc3339()],
    )?;
    Ok(())
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
    fn cn_overlay_replaces_adds_and_renames() {
        let merged = merge_cn_snapshot(snapshot().clone());
        // source 标注叠加层
        assert!(merged.source.contains("+ cn/"), "source={}", merged.source);

        let find = |id: &str| merged.providers.iter().position(|p| p.id == id);

        // deepseek 被替换为 CNY 版（models.dev 原始为 USD）
        let ds = &merged.providers[find("deepseek").expect("deepseek 应存在")];
        assert!(
            ds.models.iter().all(|m| m.currency == "CNY"),
            "应为 CNY 计价"
        );
        assert!(ds.models.iter().any(|m| m.off_peak.is_some()), "应有低谷价");

        // 双定价：zhipuai 改名海外 + zhipuai_cn 紧随其后；minimax 同理
        let zi = find("zhipuai").expect("zhipuai 海外版应保留");
        assert!(merged.providers[zi].name.contains("海外"));
        assert_eq!(find("zhipuai_cn"), Some(zi + 1), "国内条应紧随海外版");
        let mi = find("minimax").expect("minimax 海外版应保留");
        assert!(merged.providers[mi].name.contains("海外"));
        assert_eq!(find("minimax_cn"), Some(mi + 1));

        // 全球厂商不受影响
        assert!(find("openai").is_some());
    }

    #[test]
    fn off_peak_field_is_backward_compatible() {
        // 旧缓存快照没有 offPeak 字段，serde(default) 应照常解析
        let old = r#"{"model":"m","modelType":"text","inputPer1m":1.0,
            "cachedInputPer1m":null,"outputPer1m":2.0,"currency":"USD","note":null}"#;
        let m: MarketModel = serde_json::from_str(old).expect("旧快照应可解析");
        assert!(m.off_peak.is_none());
        // 带低谷价的新格式
        let new = r#"{"model":"m","modelType":"text","inputPer1m":2.0,
            "cachedInputPer1m":0.04,"outputPer1m":8.0,"currency":"CNY","note":null,
            "offPeak":{"window":"工作日高峰外","inputPer1m":1.0,
            "cachedInputPer1m":0.02,"outputPer1m":4.0}}"#;
        let m: MarketModel = serde_json::from_str(new).unwrap();
        let op = m.off_peak.expect("应有低谷价");
        assert_eq!(op.input_per_1m, Some(1.0));
    }

    #[test]
    fn fx_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::migrations::run(&conn).unwrap();
        assert!(load_fx(&conn).unwrap().rate.is_none());
        save_fx(&conn, 7.23).unwrap();
        let fx = load_fx(&conn).unwrap();
        assert_eq!(fx.rate, Some(7.23));
        assert!(fx.fetched_at.is_some());
    }

    #[test]
    fn market_cache_roundtrip_and_priority() {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::migrations::run(&conn).unwrap();

        // 无缓存 → 内置快照（叠加国内层后 source 带标注）
        assert!(load_cached_snapshot(&conn).unwrap().is_none());
        let current = current_snapshot(&conn).unwrap();
        assert!(
            current.source.starts_with("bundled"),
            "source={}",
            current.source
        );

        // 覆盖保存后 → 缓存优先（同样叠加国内层）
        let mut fetched = snapshot().clone();
        fetched.source = "models.dev".into();
        fetched.fetched_at = Some("2026-11-18T00:00:00Z".into());
        save_cached_snapshot(&conn, &fetched).unwrap();
        let cached = current_snapshot(&conn).unwrap();
        assert!(
            cached.source.starts_with("models.dev"),
            "source={}",
            cached.source
        );
        assert_eq!(cached.fetched_at.as_deref(), Some("2026-11-18T00:00:00Z"));

        // 再覆盖一次仍为单行
        save_cached_snapshot(&conn, &fetched).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM market_cache", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }
}
