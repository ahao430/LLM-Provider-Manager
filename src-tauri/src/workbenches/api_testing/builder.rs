//! API 测试工作台：请求序列化（协议构建）与请求目标组装。
//!
//! 认证方式按协议自动派生：openai_* → Authorization Bearer；anthropic → x-api-key。
//! 序列化属于「必要的封装」，构建过程写 ProcessingEvent（changed=0）。
//! Raw JSON 模式下请求体为用户原样 JSON，不注入任何字段。

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::channels::repo as channel_repo;
use crate::channels::service as channel_service;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiTestMessage {
    /// user / assistant / tool / system
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ApiTestParams {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<i64>,
    /// 逗号分隔或数组，统一为字符串列表
    pub stop: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiTestRequest {
    pub channel_id: String,
    pub channel_model_id: Option<String>,
    pub model: String,
    pub protocol: String,
    pub stream: bool,
    pub system: Option<String>,
    pub messages: Vec<ApiTestMessage>,
    #[serde(default)]
    pub params: ApiTestParams,
    /// 自定义参数（合并进请求体顶层，值原样）
    pub extra_body: Option<Value>,
    /// 工作台临时 Header（覆盖同名）
    pub custom_headers: Vec<(String, String)>,
    /// 工作台临时 Query
    pub custom_query: Vec<(String, String)>,
    /// Raw JSON 模式：请求体为用户原样 JSON
    pub raw_json: Option<Value>,
    /// 重放时指向原始请求
    #[serde(default)]
    pub parent_trace_id: Option<String>,
    /// 测试类型标签（记录的 request_type）：api_test / quick_test；缺省 api_test
    #[serde(default)]
    pub test_kind: Option<String>,
}

/// 请求目标（URL + Headers + 超时 / TLS）。工作台各协议共用。
#[derive(Clone)]
pub struct RequestTarget {
    pub url: String,
    pub headers: Vec<(String, String)>,
    /// 渠道是否配置了主凭证（未配置时不注入认证 Header，本地免鉴权网关属正常场景）
    pub auth_present: bool,
    pub timeout_secs: u64,
    pub tls_verify: bool,
}

/// 组装请求目标：按协议解析 Base URL（anthropic / responses 未填时回退 chat）、
/// 按协议派生认证 Header。凭证值不进任何持久化记录（Raw 归档时统一脱敏）。
pub fn request_target(
    conn: &Connection,
    channel_id: &str,
    protocol: &str,
    path: &str,
    extra_query: &[(String, String)],
    override_headers: &[(String, String)],
) -> AppResult<RequestTarget> {
    let row = channel_repo::find_row(conn, channel_id)?
        .ok_or_else(|| AppError::Invalid("渠道不存在".into()))?;
    if !row.enabled {
        return Err(AppError::Invalid(format!("渠道「{}」已禁用", row.name)));
    }
    let config: crate::channels::domain::ChannelConfig =
        channel_repo::load_config(conn, channel_id)?;
    let token = channel_service::resolve_primary_credential(channel_id);
    let auth_present = token.is_some();

    let base = row.base_url_for(protocol);
    if base.is_empty() {
        return Err(AppError::Invalid(format!(
            "该渠道未配置 {protocol} 的 Base URL"
        )));
    }
    // 主地址只填基础域名的新约定：openai 系自动补 /v1（已带 /vN 的旧地址不重复拼；anthropic 例外）
    let base = match protocol {
        "openai_chat" | "openai_responses" => crate::channels::domain::ensure_v1(&base),
        _ => base,
    };
    let mut url = format!("{}{}", base.trim_end_matches('/'), path);
    if !extra_query.is_empty() {
        url.push('?');
        url.push_str(
            &extra_query
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("&"),
        );
    }

    let mut headers: Vec<(String, String)> =
        vec![("Content-Type".into(), "application/json".into())];
    if protocol == "anthropic_messages" {
        if let Some(token) = token {
            headers.push(("x-api-key".into(), token));
            headers.push(("anthropic-version".into(), "2023-06-01".into()));
        }
    } else if let Some(token) = token {
        headers.push(("Authorization".into(), format!("Bearer {token}")));
    }
    // 临时 Header 覆盖同名
    for (name, value) in override_headers {
        if name.trim().is_empty() {
            continue;
        }
        headers.retain(|(n, _)| n != name);
        headers.push((name.trim().to_string(), value.clone()));
    }

    Ok(RequestTarget {
        url,
        headers,
        auth_present,
        timeout_secs: 120,
        tls_verify: config.tls_verify,
    })
}

/// 生成 Raw 归档里的脱敏 Header。
/// v0.18.0 加宽：header 名（小写化）含 authorization / auth / token / key / secret
/// 任一子串即掩码（覆盖 x-api-key、api-key、x-goog-api-key、x-auth-token 等自定义名）。
pub fn mask_header_value(name: &str, value: &str) -> String {
    let lower = name.to_ascii_lowercase();
    let sensitive = ["authorization", "auth", "token", "key", "secret"]
        .iter()
        .any(|kw| lower.contains(kw));
    if sensitive {
        format!("{}…（已脱敏）", value.chars().take(6).collect::<String>())
    } else {
        value.to_string()
    }
}

/// 序列化后的请求（headers 仅存在于内存并直接送 HTTP；写入 Raw 文件时脱敏）。
pub struct BuiltRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
    /// 序列化说明（写入 ProcessingEvent 描述）
    pub notes: Vec<String>,
    /// 渠道是否配置了主凭证（false 时请求未带认证 Header）
    pub auth_present: bool,
    /// 来自渠道配置
    pub timeout_secs: u64,
    pub tls_verify: bool,
}

pub fn build(conn: &Connection, req: &ApiTestRequest) -> AppResult<BuiltRequest> {
    if !matches!(
        req.protocol.as_str(),
        "openai_chat" | "openai_responses" | "anthropic_messages"
    ) {
        return Err(AppError::Invalid(format!("不支持的协议: {}", req.protocol)));
    }
    if req.model.trim().is_empty() && req.raw_json.is_none() {
        return Err(AppError::Invalid(
            "模型不能为空（Raw JSON 模式除外）".into(),
        ));
    }
    if req.messages.is_empty() && req.raw_json.is_none() {
        return Err(AppError::Invalid("至少需要一条消息".into()));
    }

    let path = match req.protocol.as_str() {
        "openai_chat" => "/chat/completions",
        "openai_responses" => "/responses",
        "anthropic_messages" => "/messages",
        _ => unreachable!("已校验"),
    };
    let target = request_target(
        conn,
        &req.channel_id,
        &req.protocol,
        path,
        &req.custom_query,
        &req.custom_headers,
    )?;

    // 请求体
    let (body, notes) = if let Some(raw) = &req.raw_json {
        (
            raw.clone(),
            vec!["Raw JSON 模式：请求体为用户提供的原样 JSON，未注入或修改任何字段".to_string()],
        )
    } else {
        serialize_body(req)?
    };

    Ok(BuiltRequest {
        url: target.url,
        headers: target.headers,
        body,
        notes,
        auth_present: target.auth_present,
        timeout_secs: target.timeout_secs,
        tls_verify: target.tls_verify,
    })
}

/// 按协议序列化请求体，返回（体，序列化说明）。
fn serialize_body(req: &ApiTestRequest) -> AppResult<(Value, Vec<String>)> {
    let mut notes = Vec::new();
    let mut body = Map::new();

    let model = req.model.trim().to_string();
    let p = &req.params;

    match req.protocol.as_str() {
        "openai_chat" => {
            body.insert("model".into(), json!(model));
            let mut messages = Vec::new();
            if let Some(system) = req.system.as_deref().filter(|s| !s.trim().is_empty()) {
                messages.push(json!({"role": "system", "content": system}));
                notes.push("system 字段序列化为 role=system 消息".into());
            }
            for m in &req.messages {
                messages.push(json!({"role": m.role, "content": m.content}));
            }
            body.insert("messages".into(), json!(messages));
            if req.stream {
                body.insert("stream".into(), json!(true));
            }
            if let Some(t) = p.temperature {
                body.insert("temperature".into(), json!(t));
            }
            if let Some(t) = p.top_p {
                body.insert("top_p".into(), json!(t));
            }
            if let Some(m) = p.max_tokens {
                body.insert("max_tokens".into(), json!(m));
            }
            if !p.stop.is_empty() {
                body.insert("stop".into(), json!(p.stop));
            }
            notes.push("OpenAI Chat Completions：messages 数组 + 顶层参数".into());
        }
        "openai_responses" => {
            body.insert("model".into(), json!(model));
            let mut input = Vec::new();
            for m in &req.messages {
                input.push(json!({"role": m.role, "content": m.content}));
            }
            body.insert("input".into(), json!(input));
            if let Some(system) = req.system.as_deref().filter(|s| !s.trim().is_empty()) {
                body.insert("instructions".into(), json!(system));
                notes.push("system 字段映射为 instructions".into());
            }
            if req.stream {
                body.insert("stream".into(), json!(true));
            }
            if let Some(t) = p.temperature {
                body.insert("temperature".into(), json!(t));
            }
            if let Some(t) = p.top_p {
                body.insert("top_p".into(), json!(t));
            }
            if let Some(m) = p.max_tokens {
                body.insert("max_output_tokens".into(), json!(m));
                notes.push("max_tokens 映射为 max_output_tokens（Responses 协议）".into());
            }
            if !p.stop.is_empty() {
                body.insert("stop".into(), json!(p.stop));
                notes.push("stop 参数按原样传递（渠道是否支持以实际响应为准）".into());
            }
            notes.push("OpenAI Responses：input 数组 + instructions".into());
        }
        "anthropic_messages" => {
            body.insert("model".into(), json!(model));
            // Anthropic 要求 max_tokens 必填
            let max_tokens = p.max_tokens.unwrap_or(1024);
            body.insert("max_tokens".into(), json!(max_tokens));
            if p.max_tokens.is_none() {
                notes.push("max_tokens 未设置，按 Anthropic 协议要求填入默认值 1024".into());
            }
            let mut system_parts = Vec::new();
            if let Some(system) = req.system.as_deref().filter(|s| !s.trim().is_empty()) {
                system_parts.push(system.to_string());
                notes.push("system 字段映射为顶层 system".into());
            }
            let mut messages = Vec::new();
            for m in &req.messages {
                match m.role.as_str() {
                    "user" | "assistant" => messages.push(json!({"role": m.role, "content": m.content})),
                    "system" => {
                        system_parts.push(m.content.clone());
                        notes.push("role=system 消息并入顶层 system（Anthropic 不允许 messages 中出现 system）".into());
                    }
                    other => {
                        return Err(AppError::Invalid(format!(
                            "Anthropic Messages 协议不支持 role={other}（tool 结果需要 tool_result 块结构，请使用 Raw JSON 模式）"
                        )))
                    }
                }
            }
            if !system_parts.is_empty() {
                body.insert("system".into(), json!(system_parts.join("\n\n")));
            }
            body.insert("messages".into(), json!(messages));
            if req.stream {
                body.insert("stream".into(), json!(true));
            }
            if let Some(t) = p.temperature {
                body.insert("temperature".into(), json!(t));
            }
            if let Some(t) = p.top_p {
                body.insert("top_p".into(), json!(t));
            }
            if !p.stop.is_empty() {
                body.insert("stop_sequences".into(), json!(p.stop));
                notes.push("stop 映射为 stop_sequences（Anthropic 协议）".into());
            }
            notes.push("Anthropic Messages：顶层 system + messages（user/assistant）".into());
        }
        _ => unreachable!("已校验"),
    }

    // 自定义参数合并进顶层（值原样，不校验语义）
    if let Some(extra) = &req.extra_body {
        if let Some(obj) = extra.as_object() {
            for (k, v) in obj {
                body.insert(k.clone(), v.clone());
            }
            notes.push(format!("extra_body 合并了 {} 个自定义参数", obj.len()));
        }
    }
    Ok((Value::Object(body), notes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channels::domain::ChannelInput;
    use crate::storage::migrations;

    #[test]
    fn header_masking_covers_custom_names() {
        // 精确名单之外的变体也必须被掩（凭证安全红线）
        for name in [
            "Authorization",
            "x-api-key",
            "api-key",
            "X-Goog-Api-Key",
            "X-Auth-Token",
            "X-Secret-Id",
            "OpenAI-Organization-Key",
        ] {
            let masked = mask_header_value(name, "sk-super-secret-value-123");
            assert!(masked.contains("已脱敏"), "header {name} 应被掩码");
        }
        // 无敏感词的普通 header 不掩
        assert_eq!(mask_header_value("X-Request-Id", "abc123"), "abc123");
    }

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        channel_repo::insert(
            &conn,
            "ch-1",
            &ChannelInput {
                name: "测试".into(),
                provider_id: None,
                chat_base_url: "https://api.example.com/v1".into(),
                anthropic_base_url: Some("https://anthropic.example.com".into()),
                responses_base_url: None,
                chat_completions_url: None,
                official_url: None,
                notes: None,
                primary_credential: None,
                group_id: None,
            },
            "{}",
        )
        .unwrap();
        conn
    }

    #[test]
    fn target_resolves_url_and_auth_by_protocol() {
        let conn = setup();
        let chat =
            request_target(&conn, "ch-1", "openai_chat", "/chat/completions", &[], &[]).unwrap();
        assert_eq!(chat.url, "https://api.example.com/v1/chat/completions");

        let anthropic =
            request_target(&conn, "ch-1", "anthropic_messages", "/messages", &[], &[]).unwrap();
        assert_eq!(anthropic.url, "https://anthropic.example.com/messages");

        // responses 未单独填写 → 回退 chat
        let responses =
            request_target(&conn, "ch-1", "openai_responses", "/responses", &[], &[]).unwrap();
        assert_eq!(responses.url, "https://api.example.com/v1/responses");
    }
}
