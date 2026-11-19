//! Dashboard 聚合统计。
//!
//! 规则（PLAN.md「资金与账单管理」）：充值金额、供应商账单金额、本地测试费用估算
//! 必须分开统计；不同币种分组，没有明确汇率时不直接相加。

use rusqlite::Connection;
use serde::Serialize;

use crate::requests::cost::estimate_record_cost;
use crate::requests::repo as records;
use crate::util::now_rfc3339;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyAmount {
    pub currency: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthRequests {
    pub month: String,
    pub total: i64,
    pub success: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthCost {
    pub month: String,
    pub currency: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestCounts {
    pub total: i64,
    pub success: i64,
    pub failed: i64,
    pub pending: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub channel_total: i64,
    pub channel_enabled: i64,
    pub global_models: i64,
    pub channel_models: i64,
    pub requests: RequestCounts,
    pub tokens_input: i64,
    pub tokens_output: i64,
    pub tokens_cache: i64,
    /// 本地测试费用估算（按币种分组；估算值，不等同供应商账单）
    pub estimated_costs: Vec<CurrencyAmount>,
    /// 累计充值（按币种）
    pub recharge_totals: Vec<CurrencyAmount>,
    pub recharge_count: i64,
    /// 供应商账单合计（按币种）
    pub bill_totals: Vec<CurrencyAmount>,
    /// 近 6 个月请求趋势
    pub monthly_requests: Vec<MonthRequests>,
    /// 近 6 个月本地估算费用趋势（按币种）
    pub monthly_costs: Vec<MonthCost>,
    pub recent_requests: Vec<records::RequestRecordRow>,
    pub recent_errors: Vec<records::RequestRecordRow>,
    /// 未解决故障事件数（incidents.resolved_at IS NULL）
    pub incident_open: i64,
    /// 处于「故障确认」状态的渠道数
    pub channel_fault: i64,
}

fn currency_sums(conn: &Connection, table: &str) -> Vec<CurrencyAmount> {
    let sql =
        format!("SELECT currency, SUM(amount) FROM {table} GROUP BY currency ORDER BY currency");
    let mut stmt = match conn.prepare(&sql) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map([], |row| {
        Ok(CurrencyAmount {
            currency: row.get(0)?,
            amount: row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

pub fn compute(conn: &Connection) -> DashboardStats {
    let (channel_total, channel_enabled) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(enabled), 0) FROM channels",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, 0));
    let global_models: i64 = conn
        .query_row("SELECT COUNT(*) FROM models", [], |row| row.get(0))
        .unwrap_or(0);
    let channel_models: i64 = conn
        .query_row("SELECT COUNT(*) FROM channel_models", [], |row| row.get(0))
        .unwrap_or(0);

    let (request_total, request_success, request_pending) = conn
        .query_row(
            "SELECT COUNT(*), \
             COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0), \
             COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) \
             FROM request_records",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or((0, 0, 0));
    let requests = RequestCounts {
        total: request_total,
        success: request_success,
        failed: request_total - request_success - request_pending,
        pending: request_pending,
    };

    let (tokens_input, tokens_output, tokens_cache) = conn
        .query_row(
            "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), \
             COALESCE(SUM(cache_tokens), 0) FROM request_records WHERE completed_at IS NOT NULL",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or((0, 0, 0));

    // 全量记录用于费用估算与月度趋势（本地数据量级可接受）
    let all = records::list(conn, 10_000).unwrap_or_default();

    let mut cost_by_currency: std::collections::BTreeMap<String, f64> = Default::default();
    let mut cost_by_month_currency: std::collections::BTreeMap<(String, String), f64> =
        Default::default();
    let mut month_requests: std::collections::BTreeMap<String, (i64, i64)> = Default::default();
    let month_floor = six_months_ago();

    for record in &all {
        // 费用估算（有渠道模型绑定且价格可用才计入）
        if let Some(est) = estimate_record_cost(conn, record) {
            *cost_by_currency.entry(est.currency.clone()).or_default() += est.amount;
            let month = record.created_at.get(..10).unwrap_or("").to_string();
            if month >= month_floor {
                *cost_by_month_currency
                    .entry((month, est.currency.clone()))
                    .or_default() += est.amount;
            }
        }
        // 月度请求趋势
        let month = record.created_at.get(..10).unwrap_or("").to_string();
        if month >= month_floor {
            let entry = month_requests.entry(month).or_default();
            entry.0 += 1;
            if record.status == "success" {
                entry.1 += 1;
            }
        }
    }

    let monthly_requests = month_requests
        .into_iter()
        .map(|(month, (total, success))| MonthRequests {
            month,
            total,
            success,
        })
        .collect();
    let monthly_costs = cost_by_month_currency
        .into_iter()
        .map(|((month, currency), amount)| MonthCost {
            month,
            currency,
            amount,
        })
        .collect();
    let estimated_costs = cost_by_currency
        .into_iter()
        .map(|(currency, amount)| CurrencyAmount { currency, amount })
        .collect();

    let recharge_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM channel_recharges", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    DashboardStats {
        channel_total,
        channel_enabled,
        global_models,
        channel_models,
        requests,
        tokens_input,
        tokens_output,
        tokens_cache,
        estimated_costs,
        recharge_totals: currency_sums(conn, "channel_recharges"),
        recharge_count,
        bill_totals: currency_sums(conn, "channel_bills"),
        monthly_requests,
        monthly_costs,
        recent_requests: records::list(conn, 5).unwrap_or_default(),
        recent_errors: records::list_errors(conn, 5).unwrap_or_default(),
        incident_open: conn
            .query_row(
                "SELECT COUNT(*) FROM incidents WHERE resolved_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0),
        channel_fault: conn
            .query_row(
                "SELECT COUNT(*) FROM channels WHERE ops_status = 'fault'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0),
    }
}

fn six_months_ago() -> String {
    chrono::NaiveDate::from_ymd_opt(chrono::Local::now().year(), chrono::Local::now().month(), 1)
        .map(|d| {
            let months_back = 5;
            let total = d.year() * 12 + d.month0() as i32 - months_back;
            let y = total / 12;
            let m = total % 12 + 1;
            format!("{y:04}-{m:02}-01")
        })
        .unwrap_or_else(|| "0000-01-01".into())
}

/// 当前年月（供测试断言参考，同时避免 unused import）。
#[allow(dead_code)]
fn this_month() -> String {
    let _ = now_rfc3339();
    chrono::Local::now().format("%Y-%m").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::migrations;

    #[test]
    fn empty_dashboard_returns_zeros() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        let stats = compute(&conn);
        assert_eq!(stats.requests.total, 0);
        assert!(stats.estimated_costs.is_empty());
        assert!(stats.recharge_totals.is_empty());
    }

    #[test]
    fn counts_and_currencies() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        conn.execute(
            "INSERT INTO channels (id, name, channel_type, base_url, default_protocol, enabled, config_json, created_at, updated_at) \
             VALUES ('c1', 'A', 'custom', 'https://x.com', 'openai_chat', 1, '{}', '2026-01-01', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO channel_recharges (id, channel_id, amount, currency, recharged_at, created_at) \
             VALUES ('r1', 'c1', 100.0, 'CNY', '2026-06-01', '2026-06-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO channel_bills (id, channel_id, billing_period, amount, currency, source, created_at) \
             VALUES ('b1', 'c1', '2026-06', 50.0, 'CNY', 'manual', '2026-06-01')",
            [],
        )
        .unwrap();

        let stats = compute(&conn);
        assert_eq!(stats.channel_total, 1);
        assert_eq!(stats.channel_enabled, 1);
        assert_eq!(stats.recharge_count, 1);
        assert_eq!(stats.recharge_totals[0].amount, 100.0);
        assert_eq!(stats.bill_totals[0].amount, 50.0);
        // 充值与账单分开统计
        assert_ne!(stats.recharge_totals[0].amount, stats.bill_totals[0].amount);
    }
}

// chrono 年月辅助
use chrono::Datelike;

// ------------------------------------------------------------------
// Tauri 命令封装
// ------------------------------------------------------------------

use crate::error::AppResult;
use crate::AppState;
use tauri::State;

/// Dashboard 聚合统计。
#[tauri::command]
pub fn get_dashboard_stats(state: State<'_, AppState>) -> AppResult<DashboardStats> {
    let conn = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))?;
    Ok(compute(&conn))
}
