//! 错误知识库读取（只读；内置条目来自迁移 0011）。

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppResult;

/// 知识条目（facts 与 advice 分开：事实 vs 建议）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEntry {
    pub id: String,
    pub error_code: Option<String>,
    pub http_status: Option<i64>,
    pub keyword: Option<String>,
    pub error_type: String,
    pub title: String,
    /// 事实：从错误记录中观察到的东西
    pub facts: String,
    /// 建议：推测性内容，仅供参考，LCM 不会自动执行
    pub advice: String,
    pub source: String,
}

/// 加载全部知识条目（内置集很小，全量加载后内存匹配）。
pub fn list_all(conn: &Connection) -> AppResult<Vec<KnowledgeEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, error_code, http_status, keyword, error_type, title, facts, advice, source \
         FROM error_knowledge ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(KnowledgeEntry {
                id: r.get(0)?,
                error_code: r.get(1)?,
                http_status: r.get(2)?,
                keyword: r.get(3)?,
                error_type: r.get(4)?,
                title: r.get(5)?,
                facts: r.get(6)?,
                advice: r.get(7)?,
                source: r.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}
