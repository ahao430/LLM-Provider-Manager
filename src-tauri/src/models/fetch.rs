//! 模型列表获取（GET {base}/models，OpenAI / Anthropic 兼容）。
//!
//! 获取与导入分离：结果只返回给前端，由用户确认选择后再调用导入。
//! 认证与 Header 规则与 API 测试工作台一致（Phase 3 复用此处逻辑的抽象）。

use std::time::Duration;

use rusqlite::Connection;
use serde_json::Value;

use crate::channels::domain::ChannelConfig;
use crate::channels::{repo as channel_repo, service as channel_service};
use crate::error::{AppError, AppResult};

use super::domain::{RemoteModel, RemoteModelList};

/// 第一步（同步）：从渠道配置与凭证库组装请求目标。锁内完成，不跨 await。
pub struct FetchTarget {
    pub channel_id: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub timeout_secs: u64,
    pub tls_verify: bool,
}

pub fn prepare(conn: &Connection, channel_id: &str) -> AppResult<FetchTarget> {
    let row = channel_repo::find_row(conn, channel_id)?
        .ok_or_else(|| AppError::Invalid("渠道不存在".into()))?;
    let config: ChannelConfig = channel_repo::load_config(conn, channel_id)?;
    let token = channel_service::resolve_primary_credential(channel_id);

    // 模型列表走 chat Base URL（OpenAI 兼容 /models）；主地址不带 /v1 时自动补
    let base = crate::channels::domain::ensure_v1(&row.base_url_for("openai_chat"));
    if base.is_empty() {
        return Err(AppError::Invalid("该渠道未配置 Chat Base URL".into()));
    }
    let url = format!("{}/models", base.trim_end_matches('/'));

    let mut headers = Vec::new();
    if let Some(token) = token {
        headers.push(("Authorization".into(), format!("Bearer {token}")));
    }

    Ok(FetchTarget {
        channel_id: channel_id.to_string(),
        url,
        headers,
        timeout_secs: 30,
        tls_verify: config.tls_verify,
    })
}

/// 第二步（异步）：执行 HTTP GET 并解析响应。不持有数据库锁。
pub async fn perform(target: FetchTarget) -> AppResult<RemoteModelList> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(target.timeout_secs))
        .user_agent(concat!("LCM/", env!("CARGO_PKG_VERSION")));
    if !target.tls_verify {
        // 用户显式关闭 TLS 验证时才允许（PLAN.md：TLS 默认启用证书验证）
        builder = builder.danger_accept_invalid_certs(true);
    }
    let client = builder
        .build()
        .map_err(|e| AppError::Invalid(format!("HTTP 客户端构建失败: {e}")))?;

    let mut request = client.get(&target.url);
    for (name, value) in &target.headers {
        request = request.header(name, value);
    }
    let response = request
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("请求失败（网络 / DNS / TLS）: {e}")))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::Invalid(format!("读取响应失败: {e}")))?;

    let (models, note) = parse_model_list(status, &body)?;
    Ok(RemoteModelList {
        channel_id: target.channel_id,
        url: target.url,
        http_status: status,
        models,
        note,
    })
}

/// 解析 OpenAI ({data:[{id}]}) / Anthropic ({data:[{id,display_name}]}) 形状。
/// 无法解析时如实报错并携带原始响应片段，不伪造数据。
fn parse_model_list(status: u16, body: &str) -> AppResult<(Vec<RemoteModel>, Option<String>)> {
    if !(200..300).contains(&status) {
        let snippet: String = body.chars().take(400).collect();
        return Err(AppError::Invalid(format!(
            "渠道返回 HTTP {status}，原始响应片段：{snippet}"
        )));
    }

    let root: Value = serde_json::from_str(body).map_err(|e| {
        AppError::Invalid(format!(
            "响应不是合法 JSON: {e}；原始片段：{}",
            body.chars().take(200).collect::<String>()
        ))
    })?;

    let data = match root.get("data") {
        Some(Value::Array(items)) => items.clone(),
        Some(_) => {
            return Err(AppError::Invalid(
                "响应中 data 字段不是数组，无法解析模型列表".into(),
            ))
        }
        None if root.is_array() => root.as_array().unwrap().clone(),
        None => {
            let keys: Vec<String> = root
                .as_object()
                .map(|o| o.keys().cloned().collect())
                .unwrap_or_default();
            return Err(AppError::Invalid(format!(
                "响应缺少 data 数组（顶层字段：{}），无法解析模型列表",
                keys.join(", ")
            )));
        }
    };

    let mut models = Vec::new();
    let mut skipped = 0usize;
    for item in &data {
        match item {
            Value::String(id) => models.push(RemoteModel {
                id: id.clone(),
                display_name: None,
            }),
            Value::Object(obj) => {
                let id = obj.get("id").and_then(Value::as_str).map(str::to_owned);
                match id {
                    Some(id) => {
                        let display_name = ["display_name", "displayName", "name"]
                            .iter()
                            .find_map(|k| obj.get(*k).and_then(Value::as_str))
                            .map(str::to_owned);
                        models.push(RemoteModel { id, display_name });
                    }
                    None => skipped += 1,
                }
            }
            _ => skipped += 1,
        }
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);

    let note = (skipped > 0).then(|| format!("另有 {skipped} 条无法识别的条目已跳过"));
    Ok((models, note))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_openai_shape() {
        let body = r#"{"object":"list","data":[{"id":"glm-5.2","owned_by":"x"},{"id":"m2"}]}"#;
        let (models, note) = parse_model_list(200, body).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "glm-5.2");
        assert!(note.is_none());
    }

    #[test]
    fn parse_anthropic_shape() {
        let body = r#"{"data":[{"id":"claude","display_name":"Claude"},{"type":"webhook_event"}]}"#;
        let (models, note) = parse_model_list(200, body).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].display_name.as_deref(), Some("Claude"));
        assert_eq!(note.as_deref(), Some("另有 1 条无法识别的条目已跳过"));
    }

    #[test]
    fn error_status_is_transparent() {
        let err = parse_model_list(401, r#"{"error":{"message":"bad key"}}"#).unwrap_err();
        assert!(err.to_string().contains("HTTP 401"));
        assert!(err.to_string().contains("bad key"));
    }
}
