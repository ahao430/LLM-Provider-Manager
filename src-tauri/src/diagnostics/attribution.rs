//! 多层网关错误归因（规则式，本地特征匹配；不调 AI）。
//!
//! 真实链路通常是 LCM → 中转网关（NewAPI 类）→ 上游厂商。同一失败可能出自任何一层，
//! 网关还可能改写上游错误体。本模块用**确定性特征匹配**回答「错误出自链路哪一层」：
//!
//! - 特征表分网关 / 上游两组，按特异性排序（先具体后宽泛），首个命中生效；
//! - 严格红线：事实（消息含什么特征串、上游是否返回请求 ID）与推测（错误可能出自哪层）
//!   分开输出，置信度 confirmed（特异特征命中）/ probable（宽泛特征命中）/ unknown（无证据）；
//! - 归因只读，不影响既有知识库诊断。

use serde::Serialize;

/// 归因层：gateway（中转网关层）/ upstream（上游厂商）/ unknown。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttributionLayer {
    Gateway,
    Upstream,
    Unknown,
}

/// 一次错误记录的归因结果（事实与推测分开，置信度明确）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribution {
    /// gateway / upstream / unknown
    pub layer: AttributionLayer,
    /// confirmed（特异特征命中）/ probable（宽泛特征命中）/ unknown
    pub confidence: String,
    /// 观察到的事实（不含推断）：命中的特征串、上游请求 ID 有无
    pub facts: Vec<String>,
    /// 推测（明确标注为推测，仅供参考）
    pub speculation: String,
    /// 命中的网关类型提示（如「NewAPI 系中转」）
    pub gateway_hint: Option<String>,
}

/// 一条归因特征：串（小写包含匹配）+ 特异性。
struct Signature {
    needle: &'static str,
    /// true = 特异特征（几乎只有该层会说）→ confirmed；false = 宽泛 → probable
    specific: bool,
    note: &'static str,
}

/// 中转网关特征（NewAPI / OneAPI 系为主；中文文案为其特有）。
const GATEWAY_SIGNATURES: &[Signature] = &[
    Signature {
        needle: "无可用渠道",
        specific: true,
        note: "「无可用渠道」为 NewAPI 系中转特有文案",
    },
    Signature {
        needle: "当前分组",
        specific: true,
        note: "「当前分组」为 NewAPI 系中转特有文案",
    },
    Signature {
        needle: "令牌额度",
        specific: true,
        note: "「令牌额度」为 NewAPI 系中转特有文案",
    },
    Signature {
        needle: "distributor",
        specific: true,
        note: "distributor 相关文案常见于 OneAPI 系中转",
    },
    Signature {
        needle: "中转",
        specific: false,
        note: "错误消息提及「中转」",
    },
    Signature {
        needle: "quota",
        specific: false,
        note:
            "消息含 quota（中转额度文案常见；上游 OpenAI 用 insufficient_quota，已在下方优先命中）",
    },
];

/// 上游厂商特征（OpenAI / Anthropic 标准错误结构与特有码）。
const UPSTREAM_SIGNATURES: &[Signature] = &[
    Signature {
        needle: "insufficient_quota",
        specific: true,
        note: "insufficient_quota 为 OpenAI 标准错误码",
    },
    Signature {
        needle: "invalid_request_error",
        specific: true,
        note: "invalid_request_error 为 OpenAI / Anthropic 标准错误类型",
    },
    Signature {
        needle: "model_not_found",
        specific: true,
        note: "model_not_found 为 OpenAI 标准错误码",
    },
    Signature {
        needle: "context_length_exceeded",
        specific: true,
        note: "context_length_exceeded 为 OpenAI 标准错误码",
    },
    Signature {
        needle: "overloaded_error",
        specific: true,
        note: "overloaded_error 为 Anthropic 标准错误类型",
    },
    Signature {
        needle: "api_error",
        specific: false,
        note: "api_error 为 Anthropic 错误类型（宽泛）",
    },
];

/// 对一条错误做层归因（纯函数）。
///
/// 判定顺序：先上游特异特征（中转若透传上游原文，应命中上游），再网关特征，
/// 最后宽泛特征；`provider_request_id` 仅作为事实记录（有 ID 说明请求到达过能回传 ID
/// 的某一层，但不必然是最上游——不据此下结论，避免过度归因）。
pub fn attribute(error_message: &str, provider_request_id: Option<&str>) -> Attribution {
    let message = error_message.trim();
    let message_lc = message.to_lowercase();
    let mut facts = Vec::new();
    if message.is_empty() {
        facts.push("错误消息为空".into());
    }

    let mut base = if message.is_empty() {
        Attribution {
            layer: AttributionLayer::Unknown,
            confidence: "unknown".into(),
            facts,
            speculation: "无错误消息可分析，无法归因到链路层。".into(),
            gateway_hint: None,
        }
    } else {
        // 首个命中生效：上游特征组在前（特异性排序在组内）
        match first_hit(&message_lc, UPSTREAM_SIGNATURES)
            .map(|s| (AttributionLayer::Upstream, s))
            .or_else(|| {
                first_hit(&message_lc, GATEWAY_SIGNATURES).map(|s| (AttributionLayer::Gateway, s))
            }) {
            Some((layer, sig)) => {
                let (confidence, speculation) = match (&layer, sig.specific) {
                    (AttributionLayer::Upstream, true) => (
                        "confirmed",
                        "错误体含上游厂商标准错误特征，推测错误出自（或透传自）上游厂商侧。"
                            .to_string(),
                    ),
                    (AttributionLayer::Upstream, false) => (
                        "probable",
                        "错误体含上游厂商常见错误特征（宽泛词），可能出自上游或被中转复述。"
                            .to_string(),
                    ),
                    (AttributionLayer::Gateway, true) => (
                        "confirmed",
                        "错误体含中转网关特有文案，推测错误出自中转网关层而非上游厂商。"
                            .to_string(),
                    ),
                    (AttributionLayer::Gateway, false) => (
                        "probable",
                        "错误体含常见于中转网关的宽泛特征，可能出自中转层（也可能被改写过）。"
                            .to_string(),
                    ),
                    _ => unreachable!(),
                };
                let gateway_hint = (layer == AttributionLayer::Gateway)
                    .then(|| "NewAPI / OneAPI 系中转".to_string());
                Attribution {
                    layer,
                    confidence: confidence.into(),
                    facts,
                    speculation,
                    gateway_hint,
                }
            }
            None => Attribution {
                layer: AttributionLayer::Unknown,
                confidence: "unknown".into(),
                facts,
                speculation: "错误消息未命中任何链路层特征，证据不足，不做层归因。".into(),
                gateway_hint: None,
            },
        }
    };

    // 命中时补充「命中依据」事实；上游请求 ID 有无始终作为事实记录（不据此改变层结论）
    if let Some(sig) = first_hit(&message_lc, UPSTREAM_SIGNATURES) {
        base.facts.push(format!(
            "错误消息命中上游特征「{}」（{}）",
            sig.needle, sig.note
        ));
    } else if let Some(sig) = first_hit(&message_lc, GATEWAY_SIGNATURES) {
        base.facts.push(format!(
            "错误消息命中网关特征「{}」（{}）",
            sig.needle, sig.note
        ));
    }
    match provider_request_id {
        Some(id) if !id.trim().is_empty() => base.facts.push(format!(
            "上游返回了请求 ID {id}：请求到达过能回传 ID 的某一层（不必然是最上游）"
        )),
        _ => base
            .facts
            .push("无上游请求 ID：无法证明请求到达过上游厂商".into()),
    }
    base
}

/// 组内按序取首个命中（返回特征与索引）。
fn first_hit(message_lc: &str, signatures: &'static [Signature]) -> Option<&'static Signature> {
    signatures.iter().find(|s| message_lc.contains(s.needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newapi_gateway_specific_text() {
        let a = attribute("当前分组 default 下对于模型 gpt-4o 无可用渠道", None);
        assert_eq!(a.layer, AttributionLayer::Gateway);
        assert_eq!(a.confidence, "confirmed");
        assert_eq!(a.gateway_hint.as_deref(), Some("NewAPI / OneAPI 系中转"));
        assert!(a.facts.iter().any(|f| f.contains("网关特征")));
        assert!(a.speculation.contains("中转网关层"));
    }

    #[test]
    fn openai_upstream_code_wins_over_gateway() {
        // insufficient_quota（OpenAI 上游特异）优先于宽泛网关词 quota
        let a = attribute(
            "You exceeded your current quota ... (code=insufficient_quota)",
            None,
        );
        assert_eq!(a.layer, AttributionLayer::Upstream);
        assert_eq!(a.confidence, "confirmed");
        assert!(a.facts.iter().any(|f| f.contains("insufficient_quota")));
    }

    #[test]
    fn anthropic_overloaded_is_upstream() {
        let a = attribute(
            "{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\"}}",
            Some("req_abc"),
        );
        assert_eq!(a.layer, AttributionLayer::Upstream);
        assert!(a.facts.iter().any(|f| f.contains("req_abc")));
    }

    #[test]
    fn broad_gateway_word_is_probable() {
        let a = attribute("quota exhausted, please contact admin", None);
        assert_eq!(a.layer, AttributionLayer::Gateway);
        assert_eq!(a.confidence, "probable");
    }

    #[test]
    fn unknown_when_no_evidence() {
        let a = attribute("something odd happened", None);
        assert_eq!(a.layer, AttributionLayer::Unknown);
        assert_eq!(a.confidence, "unknown");
        assert!(a.facts.iter().any(|f| f.contains("无上游请求 ID")));
    }

    #[test]
    fn empty_message_is_unknown() {
        let a = attribute("", None);
        assert_eq!(a.layer, AttributionLayer::Unknown);
        assert!(a.facts.contains(&"错误消息为空".to_string()));
    }
}
