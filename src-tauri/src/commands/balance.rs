//! 余额查询命令：不同服务商配置不同查询方式（渠道上单独设置，不在新建/编辑表单中）。
//!
//! 规则（PLAN.md）：LCM 不假装能自动同步余额；此处为用户配置的只读查询。
//! - `query_channel_balance`：通用 HTTP 方式只查询展示（渠道详情页预览，不落库）；
//! - `refresh_channel_balance`：查询并把数值写入余额快照（渠道列表「查询」按钮，用户点击即确认）；
//! - 百炼（阿里云费用中心）方式：AccessKey 配置在凭证文件，余额与账单走 RPC V1 签名。

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::billing::aliyun;
use crate::channels::domain::BalanceQuery;
use crate::channels::repo as channel_repo;
use crate::channels::service as channel_service;
use crate::credentials::{self, CredentialKind};
use crate::error::{AppError, AppResult};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| AppError::Invalid("数据库连接锁已失效".into()))
}

/// 设置余额查询配置的输入（避免命令参数过长）。
/// 查询方式不在此选择——由渠道已选的服务商派生（providers.code）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBalanceQueryInput {
    pub path: String,
    pub json_path: String,
    pub currency: Option<String>,
    /// NewAPI 用户 ID（new_api 用）
    pub user_id: Option<String>,
    /// 凭证均为：Some(非空)=写入凭证文件，Some("")=清除，None=保持不变
    pub billing_access_key_id: Option<String>,
    pub billing_access_key_secret: Option<String>,
    /// NewAPI 系统访问令牌
    pub billing_system_token: Option<String>,
}

/// 按渠道服务商派生查询方式：newapi → new_api，bailian → aliyun_bss，其他 → generic。
fn derive_balance_mode(conn: &Connection, channel_id: &str) -> AppResult<&'static str> {
    let code: Option<String> = conn
        .query_row(
            "SELECT p.code FROM channels c JOIN providers p ON c.provider_id = p.id WHERE c.id = ?1",
            rusqlite::params![channel_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::Invalid("渠道不存在".into()))?;
    Ok(crate::channels::domain::balance_mode_for_provider(
        code.as_deref(),
    ))
}

/// 设置渠道余额查询配置（渠道详情页按钮）。
/// 查询方式由渠道服务商派生：NewAPI 填用户 ID + 系统访问令牌，
/// 百炼填 AccessKey 对（均存凭证文件），其他走通用 HTTP。
#[tauri::command]
pub fn set_balance_query(
    state: State<'_, AppState>,
    channel_id: String,
    input: SetBalanceQueryInput,
) -> AppResult<()> {
    let SetBalanceQueryInput {
        path,
        json_path,
        currency,
        user_id,
        billing_access_key_id,
        billing_access_key_secret,
        billing_system_token,
    } = input;
    let conn = db(&state)?;
    let mode = derive_balance_mode(&conn, &channel_id)?;

    // 计费凭证写凭证文件（与主凭证同库，掩码展示）
    if let Some(id) = billing_access_key_id {
        let id = id.trim();
        if id.is_empty() {
            credentials::delete(&channel_id, &CredentialKind::BillingAccessKeyId)?;
        } else {
            credentials::set(&channel_id, &CredentialKind::BillingAccessKeyId, id)?;
        }
    }
    if let Some(secret) = billing_access_key_secret {
        let secret = secret.trim();
        if secret.is_empty() {
            credentials::delete(&channel_id, &CredentialKind::BillingAccessKeySecret)?;
        } else {
            credentials::set(&channel_id, &CredentialKind::BillingAccessKeySecret, secret)?;
        }
    }
    if let Some(token) = billing_system_token {
        let token = token.trim();
        if token.is_empty() {
            credentials::delete(&channel_id, &CredentialKind::BillingSystemToken)?;
        } else {
            credentials::set(&channel_id, &CredentialKind::BillingSystemToken, token)?;
        }
    }

    let mut config = channel_repo::load_config(&conn, &channel_id)?;
    if mode == "generic" && path.trim().is_empty() {
        config.balance_query = None;
    } else {
        config.balance_query = Some(BalanceQuery {
            provider: mode.to_string(),
            path: path.trim().to_string(),
            json_path: json_path.trim().to_string(),
            user_id: user_id
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .to_string(),
            // new_api 额度按 $1 = 500,000 quota 折算，固定 USD
            currency: if mode == "new_api" {
                "USD".to_string()
            } else {
                currency
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("CNY")
                    .to_uppercase()
            },
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
    /// 本次查询是否已写入余额快照（refresh_channel_balance 时为 true）
    pub saved_snapshot: bool,
    /// 写入快照的币种
    pub currency: Option<String>,
}

/// 查询余额（只读；返回提取值，不自动写快照）。
#[tauri::command]
pub async fn query_channel_balance(
    state: State<'_, AppState>,
    channel_id: String,
) -> AppResult<BalanceResult> {
    query_balance(&state, &channel_id).await
}

/// 查询并保存：渠道列表「查询余额」按钮，数值可解析时写入余额快照。
#[tauri::command]
pub async fn refresh_channel_balance(
    state: State<'_, AppState>,
    channel_id: String,
) -> AppResult<BalanceResult> {
    let mut result = query_balance(&state, &channel_id).await?;

    // 数值可解析（数字或数字字符串）才落快照；其余只返回展示
    if let Some(amount) = result.value.as_ref().and_then(parse_amount) {
        let currency = {
            let conn = db(&state)?;
            channel_repo::load_config(&conn, &channel_id)?
                .balance_query
                .map(|bq| bq.currency)
                .unwrap_or_else(|| "CNY".into())
        };
        let now = crate::util::now_rfc3339();
        let conn = db(&state)?;
        conn.execute(
            "INSERT INTO channel_balance_snapshots \
             (id, channel_id, balance, currency, captured_at, notes, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                channel_id,
                amount,
                currency,
                now,
                "余额查询",
            ],
        )?;
        result.saved_snapshot = true;
        result.currency = Some(currency);
    }
    Ok(result)
}

/// 读取渠道的百炼（阿里云 BSS）查询上下文：校验 provider + 取 AccessKey 对。
fn bailian_context(state: &AppState, channel_id: &str) -> AppResult<(String, String, bool)> {
    let (provider, tls_verify) = {
        let conn = db(state)?;
        channel_repo::find_row(&conn, channel_id)?
            .ok_or_else(|| AppError::Invalid("渠道不存在".into()))?;
        let config = channel_repo::load_config(&conn, channel_id)?;
        let provider = config
            .balance_query
            .as_ref()
            .map(|bq| bq.provider.clone())
            .unwrap_or_default();
        (provider, config.tls_verify)
    };
    if provider != "aliyun_bss" {
        return Err(AppError::Invalid(
            "该渠道未启用阿里云费用中心查询（请在渠道详情 → 余额查询选择「阿里云费用中心」）"
                .into(),
        ));
    }
    let id = credentials::get(channel_id, &CredentialKind::BillingAccessKeyId)?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Invalid("未配置 AccessKey ID（渠道详情 → 余额查询）".into()))?;
    let secret = credentials::get(channel_id, &CredentialKind::BillingAccessKeySecret)?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Invalid("未配置 AccessKey Secret（渠道详情 → 余额查询）".into())
        })?;
    Ok((id, secret, tls_verify))
}

async fn query_balance(state: &AppState, channel_id: &str) -> AppResult<BalanceResult> {
    // 1. 锁内读取配置
    let (base_url, token, tls_verify, bq) = {
        let conn = db(state)?;
        let row = channel_repo::find_row(&conn, channel_id)?
            .ok_or_else(|| AppError::Invalid("渠道不存在".into()))?;
        let config = channel_repo::load_config(&conn, channel_id)?;
        let token = channel_service::resolve_primary_credential(channel_id);
        let bq = config.balance_query.clone();
        (row.chat_base_url.clone(), token, config.tls_verify, bq)
    }; // 锁释放

    let bq =
        bq.ok_or_else(|| AppError::Invalid("该渠道未配置余额查询（请在渠道详情页设置）".into()))?;

    // 分支一：NewAPI 用户额度（/api/user/self + 用户ID + 系统访问令牌）
    if bq.provider == "new_api" {
        let user_id = bq.user_id.trim();
        if user_id.is_empty() {
            return Err(AppError::Invalid(
                "未配置 NewAPI 用户 ID（渠道详情 → 余额查询）".into(),
            ));
        }
        let token = credentials::get(channel_id, &CredentialKind::BillingSystemToken)?
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::Invalid("未配置 NewAPI 系统访问令牌（渠道详情 → 余额查询）".into())
            })?;
        let url = format!("{}/api/user/self", base_url.trim_end_matches('/'));
        let client = crate::util::http_client(30, tls_verify).map_err(AppError::Invalid)?;
        // 系统访问令牌原样放 Authorization（无 Bearer），用户 ID 走 New-Api-User 头
        let response = client
            .get(&url)
            .header("Authorization", &token)
            .header("New-Api-User", user_id)
            .send()
            .await
            .map_err(|e| AppError::Invalid(format!("NewAPI 余额查询请求失败: {e}")))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .map_err(|e| AppError::Invalid(format!("读取响应失败: {e}")))?;
        let root: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
            let snippet: String = body.chars().take(200).collect();
            AppError::Invalid(format!("响应不是 JSON: {e}；片段：{snippet}"))
        })?;
        if !root
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let message = root
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("无错误信息");
            return Err(AppError::Invalid(format!(
                "NewAPI 查询用户额度失败：{message}（请确认系统访问令牌复制自对方实例且为最新一次生成，用户 ID 与令牌归属用户一致）"
            )));
        }
        let quota = root
            .pointer("/data/quota")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        // $1 = 500,000 quota（new-api QuotaPerUnit）
        let amount = (quota.max(0) as f64) / 500_000.0;
        return Ok(BalanceResult {
            url,
            http_status: Some(status),
            json_path: "data.quota ÷ 500000".into(),
            value: Some(serde_json::json!(amount)),
            raw_snippet: None,
            saved_snapshot: false,
            currency: Some("USD".into()),
        });
    }

    // 分支二：阿里云费用中心（RPC V1 签名，AccessKey 在凭证文件）
    if bq.provider == "aliyun_bss" {
        let id = credentials::get(channel_id, &CredentialKind::BillingAccessKeyId)?
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Invalid("未配置 AccessKey ID".into()))?;
        let secret = credentials::get(channel_id, &CredentialKind::BillingAccessKeySecret)?
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Invalid("未配置 AccessKey Secret".into()))?;
        let balance = aliyun::query_balance(&id, &secret, tls_verify).await?;
        return Ok(BalanceResult {
            url: "https://business.aliyuncs.com/ (QueryAccountBalance)".into(),
            http_status: Some(200),
            json_path: "Data.AvailableAmount".into(),
            value: Some(serde_json::json!(balance.amount)),
            raw_snippet: None,
            saved_snapshot: false,
            currency: Some(balance.currency),
        });
    }

    // 分支三：通用 HTTP（Bearer GET + JSON 路径）
    let url = if bq.path.starts_with("http://") || bq.path.starts_with("https://") {
        bq.path.clone()
    } else {
        format!(
            "{}/{}",
            base_url.trim_end_matches('/'),
            bq.path.trim_start_matches('/')
        )
    };
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
            saved_snapshot: false,
            currency: None,
        });
    }
    let root: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| AppError::Invalid(format!("响应不是 JSON: {e}；片段：{snippet}")))?;
    let value = extract_json_path(&root, &bq.json_path);

    Ok(BalanceResult {
        url,
        http_status: Some(status),
        json_path: bq.json_path.clone(),
        value,
        raw_snippet: Some(snippet),
        saved_snapshot: false,
        currency: None,
    })
}

/// 数字或纯数字字符串 → f64（"12.34"/12.34 都接受；其他返回 None）。
fn parse_amount(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

// ------------------------------------------------------------------
// 百炼收支明细（账单）
// ------------------------------------------------------------------

/// 查询百炼收支明细（只读展示；start/end 为 YYYY-MM-DD，nextToken 翻页）。
#[tauri::command]
pub async fn query_bailian_transactions(
    state: State<'_, AppState>,
    channel_id: String,
    start: String,
    end: String,
    next_token: Option<String>,
) -> AppResult<aliyun::BailianTransactions> {
    let (id, secret, tls_verify) = bailian_context(&state, &channel_id)?; // 锁外部分在锁内取凭证（本地文件）
    aliyun::query_transactions(
        &id,
        &secret,
        &start,
        &end,
        next_token.as_deref(),
        tls_verify,
    )
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTransactionInput {
    pub transaction_time: String,
    pub amount: String,
}

/// 把拉取的收支明细按月汇总导入账单（source=aliyun_bss，同渠道同账期同来源覆盖替换）。
#[tauri::command]
pub fn import_bailian_bills(
    state: State<'_, AppState>,
    channel_id: String,
    currency: String,
    transactions: Vec<ImportTransactionInput>,
) -> AppResult<Vec<aliyun::MonthlyBill>> {
    // 校验 provider（保持与查询一致的入口约束）
    {
        let conn = db(&state)?;
        let config = channel_repo::load_config(&conn, &channel_id)?;
        let is_bailian = config
            .balance_query
            .as_ref()
            .is_some_and(|bq| bq.provider == "aliyun_bss");
        if !is_bailian {
            return Err(AppError::Invalid(
                "仅启用阿里云费用中心查询的渠道可导入百炼账单".into(),
            ));
        }
    }
    let items: Vec<aliyun::BailianTransaction> = transactions
        .into_iter()
        .map(|t| aliyun::BailianTransaction {
            transaction_time: t.transaction_time,
            transaction_type: String::new(),
            amount: t.amount,
            fund_type: String::new(),
            remarks: String::new(),
        })
        .collect();
    let monthly = aliyun::aggregate_monthly(&items, &currency)?;
    let currency = currency.trim().to_uppercase();
    let conn = db(&state)?;
    for bill in &monthly {
        crate::billing::repo::replace_bill(
            &conn,
            &channel_id,
            &bill.billing_period,
            bill.amount,
            &currency,
            "aliyun_bss",
            Some(&format!("百炼收支明细 {} 条求和（净额）", bill.count)),
        )?;
    }
    Ok(monthly)
}

/// 各渠道最近一次余额快照（渠道列表展示）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestBalanceRow {
    pub channel_id: String,
    pub balance: f64,
    pub currency: String,
    pub captured_at: String,
}

#[tauri::command]
pub fn list_latest_balances(state: State<'_, AppState>) -> AppResult<Vec<LatestBalanceRow>> {
    let conn = db(&state)?;
    let mut stmt = conn.prepare(
        "SELECT channel_id, balance, currency, captured_at FROM ( \
           SELECT channel_id, balance, currency, captured_at, \
                  ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY captured_at DESC) AS rn \
           FROM channel_balance_snapshots \
         ) WHERE rn = 1",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LatestBalanceRow {
                channel_id: row.get(0)?,
                balance: row.get(1)?,
                currency: row.get(2)?,
                captured_at: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
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

    #[test]
    fn amount_parsing_accepts_numeric_strings() {
        assert_eq!(parse_amount(&serde_json::json!(42.5)), Some(42.5));
        assert_eq!(parse_amount(&serde_json::json!("12.34")), Some(12.34));
        assert_eq!(parse_amount(&serde_json::json!("$12.34")), None);
        assert_eq!(parse_amount(&serde_json::json!("abc")), None);
        assert_eq!(parse_amount(&serde_json::json!(null)), None);
    }

    #[test]
    fn latest_balances_pick_most_recent_per_channel() {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::migrations::run(&conn).unwrap();
        // 外键约束开启：先建渠道再插快照
        for ch in ["c1", "c2"] {
            channel_repo::insert(
                &conn,
                ch,
                &crate::channels::domain::ChannelInput {
                    name: format!("渠道{ch}"),
                    provider_id: None,
                    chat_base_url: "https://api.example.com".into(),
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
        }
        for (ch, amount, at) in [
            ("c1", 10.0, "2026-01-01"),
            ("c1", 20.0, "2026-02-01"),
            ("c2", 5.0, "2026-03-01"),
        ] {
            conn.execute(
                "INSERT INTO channel_balance_snapshots (id, channel_id, balance, currency, captured_at, notes, created_at) \
                 VALUES (?1, ?2, ?3, 'CNY', ?4, NULL, ?4)",
                rusqlite::params![format!("{ch}-{at}"), ch, amount, at],
            )
            .unwrap();
        }
        // 验证窗口函数取每渠道最新快照
        let rows: Vec<(String, f64)> = conn
            .prepare(
                "SELECT channel_id, balance FROM (SELECT channel_id, balance, \
                 ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY captured_at DESC) rn \
                 FROM channel_balance_snapshots) WHERE rn = 1 ORDER BY channel_id",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(rows, vec![("c1".into(), 20.0), ("c2".into(), 5.0)]);
    }
}
