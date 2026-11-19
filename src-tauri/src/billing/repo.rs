//! 资金记录 SQL 读写（含校验）。

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

const CHANNEL_JOIN: &str = "LEFT JOIN channels c ON x.channel_id = c.id";

fn map_err_fk(e: rusqlite::Error) -> AppError {
    if e.sqlite_error_code() == Some(rusqlite::ErrorCode::ConstraintViolation) {
        AppError::Invalid("关联的渠道不存在".into())
    } else {
        AppError::Invalid(format!("数据库错误: {e}"))
    }
}

// ------------------------------------------------------------------
// 充值记录
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RechargeRow {
    pub id: String,
    pub channel_id: String,
    pub channel_name: Option<String>,
    pub amount: f64,
    pub currency: String,
    pub payment_method: Option<String>,
    pub transaction_id: Option<String>,
    pub recharged_at: String,
    pub notes: Option<String>,
    pub created_at: String,
}

const RECHARGE_COLUMNS: &str =
    "x.id, x.channel_id, c.name, x.amount, x.currency, x.payment_method, x.transaction_id, \
     x.recharged_at, x.notes, x.created_at";

fn recharge_from(row: &rusqlite::Row) -> rusqlite::Result<RechargeRow> {
    Ok(RechargeRow {
        id: row.get(0)?,
        channel_id: row.get(1)?,
        channel_name: row.get(2)?,
        amount: row.get(3)?,
        currency: row.get(4)?,
        payment_method: row.get(5)?,
        transaction_id: row.get(6)?,
        recharged_at: row.get(7)?,
        notes: row.get(8)?,
        created_at: row.get(9)?,
    })
}

/// 充值记录列表（可按渠道过滤）。
pub fn list_recharges(
    conn: &Connection,
    channel_id: Option<&str>,
    limit: u32,
) -> AppResult<Vec<RechargeRow>> {
    let sql = format!(
        "SELECT {RECHARGE_COLUMNS} FROM channel_recharges x {CHANNEL_JOIN} \
         {} ORDER BY x.recharged_at DESC LIMIT ?1",
        if channel_id.is_some() {
            "WHERE x.channel_id = ?2"
        } else {
            ""
        }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(id) = channel_id {
        stmt.query_map(params![limit, id], recharge_from)?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        stmt.query_map(params![limit], recharge_from)?
            .filter_map(|r| r.ok())
            .collect()
    };
    Ok(rows)
}

/// 充值输入（新增 / 编辑共用）。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RechargeInput {
    pub channel_id: String,
    pub amount: f64,
    pub currency: String,
    pub payment_method: Option<String>,
    pub transaction_id: Option<String>,
    pub recharged_at: String,
    pub notes: Option<String>,
}

pub fn insert_recharge(conn: &Connection, input: &RechargeInput) -> AppResult<String> {
    validate_amount(input.amount)?;
    validate_currency(&input.currency)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO channel_recharges \
         (id, channel_id, amount, currency, payment_method, transaction_id, recharged_at, notes, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            input.channel_id,
            input.amount,
            input.currency.trim(),
            trimmed(input.payment_method.as_deref()),
            trimmed(input.transaction_id.as_deref()),
            input.recharged_at.trim(),
            trimmed(input.notes.as_deref()),
            now_rfc3339()
        ],
    )
    .map_err(map_err_fk)?;
    Ok(id)
}

pub fn update_recharge(conn: &Connection, id: &str, input: &RechargeInput) -> AppResult<()> {
    validate_amount(input.amount)?;
    validate_currency(&input.currency)?;
    conn.execute(
        "UPDATE channel_recharges SET amount = ?2, currency = ?3, payment_method = ?4, \
         transaction_id = ?5, recharged_at = ?6, notes = ?7 WHERE id = ?1",
        params![
            id,
            input.amount,
            input.currency.trim(),
            trimmed(input.payment_method.as_deref()),
            trimmed(input.transaction_id.as_deref()),
            input.recharged_at.trim(),
            trimmed(input.notes.as_deref())
        ],
    )?;
    Ok(())
}

pub fn delete_recharge(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM channel_recharges WHERE id = ?1", params![id])?;
    Ok(())
}

// ------------------------------------------------------------------
// 供应商账单
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillRow {
    pub id: String,
    pub channel_id: String,
    pub channel_name: Option<String>,
    pub billing_period: String,
    pub amount: f64,
    pub currency: String,
    pub source: String,
    pub notes: Option<String>,
    pub created_at: String,
}

const BILL_COLUMNS: &str =
    "x.id, x.channel_id, c.name, x.billing_period, x.amount, x.currency, x.source, x.notes, x.created_at";

fn bill_from(row: &rusqlite::Row) -> rusqlite::Result<BillRow> {
    Ok(BillRow {
        id: row.get(0)?,
        channel_id: row.get(1)?,
        channel_name: row.get(2)?,
        billing_period: row.get(3)?,
        amount: row.get(4)?,
        currency: row.get(5)?,
        source: row.get(6)?,
        notes: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub fn list_bills(
    conn: &Connection,
    channel_id: Option<&str>,
    limit: u32,
) -> AppResult<Vec<BillRow>> {
    let sql = format!(
        "SELECT {BILL_COLUMNS} FROM channel_bills x {CHANNEL_JOIN} \
         {} ORDER BY x.billing_period DESC LIMIT ?1",
        if channel_id.is_some() {
            "WHERE x.channel_id = ?2"
        } else {
            ""
        }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(id) = channel_id {
        stmt.query_map(params![limit, id], bill_from)?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        stmt.query_map(params![limit], bill_from)?
            .filter_map(|r| r.ok())
            .collect()
    };
    Ok(rows)
}

/// 录入供应商账单。同渠道同周期同来源唯一（UNIQUE 约束）。
pub fn insert_bill(
    conn: &Connection,
    channel_id: &str,
    billing_period: &str,
    amount: f64,
    currency: &str,
    source: &str,
    notes: Option<&str>,
) -> AppResult<String> {
    validate_amount(amount)?;
    validate_currency(currency)?;
    validate_period(billing_period)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO channel_bills \
         (id, channel_id, billing_period, amount, currency, source, notes, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            channel_id,
            billing_period.trim(),
            amount,
            currency.trim(),
            source.trim(),
            trimmed(notes),
            now_rfc3339()
        ],
    )
    .map_err(|e| {
        if e.sqlite_error_code() == Some(rusqlite::ErrorCode::ConstraintViolation) {
            AppError::Invalid(format!(
                "账期 {billing_period} 已存在同来源账单（同渠道同账期同来源唯一）"
            ))
        } else {
            map_err_fk(e)
        }
    })?;
    Ok(id)
}

pub fn update_bill(conn: &Connection, id: &str, amount: f64, notes: Option<&str>) -> AppResult<()> {
    validate_amount(amount)?;
    conn.execute(
        "UPDATE channel_bills SET amount = ?2, notes = ?3 WHERE id = ?1",
        params![id, amount, trimmed(notes)],
    )?;
    Ok(())
}

pub fn delete_bill(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM channel_bills WHERE id = ?1", params![id])?;
    Ok(())
}

/// 同渠道同账期同来源覆盖替换（导入路径：重复拉取不产生重复账单；人工来源不受影响）。
pub fn replace_bill(
    conn: &Connection,
    channel_id: &str,
    billing_period: &str,
    amount: f64,
    currency: &str,
    source: &str,
    notes: Option<&str>,
) -> AppResult<String> {
    conn.execute(
        "DELETE FROM channel_bills WHERE channel_id = ?1 AND billing_period = ?2 AND source = ?3",
        params![channel_id, billing_period.trim(), source.trim()],
    )?;
    insert_bill(
        conn,
        channel_id,
        billing_period,
        amount,
        currency,
        source,
        notes,
    )
}

// ------------------------------------------------------------------
// 余额快照
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRow {
    pub id: String,
    pub channel_id: String,
    pub channel_name: Option<String>,
    pub balance: f64,
    pub currency: String,
    pub captured_at: String,
    pub notes: Option<String>,
    pub created_at: String,
}

const SNAPSHOT_COLUMNS: &str =
    "x.id, x.channel_id, c.name, x.balance, x.currency, x.captured_at, x.notes, x.created_at";

fn snapshot_from(row: &rusqlite::Row) -> rusqlite::Result<SnapshotRow> {
    Ok(SnapshotRow {
        id: row.get(0)?,
        channel_id: row.get(1)?,
        channel_name: row.get(2)?,
        balance: row.get(3)?,
        currency: row.get(4)?,
        captured_at: row.get(5)?,
        notes: row.get(6)?,
        created_at: row.get(7)?,
    })
}

pub fn list_snapshots(
    conn: &Connection,
    channel_id: Option<&str>,
    limit: u32,
) -> AppResult<Vec<SnapshotRow>> {
    let sql = format!(
        "SELECT {SNAPSHOT_COLUMNS} FROM channel_balance_snapshots x {CHANNEL_JOIN} \
         {} ORDER BY x.captured_at DESC LIMIT ?1",
        if channel_id.is_some() {
            "WHERE x.channel_id = ?2"
        } else {
            ""
        }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(id) = channel_id {
        stmt.query_map(params![limit, id], snapshot_from)?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        stmt.query_map(params![limit], snapshot_from)?
            .filter_map(|r| r.ok())
            .collect()
    };
    Ok(rows)
}

pub fn insert_snapshot(
    conn: &Connection,
    channel_id: &str,
    balance: f64,
    currency: &str,
    captured_at: &str,
    notes: Option<&str>,
) -> AppResult<String> {
    validate_currency(currency)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO channel_balance_snapshots \
         (id, channel_id, balance, currency, captured_at, notes, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            channel_id,
            balance,
            currency.trim(),
            captured_at.trim(),
            trimmed(notes),
            now_rfc3339()
        ],
    )
    .map_err(map_err_fk)?;
    Ok(id)
}

pub fn delete_snapshot(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM channel_balance_snapshots WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

// ------------------------------------------------------------------
// 渠道资金汇总
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyAmount {
    pub currency: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstimatedBalance {
    pub currency: String,
    /// 累计充值 - 供应商账单（估算值，不含赠送 / 退款 / 其他消费）
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelFunds {
    pub recharge_totals: Vec<CurrencyAmount>,
    pub recharge_count: i64,
    pub bill_totals: Vec<CurrencyAmount>,
    /// 估算余额（充值 - 账单；必须标注为估算）
    pub estimated_balance: Vec<EstimatedBalance>,
    pub latest_balance_snapshots: Vec<SnapshotRow>,
}

/// 汇总渠道资金。估算余额按币种：充值合计 - 账单合计。
pub fn channel_funds(conn: &Connection, channel_id: &str) -> AppResult<ChannelFunds> {
    let recharges = list_recharges(conn, Some(channel_id), 10_000)?;
    let bills = list_bills(conn, Some(channel_id), 10_000)?;

    let mut recharge_totals: std::collections::BTreeMap<String, f64> = Default::default();
    for r in &recharges {
        *recharge_totals.entry(r.currency.clone()).or_default() += r.amount;
    }
    let mut bill_totals: std::collections::BTreeMap<String, f64> = Default::default();
    for b in &bills {
        *bill_totals.entry(b.currency.clone()).or_default() += b.amount;
    }

    let mut currencies: std::collections::BTreeSet<String> = Default::default();
    currencies.extend(recharge_totals.keys().cloned());
    currencies.extend(bill_totals.keys().cloned());
    let estimated_balance = currencies
        .into_iter()
        .map(|currency| {
            let recharge = recharge_totals.get(&currency).copied().unwrap_or(0.0);
            let bill = bill_totals.get(&currency).copied().unwrap_or(0.0);
            EstimatedBalance {
                currency,
                amount: recharge - bill,
            }
        })
        .collect();

    Ok(ChannelFunds {
        recharge_totals: recharge_totals
            .into_iter()
            .map(|(currency, amount)| CurrencyAmount { currency, amount })
            .collect(),
        recharge_count: recharges.len() as i64,
        bill_totals: bill_totals
            .into_iter()
            .map(|(currency, amount)| CurrencyAmount { currency, amount })
            .collect(),
        estimated_balance,
        latest_balance_snapshots: list_snapshots(conn, Some(channel_id), 5)?,
    })
}

// ------------------------------------------------------------------
// 校验
// ------------------------------------------------------------------

fn validate_amount(amount: f64) -> AppResult<()> {
    if !amount.is_finite() {
        return Err(AppError::Invalid("金额必须是有限数字".into()));
    }
    Ok(())
}

fn validate_currency(currency: &str) -> AppResult<()> {
    if currency.trim().is_empty() {
        return Err(AppError::Invalid("币种不能为空".into()));
    }
    Ok(())
}

fn validate_period(period: &str) -> AppResult<()> {
    let bytes = period.trim().as_bytes();
    if bytes.len() != 7
        || bytes[4] != b'-'
        || !bytes[..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..].iter().all(u8::is_ascii_digit)
    {
        return Err(AppError::Invalid(format!("账期格式应为 YYYY-MM：{period}")));
    }
    Ok(())
}

fn trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|s| !s.is_empty())
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
        conn
    }

    #[test]
    fn recharge_crud_and_totals() {
        let conn = setup();
        insert_recharge(
            &conn,
            &RechargeInput {
                channel_id: "ch-1".into(),
                amount: 100.0,
                currency: "CNY".into(),
                payment_method: Some("alipay".into()),
                transaction_id: None,
                recharged_at: "2026-06-01".into(),
                notes: None,
            },
        )
        .unwrap();
        insert_recharge(
            &conn,
            &RechargeInput {
                channel_id: "ch-1".into(),
                amount: 50.0,
                currency: "USD".into(),
                payment_method: None,
                transaction_id: None,
                recharged_at: "2026-07-01".into(),
                notes: None,
            },
        )
        .unwrap();

        let list = list_recharges(&conn, Some("ch-1"), 100).unwrap();
        assert_eq!(list.len(), 2);

        let funds = channel_funds(&conn, "ch-1").unwrap();
        assert_eq!(funds.recharge_count, 2);
        assert_eq!(funds.recharge_totals.len(), 2);

        // 更新与删除
        let id = list[0].id.clone();
        update_recharge(
            &conn,
            &id,
            &RechargeInput {
                channel_id: "ch-1".into(),
                amount: 120.0,
                currency: "CNY".into(),
                payment_method: None,
                transaction_id: None,
                recharged_at: "2026-06-01".into(),
                notes: Some("改过".into()),
            },
        )
        .unwrap();
        delete_recharge(&conn, &id).unwrap();
        let funds = channel_funds(&conn, "ch-1").unwrap();
        assert_eq!(funds.recharge_count, 1);

        // 不存在的渠道
        assert!(insert_recharge(
            &conn,
            &RechargeInput {
                channel_id: "nope".into(),
                amount: 1.0,
                currency: "CNY".into(),
                payment_method: None,
                transaction_id: None,
                recharged_at: "2026-01-01".into(),
                notes: None
            }
        )
        .is_err());
    }

    #[test]
    fn bill_unique_and_period_validation() {
        let conn = setup();
        insert_recharge(
            &conn,
            &RechargeInput {
                channel_id: "ch-1".into(),
                amount: 100.0,
                currency: "CNY".into(),
                payment_method: None,
                transaction_id: None,
                recharged_at: "2026-06-01".into(),
                notes: None,
            },
        )
        .unwrap();
        insert_bill(&conn, "ch-1", "2026-06", 50.0, "CNY", "manual", None).unwrap();
        // 同渠道同账期同来源重复 → 拒绝
        assert!(insert_bill(&conn, "ch-1", "2026-06", 60.0, "CNY", "manual", None).is_err());
        // 不同来源允许
        insert_bill(&conn, "ch-1", "2026-06", 60.0, "CNY", "csv_import", None).unwrap();
        // 账期格式校验
        assert!(insert_bill(&conn, "ch-1", "2026-6", 1.0, "CNY", "manual", None).is_err());
        assert!(insert_bill(&conn, "ch-1", "202606", 1.0, "CNY", "manual", None).is_err());

        let funds = channel_funds(&conn, "ch-1").unwrap();
        assert_eq!(funds.bill_totals.len(), 1);
        assert_eq!(funds.bill_totals[0].amount, 110.0);
        // 估算余额 = 100 - 110 = -10（如实为负）
        assert_eq!(funds.estimated_balance[0].amount, -10.0);
    }

    #[test]
    fn snapshots() {
        let conn = setup();
        insert_snapshot(
            &conn,
            "ch-1",
            88.5,
            "CNY",
            "2026-06-01T10:00:00+00:00",
            Some("控制台抄录"),
        )
        .unwrap();
        let list = list_snapshots(&conn, Some("ch-1"), 10).unwrap();
        assert_eq!(list.len(), 1);
        delete_snapshot(&conn, &list[0].id).unwrap();
        assert!(list_snapshots(&conn, Some("ch-1"), 10).unwrap().is_empty());
    }
}
