//! 渠道业务编排：凭证写入、详情视图组装、删除时清理凭证库。

use rusqlite::Connection;

use crate::credentials::{self, CredentialKind};
use crate::error::{AppError, AppResult};
use crate::util::is_http_url;

use super::domain::{
    ChannelConfig, ChannelDetail, ChannelGroupRow, ChannelInput, ChannelRow, ExternalLink,
};
use super::repo;

fn validate(conn: &Connection, input: &ChannelInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::Invalid("渠道名称不能为空".into()));
    }
    if !is_http_url(input.chat_base_url.trim()) {
        return Err(AppError::Invalid(
            "Chat Base URL 必须以 http:// 或 https:// 开头".into(),
        ));
    }
    for (label, url) in [
        ("Chat Completions", &input.chat_completions_url),
        ("Anthropic", &input.anthropic_base_url),
        ("Responses", &input.responses_base_url),
    ] {
        if let Some(url) = url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            if !is_http_url(url) {
                return Err(AppError::Invalid(format!(
                    "{label} 地址必须以 http(s):// 开头"
                )));
            }
        }
    }
    if let Some(url) = input
        .official_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if !is_http_url(url) {
            return Err(AppError::Invalid("官网链接必须以 http(s):// 开头".into()));
        }
    }
    // 分组存在性校验（空串视为未分组）
    if let Some(gid) = input.group_id.as_deref().filter(|s| !s.is_empty()) {
        if !repo::list_groups(conn)?.iter().any(|g| g.id == gid) {
            return Err(AppError::Invalid("所选分组不存在".into()));
        }
    }
    Ok(())
}

/// 分组名规范化：去首尾空白；空名报错。
fn normalize_group_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim().to_owned();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("分组名不能为空".into()));
    }
    Ok(trimmed)
}

/// 创建分组（重名报错）。
pub fn create_group(conn: &Connection, name: &str) -> AppResult<ChannelGroupRow> {
    let name = normalize_group_name(name)?;
    if repo::list_groups(conn)?.iter().any(|g| g.name == name) {
        return Err(AppError::Invalid(format!("分组「{name}」已存在")));
    }
    let id = uuid::Uuid::new_v4().to_string();
    repo::insert_group(conn, &id, &name)?;
    repo::list_groups(conn)?
        .into_iter()
        .find(|g| g.id == id)
        .ok_or_else(|| AppError::Invalid("分组创建失败".into()))
}

/// 重命名分组（重名校验排除自身）。
pub fn rename_group(conn: &Connection, id: &str, name: &str) -> AppResult<ChannelGroupRow> {
    let name = normalize_group_name(name)?;
    if repo::list_groups(conn)?
        .iter()
        .any(|g| g.name == name && g.id != id)
    {
        return Err(AppError::Invalid(format!("分组「{name}」已存在")));
    }
    repo::rename_group(conn, id, &name)?;
    repo::list_groups(conn)?
        .into_iter()
        .find(|g| g.id == id)
        .ok_or_else(|| AppError::Invalid("分组不存在".into()))
}

/// 删除分组：渠道回到未分组。
pub fn delete_group(conn: &Connection, id: &str) -> AppResult<()> {
    repo::delete_group(conn, id)
}

/// 置顶 / 取消置顶（首页仪表盘渠道卡片）。
pub fn set_dashboard_pinned(conn: &Connection, id: &str, pinned: bool) -> AppResult<()> {
    repo::set_dashboard_pinned(conn, id, pinned)
}

/// 官网链接写入 config（单个输入框，kind = official）。
fn config_with_official_url(config: &ChannelConfig, official_url: Option<&str>) -> ChannelConfig {
    let mut cfg = config.clone();
    cfg.external_links = official_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|url| {
            vec![ExternalLink {
                label: "官网".into(),
                url: url.to_string(),
                kind: "official".into(),
            }]
        })
        .unwrap_or_default();
    cfg
}

/// 列表（含凭证状态概览）。
pub fn list(conn: &Connection) -> AppResult<Vec<ChannelRow>> {
    let mut rows = repo::list_rows(conn)?;
    for row in &mut rows {
        let masked = credentials::describe(&row.id, &CredentialKind::Primary);
        row.has_primary_credential = masked.is_some();
        row.primary_credential_masked = masked;
    }
    Ok(rows)
}

/// 详情。
pub fn get(conn: &Connection, id: &str) -> AppResult<ChannelDetail> {
    let mut row =
        repo::find_row(conn, id)?.ok_or_else(|| AppError::Invalid("渠道不存在".into()))?;
    let masked = credentials::describe(id, &CredentialKind::Primary);
    row.has_primary_credential = masked.is_some();
    row.primary_credential_masked = masked.clone();

    let config = repo::load_config(conn, id)?;
    Ok(ChannelDetail {
        row,
        tls_verify: config.tls_verify,
        external_links: config.external_links,
        balance_query: config.balance_query,
        ops: config.ops,
    })
}

/// 创建渠道。
pub fn create(conn: &Connection, input: ChannelInput) -> AppResult<ChannelRow> {
    validate(conn, &input)?;
    let mut input = input;
    // 空串分组视为未分组
    input.group_id = input.group_id.take_if(|s| !s.trim().is_empty());

    let id = uuid::Uuid::new_v4().to_string();
    let config = config_with_official_url(&ChannelConfig::default(), input.official_url.as_deref());
    repo::insert(conn, &id, &input, &serialize_config(&config)?)?;

    if let Some(value) = primary_credential_value(&input) {
        credentials::set(&id, &CredentialKind::Primary, &value)?;
    }

    row_with_credential(conn, &id)
}

/// 更新渠道。
pub fn update(conn: &Connection, id: &str, input: ChannelInput) -> AppResult<ChannelRow> {
    validate(conn, &input)?;
    let mut input = input;
    // 空串分组视为未分组
    input.group_id = input.group_id.take_if(|s| !s.trim().is_empty());
    let old_config = repo::load_config(conn, id)?;
    let new_config = config_with_official_url(&old_config, input.official_url.as_deref());

    repo::update(conn, id, &input, &serialize_config(&new_config)?)?;

    if let Some(value) = primary_credential_value(&input) {
        credentials::set(id, &CredentialKind::Primary, &value)?;
    }

    row_with_credential(conn, id)
}

/// 删除渠道并清理凭证。
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    credentials::delete(id, &CredentialKind::Primary)?;
    repo::delete(conn, id)?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    repo::set_enabled(conn, id, enabled)
}

/// 读取行并填充凭证状态。
fn row_with_credential(conn: &Connection, id: &str) -> AppResult<ChannelRow> {
    let mut row =
        repo::find_row(conn, id)?.ok_or_else(|| AppError::Invalid("渠道不存在".into()))?;
    let masked = credentials::describe(id, &CredentialKind::Primary);
    row.has_primary_credential = masked.is_some();
    row.primary_credential_masked = masked;
    Ok(row)
}

/// 供 Launcher / 工作台使用：读取主凭证（受控）。
pub fn resolve_primary_credential(channel_id: &str) -> Option<String> {
    credentials::get(channel_id, &CredentialKind::Primary)
        .ok()
        .flatten()
}

fn serialize_config(config: &ChannelConfig) -> AppResult<String> {
    serde_json::to_string(config).map_err(|e| AppError::Invalid(format!("配置序列化失败: {e}")))
}

fn primary_credential_value(input: &ChannelInput) -> Option<String> {
    input
        .primary_credential
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}
