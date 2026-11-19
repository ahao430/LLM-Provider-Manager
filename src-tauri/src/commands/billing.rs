//! 资金与账单命令：充值 / 账单 / 余额快照的 CRUD、渠道资金汇总与账单文件导入。

use calamine::Reader;
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::billing::repo::{self, BillRow, ChannelFunds, RechargeInput, RechargeRow, SnapshotRow};
use crate::error::{AppError, AppResult};
use crate::AppState;

fn db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}

#[tauri::command]
pub fn list_recharges(
    state: State<'_, AppState>,
    channel_id: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<RechargeRow>> {
    let conn = db(&state)?;
    repo::list_recharges(&conn, channel_id.as_deref(), limit.unwrap_or(200).min(2000))
}

#[tauri::command]
pub fn add_recharge(state: State<'_, AppState>, input: RechargeInput) -> AppResult<String> {
    let conn = db(&state)?;
    repo::insert_recharge(&conn, &input)
}

#[tauri::command]
pub fn update_recharge(
    state: State<'_, AppState>,
    id: String,
    input: RechargeInput,
) -> AppResult<()> {
    let conn = db(&state)?;
    repo::update_recharge(&conn, &id, &input)
}

#[tauri::command]
pub fn delete_recharge(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete_recharge(&conn, &id)
}

#[tauri::command]
pub fn list_bills(
    state: State<'_, AppState>,
    channel_id: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<BillRow>> {
    let conn = db(&state)?;
    repo::list_bills(&conn, channel_id.as_deref(), limit.unwrap_or(200).min(2000))
}

#[tauri::command]
pub fn add_bill(
    state: State<'_, AppState>,
    channel_id: String,
    billing_period: String,
    amount: f64,
    currency: String,
    source: Option<String>,
    notes: Option<String>,
) -> AppResult<String> {
    let conn = db(&state)?;
    repo::insert_bill(
        &conn,
        &channel_id,
        &billing_period,
        amount,
        &currency,
        source.as_deref().unwrap_or("manual"),
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn update_bill(
    state: State<'_, AppState>,
    id: String,
    amount: f64,
    notes: Option<String>,
) -> AppResult<()> {
    let conn = db(&state)?;
    repo::update_bill(&conn, &id, amount, notes.as_deref())
}

#[tauri::command]
pub fn delete_bill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete_bill(&conn, &id)
}

#[tauri::command]
pub fn list_balance_snapshots(
    state: State<'_, AppState>,
    channel_id: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<SnapshotRow>> {
    let conn = db(&state)?;
    repo::list_snapshots(&conn, channel_id.as_deref(), limit.unwrap_or(200).min(2000))
}

#[tauri::command]
pub fn add_balance_snapshot(
    state: State<'_, AppState>,
    channel_id: String,
    balance: f64,
    currency: String,
    captured_at: String,
    notes: Option<String>,
) -> AppResult<String> {
    let conn = db(&state)?;
    repo::insert_snapshot(
        &conn,
        &channel_id,
        balance,
        &currency,
        &captured_at,
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn delete_balance_snapshot(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = db(&state)?;
    repo::delete_snapshot(&conn, &id)
}

/// 渠道资金汇总：充值 / 账单 / 快照 / 估算余额。
#[tauri::command]
pub fn get_channel_funds(
    state: State<'_, AppState>,
    channel_id: String,
) -> AppResult<ChannelFunds> {
    let conn = db(&state)?;
    repo::channel_funds(&conn, &channel_id)
}

// ------------------------------------------------------------------
// 账单文件导入（v0.28.0：CSV / Excel）
// ------------------------------------------------------------------

/// 导入结果（如实报告：逐行写入，重复跳过，失败行不中断整体）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillImportReport {
    pub total: usize,
    pub created: usize,
    pub skipped: usize,
    pub failed: Vec<BillImportFailure>,
    /// 实际使用的来源类型：csv_import / excel_import
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillImportFailure {
    pub row: usize,
    pub reason: String,
}

/// 解析一行（列序：账期 / 金额 / 币种 / 备注），返回可写入的账单。
fn parse_bill_row(
    cells: &[Option<String>],
) -> Result<(String, f64, String, Option<String>), String> {
    let get = |i: usize| -> String {
        cells
            .get(i)
            .and_then(|c| c.as_deref())
            .map(str::trim)
            .unwrap_or("")
            .to_string()
    };
    let period = get(0);
    if period.is_empty() {
        return Err("账期为空".into());
    }
    let period_ok = {
        let b = period.as_bytes();
        b.len() == 7
            && b[4] == b'-'
            && b[..4].iter().all(|c| c.is_ascii_digit())
            && b[5..].iter().all(|c| c.is_ascii_digit())
            && period[5..]
                .parse::<u8>()
                .map(|m| (1..=12).contains(&m))
                .unwrap_or(false)
    };
    if !period_ok {
        return Err(format!("账期格式须为 YYYY-MM（如 2026-06）：{period}"));
    }
    let amount: f64 = get(1)
        .parse()
        .map_err(|_| format!("金额不是有效数字：{}", get(1)))?;
    let currency = get(2).to_uppercase();
    if currency.is_empty() {
        return Err("币种为空".into());
    }
    let notes = {
        let n = get(3);
        if n.is_empty() {
            None
        } else {
            Some(n)
        }
    };
    Ok((period, amount, currency, notes))
}

/// 从 CSV / Excel 文件导入供应商账单（列序：账期 YYYY-MM、金额、币种、备注）。
/// 来源按扩展名分派（.csv → csv_import，.xlsx → excel_import）；
/// 与既有账单（同渠道 + 同账期 + 同来源）重复的行跳过；单行失败不影响其余行。
#[tauri::command]
pub fn import_bills_from_file(
    state: State<'_, AppState>,
    channel_id: String,
    path: String,
) -> AppResult<BillImportReport> {
    let p = std::path::Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let (source, rows): (String, Vec<Vec<Option<String>>>) = match ext.as_str() {
        "csv" => {
            let mut rdr = csv::ReaderBuilder::new()
                .has_headers(false)
                .flexible(true)
                .from_path(p)
                .map_err(|e| AppError::Invalid(format!("CSV 读取失败: {e}")))?;
            let mut rows = Vec::new();
            for record in rdr.records() {
                let record =
                    record.map_err(|e| AppError::Invalid(format!("CSV 行解析失败: {e}")))?;
                rows.push(record.iter().map(|c| Some(c.to_string())).collect());
            }
            ("csv_import".into(), rows)
        }
        "xlsx" => {
            let mut book = calamine::open_workbook::<calamine::Xlsx<_>, _>(p)
                .map_err(|e| AppError::Invalid(format!("Excel 打开失败（仅支持 .xlsx）: {e}")))?;
            let sheet_name = book
                .sheet_names()
                .first()
                .cloned()
                .ok_or_else(|| AppError::Invalid("Excel 文件没有工作表".into()))?;
            let range = book
                .worksheet_range(&sheet_name)
                .map_err(|e| AppError::Invalid(format!("Excel 工作表读取失败: {e}")))?;
            let rows: Vec<Vec<Option<String>>> = range
                .rows()
                .map(|r: &[calamine::Data]| r.iter().map(|c| Some(cell_to_string(c))).collect())
                .collect();
            ("excel_import".into(), rows)
        }
        other => {
            return Err(AppError::Invalid(format!(
                "不支持的文件类型 .{other}（仅支持 .csv / .xlsx）"
            )))
        }
    };
    let source_field = source.clone();

    let conn = db(&state)?;
    let mut report = BillImportReport {
        total: rows.len().saturating_sub(1), // 首行视为表头
        created: 0,
        skipped: 0,
        failed: Vec::new(),
        source: source_field,
    };
    for (idx, cells) in rows.iter().enumerate().skip(1) {
        // Excel 数字单元格可能带 .0 尾巴（金额列由 parse 处理）；此层不清洗
        match parse_bill_row(cells) {
            Ok((period, amount, currency, notes)) => {
                match repo::insert_bill(
                    &conn,
                    &channel_id,
                    &period,
                    amount,
                    &currency,
                    &source,
                    notes.as_deref(),
                ) {
                    Ok(_) => report.created += 1,
                    Err(e) if is_unique_violation(&e) => report.skipped += 1,
                    Err(e) => report.failed.push(BillImportFailure {
                        row: idx + 1,
                        reason: e.to_string(),
                    }),
                }
            }
            Err(reason) => report.failed.push(BillImportFailure {
                row: idx + 1,
                reason,
            }),
        }
    }
    Ok(report)
}

fn is_unique_violation(e: &crate::error::AppError) -> bool {
    let text = e.to_string();
    text.contains("已存在") || text.contains("UNIQUE")
}

/// calamine 单元格 → 字符串（数字去浮点尾巴；日期按原文本）。
fn cell_to_string(c: &calamine::Data) -> String {
    match c {
        calamine::Data::Empty => String::new(),
        calamine::Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                format!("{}", *f as i64)
            } else {
                format!("{f}")
            }
        }
        calamine::Data::Int(i) => format!("{i}"),
        other => other.to_string().trim().to_string(),
    }
}

#[cfg(test)]
mod bill_import_tests {
    use super::*;

    #[test]
    fn parse_row_valid_and_invalid() {
        let cells = |v: Vec<Option<String>>| v;
        let ok = parse_bill_row(&cells(vec![
            Some("2026-06".into()),
            Some("60.5".into()),
            Some("cny".into()),
            Some("六月账单".into()),
        ]))
        .unwrap();
        assert_eq!(
            ok,
            (
                "2026-06".into(),
                60.5,
                "CNY".into(),
                Some("六月账单".into())
            )
        );

        // 账期格式 / 金额 / 币种错误
        assert!(parse_bill_row(&cells(vec![
            Some("2026/06".into()),
            Some("1".into()),
            Some("CNY".into()),
            None
        ]))
        .is_err());
        assert!(parse_bill_row(&cells(vec![
            Some("2026-13".into()),
            Some("1".into()),
            Some("CNY".into()),
            None
        ]))
        .is_err());
        assert!(parse_bill_row(&cells(vec![
            Some("2026-06".into()),
            Some("abc".into()),
            Some("CNY".into()),
            None
        ]))
        .is_err());
        assert!(parse_bill_row(&cells(vec![
            Some("2026-06".into()),
            Some("1".into()),
            Some("".into()),
            None
        ]))
        .is_err());
    }

    #[test]
    fn excel_number_cell_has_no_float_tail() {
        assert_eq!(cell_to_string(&calamine::Data::Float(60.0)), "60");
        assert_eq!(cell_to_string(&calamine::Data::Float(60.5)), "60.5");
        assert_eq!(cell_to_string(&calamine::Data::Int(60)), "60");
    }
}
