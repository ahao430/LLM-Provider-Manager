//! 阿里云费用中心（BssOpenApi）查询：百炼渠道余额与收支明细。
//!
//! 签名走阿里云 RPC V1（HMAC-SHA1），实现参照 new-api（controller/channel-billing.go）：
//! - 余额：QueryAccountBalance，成功 Code = "200"，金额在 Data.AvailableAmount（可能带千分位逗号）；
//! - 明细：QueryAccountTransactionDetails，成功 Code = "Success"，支持 NextToken 翻页，
//!   列表字段为 PascalCase，兼容数组直返与对象包裹两种形态；
//! - 业务错误（密钥无效 / 无权限）在 4xx/5xx 的 JSON body 里，必须读出 Code/Message。
//!
//! AccessKey 需具备费用中心读权限（bss:DescribeAccount / bssapi:QueryAccountTransactionDetails）。

use std::collections::BTreeMap;

use base64::Engine;
use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::Value;
use sha1::Sha1;

use crate::error::{AppError, AppResult};

const ENDPOINT: &str = "https://business.aliyuncs.com/";
const API_VERSION: &str = "2017-12-14";

// ------------------------------------------------------------------
// RPC V1 签名
// ------------------------------------------------------------------

/// RFC3986 百分号编码：仅字母数字与 `- _ . ~` 不编码（阿里云签名要求）。
fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 待签名字符串：GET&%2F&<按 key 排序并编码的查询串>。
fn string_to_sign(params: &BTreeMap<String, String>) -> String {
    let pairs: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect();
    format!(
        "GET&{}&{}",
        percent_encode("/"),
        percent_encode(&pairs.join("&"))
    )
}

/// RPC V1 签名：HMAC-SHA1(secret + "&") 后 Base64。
fn sign_rpc_v1(params: &BTreeMap<String, String>, access_key_secret: &str) -> String {
    let mut mac = Hmac::<Sha1>::new_from_slice(format!("{access_key_secret}&").as_bytes())
        .expect("HMAC-SHA1 接受任意长度密钥");
    mac.update(string_to_sign(params).as_bytes());
    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

/// 组装公共参数 + Action + 业务参数（BTreeMap 保证按 key 排序）。
fn build_params(
    action: &str,
    access_key_id: &str,
    extra: &[(&str, String)],
) -> BTreeMap<String, String> {
    let mut params = BTreeMap::new();
    params.insert("Action".into(), action.into());
    params.insert("Version".into(), API_VERSION.into());
    params.insert("Format".into(), "JSON".into());
    params.insert("AccessKeyId".into(), access_key_id.to_string());
    params.insert("SignatureMethod".into(), "HMAC-SHA1".into());
    params.insert("SignatureVersion".into(), "1.0".into());
    params.insert("SignatureNonce".into(), uuid::Uuid::new_v4().to_string());
    params.insert(
        "Timestamp".into(),
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    );
    for (k, v) in extra {
        params.insert((*k).to_string(), v.clone());
    }
    params
}

/// 发起一次签名 GET；HTTP 非 2xx 时仍解析 body（业务错误在 JSON 里）。
async fn bss_get(
    params: &BTreeMap<String, String>,
    access_key_secret: &str,
    tls_verify: bool,
) -> AppResult<Value> {
    let signature = sign_rpc_v1(params, access_key_secret);
    let query: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let url = format!(
        "{ENDPOINT}?Signature={}&{query}",
        percent_encode(&signature)
    );

    let client = crate::util::http_client(30, tls_verify).map_err(AppError::Invalid)?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("阿里云费用中心请求失败: {e}")))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::Invalid(format!("读取响应失败: {e}")))?;

    match serde_json::from_str::<Value>(&body) {
        Ok(root) => Ok(root),
        Err(e) => {
            let snippet: String = body.chars().take(200).collect();
            if (200..300).contains(&status) {
                Err(AppError::Invalid(format!(
                    "响应不是 JSON: {e}；片段：{snippet}"
                )))
            } else {
                Err(AppError::Invalid(format!("HTTP {status}：{snippet}")))
            }
        }
    }
}

// ------------------------------------------------------------------
// 余额
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BailianBalance {
    pub amount: f64,
    pub currency: String,
}

pub async fn query_balance(
    access_key_id: &str,
    access_key_secret: &str,
    tls_verify: bool,
) -> AppResult<BailianBalance> {
    let params = build_params("QueryAccountBalance", access_key_id, &[]);
    let root = bss_get(&params, access_key_secret, tls_verify).await?;
    parse_balance(&root)
}

/// 解析 QueryAccountBalance 响应（纯函数便于离线测试）。
fn parse_balance(root: &Value) -> AppResult<BailianBalance> {
    check_business_error(root, "200")?;
    let data = root
        .get("Data")
        .ok_or_else(|| AppError::Invalid("响应缺少 Data 字段".into()))?;
    let amount_text = data
        .get("AvailableAmount")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Invalid("响应缺少 Data.AvailableAmount".into()))?;
    // 金额可能带千分位逗号（如 "38,999.97"）
    let amount: f64 = amount_text
        .replace(',', "")
        .parse()
        .map_err(|_| AppError::Invalid(format!("余额数值非法: {amount_text}")))?;
    let currency = data
        .get("Currency")
        .and_then(Value::as_str)
        .unwrap_or("CNY")
        .to_string();
    Ok(BailianBalance { amount, currency })
}

/// 业务错误统一检查：Code 非成功值或 Success=false 时报 Code/Message。
fn check_business_error(root: &Value, success_code: &str) -> AppResult<()> {
    if let Some(success) = root.get("Success").and_then(Value::as_bool) {
        if !success {
            return Err(business_error(root));
        }
    }
    if let Some(code) = root.get("Code").and_then(Value::as_str) {
        if !code.is_empty() && code != success_code && !code.eq_ignore_ascii_case("Success") {
            return Err(business_error(root));
        }
    }
    Ok(())
}

fn business_error(root: &Value) -> AppError {
    let code = root
        .get("Code")
        .and_then(Value::as_str)
        .unwrap_or("UnknownError");
    let message = root
        .get("Message")
        .and_then(Value::as_str)
        .unwrap_or("无错误信息");
    AppError::Invalid(format!(
        "阿里云费用中心返回错误 {code}：{message}（AccessKey 需具备费用中心读权限）"
    ))
}

// ------------------------------------------------------------------
// 收支明细（账单）
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BailianTransaction {
    /// "2026-01-15 10:30:00" 形式（原样返回）
    pub transaction_time: String,
    pub transaction_type: String,
    /// 原始金额字符串（保留符号与精度；消费为负、充值为正）
    pub amount: String,
    pub fund_type: String,
    pub remarks: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BailianTransactions {
    pub account_name: String,
    pub transactions: Vec<BailianTransaction>,
    pub next_token: String,
    pub total_count: i64,
}

/// 查询收支明细（start/end 为 YYYY-MM-DD）。
pub async fn query_transactions(
    access_key_id: &str,
    access_key_secret: &str,
    start: &str,
    end: &str,
    next_token: Option<&str>,
    tls_verify: bool,
) -> AppResult<BailianTransactions> {
    for date in [start, end] {
        if !is_date(date) {
            return Err(AppError::Invalid(format!(
                "日期格式需为 YYYY-MM-DD：{date}"
            )));
        }
    }
    let mut extra = vec![
        ("CreateTimeStart", start.to_string()),
        ("CreateTimeEnd", end.to_string()),
    ];
    if let Some(token) = next_token.filter(|t| !t.trim().is_empty()) {
        extra.push(("NextToken", token.to_string()));
    }
    let params = build_params("QueryAccountTransactionDetails", access_key_id, &extra);
    let root = bss_get(&params, access_key_secret, tls_verify).await?;
    parse_transactions(&root)
}

fn is_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
}

/// 解析 QueryAccountTransactionDetails 响应；列表兼容数组直返与对象包裹两种形态。
fn parse_transactions(root: &Value) -> AppResult<BailianTransactions> {
    check_business_error(root, "Success")?;
    let data = root
        .get("Data")
        .ok_or_else(|| AppError::Invalid("响应缺少 Data 字段".into()))?;

    // 形态一：AccountTransactionsList 直接是数组；形态二：同名对象包裹 {AccountTransactionsList: [...]}
    let list_raw = data
        .get("AccountTransactionsList")
        .map(|v| v.to_string())
        .unwrap_or_default();
    let (items, next_token, total_count) =
        if let Ok(arr) = serde_json::from_str::<Vec<Value>>(&list_raw) {
            let total = data
                .get("TotalCount")
                .and_then(Value::as_i64)
                .unwrap_or(arr.len() as i64);
            let token = data
                .get("NextToken")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            (arr, token, total)
        } else if let Some(wrapped) = data
            .get("AccountTransactionsList")
            .and_then(|v| v.get("AccountTransactionsList"))
            .and_then(Value::as_array)
            .cloned()
        {
            let inner = data
                .get("AccountTransactionsList")
                .and_then(|v| v.get("NextToken"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let total = data
                .get("AccountTransactionsList")
                .and_then(|v| v.get("TotalCount"))
                .and_then(Value::as_i64)
                .unwrap_or(wrapped.len() as i64);
            (wrapped, inner, total)
        } else {
            // 空列表或字段缺失：视为无明细
            (Vec::new(), String::new(), 0)
        };

    let transactions = items
        .iter()
        .map(|item| BailianTransaction {
            transaction_time: str_field(item, "TransactionTime"),
            transaction_type: str_field(item, "TransactionType"),
            amount: str_field(item, "Amount"),
            fund_type: str_field(item, "FundType"),
            remarks: str_field(item, "Remarks"),
        })
        .collect();
    Ok(BailianTransactions {
        account_name: str_field(data, "AccountName"),
        transactions,
        next_token,
        total_count,
    })
}

fn str_field(item: &Value, key: &str) -> String {
    item.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// 按月汇总为账单（账期 YYYY-MM；金额求和为净额，消费为负、充值为正）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyBill {
    pub billing_period: String,
    pub amount: f64,
    pub count: usize,
}

pub fn aggregate_monthly(
    transactions: &[BailianTransaction],
    currency: &str,
) -> AppResult<Vec<MonthlyBill>> {
    let _ = currency; // 币种由调用方（BSS 固定 CNY）落账单，此处不参与计算
    let mut by_month: BTreeMap<String, (f64, usize)> = BTreeMap::new();
    for t in transactions {
        let period = t.transaction_time.get(..7).unwrap_or_default().to_string();
        if period.len() != 7 || !period.starts_with(|c: char| c.is_ascii_digit()) {
            continue; // 缺时间字段的明细无法归月，跳过（导入侧如实按可见条数汇总）
        }
        let amount: f64 = t
            .amount
            .trim()
            .replace(',', "")
            .parse()
            .map_err(|_| AppError::Invalid(format!("明细金额非法: {}", t.amount)))?;
        let entry = by_month.entry(period).or_insert((0.0, 0));
        entry.0 += amount;
        entry.1 += 1;
    }
    Ok(by_month
        .into_iter()
        .map(|(billing_period, (amount, count))| MonthlyBill {
            billing_period,
            amount,
            count,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 官方文档签名算法示例（与 new-api 单测同向量）：固定 nonce/timestamp/密钥验证待签名串。
    #[test]
    fn rpc_v1_string_to_sign_matches_reference() {
        let mut params = BTreeMap::new();
        params.insert("AccessKeyId".into(), "testid".into());
        params.insert("Action".into(), "QueryAccountBalance".into());
        params.insert("Format".into(), "JSON".into());
        params.insert("SignatureMethod".into(), "HMAC-SHA1".into());
        params.insert(
            "SignatureNonce".into(),
            "9e7f802e-1e1a-41c1-ae0f-e69d5850b3e6".into(),
        );
        params.insert("SignatureVersion".into(), "1.0".into());
        params.insert("Timestamp".into(), "2026-01-01T00:00:00Z".into());
        params.insert("Version".into(), "2017-12-14".into());

        let expected = "GET&%2F&AccessKeyId%3Dtestid%26Action%3DQueryAccountBalance%26Format%3DJSON%26SignatureMethod%3DHMAC-SHA1%26SignatureNonce%3D9e7f802e-1e1a-41c1-ae0f-e69d5850b3e6%26SignatureVersion%3D1.0%26Timestamp%3D2026-01-01T00%253A00%253A00Z%26Version%3D2017-12-14";
        assert_eq!(string_to_sign(&params), expected);

        // 签名为确定值（HMAC-SHA1 + Base64，长度 28）
        let sig = sign_rpc_v1(&params, "testsecret");
        assert_eq!(sig.len(), 28);
        // 参数不变签名不变；参数变化签名变化
        assert_eq!(sig, sign_rpc_v1(&params, "testsecret"));
        params.insert("Action".into(), "Other".into());
        assert_ne!(sig, sign_rpc_v1(&params, "testsecret"));
    }

    #[test]
    fn percent_encoding_rules() {
        assert_eq!(percent_encode("a b"), "a%20b");
        assert_eq!(percent_encode("*"), "%2A");
        assert_eq!(percent_encode("~"), "~");
        assert_eq!(percent_encode("中"), "%E4%B8%AD");
        assert_eq!(percent_encode("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn balance_parsing_with_commas_and_errors() {
        let ok: Value = serde_json::json!({
            "Code": "200", "Success": true,
            "Data": { "AvailableAmount": "38,999.97", "Currency": "CNY" }
        });
        let b = parse_balance(&ok).unwrap();
        assert_eq!(b.amount, 38999.97);
        assert_eq!(b.currency, "CNY");

        let err: Value = serde_json::json!({
            "Code": "InvalidAccessKeyId.NotFound",
            "Message": "The Access Key ID does not exist."
        });
        let e = parse_balance(&err).unwrap_err().to_string();
        assert!(e.contains("InvalidAccessKeyId.NotFound"), "{e}");
    }

    #[test]
    fn transactions_parsing_both_shapes() {
        let array_form: Value = serde_json::json!({
            "Code": "Success",
            "Data": {
                "AccountName": "test@aliyun",
                "AccountTransactionsList": [
                    { "TransactionTime": "2026-01-15 10:30:00", "TransactionType": "消费",
                      "Amount": "-12.50", "FundType": "通用储值", "Remarks": "百炼" }
                ],
                "NextToken": "NT1", "TotalCount": 1
            }
        });
        let t = parse_transactions(&array_form).unwrap();
        assert_eq!(t.account_name, "test@aliyun");
        assert_eq!(t.transactions.len(), 1);
        assert_eq!(t.transactions[0].amount, "-12.50");
        assert_eq!(t.next_token, "NT1");
        assert_eq!(t.total_count, 1);

        let wrapped_form: Value = serde_json::json!({
            "Code": "Success",
            "Data": { "AccountTransactionsList": {
                "AccountTransactionsList": [
                    { "TransactionTime": "2026-02-01 09:00:00", "Amount": "100.00" }
                ],
                "NextToken": "NT2", "TotalCount": 1
            } }
        });
        let t2 = parse_transactions(&wrapped_form).unwrap();
        assert_eq!(t2.transactions.len(), 1);
        assert_eq!(t2.next_token, "NT2");

        let empty: Value = serde_json::json!({ "Code": "Success", "Data": {} });
        assert!(parse_transactions(&empty).unwrap().transactions.is_empty());
    }

    #[test]
    fn monthly_aggregation() {
        let mk = |time: &str, amount: &str| BailianTransaction {
            transaction_time: time.into(),
            transaction_type: "消费".into(),
            amount: amount.into(),
            fund_type: String::new(),
            remarks: String::new(),
        };
        let tx = vec![
            mk("2026-01-15 10:30:00", "-12.50"),
            mk("2026-01-20 08:00:00", "-7.50"),
            mk("2026-02-01 09:00:00", "100.00"),
        ];
        let months = aggregate_monthly(&tx, "CNY").unwrap();
        assert_eq!(months.len(), 2);
        assert_eq!(months[0].billing_period, "2026-01");
        assert_eq!(months[0].amount, -20.0);
        assert_eq!(months[0].count, 2);
        assert_eq!(months[1].amount, 100.0);
    }
}
