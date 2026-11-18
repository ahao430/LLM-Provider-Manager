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
