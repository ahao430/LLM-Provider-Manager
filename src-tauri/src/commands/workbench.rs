//! API 测试工作台命令：发送（非流式 / 流式）、记录查询、Raw 读取。

use rusqlite::Connection;
use serde::Serialize;
use tauri::{ipc::Channel, State};

use crate::error::AppResult;
use crate::requests::repo as records;
use crate::workbenches::api_testing::{
    builder::ApiTestRequest,
    engine::{self, StreamEvent, TestRunResult},
};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

/// 非流式测试请求。
#[tauri::command]
pub async fn send_test_request(
    state: State<'_, AppState>,
    req: ApiTestRequest,
) -> AppResult<TestRunResult> {
    let run = {
        let conn = db(&state)?;
        engine::prepare(&conn, &state.data_dir, &req)?
    }; // 锁在 HTTP 前释放

    let started = std::time::Instant::now();
    let (http_status, headers, body, ttfb_ms) = engine::send_non_stream(&run.built).await?;
    let duration_ms = started.elapsed().as_millis() as i64;

    let conn = db(&state)?;
    engine::finalize_non_stream(
        &conn,
        &state.data_dir,
        &req,
        &run,
        http_status,
        headers,
        &body,
        ttfb_ms,
        duration_ms,
    )
}

/// 流式测试请求：增量经 Channel 推送，最终结果同步返回。
#[tauri::command]
pub async fn send_test_stream(
    state: State<'_, AppState>,
    req: ApiTestRequest,
    on_event: Channel<StreamEvent>,
) -> AppResult<TestRunResult> {
    let run = {
        let conn = db(&state)?;
        engine::prepare(&conn, &state.data_dir, &req)?
    }; // 锁在 HTTP 前释放

    // 阶段一（异步，无数据库锁）：HTTP + SSE 接收
    let outcome = engine::stream_http(&run.built, &req.protocol, &on_event).await?;

    // 阶段二（锁内，同步）：Preview / 归档 / 记录
    let conn = db(&state)?;
    engine::finalize_stream(&conn, &state.data_dir, &req, &run, &outcome)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDetail {
    #[serde(flatten)]
    pub record: records::RequestRecordRow,
    pub processing_events: Vec<records::ProcessingEventRow>,
}

#[tauri::command]
pub fn list_test_records(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> AppResult<Vec<records::RequestRecordRow>> {
    let conn = db(&state)?;
    records::list(&conn, limit.unwrap_or(100).min(1000))
}

#[tauri::command]
pub fn get_test_record(state: State<'_, AppState>, trace_id: String) -> AppResult<RecordDetail> {
    let conn = db(&state)?;
    let record = records::get(&conn, &trace_id)?;
    let processing_events = records::list_events(&conn, &trace_id)?;
    Ok(RecordDetail {
        record,
        processing_events,
    })
}

/// 读取 Raw 归档文件内容（request / response）。
#[tauri::command]
pub fn get_test_raw(
    state: State<'_, AppState>,
    trace_id: String,
    kind: String,
) -> AppResult<String> {
    let conn = db(&state)?;
    let record = records::get(&conn, &trace_id)?;
    let rel = match kind.as_str() {
        "request" => record
            .request_ref
            .ok_or_else(|| crate::error::AppError::Invalid("该记录没有 Raw 请求文件".into()))?,
        "response" => record
            .response_ref
            .ok_or_else(|| crate::error::AppError::Invalid("该记录没有 Raw 响应文件".into()))?,
        other => {
            return Err(crate::error::AppError::Invalid(format!(
                "未知的 Raw 类型: {other}（应为 request 或 response）"
            )))
        }
    };
    engine::read_raw(&state.data_dir, &rel)
}

/// 对已归档响应做当前版本解析（历史重新解析；不覆盖原始数据）。
#[tauri::command]
pub fn reparse_test_response(
    state: State<'_, AppState>,
    trace_id: String,
) -> AppResult<crate::workbenches::api_testing::parser::ResponsePreview> {
    let conn = db(&state)?;
    let record = records::get(&conn, &trace_id)?;
    let protocol = record
        .protocol
        .clone()
        .ok_or_else(|| crate::error::AppError::Invalid("记录缺少协议信息".into()))?;
    let rel = record
        .response_ref
        .ok_or_else(|| crate::error::AppError::Invalid("该记录没有 Raw 响应文件".into()))?;
    let raw = engine::read_raw(&state.data_dir, &rel)?;
    engine::parse_stored_response(&protocol, &raw)
}

/// 历史请求重放：读取原 Raw 请求体原样重发（凭证按当前渠道配置重新注入），
/// 生成新 Trace 并记录 parent_trace_id。重放是用户主动操作，不自动重试。
#[tauri::command]
pub async fn replay_test_request(
    state: State<'_, AppState>,
    trace_id: String,
) -> AppResult<TestRunResult> {
    use serde_json::Value;

    let (original, body) = {
        let conn = db(&state)?;
        let record = records::get(&conn, &trace_id)?;
        let rel = record.request_ref.clone().ok_or_else(|| {
            crate::error::AppError::Invalid("该记录没有 Raw 请求文件，无法重放".into())
        })?;
        let raw = engine::read_raw(&state.data_dir, &rel)?;
        (record, raw)
    }; // 锁在 HTTP 前释放

    let raw: Value = serde_json::from_str(&body)
        .map_err(|e| crate::error::AppError::Invalid(format!("Raw 请求解析失败: {e}")))?;
    let request_body = raw
        .get("body")
        .cloned()
        .ok_or_else(|| crate::error::AppError::Invalid("Raw 请求缺少 body 字段".into()))?;
    let stream = request_body
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let req = ApiTestRequest {
        channel_id: original.channel_id.clone().ok_or_else(|| {
            crate::error::AppError::Invalid("原记录缺少渠道信息（渠道可能已删除），无法重放".into())
        })?,
        channel_model_id: original.channel_model_id.clone(),
        model: original.model.clone().unwrap_or_default(),
        protocol: original
            .protocol
            .clone()
            .unwrap_or_else(|| "openai_chat".into()),
        stream,
        system: None,
        messages: Vec::new(),
        params: Default::default(),
        extra_body: None,
        custom_headers: Vec::new(),
        custom_query: Vec::new(),
        raw_json: Some(request_body),
        parent_trace_id: Some(trace_id.clone()),
    };

    let run = {
        let conn = db(&state)?;
        engine::prepare(&conn, &state.data_dir, &req)?
    };

    if req.stream {
        // 流式原请求：重放时以非流式方式收集完整响应（同一请求体，渠道按 stream:true 返回 SSE，
        // 完整 SSE 文本作为响应体归档，Preview 解析失败时保留原文）
        let started = std::time::Instant::now();
        let (http_status, headers, resp_body, ttfb_ms) =
            engine::send_non_stream(&run.built).await?;
        let duration_ms = started.elapsed().as_millis() as i64;
        let conn = db(&state)?;
        engine::finalize_non_stream(
            &conn,
            &state.data_dir,
            &req,
            &run,
            http_status,
            headers,
            &resp_body,
            ttfb_ms,
            duration_ms,
        )
    } else {
        let started = std::time::Instant::now();
        let (http_status, headers, resp_body, ttfb_ms) =
            engine::send_non_stream(&run.built).await?;
        let duration_ms = started.elapsed().as_millis() as i64;
        let conn = db(&state)?;
        engine::finalize_non_stream(
            &conn,
            &state.data_dir,
            &req,
            &run,
            http_status,
            headers,
            &resp_body,
            ttfb_ms,
            duration_ms,
        )
    }
}
