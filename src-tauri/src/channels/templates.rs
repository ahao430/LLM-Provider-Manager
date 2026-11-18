//! 内置服务商模板：仅用于新建渠道时的初始化预填，
//! 不代表所有渠道都具有相同能力（PLAN.md「渠道模板」）。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTemplate {
    pub code: &'static str,
    pub name: &'static str,
    pub default_base_url: &'static str,
    pub default_protocol: &'static str,
    pub note: &'static str,
}

pub const TEMPLATES: &[ProviderTemplate] = &[
    ProviderTemplate {
        code: "bailian",
        name: "阿里云百炼",
        default_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_protocol: "openai_chat",
        note: "OpenAI 兼容模式地址；原生 DashScope 协议属自定义配置",
    },
    ProviderTemplate {
        code: "newapi",
        name: "NewAPI",
        default_base_url: "",
        default_protocol: "openai_chat",
        note: "填你的 NewAPI 站点地址，如 https://newapi.example.com/v1",
    },
    ProviderTemplate {
        code: "volcano",
        name: "火山方舟",
        default_base_url: "https://ark.cn-beijing.volces.com/api/v3",
        default_protocol: "openai_chat",
        note: "Ark API v3",
    },
    ProviderTemplate {
        code: "siliconflow",
        name: "硅基流动",
        default_base_url: "https://api.siliconflow.cn/v1",
        default_protocol: "openai_chat",
        note: "SiliconCloud API",
    },
    ProviderTemplate {
        code: "custom",
        name: "自定义渠道",
        default_base_url: "",
        default_protocol: "openai_chat",
        note: "任意 OpenAI / Anthropic 兼容渠道",
    },
];
