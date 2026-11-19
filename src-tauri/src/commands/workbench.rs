//! API 测试工作台命令：发送（非流式 / 流式）、记录查询、Raw 读取。

use rusqlite::Connection;
use serde::Serialize;
use tauri::{ipc::Channel, State};

use crate::error::{AppError, AppResult};
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

/// 每个 (渠道, 模型) 最近一次测试（模型列表页展示）。
#[tauri::command]
pub fn list_latest_model_tests(
    state: State<'_, AppState>,
) -> AppResult<Vec<records::LatestModelTestRow>> {
    let conn = db(&state)?;
    records::latest_per_channel_model(&conn)
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
        test_kind: None,
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

/// 以 curl 命令复制测试请求：URL / Header 由 `builder::build` 按当前渠道配置重建（含真实凭证），
/// 凭证只进剪贴板（用户主动操作，与「复制凭证」同一安全级别），不落库、不进日志、不产生新记录。
/// 仅支持 API 测试工作台的记录——画图 / 图像理解归档的 body 是摘要或 multipart，重建会失真。
#[tauri::command]
pub fn copy_test_curl(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    trace_id: String,
) -> AppResult<String> {
    use serde_json::Value;
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let curl = {
        let conn = db(&state)?;
        let original = records::get(&conn, &trace_id)?;
        if original.request_type.as_deref() != Some("api_test") {
            return Err(crate::error::AppError::Invalid(
                "仅支持 API 测试工作台的记录复制 curl（画图 / 图像理解的归档 body 为摘要或 multipart，重建会失真）"
                    .into(),
            ));
        }
        let rel = original.request_ref.ok_or_else(|| {
            crate::error::AppError::Invalid("该记录没有 Raw 请求文件，无法复制 curl".into())
        })?;
        let raw: Value = serde_json::from_str(&engine::read_raw(&state.data_dir, &rel)?)
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
                crate::error::AppError::Invalid("原记录缺少渠道信息（渠道可能已删除）".into())
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
            parent_trace_id: None,
            test_kind: None,
        };
        // 只重建请求，不调用 prepare（避免写入 pending 记录 / 归档 / 事件）
        let built = crate::workbenches::api_testing::builder::build(&conn, &req)?;
        crate::workbenches::api_testing::curl::build_command(
            &built.url,
            &built.headers,
            &built.body.to_string(),
        )
    }; // 锁释放后再写剪贴板

    app.clipboard()
        .write_text(&curl)
        .map_err(|e| crate::error::AppError::Invalid(format!("写入剪贴板失败: {e}")))?;
    Ok(curl)
}

/// 快速测试结果（模型列表 / 渠道详情的逐模型连通性测试）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickTestReply {
    pub trace_id: String,
    pub text: String,
    pub status: String,
    pub http_status: Option<u16>,
    pub usage: Option<crate::workbenches::api_testing::parser::UsagePreview>,
}

/// 快速测试：以指定协议向渠道发送最小请求（写入测试记录）。
/// `model` 指定测试模型；缺省取该渠道第一个启用的渠道模型，都没有则用 "test"。
#[tauri::command]
pub async fn quick_test_channel(
    state: State<'_, AppState>,
    channel_id: String,
    protocol: String,
    model: Option<String>,
) -> AppResult<QuickTestReply> {
    let model = {
        let conn = db(&state)?;
        crate::channels::repo::find_row(&conn, &channel_id)?
            .ok_or_else(|| crate::error::AppError::Invalid("渠道不存在".into()))?;
        let picked = crate::models::repo::list_channel_models(&conn, &channel_id)?
            .into_iter()
            .find(|m| m.enabled)
            .map(|m| m.actual_model_id);
        model
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty())
            .or(picked)
            .unwrap_or_else(|| "test".into())
    }; // 锁释放

    // 最小请求体（按协议）
    let raw_json = match protocol.as_str() {
        "anthropic_messages" => serde_json::json!({
            "model": model, "max_tokens": 16,
            "messages": [{"role": "user", "content": "ping"}]
        }),
        _ => serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "ping"}]
        }),
    };

    // 直接走 api_testing 引擎（不依赖会话）
    let req = crate::workbenches::api_testing::builder::ApiTestRequest {
        channel_id,
        channel_model_id: None,
        model,
        protocol,
        stream: false,
        system: None,
        messages: Vec::new(),
        params: Default::default(),
        extra_body: None,
        custom_headers: Vec::new(),
        custom_query: Vec::new(),
        raw_json: Some(raw_json),
        parent_trace_id: None,
        // 快速连通性测试：类型标记 quick_test（与工作台 API 测试区分）
        test_kind: Some("quick_test".into()),
    };

    let run = {
        let conn = db(&state)?;
        crate::workbenches::api_testing::engine::prepare(&conn, &state.data_dir, &req)?
    };
    let started = std::time::Instant::now();
    let (http_status, headers, body, ttfb_ms) =
        crate::workbenches::api_testing::engine::send_non_stream(&run.built).await?;
    let duration_ms = started.elapsed().as_millis() as i64;
    let conn = db(&state)?;
    let result = crate::workbenches::api_testing::engine::finalize_non_stream(
        &conn,
        &state.data_dir,
        &req,
        &run,
        http_status,
        headers,
        &body,
        ttfb_ms,
        duration_ms,
    )?;

    Ok(QuickTestReply {
        trace_id: result.trace_id,
        text: result.preview.text,
        status: result.status,
        http_status: result.http_status,
        usage: result.preview.usage,
    })
}

/// 把若干条测试记录关联为同一会话（A/B 对比的两腿等）。
/// 只做 session_id 回填（与 agent_probe 完成时回填同一模式），不改其余字段。
#[tauri::command]
pub fn set_records_session(
    state: State<'_, AppState>,
    trace_ids: Vec<String>,
    session_id: String,
) -> AppResult<()> {
    if trace_ids.is_empty() || session_id.trim().is_empty() {
        return Err(AppError::Invalid("trace_ids 与 session_id 不能为空".into()));
    }
    let conn = db(&state)?;
    let placeholders = trace_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql =
        format!("UPDATE request_records SET session_id = ?1 WHERE trace_id IN ({placeholders})");
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(session_id)];
    for id in &trace_ids {
        params.push(Box::new(id.clone()));
    }
    conn.execute(
        &sql,
        rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
    )?;
    Ok(())
}
