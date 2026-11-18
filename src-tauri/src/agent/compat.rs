//! Agent 兼容性记录（PLAN.md「Agent 原生调用」）。
//!
//! 状态必须来自实际测试或可靠证据；不能因为渠道声称兼容就推断。

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

const KNOWN_STATUS: &[&str] = &["supported", "unsupported", "unverified"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompatRow {
    pub id: String,
    pub channel_id: String,
    /// claude_code / codex / other:<name>
    pub agent: String,
    pub status: String,
    pub evidence: Option<String>,
    pub tested_at: Option<String>,
    pub notes: Option<String>,
    pub updated_at: String,
}

fn row_from(row: &rusqlite::Row) -> rusqlite::Result<AgentCompatRow> {
    Ok(AgentCompatRow {
        id: row.get(0)?,
        channel_id: row.get(1)?,
        agent: row.get(2)?,
        status: row.get(3)?,
        evidence: row.get(4)?,
        tested_at: row.get(5)?,
        notes: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn list(conn: &Connection, channel_id: &str) -> AppResult<Vec<AgentCompatRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, channel_id, agent, status, evidence, tested_at, notes, updated_at \
         FROM agent_compatibility WHERE channel_id = ?1 ORDER BY agent",
    )?;
    let rows = stmt
        .query_map(params![channel_id], row_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// 按 (channel_id, agent) upsert。status != unverified 时刷新 tested_at。
pub fn upsert(
    conn: &Connection,
    channel_id: &str,
    agent: &str,
    status: &str,
    evidence: Option<&str>,
    notes: Option<&str>,
) -> AppResult<AgentCompatRow> {
    if agent.trim().is_empty() {
        return Err(AppError::Invalid("Agent 标识不能为空".into()));
    }
    if !KNOWN_STATUS.contains(&status) {
        return Err(AppError::Invalid(format!(
            "无效的兼容性状态: {status}（应为 supported / unsupported / unverified）"
        )));
    }

    let now = now_rfc3339();
    let tested_at = if status == "unverified" {
        None
    } else {
        Some(now.clone())
    };
    conn.execute(
        "INSERT INTO agent_compatibility (id, channel_id, agent, status, evidence, tested_at, notes, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) \
         ON CONFLICT(channel_id, agent) DO UPDATE SET \
           status = excluded.status, evidence = excluded.evidence, \
           tested_at = excluded.tested_at, notes = excluded.notes, updated_at = excluded.updated_at",
        params![
            uuid::Uuid::new_v4().to_string(),
            channel_id,
            agent.trim(),
            status,
            evidence.map(str::trim).filter(|s| !s.is_empty()),
            tested_at,
            notes.map(str::trim).filter(|s| !s.is_empty()),
            now
        ],
    )?;

    conn.query_row(
        "SELECT id, channel_id, agent, status, evidence, tested_at, notes, updated_at \
         FROM agent_compatibility WHERE channel_id = ?1 AND agent = ?2",
        params![channel_id, agent.trim()],
        row_from,
    )
    .map_err(|e| AppError::Invalid(format!("读取兼容性记录失败: {e}")))
}

/// 供前端展示：某渠道的兼容性摘要（JSON，MCP/导出可复用）。
#[allow(dead_code)]
pub fn summary_json(conn: &Connection, channel_id: &str) -> AppResult<Value> {
    let rows = list(conn, channel_id)?;
    serde_json::to_value(rows).map_err(|e| AppError::Invalid(format!("序列化失败: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::migrations;

    #[test]
    fn upsert_and_list() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        conn.execute(
            "INSERT INTO channels (id, name, channel_type, base_url, default_protocol, enabled, config_json, created_at, updated_at) \
             VALUES ('c1', 't', 'custom', 'https://x.com', 'openai_chat', 1, '{}', '2026-01-01', '2026-01-01')",
            [],
        )
        .unwrap();

        let row = upsert(
            &conn,
            "c1",
            "claude_code",
            "supported",
            Some("实测 tool use 正常"),
            None,
        )
        .unwrap();
        assert_eq!(row.status, "supported");
        assert!(row.tested_at.is_some());

        // 更新同一条
        let row = upsert(&conn, "c1", "claude_code", "unverified", None, None).unwrap();
        assert_eq!(row.status, "unverified");
        assert!(row.tested_at.is_none());

        let rows = list(&conn, "c1").unwrap();
        assert_eq!(rows.len(), 1);

        assert!(upsert(&conn, "c1", "claude_code", "bogus", None, None).is_err());
    }
}
