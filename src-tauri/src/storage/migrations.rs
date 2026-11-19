//! 内嵌 SQL 迁移。
//!
//! 规则（见 AGENTS.md / docs/database.md）：
//! - 迁移一经发布只能追加新的 `(name, sql)` 条目，不能修改或删除已有条目。
//! - 文件放在 src-tauri/migrations/，按 `NNNN_description.sql` 命名。

use rusqlite::{params, Connection};

use crate::error::AppResult;

/// (迁移名, SQL 文件内容)。顺序即执行顺序。
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("../../migrations/0001_init.sql")),
    (
        "0002_agent_launches",
        include_str!("../../migrations/0002_agent_launches.sql"),
    ),
    (
        "0003_seed_providers",
        include_str!("../../migrations/0003_seed_providers.sql"),
    ),
    (
        "0004_request_model",
        include_str!("../../migrations/0004_request_model.sql"),
    ),
    (
        "0005_assistant",
        include_str!("../../migrations/0005_assistant.sql"),
    ),
    (
        "0006_channel_urls_and_model_type",
        include_str!("../../migrations/0006_channel_urls_and_model_type.sql"),
    ),
    (
        "0007_channel_model_price_annotation",
        include_str!("../../migrations/0007_channel_model_price_annotation.sql"),
    ),
    (
        "0008_market_cache",
        include_str!("../../migrations/0008_market_cache.sql"),
    ),
    (
        "0009_model_protocol_default",
        include_str!("../../migrations/0009_model_protocol_default.sql"),
    ),
    (
        "0010_model_type_multimodal_families",
        include_str!("../../migrations/0010_model_type_multimodal_families.sql"),
    ),
    (
        "0011_error_knowledge",
        include_str!("../../migrations/0011_error_knowledge.sql"),
    ),
    (
        "0012_channel_groups",
        include_str!("../../migrations/0012_channel_groups.sql"),
    ),
    (
        "0013_market_fx",
        include_str!("../../migrations/0013_market_fx.sql"),
    ),
];

pub fn run(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name       TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )?;

    for (name, sql) in MIGRATIONS {
        let applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = ?1)",
            params![name],
            |row| row.get(0),
        )?;
        if applied {
            continue;
        }
        conn.execute_batch(sql)?;
        conn.execute(
            "INSERT INTO _migrations (name, applied_at) VALUES (?1, ?2)",
            params![name, chrono::Utc::now().to_rfc3339()],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrations_for_test(&conn);
        migrations_for_test(&conn); // 幂等

        let expected = [
            "providers",
            "channels",
            "models",
            "channel_models",
            "model_prices",
            "channel_recharges",
            "channel_bills",
            "channel_balance_snapshots",
            "agent_compatibility",
            "agent_launches",
            "request_records",
            "processing_events",
            "request_attachments",
            "error_diagnoses",
            "agent_conversations",
            "agent_messages",
            "settings",
        ];
        for table in expected {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "缺少表: {table}");
        }
    }

    fn migrations_for_test(conn: &Connection) {
        run(conn).unwrap();
    }
}
