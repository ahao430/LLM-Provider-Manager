//! 凭证命令：写入 / 受控读取（明文）/ 复制到剪贴板 / 清空。
//!
//! 明文读取仅用于编辑回显与用户主动查看（眼睛图标）；复制到剪贴板同样是
//! 用户主动操作，明文不进 UI、不进日志。Agent 启动注入在服务端完成，不经由此命令。

use tauri::AppHandle;

use crate::credentials::{self, CredentialKind};
use crate::error::{AppError, AppResult};
use tauri_plugin_clipboard_manager::ClipboardExt;

fn parse_kind(kind: &str) -> AppResult<CredentialKind<'_>> {
    CredentialKind::parse(kind).ok_or_else(|| {
        AppError::Invalid(format!(
            "无效的凭证类型: {kind}（应为 primary 或 header:<名称>）"
        ))
    })
}

#[tauri::command]
pub fn set_channel_credential(channel_id: String, kind: String, value: String) -> AppResult<()> {
    let kind = parse_kind(&kind)?;
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::Invalid(
            "凭证不能为空（清空请使用 clear_channel_credential）".into(),
        ));
    }
    credentials::set(&channel_id, &kind, value)
}

/// 受控读取明文（眼睛图标 / 编辑回显）。
#[tauri::command]
pub fn reveal_channel_credential(channel_id: String, kind: String) -> AppResult<Option<String>> {
    let kind = parse_kind(&kind)?;
    credentials::get(&channel_id, &kind)
}

#[tauri::command]
pub fn clear_channel_credential(channel_id: String, kind: String) -> AppResult<()> {
    let kind = parse_kind(&kind)?;
    credentials::delete(&channel_id, &kind)
}

/// 复制主凭证到系统剪贴板（列表页快捷复制；明文不进 UI 与日志）。
#[tauri::command]
pub fn copy_channel_credential(app: AppHandle, channel_id: String) -> AppResult<()> {
    let secret = credentials::get(&channel_id, &CredentialKind::Primary)?
        .ok_or_else(|| AppError::Invalid("该渠道未配置主凭证".into()))?;
    app.clipboard()
        .write_text(secret)
        .map_err(|e| AppError::Invalid(format!("写入剪贴板失败: {e}")))?;
    Ok(())
}
