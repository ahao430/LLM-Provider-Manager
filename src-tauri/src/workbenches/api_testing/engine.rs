//! API 测试工作台引擎：发送（非流式 / 流式）、Raw 归档、事件记录、指标计算。
//!
//! 职责（PLAN.md「处理透明度」）：
//! - 每一步生成 ProcessingEvent，如实描述；
//! - Raw 请求 / 响应完整归档（原子写入），解析失败不影响原始数据；
//! - 失败分类：http_error / protocol_error / stream_error 分别记录。

use std::path::Path;
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::requests::repo as records;
use crate::storage::paths;

use super::builder::{self, ApiTestRequest, BuiltRequest};
use super::parser::{self, ResponsePreview, SseParser, UsagePreview};

/// 工作台单次运行结果（同步返回给前端的最终状态）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRunResult {
    pub trace_id: String,
    pub status: String,
    pub http_status: Option<u16>,
    pub preview: ResponsePreview,
    pub request_ref: Option<String>,
    pub response_ref: Option<String>,
    pub ttfb_ms: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub duration_ms: Option<i64>,
    pub warnings: Vec<String>,
}

/// 流式事件（经 Tauri Channel 推送到前端）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamEvent {
    /// 内容增量（index 递增；raw_block 为对应 SSE 块原文）
    Delta {
        index: u64,
        delta: String,
        raw_block: String,
    },
    /// 阶段性状态说明
    Status { message: String },
}

/// 准备阶段（数据库锁内）：构建请求、写入 pending 记录、序列化 / 认证 / 保存事件。
pub fn prepare(
    conn: &rusqlite::Connection,
    data_dir: &Path,
    req: &ApiTestRequest,
) -> AppResult<PreparedRun> {
    let built = builder::build(conn, req)?;
    let trace_id = uuid::Uuid::new_v4().to_string();

    records::insert_pending(
        conn,
        &trace_id,
        &req.channel_id,
        req.channel_model_id.as_deref(),
        req.parent_trace_id.as_deref(),
        &req.protocol,
        "api_test",
    )?;

    for note in &built.notes {
        records::log_event(
            conn,
            &trace_id,
            "request_serialization",
            "serialize",
            "ok",
            false,
            Some(note),
            None,
        )?;
    }
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

    // Raw 请求归档（Header 脱敏）
    let masked_headers: Vec<(String, String)> = built
        .headers
        .iter()
        .map(|(n, v)| (n.clone(), builder::mask_header_value(n, v)))
        .collect();
    let raw_request = json!({
        "trace_id": trace_id,
        "url": built.url,
        "method": "POST",
        "headers": masked_headers,
        "body": built.body,
    });
    let request_path = paths::write_archive_atomic(
        &paths::archive_requests_dir(data_dir),
        &format!("{trace_id}.json"),
        &serde_json::to_string_pretty(&raw_request)
            .map_err(|e| AppError::Invalid(format!("Raw 请求序列化失败: {e}")))?,
    )?;
    let request_ref = rel_path(data_dir, &request_path);
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
    records::log_event(
        conn,
        &trace_id,
        "http_request",
        "send",
        "ok",
        false,
        Some(&built.url),
        None,
    )?;

    Ok(PreparedRun {
        trace_id,
        built,
        request_ref,
    })
}

pub struct PreparedRun {
    pub trace_id: String,
    pub built: BuiltRequest,
    pub request_ref: String,
}

/// 发送非流式请求。返回（状态码, 响应头, 响应体, TTFB ms）。
pub async fn send_non_stream(
    built: &BuiltRequest,
) -> AppResult<(u16, Vec<(String, String)>, String, i64)> {
    let client = crate::util::http_client(built.timeout_secs, built.tls_verify)
        .map_err(AppError::Invalid)?;
    let start = Instant::now();
    let mut request = client.post(&built.url);
    for (name, value) in &built.headers {
        request = request.header(name, value);
    }
    let response = request
        .body(built.body.to_string())
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("HTTP 请求失败（网络 / DNS / TLS / 超时）: {e}")))?;
    let ttfb_ms = start.elapsed().as_millis() as i64;
    let status = response.status().as_u16();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<binary>").to_string()))
        .collect();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::Invalid(format!("读取响应体失败: {e}")))?;
    Ok((status, headers, body, ttfb_ms))
}

/// 非流式收尾（数据库锁内）：Raw 响应归档、Preview 解析、记录与事件更新。
#[allow(clippy::too_many_arguments)]
pub fn finalize_non_stream(
    conn: &rusqlite::Connection,
    data_dir: &Path,
    req: &ApiTestRequest,
    run: &PreparedRun,
    http_status: u16,
    response_headers: Vec<(String, String)>,
    body: &str,
    ttfb_ms: i64,
    duration_ms: i64,
) -> AppResult<TestRunResult> {
    let masked_headers: Vec<(String, String)> = response_headers
        .iter()
        .map(|(n, v)| (n.clone(), builder::mask_header_value(n, v)))
        .collect();
    let raw_response = json!({
        "trace_id": run.trace_id,
        "http_status": http_status,
        "headers": masked_headers,
        "body": body,
    });
    let response_path = paths::write_archive_atomic(
        &paths::archive_responses_dir(data_dir),
        &format!("{}.json", run.trace_id),
        &serde_json::to_string_pretty(&raw_response)
            .map_err(|e| AppError::Invalid(format!("Raw 响应序列化失败: {e}")))?,
    )?;
    let response_ref = rel_path(data_dir, &response_path);
    records::log_event(
        conn,
        &run.trace_id,
        "raw_response_saving",
        "save",
        "ok",
        false,
        Some(&response_ref),
        None,
    )?;

    let preview = parser::parse_response(&req.protocol, http_status, body);
    records::log_event(
        conn,
        &run.trace_id,
        "preview_generation",
        "parse",
        if preview.error.is_some() {
            "failed"
        } else {
            "ok"
        },
        false,
        Some(if preview.error.is_some() {
            "响应包含错误，Preview 仅保留原始错误对象"
        } else {
            "Preview 提取完成（text / thinking / tool_calls / usage / finish）"
        }),
        None,
    )?;

    let (status, error_code, error_message) = classify(http_status, preview.error.is_some(), None);
    let tokens = preview.usage.as_ref();

    records::finish(
        conn,
        &run.trace_id,
        status,
        error_code.as_deref(),
        error_message.as_deref(),
        preview.provider_request_id.as_deref(),
        Some(i64::from(http_status)),
        Some(ttfb_ms),
        None, // 非流式不产生逐 Token 到达时间，TTFT 为 NULL
        Some(duration_ms),
        tokens.and_then(|u| u.input),
        tokens.and_then(|u| u.output),
        tokens.and_then(|u| u.cache_read),
        None, // 非流式不计算 TPS
        Some(&run.request_ref),
        Some(&response_ref),
        Some(req.model.trim()),
    )?;

    Ok(TestRunResult {
        trace_id: run.trace_id.clone(),
        status: status.to_string(),
        http_status: Some(http_status),
        preview,
        request_ref: Some(run.request_ref.clone()),
        response_ref: Some(response_ref),
        ttfb_ms: Some(ttfb_ms),
        ttft_ms: None,
        duration_ms: Some(duration_ms),
        warnings: Vec::new(),
    })
}

/// 流式执行第一阶段（异步，不持有数据库锁）：
/// HTTP + SSE 增量接收，增量经 Channel 推送。
pub async fn stream_http(
    built: &BuiltRequest,
    protocol: &str,
    on_event: &Channel<StreamEvent>,
) -> AppResult<StreamOutcome> {
    let client = crate::util::http_client(built.timeout_secs, built.tls_verify)
        .map_err(AppError::Invalid)?;
    let start = Instant::now();
    let mut request = client.post(&built.url);
    for (name, value) in &built.headers {
        request = request.header(name, value);
    }
    let response = request
        .body(built.body.to_string())
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("HTTP 请求失败（网络 / DNS / TLS / 超时）: {e}")))?;
    let ttfb_ms = start.elapsed().as_millis() as i64;
    let http_status = response.status().as_u16();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<binary>").to_string()))
        .collect();

    let _ = on_event.send(StreamEvent::Status {
        message: format!("HTTP {http_status}，开始接收流式响应"),
    });

    let mut sse_raw = String::new();
    let mut sse_parser = SseParser::default();
    let mut text_acc = String::new();
    let mut usage: Option<UsagePreview> = None;
    let mut ttft_ms: Option<i64> = None;
    let mut index: u64 = 0;
    let mut stream_error: Option<String> = None;
    let mut error_body: Option<String> = None;

    // 非 2xx：直接读完整 body 当作普通错误响应处理（此时通常不是 SSE）
    if !(200..300).contains(&http_status) {
        error_body = Some(
            response
                .text()
                .await
                .map_err(|e| AppError::Invalid(format!("读取错误响应体失败: {e}")))?,
        );
    } else {
        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let chunk_str = String::from_utf8_lossy(&bytes);
                    sse_raw.push_str(&chunk_str);
                    for ev in sse_parser.feed(&chunk_str) {
                        if let Some(delta) = parser::extract_stream_delta(protocol, &ev.data) {
                            if ttft_ms.is_none() {
                                ttft_ms = Some(start.elapsed().as_millis() as i64);
                            }
                            text_acc.push_str(&delta);
                            index += 1;
                            let _ = on_event.send(StreamEvent::Delta {
                                index,
                                delta,
                                raw_block: ev.data.clone(),
                            });
                        }
                        if let Some(u) = parser::extract_stream_usage(protocol, &ev.data) {
                            usage = Some(u);
                        }
                    }
                }
                Err(e) => {
                    stream_error = Some(format!("{e}"));
                    break;
                }
            }
        }
    }

    let duration_ms = start.elapsed().as_millis() as i64;
    Ok(StreamOutcome {
        http_status,
        headers,
        ttfb_ms,
        duration_ms,
        sse_raw,
        text_acc,
        usage,
        ttft_ms,
        stream_error,
        error_body,
    })
}

/// 流式第一阶段结果。
pub struct StreamOutcome {
    pub http_status: u16,
    pub headers: Vec<(String, String)>,
    pub ttfb_ms: i64,
    pub duration_ms: i64,
    pub sse_raw: String,
    pub text_acc: String,
    pub usage: Option<UsagePreview>,
    pub ttft_ms: Option<i64>,
    pub stream_error: Option<String>,
    pub error_body: Option<String>,
}

/// 流式第二阶段（数据库锁内，同步）：Preview、Raw 归档、事件与记录更新。
pub fn finalize_stream(
    conn: &rusqlite::Connection,
    data_dir: &Path,
    req: &ApiTestRequest,
    run: &PreparedRun,
    outcome: &StreamOutcome,
) -> AppResult<TestRunResult> {
    // Preview：流式成功时用累积文本；出错时用原始错误响应
    let preview = if let Some(err_body) = &outcome.error_body {
        parser::parse_response(&req.protocol, outcome.http_status, err_body)
    } else if let Some(err) = &outcome.stream_error {
        let mut p = ResponsePreview {
            text: outcome.text_acc.clone(),
            ..Default::default()
        };
        p.error = Some(json!({
            "stream_interrupted": true,
            "message": err,
            "note": "流中断前的增量已累计，原始 SSE 已完整归档"
        }));
        p
    } else {
        ResponsePreview {
            text: outcome.text_acc.clone(),
            usage: outcome.usage.clone(),
            ..Default::default()
        }
    };

    // Raw 归档：SSE 原文（含顺序与不完整尾部）+ 元信息
    let raw_response = json!({
        "trace_id": run.trace_id,
        "http_status": outcome.http_status,
        "headers": outcome.headers.iter().map(|(n, v)| (n.clone(), builder::mask_header_value(n, v))).collect::<Vec<_>>(),
        "stream": true,
        "sse_raw": outcome.sse_raw,
    });
    let response_path = paths::write_archive_atomic(
        &paths::archive_responses_dir(data_dir),
        &format!("{}.sse.json", run.trace_id),
        &serde_json::to_string_pretty(&raw_response)
            .map_err(|e| AppError::Invalid(format!("Raw SSE 序列化失败: {e}")))?,
    )?;
    let response_ref = rel_path(data_dir, &response_path);

    let (status, error_code, error_message) = classify(
        outcome.http_status,
        preview.error.is_some(),
        outcome.stream_error.as_deref(),
    );

    records::log_event(
        conn,
        &run.trace_id,
        "sse_parsing",
        "parse",
        if outcome.stream_error.is_some() {
            "failed"
        } else {
            "ok"
        },
        false,
        Some(if outcome.stream_error.is_some() {
            "流中断，中断前的事件已解析，原始 SSE 完整保留"
        } else {
            "SSE 事件解析完成（增量文本 / usage / finish）"
        }),
        None,
    )?;
    records::log_event(
        conn,
        &run.trace_id,
        "raw_response_saving",
        "save",
        "ok",
        false,
        Some(&response_ref),
        None,
    )?;

    // TPS 仅在流式且数据足够可靠时计算：有首 Token 且总时长大于 TTFT
    let tokens_per_second = match (
        outcome.ttft_ms,
        preview.usage.as_ref().and_then(|u| u.output),
    ) {
        (Some(ttft), Some(output)) if output > 0 && outcome.duration_ms > ttft => {
            Some(output as f64 / ((outcome.duration_ms - ttft) as f64 / 1000.0))
        }
        _ => None,
    };

    records::finish(
        conn,
        &run.trace_id,
        status,
        error_code.as_deref(),
        error_message.as_deref(),
        preview.provider_request_id.as_deref(),
        Some(i64::from(outcome.http_status)),
        Some(outcome.ttfb_ms),
        outcome.ttft_ms,
        Some(outcome.duration_ms),
        preview.usage.as_ref().and_then(|u| u.input),
        preview.usage.as_ref().and_then(|u| u.output),
        preview.usage.as_ref().and_then(|u| u.cache_read),
        tokens_per_second,
        Some(&run.request_ref),
        Some(&response_ref),
        Some(req.model.trim()),
    )?;

    Ok(TestRunResult {
        trace_id: run.trace_id.clone(),
        status: status.to_string(),
        http_status: Some(outcome.http_status),
        preview,
        request_ref: Some(run.request_ref.clone()),
        response_ref: Some(response_ref),
        ttfb_ms: Some(outcome.ttfb_ms),
        ttft_ms: outcome.ttft_ms,
        duration_ms: Some(outcome.duration_ms),
        warnings: Vec::new(),
    })
}

fn classify(
    http_status: u16,
    has_error: bool,
    stream_error: Option<&str>,
) -> (&'static str, Option<String>, Option<String>) {
    if let Some(err) = stream_error {
        return (
            "stream_error",
            Some("STREAM_INTERRUPTED".into()),
            Some(err.to_string()),
        );
    }
    if !(200..300).contains(&http_status) {
        return ("http_error", Some(format!("HTTP_{http_status}")), None);
    }
    if has_error {
        return ("protocol_error", Some("PROTOCOL_ERROR".into()), None);
    }
    ("success", None, None)
}

fn rel_path(data_dir: &Path, file: &Path) -> String {
    file.strip_prefix(data_dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file.to_string_lossy().into_owned())
}

/// 读取归档文件内容（命令层使用）。
pub fn read_raw(data_dir: &Path, rel: &str) -> AppResult<String> {
    // 防路径穿越：只允许 archives/ 下的相对路径
    if rel.contains("..") {
        return Err(AppError::Invalid("非法的归档路径".into()));
    }
    let path = data_dir.join(rel);
    std::fs::read_to_string(&path).map_err(|e| AppError::Invalid(format!("读取归档失败: {e}")))
}

/// 从响应 Raw 提取当前解析版本（历史重新解析的入口；不覆盖原始数据）。
pub fn parse_stored_response(protocol: &str, raw_json: &str) -> AppResult<ResponsePreview> {
    let value: Value = serde_json::from_str(raw_json)
        .map_err(|e| AppError::Invalid(format!("归档解析失败: {e}")))?;
    if let Some(body) = value.get("body").and_then(Value::as_str) {
        let status = value
            .get("http_status")
            .and_then(Value::as_u64)
            .unwrap_or(200) as u16;
        Ok(parser::parse_response(protocol, status, body))
    } else if let Some(sse) = value.get("sse_raw").and_then(Value::as_str) {
        // 流式历史：重新解析全部事件
        let mut text = String::new();
        let mut usage = None;
        let mut p = SseParser::default();
        for ev in p.feed(sse) {
            if let Some(delta) = parser::extract_stream_delta(protocol, &ev.data) {
                text.push_str(&delta);
            }
            if let Some(u) = parser::extract_stream_usage(protocol, &ev.data) {
                usage = Some(u);
            }
        }
        Ok(ResponsePreview {
            text,
            usage,
            ..Default::default()
        })
    } else {
        Err(AppError::Invalid("归档缺少 body / sse_raw 字段".into()))
    }
}
