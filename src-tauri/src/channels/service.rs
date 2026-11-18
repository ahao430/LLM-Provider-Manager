//! 渠道业务编排：凭证写入、详情视图组装、删除时清理凭证库。

use rusqlite::Connection;

use crate::credentials::{self, CredentialKind};
use crate::error::{AppError, AppResult};
use crate::util::is_http_url;

use super::domain::{ChannelConfig, ChannelDetail, ChannelInput, ChannelRow, ExternalLink};
use super::repo;

fn validate(input: &ChannelInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::Invalid("渠道名称不能为空".into()));
    }
    if !is_http_url(input.chat_base_url.trim()) {
        return Err(AppError::Invalid(
            "Chat Base URL 必须以 http:// 或 https:// 开头".into(),
        ));
    }
    for (label, url) in [
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
    Ok(())
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
    })
}

/// 创建渠道。
pub fn create(conn: &Connection, input: ChannelInput) -> AppResult<ChannelRow> {
    validate(&input)?;

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
    validate(&input)?;
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
