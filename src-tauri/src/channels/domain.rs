//! 渠道领域类型。

use serde::{Deserialize, Serialize};

/// 协议 → 对应 Base URL 字段。anthropic / responses 未单独填写时回退 chat 地址。
pub fn base_url_for_protocol(
    chat: &str,
    anthropic: &str,
    responses: &str,
    protocol: &str,
) -> String {
    match protocol {
        "anthropic_messages" => {
            let a = anthropic.trim();
            if a.is_empty() {
                chat.trim().to_string()
            } else {
                a.to_string()
            }
        }
        "openai_responses" => {
            let r = responses.trim();
            if r.is_empty() {
                chat.trim().to_string()
            } else {
                r.to_string()
            }
        }
        _ => chat.trim().to_string(),
    }
}

/// 渠道模型类型（人工标记）：多模态 / 图像 / 文本 / 决策。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModelType {
    Multimodal,
    Image,
    #[default]
    Text,
    Decision,
}

impl ModelType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Multimodal => "multimodal",
            Self::Image => "image",
            Self::Text => "text",
            Self::Decision => "decision",
        }
    }
}

/// 外部链接（官网 / 控制台 / 文档 / 状态页 / 自定义）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLink {
    pub label: String,
    pub url: String,
    pub kind: String,
}

/// 余额查询配置（查询方式由渠道服务商派生，不在表单中选择）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BalanceQuery {
    /// 查询方式：generic = 通用 HTTP（Bearer GET + JSON 路径）；
    /// new_api = NewAPI 用户额度（/api/user/self + 用户ID + 系统访问令牌）；
    /// aliyun_bss = 阿里云费用中心（RPC V1 签名，AccessKey 配置在凭证文件）
    #[serde(default)]
    pub provider: String,
    /// 查询路径：相对路径（拼在 chat Base URL 后）或完整 URL（generic 用）
    pub path: String,
    /// JSON 点路径，如 data.total_balance；数组用数字下标（generic 用）
    pub json_path: String,
    /// NewAPI 用户 ID（new_api 用；非敏感，直接存配置）
    #[serde(default)]
    pub user_id: String,
    /// 余额币种（写快照用；旧配置缺省 CNY；new_api 固定 USD）
    #[serde(default = "default_balance_currency")]
    pub currency: String,
}

impl Default for BalanceQuery {
    fn default() -> Self {
        Self {
            provider: String::new(),
            path: String::new(),
            json_path: String::new(),
            user_id: String::new(),
            currency: default_balance_currency(),
        }
    }
}

/// 按渠道服务商派生余额查询方式（单一事实来源：providers.code）。
pub fn balance_mode_for_provider(provider_code: Option<&str>) -> &'static str {
    match provider_code {
        Some("newapi") => "new_api",
        Some("bailian") => "aliyun_bss",
        _ => "generic",
    }
}

fn default_balance_currency() -> String {
    "CNY".into()
}

/// 渠道模型接口类型默认规则：模型名含 claude → Anthropic Messages，否则 Chat Completions。
pub fn default_protocol_for(model_id: &str) -> &'static str {
    if model_id.to_lowercase().contains("claude") {
        "anthropic_messages"
    } else {
        "openai_chat"
    }
}

/// 渠道连接配置（存 channels.config_json；认证按协议自动派生，不存自定义 Header）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ChannelConfig {
    /// 默认启用 TLS 证书验证
    pub tls_verify: bool,
    pub external_links: Vec<ExternalLink>,
    pub balance_query: Option<BalanceQuery>,
}

/// 渠道列表行（含凭证状态概览）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRow {
    pub id: String,
    pub name: String,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub channel_type: String,
    /// chat Base URL（主地址，兼容旧字段）
    pub base_url: String,
    pub chat_base_url: String,
    pub anthropic_base_url: String,
    pub responses_base_url: String,
    /// 按协议取有效 Base URL（未单独填写时回退 chat）
    pub effective_urls: ProtocolUrls,
    pub enabled: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// 官网链接（config_json 中 kind=official 的外链；未配置为 None）
    pub official_url: Option<String>,
    /// 主凭证是否存在（系统凭证库）
    pub has_primary_credential: bool,
    /// 主凭证掩码（如 sk-************）
    pub primary_credential_masked: Option<String>,
    /// 归属分组（可空 = 未分组）
    pub group_id: Option<String>,
    /// 分组名（JOIN channel_groups；未分组为 None）
    pub group_name: Option<String>,
    /// 置顶到首页仪表盘
    pub dashboard_pinned: bool,
}

/// 渠道分组行。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelGroupRow {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolUrls {
    pub openai_chat: String,
    pub anthropic_messages: String,
    pub openai_responses: String,
}

impl ChannelRow {
    /// 按协议取有效 Base URL。
    pub fn base_url_for(&self, protocol: &str) -> String {
        base_url_for_protocol(
            &self.chat_base_url,
            &self.anthropic_base_url,
            &self.responses_base_url,
            protocol,
        )
    }
}

/// 渠道详情。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDetail {
    #[serde(flatten)]
    pub row: ChannelRow,
    pub tls_verify: bool,
    pub external_links: Vec<ExternalLink>,
    pub balance_query: Option<BalanceQuery>,
}

/// 创建 / 更新渠道的输入。
///
/// - `primary_credential`：Some(非空) = 写入新值；None = 保持不变（清空用独立命令）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInput {
    pub name: String,
    pub provider_id: Option<String>,
    /// chat 协议 Base URL（主地址）*
    pub chat_base_url: String,
    /// Anthropic 专用地址（可空 = 与 chat 相同）
    pub anthropic_base_url: Option<String>,
    /// Responses 专用地址（可空 = 与 chat 相同）
    pub responses_base_url: Option<String>,
    /// 官网链接（可选）
    pub official_url: Option<String>,
    pub notes: Option<String>,
    pub primary_credential: Option<String>,
    /// 归属分组 id（可空 = 未分组；表单每次保存都会显式发送当前值）
    pub group_id: Option<String>,
}

/// 阶梯价一档（与市场价统一格式；存储为 channel_models.price_tiers_json）。
/// upTo = 累计输入 token 上限（单位：百万），None = 无上限（最后一档）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceTier {
    pub up_to: Option<f64>,
    pub input: Option<f64>,
    pub output: Option<f64>,
}

/// 分时段（低谷）价：window 描述时段，价格与主价同币种
/// （对齐市场 offPeak 结构，去掉标注维度没有的缓存价）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceOffPeak {
    pub window: String,
    pub input: Option<f64>,
    pub output: Option<f64>,
}

// 注意：比价 / 排序口径（max(单一, 阶梯最高档, 低谷) × 倍率）的实现在前端
// `src/lib/annotationPrice.ts`（展示与排序的消费方都在前端），后端只负责存储。

/// 渠道模型类型输入。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelModelInput {
    /// 编辑时提供，新建为 None
    pub id: Option<String>,
    pub channel_id: String,
    pub model_id: String,
    pub actual_model_id: String,
    pub protocol: String,
    pub model_type: Option<ModelType>,
    pub notes: Option<String>,
    pub enabled: Option<bool>,
    /// 标注价格（每百万 token）：仅供展示与市场比较，不参与费用估算。
    /// 编辑整行时会整体覆盖，前端须回传现有值。
    #[serde(default)]
    pub price_input_per_1m: Option<f64>,
    #[serde(default)]
    pub price_output_per_1m: Option<f64>,
    /// 空字符串 = 未标注币种
    #[serde(default)]
    pub price_currency: Option<String>,
    /// 倍率：实际价 = 原价 × 倍率（1.0 = 原价；0.8 = 八折）。None 归一为 1.0
    #[serde(default)]
    pub price_multiplier: Option<f64>,
    /// 阶梯价（每百万 token；upTo = 累计输入 token 上限，单位百万，None = 无上限最后一档）
    #[serde(default)]
    pub price_tiers: Option<Vec<PriceTier>>,
    /// 分时段（低谷）价
    #[serde(default)]
    pub price_off_peak: Option<PriceOffPeak>,
}

/// 渠道模型（某渠道实际提供的模型）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelModelRow {
    pub id: String,
    pub channel_id: String,
    pub model_id: String,
    pub model_name: Option<String>,
    pub actual_model_id: String,
    pub protocol: String,
    pub model_type: ModelType,
    pub enabled: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// 标注价格（每百万 token；None = 未标注）。仅展示比较，与费用估算无关。
    /// 倍率与阶梯 / 低谷为标注格式的一部分；展示层计算「实际价 = 原价 × 倍率」。
    pub price_input_per_1m: Option<f64>,
    pub price_output_per_1m: Option<f64>,
    pub price_currency: String,
    pub price_multiplier: f64,
    pub price_tiers: Option<Vec<PriceTier>>,
    pub price_off_peak: Option<PriceOffPeak>,
}

/// 全渠道模型视图行（模型列表页：跨渠道以模型维度聚合用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllChannelModelRow {
    /// 渠道模型 ID
    pub id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub channel_enabled: bool,
    pub model_id: String,
    pub actual_model_id: String,
    pub protocol: String,
    pub model_type: ModelType,
    pub enabled: bool,
    /// 标注价格（仅展示比较，与费用估算无关）
    pub price_input_per_1m: Option<f64>,
    pub price_output_per_1m: Option<f64>,
    pub price_currency: String,
    pub price_multiplier: f64,
    pub price_tiers: Option<Vec<PriceTier>>,
    pub price_off_peak: Option<PriceOffPeak>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn price_tier_serde_camelcase_roundtrip() {
        // JSON 列存储格式：camelCase（与前端 PriceTier / PriceOffPeak 对齐）
        let json =
            r#"[{"upTo":0.128,"input":4.0,"output":16.0},{"upTo":null,"input":2.0,"output":8.0}]"#;
        let tiers: Vec<PriceTier> = serde_json::from_str(json).unwrap();
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].up_to, Some(0.128));
        assert!(tiers[1].up_to.is_none());
        let out = serde_json::to_string(&tiers).unwrap();
        assert!(out.contains("\"upTo\""));
        assert!(!out.contains("\"up_to\""));
    }

    #[test]
    fn price_off_peak_serde_roundtrip() {
        let json = r#"{"window":"00:30–08:30 UTC+8","input":1.0,"output":4.0}"#;
        let op: PriceOffPeak = serde_json::from_str(json).unwrap();
        assert_eq!(op.window, "00:30–08:30 UTC+8");
        assert_eq!(op.input, Some(1.0));
        // 旧快照 / 手工配置缺字段容忍为 None
        let partial: PriceOffPeak = serde_json::from_str(r#"{"window":"2点～8点"}"#).unwrap();
        assert_eq!(partial.input, None);
        assert_eq!(partial.output, None);
    }
}
