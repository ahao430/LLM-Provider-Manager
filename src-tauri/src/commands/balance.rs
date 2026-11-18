//! 余额查询命令：不同服务商配置不同查询路径（渠道上单独设置，不在新建/编辑表单中）。
//!
//! 规则（PLAN.md）：LCM 不假装能自动同步余额；此处为用户配置的只读查询，
//! 结果写余额快照（人工确认后才入库，查询即展示 + 用户点保存才记快照）。

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::channels::domain::BalanceQuery;
use crate::channels::repo as channel_repo;
use crate::channels::service as channel_service;
use crate::error::{AppError, AppResult};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

/// 设置渠道余额查询配置（渠道详情页按钮）。
#[tauri::command]
pub fn set_balance_query(
    state: State<'_, AppState>,
    channel_id: String,
    path: String,
    json_path: String,
) -> AppResult<()> {
    let conn = db(&state)?;
    let mut config = channel_repo::load_config(&conn, &channel_id)?;
    if path.trim().is_empty() {
        config.balance_query = None;
    } else {
        config.balance_query = Some(BalanceQuery {
            path: path.trim().to_string(),
            json_path: json_path.trim().to_string(),
        });
    }
    conn.execute(
        "UPDATE channels SET config_json = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![
            channel_id,
            serde_json::to_string(&config).map_err(|e| AppError::Invalid(e.to_string()))?,
            crate::util::now_rfc3339()
        ],
    )?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceResult {
    pub url: String,
    pub http_status: Option<u16>,
    pub json_path: String,
    /// 点路径提取到的余额值（数字或字符串，按服务商返回）
    pub value: Option<serde_json::Value>,
    pub raw_snippet: Option<String>,
}

/// 查询余额（只读 GET，凭证受控注入；返回提取值，不自动写快照）。
#[tauri::command]
pub async fn query_channel_balance(
    state: State<'_, AppState>,
    channel_id: String,
) -> AppResult<BalanceResult> {
    // 1. 锁内读取配置
    let (base_url, token, tls_verify, bq) = {
        let conn = db(&state)?;
        let row = channel_repo::find_row(&conn, &channel_id)?
            .ok_or_else(|| AppError::Invalid("渠道不存在".into()))?;
        let config = channel_repo::load_config(&conn, &channel_id)?;
        let token = channel_service::resolve_primary_credential(&channel_id);
        (
            row.chat_base_url.clone(),
            token,
            config.tls_verify,
            config.balance_query,
        )
    }; // 锁释放

    let bq = bq.ok_or_else(|| {
        AppError::Invalid("该渠道未配置余额查询（请在渠道详情页设置查询路径）".into())
    })?;

    // 2. 构造 URL：完整 URL 或相对路径拼在 chat Base URL 后
    let url = if bq.path.starts_with("http://") || bq.path.starts_with("https://") {
        bq.path.clone()
    } else {
        format!(
            "{}/{}",
            base_url.trim_end_matches('/'),
            bq.path.trim_start_matches('/')
        )
    };

    // 3. 只读 GET（Bearer 认证）
    let client = crate::util::http_client(30, tls_verify).map_err(AppError::Invalid)?;
    let mut request = client.get(&url);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("余额查询请求失败: {e}")))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::Invalid(format!("读取响应失败: {e}")))?;

    let snippet: String = body.chars().take(400).collect();
    if !(200..300).contains(&status) {
        return Ok(BalanceResult {
            url,
            http_status: Some(status),
            json_path: bq.json_path.clone(),
            value: None,
            raw_snippet: Some(format!("HTTP {status}：{snippet}")),
        });
    }

    // 4. 点路径提取（data.total_balance 形式；数组用数字下标）
    let root: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| AppError::Invalid(format!("响应不是 JSON: {e}；片段：{snippet}")))?;
    let value = extract_json_path(&root, &bq.json_path);

    Ok(BalanceResult {
        url,
        http_status: Some(status),
        json_path: bq.json_path.clone(),
        value,
        raw_snippet: Some(snippet),
    })
}

/// 点路径提取：a.b.0.c（对象键 + 数字数组下标）。找不到返回 None，不报错。
fn extract_json_path(root: &serde_json::Value, path: &str) -> Option<serde_json::Value> {
    let mut current = root.clone();
    for segment in path.split('.').filter(|s| !s.is_empty()) {
        current = match &current {
            serde_json::Value::Object(map) => map.get(segment)?.clone(),
            serde_json::Value::Array(items) => {
                let index: usize = segment.parse().ok()?;
                items.get(index)?.clone()
            }
            _ => return None,
        };
    }
    Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_path_extraction() {
        let root: serde_json::Value = serde_json::from_str(
            r#"{"data":{"total_balance":42.5,"items":[{"quota":1},{"quota":2}]}}"#,
        )
        .unwrap();
        assert_eq!(
            extract_json_path(&root, "data.total_balance"),
            Some(serde_json::json!(42.5))
        );
        assert_eq!(
            extract_json_path(&root, "data.items.1.quota"),
            Some(serde_json::json!(2))
        );
        assert_eq!(extract_json_path(&root, "data.nope"), None);
        assert_eq!(extract_json_path(&root, ""), Some(root.clone()));
    }
}
