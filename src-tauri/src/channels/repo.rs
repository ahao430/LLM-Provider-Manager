//! 渠道纯 SQL 读写。凭证（系统凭证库）操作在 service 层。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

use super::domain::{ChannelConfig, ChannelInput, ChannelRow};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRow {
    pub id: String,
    pub code: String,
    pub name: String,
    pub notes: Option<String>,
}

pub fn list_providers(conn: &Connection) -> AppResult<Vec<ProviderRow>> {
    let mut stmt = conn.prepare("SELECT id, code, name, notes FROM providers ORDER BY code")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProviderRow {
                id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                notes: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

const ROW_COLUMNS: &str = "c.id, c.name, c.provider_id, p.name, c.channel_type, c.base_url, \
     c.chat_base_url, c.anthropic_base_url, c.responses_base_url, \
     c.enabled, c.notes, c.created_at, c.updated_at, c.config_json, \
     c.group_id, g.name, c.dashboard_pinned";

fn row_from(row: &rusqlite::Row) -> rusqlite::Result<ChannelRow> {
    let chat: String = row.get(6)?;
    let anthropic: String = row.get(7)?;
    let responses: String = row.get(8)?;
    let effective = super::domain::base_url_for_protocol(
        &chat,
        &anthropic.clone(),
        &responses.clone(),
        "openai_chat",
    );
    Ok(ChannelRow {
        id: row.get(0)?,
        name: row.get(1)?,
        provider_id: row.get(2)?,
        provider_name: row.get(3)?,
        channel_type: row.get(4)?,
        base_url: row.get(5)?,
        chat_base_url: chat.clone(),
        anthropic_base_url: anthropic.clone(),
        responses_base_url: responses.clone(),
        effective_urls: super::domain::ProtocolUrls {
            openai_chat: effective,
            anthropic_messages: super::domain::base_url_for_protocol(
                &chat,
                &anthropic,
                &responses,
                "anthropic_messages",
            ),
            openai_responses: super::domain::base_url_for_protocol(
                &chat,
                &anthropic,
                &responses,
                "openai_responses",
            ),
        },
        enabled: row.get::<_, i64>(9)? != 0,
        notes: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        // 官网链接从 config_json 提取（kind=official 的外链）
        official_url: row
            .get::<_, Option<String>>(13)?
            .as_deref()
            .and_then(|text| serde_json::from_str::<ChannelConfig>(text).ok())
            .and_then(|config| {
                config
                    .external_links
                    .iter()
                    .find(|link| link.kind == "official")
                    .map(|link| link.url.clone())
            }),
        // 凭证状态由 service 层填充
        has_primary_credential: false,
        primary_credential_masked: None,
        group_id: row.get(14)?,
        group_name: row.get(15)?,
        dashboard_pinned: row.get::<_, i64>(16)? != 0,
    })
}

pub fn list_rows(conn: &Connection) -> AppResult<Vec<ChannelRow>> {
    let sql = format!(
        "SELECT {ROW_COLUMNS} FROM channels c LEFT JOIN providers p ON c.provider_id = p.id \
         LEFT JOIN channel_groups g ON c.group_id = g.id \
         ORDER BY c.created_at DESC, c.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], row_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn find_row(conn: &Connection, id: &str) -> AppResult<Option<ChannelRow>> {
    let sql = format!(
        "SELECT {ROW_COLUMNS} FROM channels c LEFT JOIN providers p ON c.provider_id = p.id \
         LEFT JOIN channel_groups g ON c.group_id = g.id \
         WHERE c.id = ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt.query_row(params![id], row_from).optional()?)
}

/// 分组列表（按创建顺序）。
pub fn list_groups(conn: &Connection) -> AppResult<Vec<super::domain::ChannelGroupRow>> {
    let mut stmt =
        conn.prepare("SELECT id, name, created_at FROM channel_groups ORDER BY created_at, id")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(super::domain::ChannelGroupRow {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn insert_group(conn: &Connection, id: &str, name: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO channel_groups (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, name, now_rfc3339()],
    )?;
    Ok(())
}

pub fn rename_group(conn: &Connection, id: &str, name: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE channel_groups SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    Ok(())
}

/// 删除分组：渠道回到未分组（group_id 置空）。
pub fn delete_group(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE channels SET group_id = NULL WHERE group_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM channel_groups WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_dashboard_pinned(conn: &Connection, id: &str, pinned: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE channels SET dashboard_pinned = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, pinned as i64, now_rfc3339()],
    )?;
    Ok(())
}

pub fn load_config(conn: &Connection, id: &str) -> AppResult<ChannelConfig> {
    let json: Option<String> = conn
        .query_row(
            "SELECT config_json FROM channels WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    match json {
        Some(text) => Ok(serde_json::from_str(&text)
            .map_err(|e| AppError::Invalid(format!("渠道配置解析失败: {e}")))?),
        None => Err(AppError::Invalid("渠道不存在".into())),
    }
}

pub fn insert(
    conn: &Connection,
    id: &str,
    input: &ChannelInput,
    config_json: &str,
) -> AppResult<()> {
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO channels \
         (id, provider_id, name, channel_type, base_url, chat_base_url, anthropic_base_url, \
          responses_base_url, enabled, notes, config_json, group_id, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, 1, ?8, ?9, ?10, ?11, ?11)",
        params![
            id,
            input.provider_id,
            input.name.trim(),
            "custom",
            input.chat_base_url.trim(),
            input
                .anthropic_base_url
                .as_deref()
                .map(str::trim)
                .unwrap_or(""),
            input
                .responses_base_url
                .as_deref()
                .map(str::trim)
                .unwrap_or(""),
            trimmed_or_none(&input.notes),
            config_json,
            input.group_id,
            now
        ],
    )?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: &str,
    input: &ChannelInput,
    config_json: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE channels SET name = ?2, provider_id = ?3, base_url = ?4, chat_base_url = ?4, \
         anthropic_base_url = ?5, responses_base_url = ?6, notes = ?7, config_json = ?8, \
         group_id = ?9, updated_at = ?10 WHERE id = ?1",
        params![
            id,
            input.name.trim(),
            input.provider_id,
            input.chat_base_url.trim(),
            input
                .anthropic_base_url
                .as_deref()
                .map(str::trim)
                .unwrap_or(""),
            input
                .responses_base_url
                .as_deref()
                .map(str::trim)
                .unwrap_or(""),
            trimmed_or_none(&input.notes),
            config_json,
            input.group_id,
            now_rfc3339()
        ],
    )?;
    Ok(())
}

fn trimmed_or_none(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE channels SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, enabled as i64, now_rfc3339()],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM channels WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::migrations;

    fn channel_input(name: &str, base_url: &str, provider_id: Option<&str>) -> ChannelInput {
        ChannelInput {
            name: name.into(),
            provider_id: provider_id.map(str::to_owned),
            chat_base_url: base_url.into(),
            anthropic_base_url: None,
            responses_base_url: None,
            official_url: None,
            notes: Some("备注".into()),
            primary_credential: None,
            group_id: None,
        }
    }

    #[test]
    fn channel_crud_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();

        insert(
            &conn,
            "ch-1",
            &channel_input(
                "测试渠道",
                "https://api.example.com/v1",
                Some("prov_bailian"),
            ),
            "{}",
        )
        .unwrap();

        let row = find_row(&conn, "ch-1").unwrap().expect("应有渠道");
        assert_eq!(row.name, "测试渠道");
        assert_eq!(row.provider_name.as_deref(), Some("阿里云百炼"));
        assert_eq!(row.chat_base_url, "https://api.example.com/v1");
        assert_eq!(row.base_url, "https://api.example.com/v1");
        assert!(row.enabled);

        let config: ChannelConfig =
            serde_json::from_str("{\"tlsVerify\":true,\"externalLinks\":[]}").unwrap();
        assert!(config.tls_verify);

        // 专用地址覆盖后按协议解析
        let mut input = channel_input("改名", "https://api.example.com/v1", None);
        input.anthropic_base_url = Some("https://anthropic.example.com".into());
        update(&conn, "ch-1", &input, "{}").unwrap();
        let row = find_row(&conn, "ch-1").unwrap().unwrap();
        assert_eq!(
            row.base_url_for("anthropic_messages"),
            "https://anthropic.example.com"
        );
        assert_eq!(
            row.base_url_for("openai_chat"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            row.base_url_for("openai_responses"),
            "https://api.example.com/v1"
        );
        assert_eq!(row.provider_name, None);

        delete(&conn, "ch-1").unwrap();
        assert!(find_row(&conn, "ch-1").unwrap().is_none());
    }

    #[test]
    fn providers_are_seeded() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        let providers = list_providers(&conn).unwrap();
        assert!(providers.len() >= 5, "应至少内置 5 个服务商");
        assert!(providers.iter().any(|p| p.code == "bailian"));
    }

    #[test]
    fn channel_group_crud_and_pinning() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();

        // 建分组 + 建渠道（归属分组）
        insert_group(&conn, "g-1", "上游中转站").unwrap();
        let mut input = channel_input("中转渠道", "https://relay.example.com/v1", None);
        input.group_id = Some("g-1".into());
        insert(&conn, "ch-g", &input, "{}").unwrap();

        // 列表行带分组名
        let row = find_row(&conn, "ch-g").unwrap().unwrap();
        assert_eq!(row.group_id.as_deref(), Some("g-1"));
        assert_eq!(row.group_name.as_deref(), Some("上游中转站"));
        assert!(!row.dashboard_pinned);

        // 置顶 + 取消置顶
        set_dashboard_pinned(&conn, "ch-g", true).unwrap();
        let row = find_row(&conn, "ch-g").unwrap().unwrap();
        assert!(row.dashboard_pinned);
        set_dashboard_pinned(&conn, "ch-g", false).unwrap();

        // 删除分组 → 渠道回到未分组
        delete_group(&conn, "g-1").unwrap();
        let row = find_row(&conn, "ch-g").unwrap().unwrap();
        assert_eq!(row.group_id, None);
        assert_eq!(row.group_name, None);
        assert!(list_groups(&conn).unwrap().is_empty());
    }
}
