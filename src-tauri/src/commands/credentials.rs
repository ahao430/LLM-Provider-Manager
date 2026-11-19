//! 凭证命令：写入 / 受控读取（明文）/ 复制到剪贴板 / 清空。
//!
//! 明文读取仅用于编辑回显与用户主动查看（眼睛图标）；复制到剪贴板同样是
//! 用户主动操作，明文不进 UI、不进日志。Agent 启动注入在服务端完成，不经由此命令。

use tauri::AppHandle;
use tauri::State;

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

// ------------------------------------------------------------------
// 凭证一览 / 批量导出（v0.21.0；均为用户显式触发的明文操作）
// ------------------------------------------------------------------

/// 一条渠道凭证的导出行。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCredentialRow {
    pub channel_id: String,
    pub channel_name: String,
    pub provider_name: Option<String>,
    pub base_url: String,
    /// 主凭证明文（未配置渠道该行为空串）
    pub token: String,
}

/// 列出全部渠道主凭证明文（仅用户主动打开「凭证一览」时调用；不落日志）。
#[tauri::command]
pub fn list_channel_credentials(
    state: State<'_, crate::AppState>,
) -> AppResult<Vec<ChannelCredentialRow>> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Invalid("数据库连接锁已失效".into()))?;
    let rows = crate::channels::repo::list_rows(&conn)?;
    let mut out = Vec::new();
    for row in rows {
        let token = credentials::get(&row.id, &CredentialKind::Primary)?.unwrap_or_default();
        out.push(ChannelCredentialRow {
            channel_id: row.id,
            channel_name: row.name,
            provider_name: row.provider_name,
            base_url: row.chat_base_url,
            token,
        });
    }
    Ok(out)
}

/// 导出全部渠道凭证（csv / xlsx）。path 由前端 save 对话框提供；明文文件请用户妥善保管。
#[tauri::command]
pub fn export_channel_credentials(
    state: State<'_, crate::AppState>,
    path: String,
    format: String,
) -> AppResult<usize> {
    let rows = {
        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Invalid("数据库连接锁已失效".into()))?;
        crate::channels::repo::list_rows(&conn)?
    };
    // 组装行数据（渠道名, 服务商, Base URL, Token）
    let mut data: Vec<Vec<String>> = Vec::with_capacity(rows.len() + 1);
    data.push(vec![
        "渠道名".into(),
        "服务商".into(),
        "Base URL".into(),
        "Token".into(),
    ]);
    for row in rows {
        let token = credentials::get(&row.id, &CredentialKind::Primary)?.unwrap_or_default();
        data.push(vec![
            row.name,
            row.provider_name.clone().unwrap_or_default(),
            row.chat_base_url.clone(),
            token,
        ]);
    }
    let count = data.len() - 1;

    match format.as_str() {
        "csv" => {
            // UTF-8 BOM：Excel 直接打开不乱码
            let mut csv = String::from("\u{feff}");
            for line in &data {
                let cells: Vec<String> = line
                    .iter()
                    .map(|c| format!("\"{}\"", c.replace('"', "\"\"")))
                    .collect();
                csv.push_str(&cells.join(","));
                csv.push('\n');
            }
            std::fs::write(&path, csv.as_bytes())
                .map_err(|e| AppError::Invalid(format!("写入文件失败: {e}")))?;
        }
        "xlsx" => {
            use rust_xlsxwriter::{Format, Workbook};
            let mut book = Workbook::new();
            // 表头加粗
            let bold = Format::new().set_bold();
            let sheet = book.add_worksheet();
            for (r, line) in data.iter().enumerate() {
                for (c, cell) in line.iter().enumerate() {
                    if r == 0 {
                        sheet
                            .write_with_format(r as u32, c as u16, cell, &bold)
                            .map_err(|e| AppError::Invalid(format!("写入 xlsx 失败: {e}")))?;
                    } else {
                        sheet
                            .write(r as u32, c as u16, cell)
                            .map_err(|e| AppError::Invalid(format!("写入 xlsx 失败: {e}")))?;
                    }
                }
            }
            sheet.autofit();
            book.save(&path)
                .map_err(|e| AppError::Invalid(format!("写入 xlsx 失败: {e}")))?;
        }
        other => return Err(AppError::Invalid(format!("不支持的导出格式: {other}"))),
    }
    Ok(count)
}
