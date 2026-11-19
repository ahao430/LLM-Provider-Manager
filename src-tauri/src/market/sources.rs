//! 自定义市场数据源：NewAPI 类站点「模型广场」价格抓取。
//!
//! NewAPI（Calcium-Ion/new-api 及其衍生）暴露机器可读的 `/api/pricing` 接口，含
//! `data[]{model_name, quota_type, model_ratio, model_price, completion_ratio, cache_ratio, enable_groups}`
//! 与 `group_ratio{group: ratio}`。计费惯例：1 倍率 = $0.002/1K token = **$2/1M token**（USD 基准），
//! 输出另有 completion_ratio 倍率。
//!
//! 本模块把倍率折算为「USD 每百万 token」估算价并在 note 标注口径；与内置快照 /
//! 国内价叠加层一样只做展示参考，不参与费用估算。

use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

use super::{MarketModel, MarketProvider, MarketSnapshot};

/// NewAPI 倍率基准：1 ratio = $2 / 百万 token（即 $0.002/1K）。
pub const RATIO_USD_PER_1M: f64 = 2.0;

// ------------------------------------------------------------------
// 源配置 CRUD（market_sources 表；builtin 行只读）
// ------------------------------------------------------------------

/// 一条市场数据源。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSourceRow {
    pub id: String,
    pub name: String,
    /// newapi / sub2api（TODO）/ builtin（内置只读）
    pub kind: String,
    /// 模型广场页面地址（展示与跳转）；内置 models.dev 源为其站点地址
    pub base_url: String,
    pub enabled: bool,
    pub builtin: bool,
    /// 站点 favicon（data URL；抓取时顺带保存，None 用字母回退）
    pub icon_data: Option<String>,
    /// 该源最近一次抓取的模型条数（无 cache 为 None）
    pub cached_model_count: Option<i64>,
    /// 该源最近一次抓取时间（RFC3339；无 cache 为 None）
    pub fetched_at: Option<String>,
}

/// 新增 / 编辑源的输入。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSourceInput {
    /// 编辑时提供，新建为 None（后端生成 UUID）
    pub id: Option<String>,
    pub name: String,
    /// newapi / sub2api；builtin 由种子维护，不接受外部写入
    pub kind: String,
    /// 模型广场页面地址（如 https://yiz.bjkhdf.cn/pricing）
    pub base_url: String,
    #[serde(default)]
    pub enabled: Option<bool>,
}

fn row_from(
    row: &rusqlite::Row,
    cached_model_count: Option<i64>,
    fetched_at: Option<String>,
) -> rusqlite::Result<MarketSourceRow> {
    Ok(MarketSourceRow {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        base_url: row.get(3)?,
        enabled: row.get::<_, i64>(4)? != 0,
        builtin: row.get::<_, i64>(5)? != 0,
        icon_data: row.get(6)?,
        cached_model_count,
        fetched_at,
    })
}

/// 列出全部源（内置在前，按名称排序），附各自缓存状态。
pub fn list_market_sources(conn: &Connection) -> AppResult<Vec<MarketSourceRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.kind, s.base_url, s.enabled, s.builtin, s.icon_data, \
         c.model_count, c.fetched_at \
         FROM market_sources s \
         LEFT JOIN (SELECT source_id, json_array_length(json_extract(snapshot_json, '$.providers')) \
                    AS model_count, fetched_at FROM market_source_cache) c \
           ON c.source_id = s.id \
         ORDER BY s.builtin DESC, s.name COLLATE NOCASE",
    )?;
    // 注意：json_extract('$.providers') 是数组，json_array_length 返回条数；无 cache 时 c.* 全空
    let rows = stmt
        .query_map([], |row| {
            let count: Option<i64> = row.get(7).ok();
            let fetched: Option<String> = row.get(8).ok();
            row_from(row, count, fetched)
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// 保存源（新增或编辑；builtin 不可编辑）。
pub fn upsert_market_source(conn: &Connection, input: &MarketSourceInput) -> AppResult<String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("源名称不能为空".into()));
    }
    let base_url = input.base_url.trim();
    if base_url.is_empty() {
        return Err(AppError::Invalid("模型广场页面地址不能为空".into()));
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err(AppError::Invalid("页面地址须以 http(s):// 开头".into()));
    }
    let kind = input.kind.trim();
    if kind != "newapi" && kind != "sub2api" {
        return Err(AppError::Invalid("不支持的源类型".into()));
    }
    match &input.id {
        Some(id) => {
            let builtin: Option<i64> = conn
                .query_row(
                    "SELECT builtin FROM market_sources WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            match builtin {
                None => return Err(AppError::Invalid("源不存在".into())),
                Some(1) => return Err(AppError::Invalid("内置源不可编辑".into())),
                _ => {}
            }
            conn.execute(
                "UPDATE market_sources SET name = ?2, kind = ?3, base_url = ?4, enabled = ?5 \
                 WHERE id = ?1",
                params![
                    id,
                    name,
                    kind,
                    base_url,
                    input.enabled.unwrap_or(true) as i64
                ],
            )?;
            Ok(id.clone())
        }
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO market_sources (id, name, kind, base_url, enabled, builtin, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
                params![
                    id,
                    name,
                    kind,
                    base_url,
                    input.enabled.unwrap_or(true) as i64,
                    now_rfc3339()
                ],
            )?;
            Ok(id)
        }
    }
}

/// 删除源（builtin 拒绝）；缓存随外键级联删除。
pub fn delete_market_source(conn: &Connection, id: &str) -> AppResult<()> {
    let builtin: Option<i64> = conn
        .query_row(
            "SELECT builtin FROM market_sources WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;
    match builtin {
        None => return Err(AppError::Invalid("源不存在".into())),
        Some(1) => return Err(AppError::Invalid("内置源不可删除".into())),
        _ => {}
    }
    conn.execute("DELETE FROM market_sources WHERE id = ?1", params![id])?;
    Ok(())
}

/// 启用 / 停用源（停用后其快照不再并入市场展示）。
pub fn set_source_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    let builtin: Option<i64> = conn
        .query_row(
            "SELECT builtin FROM market_sources WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;
    if builtin.is_none() {
        return Err(AppError::Invalid("源不存在".into()));
    }
    conn.execute(
        "UPDATE market_sources SET enabled = ?2 WHERE id = ?1",
        params![id, enabled as i64],
    )?;
    Ok(())
}

/// 保存源图标（favicon data URL）。
pub fn save_source_icon(conn: &Connection, id: &str, icon_data: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE market_sources SET icon_data = ?2 WHERE id = ?1",
        params![id, icon_data],
    )?;
    Ok(())
}

/// 保存源抓取缓存（整份快照 JSON，providers 单条）。
pub fn save_source_cache(
    conn: &Connection,
    source_id: &str,
    snapshot: &MarketSnapshot,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO market_source_cache (source_id, snapshot_json, fetched_at) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(source_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, \
         fetched_at = excluded.fetched_at",
        params![
            source_id,
            serde_json::to_string(snapshot)
                .map_err(|e| { AppError::Invalid(format!("源快照序列化失败: {e}")) })?,
            now_rfc3339()
        ],
    )?;
    Ok(())
}

/// 读取全部「启用且有缓存」的源的 providers（合并进市场快照展示）。
pub fn load_enabled_source_providers(conn: &Connection) -> AppResult<Vec<MarketProvider>> {
    // builtin_apiprice 是「可独立抓取 / 开关」的内置汇总源（走 source 缓存机制），
    // 其余 builtin（models.dev / 国内叠加层）由「抓取数据」按钮统一走 market_cache
    let mut stmt = conn.prepare(
        "SELECT c.snapshot_json FROM market_source_cache c \
         JOIN market_sources s ON s.id = c.source_id \
         WHERE s.enabled = 1 AND (s.builtin = 0 OR s.id = 'builtin_apiprice')",
    )?;
    let jsons: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    let mut out = Vec::new();
    for json in jsons {
        match serde_json::from_str::<MarketSnapshot>(&json) {
            Ok(snap) => out.extend(snap.providers),
            Err(e) => {
                // 单个源缓存损坏不毁掉整体市场展示：跳过该源（缓存会在下次抓取时重写）
                let _ = e;
            }
        }
    }
    Ok(out)
}

// ------------------------------------------------------------------
// NewAPI 抓取与换算
// ------------------------------------------------------------------

/// 从页面地址提取站点 origin（scheme + host），非法返回错误。
pub fn origin_of(page_url: &str) -> AppResult<String> {
    let trimmed = page_url.trim();
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or_else(|| AppError::Invalid("页面地址须以 http(s):// 开头".into()))?;
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..host_end];
    if host.is_empty() {
        return Err(AppError::Invalid("页面地址缺少主机名".into()));
    }
    let scheme = if trimmed.starts_with("https://") {
        "https://"
    } else {
        "http://"
    };
    Ok(format!("{scheme}{host}"))
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("LCM/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| AppError::Invalid(format!("HTTP 客户端构建失败: {e}")))
}

/// 抓取 NewAPI `/api/pricing` 并换算为快照（一个源 = 一个 provider）。
pub async fn fetch_newapi_pricing(
    page_url: &str,
    source_id: &str,
    source_name: &str,
) -> AppResult<MarketSnapshot> {
    let origin = origin_of(page_url)?;
    let client = http_client()?;
    let api_url = format!("{origin}/api/pricing");
    let resp = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("抓取 {api_url} 失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "抓取失败：{api_url} 返回 HTTP {}",
            resp.status()
        )));
    }
    let root: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Invalid(format!("{api_url} 响应解析失败: {e}")))?;
    let provider = map_newapi_provider(&root, source_id, source_name, page_url)?;
    Ok(MarketSnapshot {
        snapshot_date: now_rfc3339()[..10].to_string(),
        source: format!("newapi:{origin}"),
        fetched_at: Some(now_rfc3339()),
        providers: vec![provider],
    })
}

/// 抓取站点 favicon 并返回 data URL（失败容忍返回 None，不报错）。
pub async fn fetch_favicon(page_url: &str) -> Option<String> {
    let origin = origin_of(page_url).ok()?;
    let client = http_client().ok()?;
    let resp = client
        .get(format!("{origin}/favicon.ico"))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > 256 * 1024 {
        return None;
    }
    // 常见三种格式按魔数判断；其余跳过（不猜 MIME）
    let mime = if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else {
        "image/x-icon"
    };
    use base64::Engine;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// NewAPI pricing JSON → MarketProvider（纯函数，换算口径见模块注释）。
pub fn map_newapi_provider(
    root: &Value,
    source_id: &str,
    source_name: &str,
    page_url: &str,
) -> AppResult<MarketProvider> {
    let entries = root
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Invalid("响应缺少 data 数组（确认是 NewAPI 类站点？）".into()))?;
    // group_ratio: {group: ratio}；usable_group 同 key 集合
    let group_ratio = root.get("group_ratio").and_then(Value::as_object);

    let mut models = Vec::new();
    for e in entries {
        let Some(name) = e.get("model_name").and_then(Value::as_str) else {
            continue;
        };
        let quota_type = e.get("quota_type").and_then(Value::as_i64).unwrap_or(0);
        let model_ratio = e.get("model_ratio").and_then(Value::as_f64).unwrap_or(0.0);
        let completion_ratio = e
            .get("completion_ratio")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let cache_ratio = e.get("cache_ratio").and_then(Value::as_f64);
        let model_price = e.get("model_price").and_then(Value::as_f64).unwrap_or(0.0);

        // 分组倍率：enable_groups ∩ group_ratio 取最小（用户最优可用分组）
        let group_factor = match (
            e.get("enable_groups").and_then(Value::as_array),
            group_ratio,
        ) {
            (Some(groups), Some(ratios)) => groups
                .iter()
                .filter_map(|g| g.as_str())
                .filter_map(|g| ratios.get(g))
                .filter_map(Value::as_f64)
                .filter(|r| *r > 0.0)
                .fold(None::<f64>, |acc, r| Some(acc.map_or(r, |a: f64| a.min(r))))
                .unwrap_or(1.0),
            _ => 1.0,
        };

        let (input, output, cached, note);
        if quota_type == 1 {
            // 按次计费：model_price = USD/次；token 价列留空，note 标注
            input = None;
            output = None;
            cached = None;
            let mut n = if model_price > 0.0 {
                format!("按次 ${model_price}/次（NewAPI 按次计费）")
            } else {
                "按次计费（价格未公开）".to_string()
            };
            if let Some(desc) = e.get("description").and_then(Value::as_str) {
                n.push_str(&format!("；{desc}"));
            }
            note = Some(n);
        } else if model_ratio <= 0.0 {
            // 倍率未配置：无价展示
            input = None;
            output = None;
            cached = None;
            note = Some("价格未公开（倍率未配置）".to_string());
        } else {
            let base = model_ratio * group_factor * RATIO_USD_PER_1M;
            input = Some(round4(base));
            // completion_ratio ≤ 0 视作与输入同价（NewAPI 默认输出同倍率）
            output = Some(round4(if completion_ratio > 0.0 {
                base * completion_ratio
            } else {
                base
            }));
            cached = cache_ratio.filter(|r| *r > 0.0).map(|r| round4(base * r));
            let ratio_note = if (group_factor - 1.0).abs() < f64::EPSILON {
                format!("NewAPI 倍率 {model_ratio}，按 $2/1M 折算估算")
            } else {
                format!("NewAPI 倍率 {model_ratio} × 分组 {group_factor}，按 $2/1M 折算估算")
            };
            note = Some(ratio_note);
        }

        let model_type = {
            let endpoints = e
                .get("supported_endpoint_types")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if endpoints.iter().any(|s| s.contains("image")) {
                "image"
            } else {
                "text"
            }
        };

        models.push(MarketModel {
            model: name.to_string(),
            model_type: model_type.to_string(),
            input_per_1m: input,
            cached_input_per_1m: cached,
            output_per_1m: output,
            currency: "USD".to_string(),
            note,
            off_peak: None,
        });
    }

    if models.is_empty() {
        return Err(AppError::Invalid("模型广场为空（data 数组无条目）".into()));
    }
    models.sort_by_key(|m| m.model.to_lowercase());
    Ok(MarketProvider {
        id: source_id.to_string(),
        name: source_name.to_string(),
        region: "custom".to_string(),
        pricing_url: page_url.to_string(),
        models,
    })
}

fn round4(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

// ------------------------------------------------------------------
// apiprice.app 汇总源（开放数据，CC BY 4.0）
// ------------------------------------------------------------------

/// apiprice 数据端点（license CC BY 4.0；cite_as 要求署名「apiprice.app (as of 日期)」）。
pub const APIPRICE_ENDPOINT: &str = "https://apiprice.app/data/prices.json";

/// apiprice provider code → 展示名（与内置快照命名习惯对齐；未知 code 原样展示）。
fn apiprice_provider_name(code: &str) -> String {
    match code {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        "google" => "Google Gemini",
        "qwen" => "阿里云百炼（通义千问）",
        "deepseek" => "DeepSeek",
        "zhipu" => "智谱 AI",
        "moonshot" => "月之暗面 Kimi",
        "bytedance" => "火山方舟（豆包）",
        "baidu" => "百度千帆（文心）",
        "tencent" => "腾讯混元",
        "minimax" => "MiniMax",
        "stepfun" => "阶跃星辰",
        "xiaomi" => "小米 MiMo",
        "mistral" => "Mistral",
        "xai" => "xAI",
        "nvidia" => "NVIDIA",
        other => other,
    }
    .to_string()
}

/// apiprice 单条价格记录（仅取所需字段；schema_version 变化时缺失字段容忍为 None）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct ApipriceEntry {
    model_id: String,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    channel: String,
    #[serde(default)]
    currency: String,
    #[serde(default)]
    input_per_1m: Option<f64>,
    #[serde(default)]
    output_per_1m: Option<f64>,
    #[serde(default)]
    cached_per_1m: Option<f64>,
    #[serde(default)]
    off_peak_input_per_1m: Option<f64>,
    #[serde(default)]
    off_peak_output_per_1m: Option<f64>,
    #[serde(default)]
    off_peak_hours: Option<String>,
    #[serde(default)]
    tier_notes: Option<String>,
    #[serde(default)]
    retired: bool,
}

/// apiprice 顶层 JSON（license / 汇率 / prices 数组）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct ApipriceDoc {
    #[serde(default)]
    prices: Vec<ApipriceEntry>,
    #[serde(default)]
    cite_as: Option<String>,
    #[serde(default)]
    generated_at: Option<String>,
}

/// 抓取 apiprice.app 开放数据并映射为快照（每厂商一个 provider，
/// 同厂商多通道条目并列成行，note 标注渠道与署名）。
pub async fn fetch_apiprice(source_id: &str, _source_name: &str) -> AppResult<MarketSnapshot> {
    let client = http_client()?;
    let resp = client
        .get(APIPRICE_ENDPOINT)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("抓取 {APIPRICE_ENDPOINT} 失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "抓取失败：{APIPRICE_ENDPOINT} 返回 HTTP {}",
            resp.status()
        )));
    }
    let doc: ApipriceDoc = resp
        .json()
        .await
        .map_err(|e| AppError::Invalid(format!("apiprice 数据解析失败: {e}")))?;
    map_apiprice(&doc, source_id)
}

/// apiprice 文档 → 快照（纯函数，便于单测；抓取只负责 HTTP）。
fn map_apiprice(doc: &ApipriceDoc, source_id: &str) -> AppResult<MarketSnapshot> {
    // 按厂商分组（保持首次出现顺序），组内按模型名 + 通道排序
    let mut order: Vec<String> = Vec::new();
    let mut groups: std::collections::HashMap<String, Vec<&ApipriceEntry>> =
        std::collections::HashMap::new();
    for e in doc.prices.iter().filter(|e| !e.retired) {
        if !groups.contains_key(&e.provider) {
            order.push(e.provider.clone());
        }
        groups.entry(e.provider.clone()).or_default().push(e);
    }

    let cite = doc.cite_as.as_deref().unwrap_or("apiprice.app");
    let mut providers = Vec::new();
    for code in order {
        let entries = &groups[&code];
        let mut models = Vec::new();
        for e in entries.iter() {
            let channel_label = match e.channel.as_str() {
                "official" => "官方价",
                "official_cn" => "国内官方价",
                "openrouter" => "OpenRouter",
                other => other,
            };
            let mut note_parts = vec![channel_label.to_string()];
            if let Some(t) = e.tier_notes.as_deref().filter(|t| !t.is_empty()) {
                note_parts.push(t.chars().take(160).collect());
            }
            note_parts.push(format!("来源 {cite} · CC BY 4.0"));
            let off_peak =
                if e.off_peak_input_per_1m.is_some() || e.off_peak_output_per_1m.is_some() {
                    Some(super::OffPeakPrice {
                        window: e
                            .off_peak_hours
                            .clone()
                            .unwrap_or_else(|| "低谷时段".into()),
                        input_per_1m: e.off_peak_input_per_1m,
                        output_per_1m: e.off_peak_output_per_1m,
                        cached_input_per_1m: None,
                    })
                } else {
                    None
                };
            models.push(MarketModel {
                model: e.model_id.clone(),
                // apiprice 无模态信息；类型先按文本（比价不受影响）
                model_type: "text".into(),
                input_per_1m: e.input_per_1m,
                cached_input_per_1m: e.cached_per_1m,
                output_per_1m: e.output_per_1m,
                currency: if e.currency.eq_ignore_ascii_case("cny") {
                    "CNY".into()
                } else {
                    "USD".into()
                },
                note: Some(note_parts.join("；")),
                off_peak,
            });
        }
        if models.is_empty() {
            continue;
        }
        models.sort_by_key(|m| m.model.clone());
        providers.push(MarketProvider {
            id: format!("{source_id}-{code}"),
            name: apiprice_provider_name(&code),
            region: "global".into(),
            pricing_url: "https://apiprice.app/zh/".into(),
            models,
        });
    }
    if providers.is_empty() {
        return Err(AppError::Invalid(
            "apiprice 数据为空（prices 数组无可用条目）".into(),
        ));
    }
    Ok(MarketSnapshot {
        snapshot_date: doc
            .generated_at
            .as_deref()
            .unwrap_or("")
            .get(..10)
            .unwrap_or("")
            .to_string(),
        source: format!("apiprice:{cite}"),
        fetched_at: Some(now_rfc3339()),
        providers,
    })
}

// ------------------------------------------------------------------
// 测试
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn newapi_ratio_conversion() {
        // 仿真实 yiz.bjkhdf.cn /api/pricing 结构
        let root = json!({
            "success": true,
            "data": [
                {
                    "model_name": "claude-opus-4-6",
                    "quota_type": 0,
                    "model_ratio": 3.5,
                    "model_price": 0,
                    "completion_ratio": 5.0,
                    "cache_ratio": 0.171428571429,
                    "enable_groups": ["gpt", "gaoyang_vip"],
                    "supported_endpoint_types": ["anthropic", "openai"]
                },
                {
                    "model_name": "gpt-image-2",
                    "quota_type": 1,
                    "model_ratio": 0,
                    "model_price": 0.2,
                    "completion_ratio": 0,
                    "enable_groups": ["gpt"],
                    "supported_endpoint_types": ["image-generation", "openai"]
                },
                {
                    "model_name": "kimi-k2.7-code",
                    "quota_type": 0,
                    "model_ratio": 3.25,
                    "model_price": 0,
                    "completion_ratio": 0,
                    "enable_groups": ["svip", "default"],
                    "supported_endpoint_types": ["openai"]
                }
            ],
            "group_ratio": { "gaoyang_vip": 1.0, "gpt": 1.2, "svip": 0.9 }
        });
        let p = map_newapi_provider(
            &root,
            "src1",
            "易准大模型",
            "https://yiz.example.com/pricing",
        )
        .unwrap();
        assert_eq!(p.id, "src1");
        assert_eq!(p.region, "custom");
        assert_eq!(p.pricing_url, "https://yiz.example.com/pricing");
        assert_eq!(p.models.len(), 3);

        // 倍率 3.5 × 分组 1.0（gpt=1.2 / gaoyang_vip=1.0 取最小）× $2 = $7；输出 ×5 = $35
        let opus = &p.models[0];
        assert_eq!(opus.model, "claude-opus-4-6");
        assert_eq!(opus.input_per_1m, Some(7.0));
        assert_eq!(opus.output_per_1m, Some(35.0));
        assert_eq!(opus.cached_input_per_1m, Some(1.2));
        assert_eq!(opus.currency, "USD");
        assert!(opus.note.as_deref().unwrap().contains("倍率 3.5"));

        // 按次计费：token 价为空，note 标注按次
        let img = p.models.iter().find(|m| m.model == "gpt-image-2").unwrap();
        assert_eq!(img.input_per_1m, None);
        assert!(img.note.as_deref().unwrap().contains("按次 $0.2/次"));
        assert_eq!(img.model_type, "image");

        // completion_ratio = 0 → 输出与输入同价；分组倍率 svip 0.9
        let kimi = p
            .models
            .iter()
            .find(|m| m.model == "kimi-k2.7-code")
            .unwrap();
        let expected = round4(3.25 * 0.9 * 2.0);
        assert_eq!(kimi.input_per_1m, Some(expected));
        assert_eq!(kimi.output_per_1m, Some(expected));
        assert!(kimi.note.as_deref().unwrap().contains("分组 0.9"));
    }

    #[test]
    fn apiprice_maps_channels_currency_and_offpeak() {
        let doc: ApipriceDoc = serde_json::from_value(json!({
            "cite_as": "apiprice.app (as of 2026-11-19)",
            "generated_at": "2026-11-19T11:49:22.630Z",
            "prices": [
                {"model_id": "minimax-m3", "provider": "minimax", "channel": "official_cn",
                 "currency": "CNY", "input_per_1m": 2.1, "output_per_1m": 8.4, "cached_per_1m": 0.42,
                 "tier_notes": "标准服务"},
                {"model_id": "gpt-6.1-sol", "provider": "openai", "channel": "openrouter",
                 "currency": "USD", "input_per_1m": 2, "output_per_1m": 10, "cached_per_1m": 0.1,
                 "or_price_source": "original"},
                {"model_id": "deepseek-v4", "provider": "deepseek", "channel": "official",
                 "currency": "USD", "input_per_1m": 0.27, "output_per_1m": 1.1,
                 "off_peak_input_per_1m": 0.014, "off_peak_output_per_1m": 0.056,
                 "off_peak_hours": "00:30-08:30 UTC+8"},
                {"model_id": "retired-old", "provider": "openai", "channel": "official",
                 "currency": "USD", "input_per_1m": 1, "output_per_1m": 2, "retired": true}
            ]
        }))
        .unwrap();
        let snap = map_apiprice(&doc, "builtin_apiprice").unwrap();
        assert_eq!(
            snap.providers.len(),
            3,
            "按厂商分组：minimax/openai/deepseek"
        );
        assert_eq!(snap.snapshot_date, "2026-11-19");

        let mm = &snap
            .providers
            .iter()
            .find(|p| p.name == "MiniMax")
            .unwrap()
            .models[0];
        assert_eq!(mm.currency, "CNY");
        assert_eq!(mm.input_per_1m, Some(2.1));
        assert!(mm.note.as_deref().unwrap().contains("国内官方价"));
        assert!(mm.note.as_deref().unwrap().contains("CC BY 4.0"));

        let oai = &snap
            .providers
            .iter()
            .find(|p| p.name == "OpenAI")
            .unwrap()
            .models[0];
        assert_eq!(oai.currency, "USD");
        assert!(oai.note.as_deref().unwrap().contains("OpenRouter"));
        // retired 条目被过滤
        assert_eq!(
            snap.providers
                .iter()
                .find(|p| p.name == "OpenAI")
                .unwrap()
                .models
                .len(),
            1
        );

        let ds = &snap
            .providers
            .iter()
            .find(|p| p.name == "DeepSeek")
            .unwrap()
            .models[0];
        let op = ds.off_peak.as_ref().expect("低谷价应映射");
        assert_eq!(op.window, "00:30-08:30 UTC+8");
        assert_eq!(op.input_per_1m, Some(0.014));
    }

    #[test]
    fn apiprice_empty_is_error() {
        let doc: ApipriceDoc = serde_json::from_value(json!({"prices": [
            {"model_id": "x", "provider": "p", "channel": "official", "retired": true}
        ]}))
        .unwrap();
        assert!(map_apiprice(&doc, "s").is_err());
    }

    #[test]
    fn newapi_empty_data_is_error() {
        let root = json!({ "success": true, "data": [] });
        assert!(map_newapi_provider(&root, "s", "n", "https://x.com/pricing").is_err());
    }

    #[test]
    fn origin_extraction() {
        assert_eq!(
            origin_of("https://yiz.bjkhdf.cn/pricing").unwrap(),
            "https://yiz.bjkhdf.cn"
        );
        assert_eq!(
            origin_of("http://localhost:3000/pricing?a=1").unwrap(),
            "http://localhost:3000"
        );
        assert!(origin_of("ftp://x.com").is_err());
        assert!(origin_of("https:///path").is_err());
    }
}
