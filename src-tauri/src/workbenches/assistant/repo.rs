//! 内嵌 Agent 对话 SQL 读写。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRow {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub channel_id: String,
    pub channel_model_id: Option<String>,
    pub model: String,
    pub protocol: String,
    pub system: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationInput {
    pub channel_id: String,
    pub channel_model_id: Option<String>,
    pub model: String,
    /// 模式：claude_code / codex（决定默认协议与预设 system）
    pub mode: String,
    pub system: Option<String>,
}

fn conversation_from(row: &rusqlite::Row) -> rusqlite::Result<ConversationRow> {
    Ok(ConversationRow {
        id: row.get(0)?,
        title: row.get(1)?,
        mode: row.get(2)?,
        channel_id: row.get(3)?,
        channel_model_id: row.get(4)?,
        model: row.get(5)?,
        protocol: row.get(6)?,
        system: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

const CONV_COLUMNS: &str =
    "id, title, mode, channel_id, channel_model_id, model, protocol, system, created_at, updated_at";

pub fn create(conn: &Connection, input: &ConversationInput) -> AppResult<ConversationRow> {
    if input.model.trim().is_empty() {
        return Err(AppError::Invalid("模型不能为空".into()));
    }
    if !matches!(input.mode.as_str(), "claude_code" | "codex") {
        return Err(AppError::Invalid(format!(
            "不支持的模式: {}（应为 claude_code / codex）",
            input.mode
        )));
    }
    // 模式决定默认协议与预设 system（用户显式填写时优先）
    let (protocol, preset_system) = match input.mode.as_str() {
        "claude_code" => ("anthropic_messages", "You are Claude Code, Anthropic's official CLI for Claude. Reply in the user's language."),
        _ => ("openai_chat", "You are Codex, OpenAI's coding agent. Reply in the user's language."),
    };
    let system = input
        .system
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| preset_system.to_string());

    let id = uuid::Uuid::new_v4().to_string();
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO agent_conversations (id, title, mode, channel_id, channel_model_id, model, protocol, system, created_at, updated_at) \
         VALUES (?1, '新对话', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            input.mode,
            input.channel_id,
            input.channel_model_id,
            input.model.trim(),
            protocol,
            system,
            now
        ],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<ConversationRow> {
    let sql = format!("SELECT {CONV_COLUMNS} FROM agent_conversations WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_row(params![id], conversation_from)
        .optional()?
        .ok_or_else(|| AppError::Invalid("对话不存在".into()))
}

pub fn list(conn: &Connection, limit: u32) -> AppResult<Vec<ConversationRow>> {
    let sql =
        format!("SELECT {CONV_COLUMNS} FROM agent_conversations ORDER BY updated_at DESC LIMIT ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![limit], conversation_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM agent_conversations WHERE id = ?1", params![id])?;
    Ok(())
}

/// 更新标题与最近活跃时间。
pub fn touch(conn: &Connection, id: &str, title: Option<&str>) -> AppResult<()> {
    if let Some(title) = title.map(str::trim).filter(|s| !s.is_empty()) {
        conn.execute(
            "UPDATE agent_conversations SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, title, now_rfc3339()],
        )?;
    } else {
        conn.execute(
            "UPDATE agent_conversations SET updated_at = ?2 WHERE id = ?1",
            params![id, now_rfc3339()],
        )?;
    }
    Ok(())
}

// ------------------------------------------------------------------
// 消息
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub trace_id: Option<String>,
    pub created_at: String,
}

fn message_from(row: &rusqlite::Row) -> rusqlite::Result<MessageRow> {
    Ok(MessageRow {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        trace_id: row.get(4)?,
        created_at: row.get(5)?,
    })
}

const MSG_COLUMNS: &str = "id, conversation_id, role, content, trace_id, created_at";

pub fn insert_message(
    conn: &Connection,
    conversation_id: &str,
    role: &str,
    content: &str,
    trace_id: Option<&str>,
) -> AppResult<String> {
    if !matches!(role, "user" | "assistant") {
        return Err(AppError::Invalid(format!("不支持的消息角色: {role}")));
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO agent_messages (id, conversation_id, role, content, trace_id, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, conversation_id, role, content, trace_id, now_rfc3339()],
    )?;
    Ok(id)
}

pub fn list_messages(conn: &Connection, conversation_id: &str) -> AppResult<Vec<MessageRow>> {
    let sql = format!(
        "SELECT {MSG_COLUMNS} FROM agent_messages WHERE conversation_id = ?1 ORDER BY created_at, rowid"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![conversation_id], message_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channels::domain::ChannelInput;
    use crate::channels::repo as channel_repo;
    use crate::storage::migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        channel_repo::insert(
            &conn,
            "ch-1",
            &ChannelInput {
                name: "测试".into(),
                provider_id: None,
                chat_base_url: "https://api.example.com".into(),
                anthropic_base_url: None,
                responses_base_url: None,
                official_url: None,
                notes: None,
                primary_credential: None,
            },
            "{}",
        )
        .unwrap();
        conn
    }

    #[test]
    fn conversation_and_message_flow() {
        let conn = setup();
        let conv = create(
            &conn,
            &ConversationInput {
                channel_id: "ch-1".into(),
                channel_model_id: None,
                model: "m1".into(),
                mode: "claude_code".into(),
                system: None,
            },
        )
        .unwrap();

        insert_message(&conn, &conv.id, "user", "你好", None).unwrap();
        crate::requests::repo::insert_pending(
            &conn,
            "t1",
            "ch-1",
            None,
            None,
            "openai_chat",
            "agent_chat",
        )
        .unwrap();
        insert_message(&conn, &conv.id, "assistant", "你好！", Some("t1")).unwrap();

        let messages = list_messages(&conn, &conv.id).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].trace_id.as_deref(), Some("t1"));

        // 角色校验
        assert!(insert_message(&conn, &conv.id, "system", "x", None).is_err());

        // mode 派生协议与预设 system
        assert_eq!(conv.protocol, "anthropic_messages");
        assert!(conv
            .system
            .as_deref()
            .unwrap_or_default()
            .contains("Claude Code"));
        let conv2 = create(
            &conn,
            &ConversationInput {
                channel_id: "ch-1".into(),
                channel_model_id: None,
                model: "m1".into(),
                mode: "codex".into(),
                system: None,
            },
        )
        .unwrap();
        assert_eq!(conv2.protocol, "openai_chat");

        touch(&conn, &conv.id, Some("第一个对话")).unwrap();
        assert_eq!(get(&conn, &conv.id).unwrap().title, "第一个对话");

        delete(&conn, &conv.id).unwrap();
        assert!(list_messages(&conn, &conv.id).unwrap().is_empty());
        assert!(get(&conn, &conv.id).is_err());
    }
}
