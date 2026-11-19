//! 图片理解（Vision）：带图片输入的 Chat 请求。
//!
//! 支持 openai_chat（image_url：URL / data base64）与 anthropic_messages
//! （image.source：base64 / url）。图片不压缩、不转换，按渠道要求原样传递。

use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::requests::repo as records;
use crate::storage::paths;
use crate::workbenches::api_testing::builder::{mask_header_value, request_target};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionImage {
    /// url = 网络图片；base64 = 本地图片（value 为纯 base64，无 data: 前缀）
    pub kind: String, // url | base64
    pub value: String,
    /// base64 图片的 MIME（anthropic 必需）
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionRequest {
    pub channel_id: String,
    pub model: String,
    /// openai_chat | anthropic_messages
    pub protocol: String,
    pub system: Option<String>,
    pub text: String,
    pub images: Vec<VisionImage>,
    pub max_tokens: Option<i64>,
    pub custom_headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionResult {
    pub trace_id: String,
    pub status: String,
    pub http_status: Option<u16>,
    pub preview: crate::workbenches::api_testing::parser::ResponsePreview,
    pub raw_response_ref: Option<String>,
}

/// 构建（数据库锁内）。
pub fn prepare(
    conn: &Connection,
    data_dir: &Path,
    req: &VisionRequest,
) -> AppResult<PreparedVision> {
    if !matches!(req.protocol.as_str(), "openai_chat" | "anthropic_messages") {
        return Err(AppError::Invalid(
            "Vision 支持 openai_chat 与 anthropic_messages 协议".into(),
        ));
    }
    if req.text.trim().is_empty() && req.images.is_empty() {
        return Err(AppError::Invalid("请输入文字或至少一张图片".into()));
    }
    if req.images.is_empty() {
        return Err(AppError::Invalid("Vision 请求需要至少一张图片".into()));
    }
    if req.model.trim().is_empty() {
        return Err(AppError::Invalid("模型不能为空".into()));
    }

    let path = match req.protocol.as_str() {
        "openai_chat" => "/chat/completions",
        "anthropic_messages" => "/messages",
        _ => unreachable!("已校验"),
    };
    let target = request_target(
        conn,
        &req.channel_id,
        &req.protocol,
        path,
        &[],
        &req.custom_headers,
    )?;

    let content: Vec<Value> = {
        let mut parts = Vec::new();
        if !req.text.trim().is_empty() {
            parts.push(match req.protocol.as_str() {
                "openai_chat" => json!({"type": "text", "text": req.text.trim()}),
                "anthropic_messages" => json!({"type": "text", "text": req.text.trim()}),
                _ => unreachable!(),
            });
        }
        for image in &req.images {
            match (req.protocol.as_str(), image.kind.as_str()) {
                ("openai_chat", "url") => parts.push(json!({
                    "type": "image_url",
                    "image_url": {"url": image.value}
                })),
                ("openai_chat", "base64") => parts.push(json!({
                    "type": "image_url",
                    "image_url": {"url": format!("data:{};base64,{}", image.media_type.clone().unwrap_or_else(|| "image/png".into()), image.value)}
                })),
                ("anthropic_messages", "url") => parts.push(json!({
                    "type": "image",
                    "source": {"type": "url", "url": image.value}
                })),
                ("anthropic_messages", "base64") => parts.push(json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image.media_type.clone().unwrap_or_else(|| "image/png".into()),
                        "data": image.value
                    }
                })),
                (protocol, kind) => {
                    return Err(AppError::Invalid(format!("协议 {protocol} 不支持图片形态 {kind}")))
                }
            }
        }
        parts
    };

    let mut body_map = serde_json::Map::new();
    body_map.insert("model".into(), json!(req.model.trim()));
    if req.protocol == "anthropic_messages" {
        body_map.insert("max_tokens".into(), json!(req.max_tokens.unwrap_or(1024)));
        if let Some(system) = req.system.as_deref().filter(|s| !s.trim().is_empty()) {
            body_map.insert("system".into(), json!(system));
        }
        body_map.insert(
            "messages".into(),
            json!([{"role": "user", "content": content}]),
        );
    } else {
        let mut messages = Vec::new();
        if let Some(system) = req.system.as_deref().filter(|s| !s.trim().is_empty()) {
            messages.push(json!({"role": "system", "content": system}));
        }
        messages.push(json!({"role": "user", "content": content}));
        body_map.insert("messages".into(), json!(messages));
        if let Some(m) = req.max_tokens {
            body_map.insert("max_tokens".into(), json!(m));
        }
    }
    let body = Value::Object(body_map);

    let trace_id = uuid::Uuid::new_v4().to_string();
    records::insert_pending(
        conn,
        &trace_id,
        &req.channel_id,
        None,
        None,
        &req.protocol,
        // 图像理解测试：此前误标为协议名，修复为独立类型（测试记录可按类型筛选）
        "image_understanding",
    )?;
    records::log_event(
        conn,
        &trace_id,
        "request_serialization",
        "serialize",
        "ok",
        false,
        Some(&format!(
            "Vision：{} 张图片（{} url / {} base64），文本 {} 字符；图片原样传递未压缩",
            req.images.len(),
            req.images.iter().filter(|i| i.kind == "url").count(),
            req.images.iter().filter(|i| i.kind == "base64").count(),
            req.text.trim().len()
        )),
        None,
    )?;
    records::log_event(
        conn,
        &trace_id,
        "auth_header",
        "inject",
        "ok",
        false,
        Some("已注入认证 Header（值不进入任何记录）"),
        None,
    )?;

    let raw_request = json!({
        "trace_id": trace_id,
        "url": target.url,
        "method": "POST",
        "headers": target.headers.iter().map(|(n, v)| (n.clone(), mask_header_value(n, v))).collect::<Vec<_>>(),
        // base64 图片体积大，请求 Raw 中以长度摘要代替原图（原始输入由用户本地持有）
        "body": summarize_body(&body),
    });
    let request_path = paths::write_archive_atomic(
        &paths::archive_requests_dir(data_dir),
        &format!("{trace_id}.json"),
        &serde_json::to_string_pretty(&raw_request)
            .map_err(|e| AppError::Invalid(format!("Raw 序列化失败: {e}")))?,
    )?;
    let request_ref = rel(data_dir, &request_path);
    records::log_event(
        conn,
        &trace_id,
        "raw_request_saving",
        "save",
        "ok",
        false,
        Some(&request_ref),
        None,
    )?;

    Ok(PreparedVision {
        trace_id,
        target,
        body,
        request_ref,
    })
}

pub struct PreparedVision {
    pub trace_id: String,
    pub target: crate::workbenches::api_testing::builder::RequestTarget,
    pub body: Value,
    pub request_ref: String,
}

/// Raw 请求归档摘要：base64 数据替换为长度说明（完整请求体在内存中发送）。
fn summarize_body(body: &Value) -> Value {
    let mut clone = body.clone();
    fn walk(value: &mut Value) {
        match value {
            Value::Object(map) => {
                for (k, v) in map.iter_mut() {
                    if k == "data" || k == "url" {
                        if let Some(s) = v.as_str() {
                            if s.len() > 512 {
                                *v = Value::String(format!(
                                    "<省略 {} 字符，见渠道实际请求>",
                                    s.len()
                                ));
                                continue;
                            }
                        }
                    }
                    walk(v);
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item);
                }
            }
            _ => {}
        }
    }
    walk(&mut clone);
    clone
}

/// 发送（异步，无锁）。
pub async fn send(prepared: &PreparedVision) -> AppResult<(u16, String, i64)> {
    let client = crate::util::http_client(prepared.target.timeout_secs, prepared.target.tls_verify)
        .map_err(AppError::Invalid)?;
    let start = std::time::Instant::now();
    let mut request = client.post(&prepared.target.url);
    for (name, value) in &prepared.target.headers {
        request = request.header(name, value);
    }
    let response = request
        .body(prepared.body.to_string())
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("HTTP 请求失败: {e}")))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|e| AppError::Invalid(format!("读取响应失败: {e}")))?;
    Ok((status, text, start.elapsed().as_millis() as i64))
}

/// 收尾（数据库锁内）。
pub fn finalize(
    conn: &Connection,
    data_dir: &Path,
    req: &VisionRequest,
    prepared: &PreparedVision,
    http_status: u16,
    body: &str,
    duration_ms: i64,
) -> AppResult<VisionResult> {
    let raw_response = json!({
        "trace_id": prepared.trace_id,
        "http_status": http_status,
        "body": body,
    });
    let response_path = paths::write_archive_atomic(
        &paths::archive_responses_dir(data_dir),
        &format!("{}.json", prepared.trace_id),
        &serde_json::to_string_pretty(&raw_response)
            .map_err(|e| AppError::Invalid(format!("Raw 响应序列化失败: {e}")))?,
    )?;
    let response_ref = rel(data_dir, &response_path);

    let preview =
        crate::workbenches::api_testing::parser::parse_response(&req.protocol, http_status, body);
    let (status, error_message) = if preview.error.is_some() {
        if (200..300).contains(&http_status) {
            ("protocol_error", None)
        } else {
            ("http_error", None)
        }
    } else {
        ("success", None)
    };
    records::log_event(
        conn,
        &prepared.trace_id,
        "preview_generation",
        "parse",
        if preview.error.is_some() {
            "failed"
        } else {
            "ok"
        },
        false,
        Some(if preview.error.is_some() {
            "响应包含错误，Preview 保留原始错误对象"
        } else {
            "Vision 响应解析完成"
        }),
        None,
    )?;
    records::finish(
        conn,
        &prepared.trace_id,
        status,
        None,
        error_message,
        preview.provider_request_id.as_deref(),
        Some(i64::from(http_status)),
        None,
        None,
        Some(duration_ms),
        preview.usage.as_ref().and_then(|u| u.input),
        preview.usage.as_ref().and_then(|u| u.output),
        preview.usage.as_ref().and_then(|u| u.cache_read),
        None,
        Some(&prepared.request_ref),
        Some(&response_ref),
        Some(req.model.trim()),
    )?;

    Ok(VisionResult {
        trace_id: prepared.trace_id.clone(),
        status: status.to_string(),
        http_status: Some(http_status),
        preview,
        raw_response_ref: Some(response_ref),
    })
}

fn rel(data_dir: &Path, file: &Path) -> String {
    file.strip_prefix(data_dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file.to_string_lossy().into_owned())
}
