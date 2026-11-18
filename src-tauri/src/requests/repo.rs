//! RequestRecord 与 ProcessingEvent 的 SQL 读写。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecordRow {
    pub trace_id: String,
    pub parent_trace_id: Option<String>,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub channel_model_id: Option<String>,
    pub model: Option<String>,
    pub protocol: Option<String>,
    pub request_type: Option<String>,
    pub status: String,
    pub request_ref: Option<String>,
    pub response_ref: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub provider_request_id: Option<String>,
    pub http_status: Option<i64>,
    pub ttfb_ms: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub duration_ms: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_tokens: Option<i64>,
    pub tokens_per_second: Option<f64>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// 模型列表页：每个 (渠道, 模型) 最近一次测试。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestModelTestRow {
    pub channel_id: String,
    pub model: String,
    pub trace_id: String,
    pub status: String,
    pub created_at: String,
    /// 首字时间（未产生首 Token 时为 NULL）
    pub ttft_ms: Option<i64>,
    /// 总耗时（请求未走完时为 NULL）
    pub duration_ms: Option<i64>,
    /// 失败原因摘要（仅流中断等少数场景非空，详情以测试记录为准）
    pub error_message: Option<String>,
}

pub fn latest_per_channel_model(conn: &Connection) -> AppResult<Vec<LatestModelTestRow>> {
    let mut stmt = conn.prepare(
        "SELECT channel_id, model, trace_id, status, created_at, ttft_ms, duration_ms, error_message \
         FROM ( \
           SELECT channel_id, model, trace_id, status, created_at, ttft_ms, duration_ms, error_message, \
                  ROW_NUMBER() OVER ( \
                    PARTITION BY channel_id, model ORDER BY created_at DESC, trace_id DESC \
                  ) AS rn \
           FROM request_records \
           WHERE channel_id IS NOT NULL AND model IS NOT NULL AND model != '' \
             AND request_type != 'agent_probe' \
         ) WHERE rn = 1",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LatestModelTestRow {
                channel_id: row.get(0)?,
                model: row.get(1)?,
                trace_id: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                ttft_ms: row.get(5)?,
                duration_ms: row.get(6)?,
                error_message: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn insert_pending(
    conn: &Connection,
    trace_id: &str,
    channel_id: &str,
    channel_model_id: Option<&str>,
    parent_trace_id: Option<&str>,
    protocol: &str,
    request_type: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO request_records \
         (trace_id, parent_trace_id, channel_id, channel_model_id, protocol, request_type, status, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
        params![
            trace_id,
            parent_trace_id,
            channel_id,
            channel_model_id,
            protocol,
            request_type,
            now_rfc3339()
        ],
    )?;
    Ok(())
}

/// 请求完成：回填状态与指标。model 列按实际传入的模型名记录。
#[allow(clippy::too_many_arguments)]
pub fn finish(
    conn: &Connection,
    trace_id: &str,
    status: &str,
    error_code: Option<&str>,
    error_message: Option<&str>,
    provider_request_id: Option<&str>,
    http_status: Option<i64>,
    ttfb_ms: Option<i64>,
    ttft_ms: Option<i64>,
    duration_ms: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cache_tokens: Option<i64>,
    tokens_per_second: Option<f64>,
    request_ref: Option<&str>,
    response_ref: Option<&str>,
    model: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE request_records SET \
           status = ?2, error_code = ?3, error_message = ?4, provider_request_id = ?5, \
           http_status = ?6, ttfb_ms = ?7, ttft_ms = ?8, duration_ms = ?9, \
           input_tokens = ?10, output_tokens = ?11, cache_tokens = ?12, tokens_per_second = ?13, \
           request_ref = ?14, response_ref = ?15, model = ?16, completed_at = ?17 \
         WHERE trace_id = ?1",
        params![
            trace_id,
            status,
            error_code,
            error_message,
            provider_request_id,
            http_status,
            ttfb_ms,
            ttft_ms,
            duration_ms,
            input_tokens,
            output_tokens,
            cache_tokens,
            tokens_per_second,
            request_ref,
            response_ref,
            model,
            now_rfc3339()
        ],
    )?;
    Ok(())
}

fn row_from(row: &rusqlite::Row) -> rusqlite::Result<RequestRecordRow> {
    Ok(RequestRecordRow {
        trace_id: row.get(0)?,
        parent_trace_id: row.get(1)?,
        channel_id: row.get(2)?,
        channel_name: row.get(3)?,
        channel_model_id: row.get(4)?,
        model: row.get(5)?,
        protocol: row.get(6)?,
        request_type: row.get(7)?,
        status: row.get(8)?,
        request_ref: row.get(9)?,
        response_ref: row.get(10)?,
        error_code: row.get(11)?,
        error_message: row.get(12)?,
        provider_request_id: row.get(13)?,
        http_status: row.get(14)?,
        ttfb_ms: row.get(15)?,
        ttft_ms: row.get(16)?,
        duration_ms: row.get(17)?,
        input_tokens: row.get(18)?,
        output_tokens: row.get(19)?,
        cache_tokens: row.get(20)?,
        tokens_per_second: row.get(21)?,
        created_at: row.get(22)?,
        completed_at: row.get(23)?,
    })
}

pub fn list(conn: &Connection, limit: u32) -> AppResult<Vec<RequestRecordRow>> {
    let mut stmt = conn.prepare(
        "SELECT r.trace_id, r.parent_trace_id, r.channel_id, c.name, r.channel_model_id, r.model, \
         r.protocol, r.request_type, r.status, r.request_ref, r.response_ref, r.error_code, \
         r.error_message, r.provider_request_id, r.http_status, r.ttfb_ms, r.ttft_ms, r.duration_ms, \
         r.input_tokens, r.output_tokens, r.cache_tokens, r.tokens_per_second, r.created_at, r.completed_at \
         FROM request_records r LEFT JOIN channels c ON r.channel_id = c.id \
         ORDER BY r.created_at DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], row_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn get(conn: &Connection, trace_id: &str) -> AppResult<RequestRecordRow> {
    let mut stmt = conn.prepare(
        "SELECT r.trace_id, r.parent_trace_id, r.channel_id, c.name, r.channel_model_id, r.model, \
         r.protocol, r.request_type, r.status, r.request_ref, r.response_ref, r.error_code, \
         r.error_message, r.provider_request_id, r.http_status, r.ttfb_ms, r.ttft_ms, r.duration_ms, \
         r.input_tokens, r.output_tokens, r.cache_tokens, r.tokens_per_second, r.created_at, r.completed_at \
         FROM request_records r LEFT JOIN channels c ON r.channel_id = c.id \
         WHERE r.trace_id = ?1",
    )?;
    stmt.query_row(params![trace_id], row_from)
        .optional()?
        .ok_or_else(|| AppError::Invalid("请求记录不存在".into()))
}

// ------------------------------------------------------------------
// ProcessingEvent
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingEventRow {
    pub event_id: String,
    pub trace_id: String,
    pub stage: String,
    pub operation: String,
    pub status: String,
    pub changed: bool,
    pub description: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

/// 记录一条处理事件（status: ok / changed / failed / skipped）。
#[allow(clippy::too_many_arguments)]
pub fn log_event(
    conn: &Connection,
    trace_id: &str,
    stage: &str,
    operation: &str,
    status: &str,
    changed: bool,
    description: Option<&str>,
    metadata_json: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO processing_events \
         (event_id, trace_id, stage, operation, status, changed, description, metadata_json, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            uuid::Uuid::new_v4().to_string(),
            trace_id,
            stage,
            operation,
            status,
            changed as i64,
            description,
            metadata_json,
            now_rfc3339()
        ],
    )?;
    Ok(())
}

pub fn list_events(conn: &Connection, trace_id: &str) -> AppResult<Vec<ProcessingEventRow>> {
    let mut stmt = conn.prepare(
        "SELECT event_id, trace_id, stage, operation, status, changed, description, metadata_json, created_at \
         FROM processing_events WHERE trace_id = ?1 ORDER BY created_at, rowid",
    )?;
    let rows = stmt
        .query_map(params![trace_id], |row| {
            Ok(ProcessingEventRow {
                event_id: row.get(0)?,
                trace_id: row.get(1)?,
                stage: row.get(2)?,
                operation: row.get(3)?,
                status: row.get(4)?,
                changed: row.get::<_, i64>(5)? != 0,
                description: row.get(6)?,
                metadata_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// 最近错误记录（五种错误状态）。
pub fn list_errors(conn: &Connection, limit: u32) -> AppResult<Vec<RequestRecordRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT r.trace_id, r.parent_trace_id, r.channel_id, c.name, r.channel_model_id, r.model, \
         r.protocol, r.request_type, r.status, r.request_ref, r.response_ref, r.error_code, \
         r.error_message, r.provider_request_id, r.http_status, r.ttfb_ms, r.ttft_ms, r.duration_ms, \
         r.input_tokens, r.output_tokens, r.cache_tokens, r.tokens_per_second, r.created_at, r.completed_at \
         FROM request_records r LEFT JOIN channels c ON r.channel_id = c.id \
         WHERE r.status IN ({}) ORDER BY r.created_at DESC LIMIT ?1",
        ERROR_STATUSES.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(", ")
    ))?;
    let rows = stmt
        .query_map(params![limit], row_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

const ERROR_STATUSES: &[&str] = &[
    "http_error",
    "protocol_error",
    "stream_error",
    "storage_error",
    "failed",
];
