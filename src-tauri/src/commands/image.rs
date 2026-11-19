//! 画图工作台命令：图片生成、图片理解。

use rusqlite::Connection;
use tauri::State;

use crate::error::AppResult;
use crate::workbenches::image::generator::{self, ImageGenRequest, ImageGenResult};
use crate::workbenches::image::vision::{self, VisionRequest, VisionResult};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

/// 图片生成（非流式）。
#[tauri::command]
pub async fn generate_image(
    state: State<'_, AppState>,
    req: ImageGenRequest,
) -> AppResult<ImageGenResult> {
    let prepared = {
        let conn = db(&state)?;
        generator::prepare(&conn, &state.data_dir, &req)?
    }; // 锁在 HTTP 前释放

    let (http_status, body, duration_ms) = generator::send(&prepared).await?;

    let conn = db(&state)?;
    generator::finalize(
        &conn,
        &state.data_dir,
        &req,
        &prepared,
        http_status,
        &body,
        duration_ms,
    )
}

/// 图片理解（Vision，非流式）。
#[tauri::command]
pub async fn send_vision_request(
    state: State<'_, AppState>,
    req: VisionRequest,
) -> AppResult<VisionResult> {
    let prepared = {
        let conn = db(&state)?;
        vision::prepare(&conn, &state.data_dir, &req)?
    };

    let (http_status, body, duration_ms) = vision::send(&prepared).await?;

    let conn = db(&state)?;
    vision::finalize(
        &conn,
        &state.data_dir,
        &req,
        &prepared,
        http_status,
        &body,
        duration_ms,
    )
}

/// 读取归档图片为 data URL（前端画廊展示归档图）。
#[tauri::command]
pub fn read_archived_image(state: State<'_, AppState>, rel_path: String) -> AppResult<String> {
    use crate::workbenches::image::attachments;
    let b64 = attachments::read_image_base64(&state.data_dir, &rel_path)?;
    let mime = if rel_path.ends_with(".jpg") || rel_path.ends_with(".jpeg") {
        "image/jpeg"
    } else {
        "image/png"
    };
    Ok(format!("data:{mime};base64,{b64}"))
}

/// 图片编辑（multipart /images/edits）。
#[tauri::command]
pub async fn edit_image(
    state: State<'_, AppState>,
    req: crate::workbenches::image::generator::ImageEditRequest,
) -> AppResult<crate::workbenches::image::generator::ImageGenResult> {
    let prepared = {
        let conn = db(&state)?;
        generator_prepare_edit(&conn, &state.data_dir, &req)?
    }; // 锁在 HTTP 前释放

    let (http_status, body, duration_ms) =
        crate::workbenches::image::generator::send_edit(&prepared).await?;

    let conn = db(&state)?;
    crate::workbenches::image::generator::finalize_edit(
        &conn,
        &state.data_dir,
        &req,
        &prepared,
        http_status,
        &body,
        duration_ms,
    )
}

fn generator_prepare_edit<'a>(
    conn: &'a std::sync::MutexGuard<'a, Connection>,
    data_dir: &std::path::Path,
    req: &crate::workbenches::image::generator::ImageEditRequest,
) -> AppResult<crate::workbenches::image::generator::PreparedImageEdit> {
    crate::workbenches::image::generator::prepare_edit(conn, data_dir, req)
}

// ------------------------------------------------------------------
// 历史记录（v0.22.0：画图工作台历史面板，点击回填表单）
// ------------------------------------------------------------------

/// 一条画图历史行（生成 / 编辑共用；回填用字段从请求归档读回）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageHistoryRow {
    pub trace_id: String,
    /// image_generation / image_edit
    pub request_type: String,
    pub status: String,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub model: Option<String>,
    pub created_at: String,
    /// 生成 / 编辑 prompt（编辑从归档 body_note 提取，取不到为 None）
    pub prompt: Option<String>,
    pub size: Option<String>,
    pub n: Option<i64>,
    pub response_format: Option<String>,
    /// 首张归档图相对路径（b64 归档时有值，前端 read_archived_image 加载缩略图）
    pub first_image_path: Option<String>,
    /// url 形态首图（不自动下载）
    pub first_image_url: Option<String>,
}

/// 画图历史：最近的 image_generation / image_edit 记录（含回填字段与首图）。
#[tauri::command]
pub fn list_image_history(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> AppResult<Vec<ImageHistoryRow>> {
    use serde_json::Value;

    let conn = db(&state)?;
    let limit = limit.unwrap_or(50).min(200);
    let mut stmt = conn.prepare(
        "SELECT r.trace_id, r.request_type, r.status, r.channel_id, c.name, r.model, r.created_at, \
                r.request_ref, r.response_ref \
         FROM request_records r LEFT JOIN channels c ON r.channel_id = c.id \
         WHERE r.request_type IN ('image_generation', 'image_edit') \
         ORDER BY r.created_at DESC LIMIT ?1",
    )?;
    // 查询中间行：(trace_id, request_type, status, channel_id, channel_name, model, created_at, request_ref, response_ref)
    type HistoryQueryRow = (
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
    );
    let raw_rows: Vec<HistoryQueryRow> = stmt
        .query_map(rusqlite::params![limit], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut out = Vec::new();
    for (
        trace_id,
        request_type,
        status,
        channel_id,
        channel_name,
        model,
        created_at,
        request_ref,
        response_ref,
    ) in raw_rows
    {
        // 请求归档回填字段（归档缺失/解析失败不毁掉整行）
        let mut prompt = None;
        let mut size = None;
        let mut n = None;
        let mut response_format = None;
        if let Some(rel) = request_ref.as_deref() {
            if let Ok(text) =
                crate::workbenches::api_testing::engine::read_raw(&state.data_dir, rel)
            {
                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    let body = v.get("body");
                    prompt = body
                        .and_then(|b| b.get("prompt"))
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    size = body
                        .and_then(|b| b.get("size"))
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    n = body.and_then(|b| b.get("n")).and_then(Value::as_i64);
                    response_format = body
                        .and_then(|b| b.get("response_format"))
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    // 编辑归档 body 是摘要（body_note），从 note 提取 prompt
                    if prompt.is_none() {
                        if let Some(note) = body
                            .and_then(|b| b.get("body_note"))
                            .and_then(Value::as_str)
                        {
                            if let Some(i) = note.find("prompt: ") {
                                prompt = Some(note[i + "prompt: ".len()..].to_string());
                            }
                        }
                    }
                }
            }
        }
        // 首图：附件元数据表取 generated_image 首条；url 形态从响应归档 body.data[0].url
        let mut first_image_path = None;
        let mut first_image_url = None;
        {
            let mut stmt2 = conn.prepare(
                "SELECT file_path FROM request_attachments \
                 WHERE trace_id = ?1 AND kind = 'generated_image' ORDER BY created_at LIMIT 1",
            )?;
            if let Ok(path) =
                stmt2.query_row(rusqlite::params![trace_id], |r| r.get::<_, String>(0))
            {
                first_image_path = Some(path);
            }
        }
        if first_image_path.is_none() {
            if let Some(rel) = response_ref.as_deref() {
                if let Ok(text) =
                    crate::workbenches::api_testing::engine::read_raw(&state.data_dir, rel)
                {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        first_image_url = v
                            .pointer("/body/data/0/url")
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                    }
                }
            }
        }
        out.push(ImageHistoryRow {
            trace_id,
            request_type,
            status,
            channel_id,
            channel_name,
            model,
            created_at,
            prompt,
            size,
            n,
            response_format,
            first_image_path,
            first_image_url,
        });
    }
    Ok(out)
}
