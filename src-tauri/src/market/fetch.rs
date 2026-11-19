//! 市场价格抓取：models.dev JSON → MarketSnapshot。
//!
//! 不爬 HTML 价格页（多为 JS 渲染、结构频繁变动），只消费机器可读的
//! models.dev/api.json（官方第一方厂商、统一 USD/百万 token）。

use std::time::Duration;

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

use super::{MarketModel, MarketProvider, MarketSnapshot};

pub const SOURCE_ID: &str = "models.dev";
pub const SOURCE_URL: &str = "https://models.dev/api.json";

/// 官方第一方厂商白名单（models.dev 收录 300+ 供应商，多为聚合中转）。
/// (models.dev id, 展示名, 区域)
const PROVIDER_WHITELIST: &[(&str, &str, &str)] = &[
    ("openai", "OpenAI", "global"),
    ("anthropic", "Anthropic", "global"),
    ("google", "Google Gemini", "global"),
    ("xai", "xAI", "global"),
    ("mistral", "Mistral", "global"),
    ("cohere", "Cohere", "global"),
    ("perplexity", "Perplexity", "global"),
    ("meta", "Meta (Llama)", "global"),
    ("deepseek", "DeepSeek", "cn"),
    ("alibaba", "阿里云百炼（通义千问）", "cn"),
    ("moonshotai", "月之暗面（Kimi）", "cn"),
    ("zhipuai", "智谱 AI（GLM）", "cn"),
    ("volcengine", "火山方舟（豆包）", "cn"),
    ("minimax", "MiniMax", "cn"),
    ("stepfun", "阶跃星辰", "cn"),
    ("xiaomi", "小米", "cn"),
];

/// 拉取并映射最新快照（异步、不触碰数据库）。
pub async fn fetch_snapshot() -> AppResult<MarketSnapshot> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("LCM/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Invalid(format!("HTTP 客户端构建失败: {e}")))?;
    let resp = client
        .get(SOURCE_URL)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("抓取 {SOURCE_URL} 失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "抓取失败：{SOURCE_URL} 返回 HTTP {}",
            resp.status()
        )));
    }
    let root: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Invalid(format!("models.dev 响应解析失败: {e}")))?;
    map_snapshot(&root)
}

/// 抓取 USD → CNY 汇率（市场页币种切换折算用）。
/// frankfurter（欧央行数据，免密钥）优先，失败回退 open.er-api.com；再失败返回 None（保留旧值）。
pub async fn fetch_usd_cny_rate() -> Option<f64> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("LCM/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .build()
        .ok()?;
    // 主源：frankfurter
    if let Ok(resp) = client
        .get("https://api.frankfurter.app/latest?from=USD&to=CNY")
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                if let Some(rate) = v
                    .pointer("/rates/CNY")
                    .and_then(Value::as_f64)
                    .filter(|r| *r > 0.0)
                {
                    return Some(rate);
                }
            }
        }
    }
    // 回退源：open.er-api.com
    if let Ok(resp) = client
        .get("https://open.er-api.com/v6/latest/USD")
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                if let Some(rate) = v
                    .pointer("/rates/CNY")
                    .and_then(Value::as_f64)
                    .filter(|r| *r > 0.0)
                {
                    return Some(rate);
                }
            }
        }
    }
    None
}

/// 把 models.dev 结构映射为 MarketSnapshot（纯函数，便于离线测试）。
pub fn map_snapshot(root: &Value) -> AppResult<MarketSnapshot> {
    let obj = root
        .as_object()
        .ok_or_else(|| AppError::Invalid("models.dev 数据结构异常（顶层非对象）".into()))?;
    let fetched_at = now_rfc3339();
    let snapshot_date = fetched_at.get(..7).unwrap_or("unknown").to_string();

    let mut providers = Vec::new();
    for (pid, display, region) in PROVIDER_WHITELIST {
        let Some(pv) = obj.get(*pid) else {
            continue; // 白名单厂商缺席时跳过，不让单个缺失毁掉整次抓取
        };
        let mut models = Vec::new();
        if let Some(models_obj) = pv.get("models").and_then(Value::as_object) {
            for (mid, mv) in models_obj {
                let cost = mv.get("cost");
                let input = num(cost, "input");
                let output = num(cost, "output");
                // 无价模型（未公开/免费计划）不进市场表
                if input.is_none() && output.is_none() {
                    continue;
                }
                models.push(MarketModel {
                    model: mid.clone(),
                    model_type: classify(mv, mid),
                    input_per_1m: input,
                    cached_input_per_1m: num(cost, "cache_read").filter(|v| *v > 0.0),
                    output_per_1m: output,
                    currency: "USD".into(),
                    note: None,
                    // models.dev 无分时段数据；国内厂商低谷价由 data_cn.json 叠加层提供
                    off_peak: None,
                });
            }
        }
        if models.is_empty() {
            continue;
        }
        models.sort_by(|a, b| a.model.cmp(&b.model));
        providers.push(MarketProvider {
            id: (*pid).to_string(),
            name: (*display).to_string(),
            region: (*region).to_string(),
            pricing_url: pv
                .get("doc")
                .and_then(Value::as_str)
                .unwrap_or(SOURCE_URL)
                .to_string(),
            models,
        });
    }

    if providers.is_empty() {
        return Err(AppError::Invalid(
            "抓取结果为空：白名单厂商均无可用数据".into(),
        ));
    }
    Ok(MarketSnapshot {
        snapshot_date,
        source: SOURCE_ID.into(),
        fetched_at: Some(fetched_at),
        providers,
    })
}

/// 取 cost.<key> 数值（缺失/非数值返回 None；基于 Value 解析以容忍 schema 细节变化）。
fn num(cost: Option<&Value>, key: &str) -> Option<f64> {
    cost?.get(key)?.as_f64()
}

/// 模型类型：输出含 image → 图像；输入含 image → 多模态；
/// 纯推理系列（o1/o3/o4/o5、R 系等）→ 决策；否则文本。
/// 注意：models.dev 的 reasoning=true 对 glm/qwen3/MiniMax 等混合思考模型普遍为 true，
/// 不能作为「决策模型」依据（决策 = 纯推理/系统一类型，如 o 系），故按模型名识别。
fn classify(mv: &Value, model_id: &str) -> String {
    let outputs_image = mv
        .get("modalities")
        .and_then(|m| m.get("output"))
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|v| v.as_str() == Some("image")));
    let inputs_image = mv
        .get("modalities")
        .and_then(|m| m.get("input"))
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|v| v.as_str() == Some("image")));
    if outputs_image {
        "image".into()
    } else if inputs_image {
        "multimodal".into()
    } else if is_pure_reasoning(model_id) {
        "decision".into()
    } else {
        "text".into()
    }
}

/// 纯推理（决策）系列判定：OpenAI o1/o3/o4/o5 系、DeepSeek R 系、qwq 等纯推理模型名。
fn is_pure_reasoning(model_id: &str) -> bool {
    let n = model_id.to_lowercase();
    let stripped = n.strip_prefix("openai/").unwrap_or(&n);
    // o 系列：o1 / o3 / o4-mini / o4mini…（排除正文词如 sonata，直接 ^o\d）
    if regex_like_o_series(stripped) {
        return true;
    }
    // DeepSeek R 系 / Qwen 纯推理 qwq
    stripped.starts_with("r1") || stripped.starts_with("deepseek-r1") || stripped.starts_with("qwq")
}

/// ^o\d 系列判定（o1/o3/o4/o5，含 -mini/-pro 后缀）。
fn regex_like_o_series(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some('o')) && matches!(chars.next(), Some(c) if c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        serde_json::json!({
            "openai": {
                "name": "OpenAI",
                "doc": "https://openai.com/api/pricing/",
                "models": {
                    "gpt-test": {
                        "reasoning": false,
                        "modalities": { "input": ["text", "image"], "output": ["text"] },
                        "cost": { "input": 1.25, "output": 10.0, "cache_read": 0.125 }
                    },
                    "o3-test": {
                        "reasoning": true,
                        "modalities": { "input": ["text"], "output": ["text"] },
                        "cost": { "input": 2.0, "output": 8.0 }
                    },
                    "img-test": {
                        "modalities": { "input": ["text", "image"], "output": ["image"] },
                        "cost": { "input": null, "output": null }
                    },
                    "no-price": { "cost": {} }
                }
            },
            "some-router": {
                "name": "Some Router",
                "models": { "cheap": { "cost": { "input": 0.01, "output": 0.02 } } }
            },
            "zhipuai": {
                "name": "Zhipu AI",
                "doc": "https://bigmodel.cn/pricing",
                "models": {
                    "glm-test": {
                        "reasoning": true,
                        "modalities": { "input": ["text"], "output": ["text"] },
                        "cost": { "input": 0.44, "output": 2.09, "cache_read": 0 }
                    }
                }
            }
        })
    }

    #[test]
    fn maps_whitelist_classification_and_skips() {
        let snap = map_snapshot(&fixture()).unwrap();
        assert_eq!(snap.source, "models.dev");
        assert!(snap.fetched_at.is_some());

        let ids: Vec<&str> = snap.providers.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["openai", "zhipuai"], "聚合中转必须被白名单过滤");

        let openai = &snap.providers[0];
        assert_eq!(openai.pricing_url, "https://openai.com/api/pricing/");
        // img-test 无价不进表（input/output 均 null）；no-price 同样跳过
        assert_eq!(openai.models.len(), 2);

        let gpt = &openai.models[0];
        assert_eq!(gpt.model_type, "multimodal");
        assert_eq!(gpt.input_per_1m, Some(1.25));
        assert_eq!(gpt.cached_input_per_1m, Some(0.125));
        assert_eq!(gpt.currency, "USD");

        let o = &openai.models[1];
        assert_eq!(o.model_type, "decision", "纯推理 o 系应归为决策");

        // glm 系是混合思考模型（reasoning=true 但非纯推理系列），应归文本而非决策
        let glm = &snap.providers[1].models[0];
        assert_eq!(glm.model_type, "text", "glm 不应被误标为决策");
        assert_eq!(glm.cached_input_per_1m, None, "cache_read=0 视为未提供");
    }

    #[test]
    fn empty_whitelist_result_is_error() {
        let root = serde_json::json!({ "some-router": { "models": {} } });
        assert!(map_snapshot(&root).is_err());
    }
}
