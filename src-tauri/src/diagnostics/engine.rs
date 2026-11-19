//! 诊断引擎：把错误记录的事实与知识库条目匹配，输出带置信度的诊断。
//!
//! 红线（PLAN.md）：错误性质与来源分开、事实与推测分开、置信度必须明确、
//! 证据不足时标 unknown；诊断只读，不修改任何数据。

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppResult;
use crate::requests::repo as records;

use super::knowledge::{self, KnowledgeEntry};

/// 置信度：confirmed（错误码精确命中）/ probable（状态或关键词命中）/ unknown（证据不足）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Confidence {
    Confirmed,
    Probable,
    Unknown,
}

impl Confidence {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::Probable => "probable",
            Self::Unknown => "unknown",
        }
    }
}

/// 诊断结果：事实（evidence / facts）与建议（advice）分开，置信度必填。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    pub trace_id: String,
    pub status: String,
    /// 命中的置信度
    pub confidence: String,
    /// 观察到的事实（错误码 / 消息摘要 / 命中依据）
    pub evidence: String,
    /// 命中的知识条目（unknown 时为 null）
    pub matched: Option<KnowledgeEntry>,
    /// 建议（matched 为 null 时给出通用排查建议）
    pub advice: String,
    /// 处理事件中的失败步骤（事实）
    pub failed_events: Vec<String>,
}

/// 对一条测试记录做知识库诊断。
pub fn diagnose(conn: &Connection, trace_id: &str) -> AppResult<Diagnosis> {
    let record = records::get(conn, trace_id)?;
    let failed_events: Vec<String> = records::list_events(conn, trace_id)?
        .into_iter()
        .filter(|e| e.status == "failed")
        .map(|e| {
            format!(
                "[{}] {}: {}",
                e.stage,
                e.operation,
                e.description.as_deref().unwrap_or("")
            )
        })
        .collect();

    let entries = knowledge::list_all(conn)?;
    let message_lc = record.error_message.as_deref().unwrap_or("").to_lowercase();
    let error_code = record.error_code.as_deref();

    // 1) confirmed：error_code 精确命中
    if let Some(code) = error_code {
        if let Some(entry) = entries
            .iter()
            .find(|e| e.error_code.as_deref() == Some(code))
        {
            return Ok(build(
                &record,
                Confidence::Confirmed,
                format!("错误码 {} 精确命中知识条目「{}」", code, entry.id),
                Some(entry.clone()),
                failed_events,
            ));
        }
    }
    // 2) probable：http_status 命中（条目未限定 error_code），或关键词命中消息
    if let Some(status) = record.http_status {
        if let Some(entry) = entries
            .iter()
            .find(|e| e.error_code.is_none() && e.http_status == Some(status))
        {
            return Ok(build(
                &record,
                Confidence::Probable,
                format!("HTTP {} 命中知识条目「{}」", status, entry.id),
                Some(entry.clone()),
                failed_events,
            ));
        }
    }
    if let Some(entry) = entries.iter().find(|e| {
        e.keyword
            .as_deref()
            .map(|kw| message_lc.contains(kw))
            .unwrap_or(false)
    }) {
        return Ok(build(
            &record,
            Confidence::Probable,
            format!(
                "错误消息命中关键词「{}」",
                entry.keyword.as_deref().unwrap_or("")
            ),
            Some(entry.clone()),
            failed_events,
        ));
    }
    // 3) unknown：证据不足，给通用排查建议
    Ok(build(
        &record,
        Confidence::Unknown,
        "证据不足：错误码 / 状态 / 消息均未命中知识库条目".into(),
        None,
        failed_events,
    ))
}

fn build(
    record: &records::RequestRecordRow,
    confidence: Confidence,
    evidence: String,
    matched: Option<KnowledgeEntry>,
    failed_events: Vec<String>,
) -> Diagnosis {
    Diagnosis {
        trace_id: record.trace_id.clone(),
        status: record.status.clone(),
        confidence: confidence.as_str().to_string(),
        evidence,
        matched: matched.clone(),
        advice: matched
            .as_ref()
            .map(|e| e.advice.clone())
            .unwrap_or_else(|| {
                "通用排查：打开 Raw 请求 / 响应归档核对实际交互；查看处理事件链路；用「复制 curl」在终端复现".into()
            }),
        failed_events,
    }
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
                name: "测试渠道".into(),
                provider_id: None,
                chat_base_url: "Invalid URL".into(),
                anthropic_base_url: None,
                responses_base_url: None,
                chat_completions_url: None,
                official_url: None,
                notes: None,
                primary_credential: None,
                group_id: None,
            },
            "{}",
        )
        .unwrap();
        conn
    }

    fn insert_failed_record(
        conn: &Connection,
        code: &str,
        message: &str,
        http: Option<i64>,
    ) -> String {
        records::insert_pending(conn, "t-1", "ch-1", None, None, "openai_chat", "api_test")
            .unwrap();
        conn.execute(
            "UPDATE request_records SET status='failed', error_code=?1, error_message=?2, http_status=?3 WHERE trace_id='t-1'",
            rusqlite::params![code, message, http],
        )
        .unwrap();
        "t-1".into()
    }

    #[test]
    fn confirmed_match_by_error_code() {
        let conn = setup();
        insert_failed_record(
            &conn,
            "HTTP_401",
            "{\"message\":\"Invalid token\"}",
            Some(401),
        );
        let d = diagnose(&conn, "t-1").unwrap();
        assert_eq!(d.confidence, "confirmed");
        let entry = d.matched.expect("应命中条目");
        assert_eq!(entry.error_type, "auth");
        assert!(!d.advice.is_empty());
    }

    #[test]
    fn probable_match_by_keyword() {
        let conn = setup();
        insert_failed_record(
            &conn,
            "HTTP_400",
            "{\"message\":\"connection refused\"}",
            Some(400),
        );
        let d = diagnose(&conn, "t-1").unwrap();
        assert_eq!(d.confidence, "probable");
        assert!(d.matched.expect("关键词应命中").error_type == "network");
    }

    #[test]
    fn unknown_when_no_match() {
        let conn = setup();
        insert_failed_record(&conn, "HTTP_418", "奇异错误", None);
        let d = diagnose(&conn, "t-1").unwrap();
        assert_eq!(d.confidence, "unknown");
        assert!(d.matched.is_none());
        assert!(d.advice.contains("通用排查"));
    }
}
