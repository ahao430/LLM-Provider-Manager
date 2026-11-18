//! 内嵌 Agent 命令：会话 CRUD、消息列表、流式对话。

use rusqlite::Connection;
use tauri::{ipc::Channel, State};

use crate::error::AppResult;
use crate::workbenches::api_testing::engine::StreamEvent;
use crate::workbenches::assistant::{
    engine,
    engine::{AgentReply, SendMessageInput},
    repo::{self, ConversationInput, ConversationRow, MessageRow},
};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

#[tauri::command]
pub fn list_conversations(state: State<'_, AppState>) -> AppResult<Vec<ConversationRow>> {
    let conn = db(&state)?;
    repo::list(&conn, 100)
}

#[tauri::command]
pub fn create_conversation(
    state: State<'_, AppState>,
    input: ConversationInput,
) -> AppResult<ConversationRow> {
    let conn = db(&state)?;
    repo::create(&conn, &input)
}

#[tauri::command]
pub fn delete_conversation(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete(&conn, &id)
}

#[tauri::command]
pub fn list_agent_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> AppResult<Vec<MessageRow>> {
    let conn = db(&state)?;
    repo::list_messages(&conn, &conversation_id)
}

/// 发送消息（流式）：增量经 Channel 推送，最终回复同步返回。
#[tauri::command]
pub async fn send_agent_message(
    state: State<'_, AppState>,
    input: SendMessageInput,
    on_event: Channel<StreamEvent>,
) -> AppResult<AgentReply> {
    let prepared = {
        let conn = db(&state)?;
        engine::prepare(&conn, &state.data_dir, &input)?
    }; // 锁在 HTTP 前释放

    // 阶段一（异步，无数据库锁）：流式接收
    let outcome = engine::stream_turn(&prepared, &on_event).await?;

    // 阶段二（锁内，同步）：归档、记录、消息落库
    let conn = db(&state)?;
    engine::finalize_turn(&conn, &state.data_dir, &prepared, &outcome)
}

/// 快速测试：以指定协议向渠道发送最小请求（写入测试记录）。
/// `model` 指定测试模型；缺省取该渠道第一个启用的渠道模型，都没有则用 "test"。
#[tauri::command]
pub async fn quick_test_channel(
    state: State<'_, AppState>,
    channel_id: String,
    protocol: String,
    model: Option<String>,
) -> AppResult<AgentReply> {
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
    let input = SendMessageInput {
        conversation_id: String::new(), // 占位：quick test 不走会话
        content: String::new(),
    };
    let _ = input;

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

    Ok(AgentReply {
        trace_id: result.trace_id,
        conversation_id: String::new(),
        user_message_id: String::new(),
        assistant_message_id: String::new(),
        text: result.preview.text,
        status: result.status,
        http_status: result.http_status,
        usage: result.preview.usage,
    })
}
