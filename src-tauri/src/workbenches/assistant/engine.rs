//! 内嵌 Agent 对话引擎：多轮上下文构建 + 流式请求 + 记录。
//!
//! 异步阶段（stream_http）不持有数据库锁；落库在锁内的 finalize 中完成。

use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::requests::repo as records;
use crate::storage::paths;
use crate::workbenches::api_testing::builder::{mask_header_value, request_target, BuiltRequest};
use crate::workbenches::api_testing::engine::{stream_http, StreamEvent, StreamOutcome};
use crate::workbenches::api_testing::parser;

use super::repo::{self, ConversationRow, MessageRow};

const PROTOCOLS: &[&str] = &["openai_chat", "anthropic_messages"];
/// 发送给模型的上下文窗口（最近 N 条消息）。
const CONTEXT_LIMIT: usize = 20;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageInput {
    pub conversation_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReply {
    pub trace_id: String,
    pub conversation_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub text: String,
    pub status: String,
    pub http_status: Option<u16>,
    pub usage: Option<parser::UsagePreview>,
}

/// 单轮会话上下文（锁内准备，跨 await 传递无锁数据）。
pub struct PreparedTurn {
    pub trace_id: String,
    pub conversation: ConversationRow,
    pub built: BuiltRequest,
    pub request_ref: String,
    pub user_message_id: String,
    pub context_len: usize,
}

/// 准备阶段（数据库锁内）：构建请求、写入 pending 记录与用户消息。
pub fn prepare(
    conn: &Connection,
    data_dir: &Path,
    input: &SendMessageInput,
) -> AppResult<PreparedTurn> {
    if input.content.trim().is_empty() {
        return Err(AppError::Invalid("消息内容不能为空".into()));
    }
    let conversation: ConversationRow = repo::get(conn, &input.conversation_id)?;
    if !PROTOCOLS.contains(&conversation.protocol.as_str()) {
        return Err(AppError::Invalid(format!(
            "内嵌 Agent 暂不支持协议 {}（当前支持 openai_chat / anthropic_messages）",
            conversation.protocol
        )));
    }

    let target = request_target(
        conn,
        &conversation.channel_id,
        &conversation.protocol,
        match conversation.protocol.as_str() {
            "openai_chat" => "/chat/completions",
            "anthropic_messages" => "/messages",
            _ => unreachable!("已校验"),
        },
        &[],
        &[],
    )?;

    // 上下文：最近 N 条历史 + 本条用户消息
    let history = repo::list_messages(conn, &conversation.id)?;
    let start = history.len().saturating_sub(CONTEXT_LIMIT);
    let mut context: Vec<(String, String)> = history[start..]
        .iter()
        .map(|m: &MessageRow| (m.role.clone(), m.content.clone()))
        .collect();
    context.push(("user".into(), input.content.trim().to_string()));

    let body = build_body(&conversation, &context)?;

    let trace_id = uuid::Uuid::new_v4().to_string();
    records::insert_pending(
        conn,
        &trace_id,
        &conversation.channel_id,
        conversation.channel_model_id.as_deref(),
        Some(&conversation.id),
        &conversation.protocol,
        "agent_chat",
    )?;
    records::log_event(
        conn,
        &trace_id,
        "request_serialization",
        "serialize",
        "ok",
        false,
        Some(&format!(
            "内嵌 Agent：上下文 {} 条（上限 {CONTEXT_LIMIT}），协议 {}",
            context.len(),
            conversation.protocol
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
        "body": body,
    });
    let request_path = paths::write_archive_atomic(
        &paths::archive_requests_dir(data_dir),
        &format!("{trace_id}.json"),
        &serde_json::to_string_pretty(&raw_request)
            .map_err(|e| AppError::Invalid(format!("Raw 序列化失败: {e}")))?,
    )?;
    let request_ref = rel(data_dir, &request_path);

    let user_message_id =
        repo::insert_message(conn, &conversation.id, "user", input.content.trim(), None)?;

    Ok(PreparedTurn {
        trace_id,
        conversation,
        built: BuiltRequest {
            url: target.url,
            headers: target.headers,
            body,
            notes: Vec::new(),
            timeout_secs: target.timeout_secs,
            tls_verify: target.tls_verify,
        },
        request_ref,
        user_message_id,
        context_len: context.len(),
    })
}

fn build_body(conversation: &ConversationRow, context: &[(String, String)]) -> AppResult<Value> {
    match conversation.protocol.as_str() {
        "openai_chat" => {
            let mut messages = Vec::new();
            if let Some(system) = conversation
                .system
                .as_deref()
                .filter(|s| !s.trim().is_empty())
            {
                messages.push(json!({"role": "system", "content": system}));
            }
            for (role, content) in context {
                messages.push(json!({"role": role, "content": content}));
            }
            Ok(json!({"model": conversation.model, "messages": messages, "stream": true}))
        }
        "anthropic_messages" => {
            let mut body = json!({
                "model": conversation.model,
                "max_tokens": 4096,
                "messages": context
                    .iter()
                    .map(|(role, content)| json!({"role": role, "content": content}))
                    .collect::<Vec<_>>(),
                "stream": true,
            });
            if let Some(system) = conversation
                .system
                .as_deref()
                .filter(|s| !s.trim().is_empty())
            {
                body.as_object_mut()
                    .expect("body 是 object")
                    .insert("system".into(), json!(system));
            }
            Ok(body)
        }
        other => Err(AppError::Invalid(format!("不支持的协议: {other}"))),
    }
}

/// 异步阶段（无数据库锁）：流式接收，增量经 Channel 推送。
pub async fn stream_turn(
    prepared: &PreparedTurn,
    on_event: &Channel<StreamEvent>,
) -> AppResult<StreamOutcome> {
    stream_http(&prepared.built, &prepared.conversation.protocol, on_event).await
}

/// 同步收尾（数据库锁内）：Preview、归档、记录与消息落库。
pub fn finalize_turn(
    conn: &Connection,
    data_dir: &Path,
    prepared: &PreparedTurn,
    outcome: &StreamOutcome,
) -> AppResult<AgentReply> {
    let (text, status, error_message) = if let Some(err_body) = &outcome.error_body {
        let preview = parser::parse_response(
            &prepared.conversation.protocol,
            outcome.http_status,
            err_body,
        );
        let msg = preview
            .error
            .as_ref()
            .map(|e| serde_json::to_string(e).unwrap_or_default());
        (String::new(), "http_error", msg)
    } else if let Some(err) = &outcome.stream_error {
        (
            outcome.text_acc.clone(),
            "stream_error",
            Some(format!("流中断：{err}；中断前内容已保留")),
        )
    } else {
        (outcome.text_acc.clone(), "success", None)
    };

    // Raw 响应归档
    let raw_response = json!({
        "trace_id": prepared.trace_id,
        "http_status": outcome.http_status,
        "headers": outcome.headers.iter().map(|(n, v)| (n.clone(), mask_header_value(n, v))).collect::<Vec<_>>(),
        "stream": true,
        "sse_raw": outcome.sse_raw,
    });
    let response_path = paths::write_archive_atomic(
        &paths::archive_responses_dir(data_dir),
        &format!("{}.sse.json", prepared.trace_id),
        &serde_json::to_string_pretty(&raw_response)
            .map_err(|e| AppError::Invalid(format!("Raw SSE 序列化失败: {e}")))?,
    )?;
    let response_ref = rel(data_dir, &response_path);

    // TPS（流式且可靠时）
    let tokens_per_second = match (
        outcome.ttft_ms,
        outcome.usage.as_ref().and_then(|u| u.output),
    ) {
        (Some(ttft), Some(output)) if output > 0 && outcome.duration_ms > ttft => {
            Some(output as f64 / ((outcome.duration_ms - ttft) as f64 / 1000.0))
        }
        _ => None,
    };

    records::log_event(
        conn,
        &prepared.trace_id,
        "sse_parsing",
        "parse",
        if outcome.stream_error.is_some() {
            "failed"
        } else {
            "ok"
        },
        false,
        Some(if outcome.stream_error.is_some() {
            "流中断，中断前内容已保留，原始 SSE 完整归档"
        } else {
            "SSE 事件解析完成"
        }),
        None,
    )?;
    records::finish(
        conn,
        &prepared.trace_id,
        status,
        None,
        error_message.as_deref(),
        None,
        Some(i64::from(outcome.http_status)),
        Some(outcome.ttfb_ms),
        outcome.ttft_ms,
        Some(outcome.duration_ms),
        outcome.usage.as_ref().and_then(|u| u.input),
        outcome.usage.as_ref().and_then(|u| u.output),
        outcome.usage.as_ref().and_then(|u| u.cache_read),
        tokens_per_second,
        Some(&prepared.request_ref),
        Some(&response_ref),
        Some(&prepared.conversation.model),
    )?;

    // 助手消息落库（流中断时保留已收到内容并如实标记状态）
    let assistant_content = if text.is_empty() && error_message.is_some() {
        format!("[{}] {}", status, error_message.clone().unwrap_or_default())
    } else {
        text.clone()
    };
    let assistant_message_id = repo::insert_message(
        conn,
        &prepared.conversation.id,
        "assistant",
        &assistant_content,
        Some(&prepared.trace_id),
    )?;
    let title = if prepared.context_len <= 1 {
        Some(input_title(&text, &prepared.conversation.model))
    } else {
        None
    };
    repo::touch(conn, &prepared.conversation.id, title.as_deref())?;

    Ok(AgentReply {
        trace_id: prepared.trace_id.clone(),
        conversation_id: prepared.conversation.id.clone(),
        user_message_id: prepared.user_message_id.clone(),
        assistant_message_id,
        text,
        status: status.to_string(),
        http_status: Some(outcome.http_status),
        usage: outcome.usage.clone(),
    })
}

fn input_title(text: &str, fallback: &str) -> String {
    let first_line = text
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or(fallback);
    let chars: Vec<char> = first_line.trim().chars().collect();
    if chars.len() > 24 {
        format!("{}…", chars[..24].iter().collect::<String>())
    } else {
        chars.into_iter().collect()
    }
}

fn rel(data_dir: &Path, file: &Path) -> String {
    file.strip_prefix(data_dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file.to_string_lossy().into_owned())
}
