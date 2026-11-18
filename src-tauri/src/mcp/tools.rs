//! MCP 只读工具层：白名单序列化，凭证零输出（PLAN.md 红线）。
//!
//! 允许读取：SQLite（只读连接）与 archives/ 归档文件；
//! 禁止读取：credentials.json 与任何凭证值——任何工具的输出都不含凭证。

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::billing::repo as billing_repo;
use crate::channels::repo as channel_repo;
use crate::market;
use crate::models::repo as model_repo;
use crate::requests::repo as request_repo;
use crate::workbenches::api_testing::engine::read_raw;

/// 工具上下文（数据目录，用于读归档）。
pub struct ToolContext {
    pub data_dir: PathBuf,
}

/// 工具注册表：名称 / 描述 / 参数 schema（tools/list 用）。
pub fn tool_descriptors() -> Vec<Value> {
    vec![
        json!({
            "name": "list_channels",
            "description": "列出 LCM 中的全部渠道（含启用状态、Base URL、各渠道最近余额）。只读。",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "list_models",
            "description": "列出全部渠道模型（模型 ID / 协议 / 类型 / 标注价 / 启用状态），可按渠道过滤。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "channelId": { "type": "string", "description": "按渠道 ID 过滤（可选）" }
                }
            }
        }),
        json!({
            "name": "search_request_records",
            "description": "检索测试记录元数据（不含 Raw 正文）：按渠道 / 模型 / 状态过滤，按时间倒序。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "channelId": { "type": "string" },
                    "model": { "type": "string" },
                    "status": { "type": "string", "description": "success / failed / ..." },
                    "limit": { "type": "integer", "description": "默认 20，上限 100" }
                }
            }
        }),
        json!({
            "name": "get_request_record",
            "description": "按 traceId 取单条测试记录详情 + 全部处理事件。",
            "inputSchema": {
                "type": "object",
                "properties": { "traceId": { "type": "string" } },
                "required": ["traceId"]
            }
        }),
        json!({
            "name": "get_request_error",
            "description": "按 traceId 取错误事实（错误码 / 消息 / HTTP 状态），只陈述事实不提供猜测。",
            "inputSchema": {
                "type": "object",
                "properties": { "traceId": { "type": "string" } },
                "required": ["traceId"]
            }
        }),
        json!({
            "name": "get_request_raw",
            "description": "读取测试记录的 Raw 归档原文（request=请求侧参数/请求体；response=捕获输出/原始响应）。Header 已脱敏。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "traceId": { "type": "string" },
                    "kind": { "type": "string", "enum": ["request", "response"] }
                },
                "required": ["traceId", "kind"]
            }
        }),
        json!({
            "name": "list_balances",
            "description": "每个渠道最近一次余额快照。",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "list_funds",
            "description": "供应商账单与充值记录（最近 N 条）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "channelId": { "type": "string" },
                    "limit": { "type": "integer", "description": "默认 20，上限 100" }
                }
            }
        }),
        json!({
            "name": "search_market_prices",
            "description": "搜索各厂商模型价格快照（models.dev 数据）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "模型名或厂商名关键词" },
                    "provider": { "type": "string", "description": "厂商 id 精确过滤" },
                    "limit": { "type": "integer", "description": "默认 50，上限 200" }
                }
            }
        }),
    ]
}

/// 工具执行入口：返回文本载荷（JSON 字符串）；Err 视为工具执行错误（isError=true）。
pub fn call_tool(
    conn: &Connection,
    ctx: &ToolContext,
    name: &str,
    args: &Value,
) -> Result<String, String> {
    let value = match name {
        "list_channels" => list_channels(conn),
        "list_models" => list_models(conn, args),
        "search_request_records" => search_request_records(conn, args),
        "get_request_record" => get_request_record(conn, args),
        "get_request_error" => get_request_error(conn, args),
        "get_request_raw" => get_request_raw(conn, ctx, args),
        "list_balances" => list_balances(conn),
        "list_funds" => list_funds(conn, args),
        "search_market_prices" => search_market_prices(conn, args),
        other => return Err(format!("未知工具: {other}（可用工具见 tools/list）")),
    }?;
    serde_json::to_string_pretty(&value).map_err(|e| format!("结果序列化失败: {e}"))
}

fn arg_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
}
fn arg_limit(args: &Value, default: u32, max: u32) -> u32 {
    let raw = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(default as u64);
    (raw as u32).clamp(1, max)
}

/// 渠道列表（白名单字段，零凭证输出）+ 最近余额。
fn list_channels(conn: &Connection) -> Result<Value, String> {
    let rows = channel_repo::list_rows(conn).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let balance = latest_balance_for(conn, &row.id)?;
        items.push(json!({
            "id": row.id,
            "name": row.name,
            "providerName": row.provider_name,
            "baseUrl": row.base_url,
            "enabled": row.enabled,
            "notes": row.notes,
            "updatedAt": row.updated_at,
            "latestBalance": balance,
        }));
    }
    Ok(json!({ "channels": items, "total": items.len() }))
}

/// 每渠道最近一次余额（窗口函数，与 commands/balance.rs 同口径）。
fn latest_balance_for(conn: &Connection, channel_id: &str) -> Result<Value, String> {
    conn.query_row(
        "SELECT balance, currency, captured_at FROM ( \
           SELECT balance, currency, captured_at, \
                  ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY captured_at DESC) AS rn \
           FROM channel_balance_snapshots WHERE channel_id = ?1 \
         ) WHERE rn = 1",
        params![channel_id],
        |r| {
            Ok(json!({
                "balance": r.get::<_, f64>(0)?,
                "currency": r.get::<_, String>(1)?,
                "capturedAt": r.get::<_, String>(2)?,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
    .map(|opt| opt.unwrap_or(Value::Null))
}

/// 全渠道模型（可按渠道过滤；标注价仅参考，不算费用）。
fn list_models(conn: &Connection, args: &Value) -> Result<Value, String> {
    let rows = model_repo::list_all_channel_models(conn).map_err(|e| e.to_string())?;
    let filter_channel = arg_str(args, "channelId");
    let items: Vec<Value> = rows
        .into_iter()
        .filter(|r| {
            filter_channel
                .as_ref()
                .map(|c| *c == r.channel_id)
                .unwrap_or(true)
        })
        .map(|r| {
            json!({
                "channelId": r.channel_id,
                "channelName": r.channel_name,
                "actualModelId": r.actual_model_id,
                "protocol": r.protocol,
                "modelType": r.model_type,
                "enabled": r.enabled,
                "priceInputPer1m": r.price_input_per_1m,
                "priceOutputPer1m": r.price_output_per_1m,
                "priceCurrency": r.price_currency,
            })
        })
        .collect();
    Ok(json!({ "models": items, "total": items.len() }))
}

/// 测试记录检索（元数据，不含 Raw 正文）。
fn search_request_records(conn: &Connection, args: &Value) -> Result<Value, String> {
    let limit = arg_limit(args, 20, 100);
    let rows = request_repo::list(conn, 1000).map_err(|e| e.to_string())?;
    let channel = arg_str(args, "channelId");
    let model = arg_str(args, "model").map(|m| m.trim().to_lowercase());
    let status = arg_str(args, "status");
    let items: Vec<Value> = rows
        .into_iter()
        .filter(|r| {
            channel
                .as_ref()
                .map(|c| *c == r.channel_id.clone().unwrap_or_default())
                .unwrap_or(true)
        })
        .filter(|r| {
            model
                .as_ref()
                .map(|m| {
                    r.model
                        .clone()
                        .unwrap_or_default()
                        .to_lowercase()
                        .contains(m.as_str())
                })
                .unwrap_or(true)
        })
        .filter(|r| status.as_ref().map(|s| *s == r.status).unwrap_or(true))
        .take(limit as usize)
        .map(|r| serde_json::to_value(&r).unwrap_or(Value::Null))
        .collect();
    Ok(json!({ "records": items, "total": items.len() }))
}

/// 单条记录详情 + 处理事件。
fn get_request_record(conn: &Connection, args: &Value) -> Result<Value, String> {
    let trace_id = arg_str(args, "traceId").ok_or_else(|| "缺少 traceId".to_string())?;
    let record = request_repo::get(conn, &trace_id).map_err(|e| e.to_string())?;
    let events = request_repo::list_events(conn, &trace_id).map_err(|e| e.to_string())?;
    Ok(json!({
        "record": serde_json::to_value(&record).unwrap_or(Value::Null),
        "processingEvents": serde_json::to_value(&events).unwrap_or(Value::Null),
    }))
}

/// 错误事实（错误码 / 消息 / HTTP 状态），不提供猜测。
fn get_request_error(conn: &Connection, args: &Value) -> Result<Value, String> {
    let trace_id = arg_str(args, "traceId").ok_or_else(|| "缺少 traceId".to_string())?;
    let record = request_repo::get(conn, &trace_id).map_err(|e| e.to_string())?;
    let failed_events: Vec<Value> = request_repo::list_events(conn, &trace_id)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.status == "failed")
        .map(|e| serde_json::to_value(&e).unwrap_or(Value::Null))
        .collect();
    Ok(json!({
        "traceId": record.trace_id,
        "status": record.status,
        "errorCode": record.error_code,
        "errorMessage": record.error_message,
        "httpStatus": record.http_status,
        "failedEvents": failed_events,
    }))
}

/// Raw 归档原文（Header 已脱敏；显式调用视为用户授权）。
fn get_request_raw(conn: &Connection, ctx: &ToolContext, args: &Value) -> Result<Value, String> {
    let trace_id = arg_str(args, "traceId").ok_or_else(|| "缺少 traceId".to_string())?;
    let kind =
        arg_str(args, "kind").ok_or_else(|| "缺少 kind（request / response）".to_string())?;
    let record = request_repo::get(conn, &trace_id).map_err(|e| e.to_string())?;
    let rel = match kind.as_str() {
        "request" => record
            .request_ref
            .clone()
            .ok_or_else(|| "该记录没有 Raw 请求归档".to_string())?,
        "response" => record
            .response_ref
            .clone()
            .ok_or_else(|| "该记录没有 Raw 响应归档".to_string())?,
        other => return Err(format!("未知 kind: {other}")),
    };
    let text = read_raw(&ctx.data_dir, &rel).map_err(|e| e.to_string())?;
    Ok(json!({ "traceId": trace_id, "kind": kind, "content": text }))
}

/// 每渠道最近余额快照。
fn list_balances(conn: &Connection) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.channel_id, c.name, s.balance, s.currency, s.captured_at FROM ( \
               SELECT channel_id, balance, currency, captured_at, \
                      ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY captured_at DESC) AS rn \
               FROM channel_balance_snapshots \
             ) s LEFT JOIN channels c ON s.channel_id = c.id WHERE s.rn = 1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "channelId": r.get::<_, String>(0)?,
                "channelName": r.get::<_, Option<String>>(1).unwrap_or(None),
                "balance": r.get::<_, f64>(2)?,
                "currency": r.get::<_, String>(3)?,
                "capturedAt": r.get::<_, String>(4)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let items: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!({ "balances": items, "total": items.len() }))
}

/// 账单 + 充值（最近 N 条）。
fn list_funds(conn: &Connection, args: &Value) -> Result<Value, String> {
    let limit = arg_limit(args, 20, 100);
    let channel = arg_str(args, "channelId");
    let bills =
        billing_repo::list_bills(conn, channel.as_deref(), limit).map_err(|e| e.to_string())?;
    let recharges =
        billing_repo::list_recharges(conn, channel.as_deref(), limit).map_err(|e| e.to_string())?;
    Ok(json!({
        "bills": serde_json::to_value(&bills).unwrap_or(Value::Null),
        "recharges": serde_json::to_value(&recharges).unwrap_or(Value::Null),
    }))
}

/// 市场行情检索（models.dev 快照或缓存）。
fn search_market_prices(conn: &Connection, args: &Value) -> Result<Value, String> {
    let snapshot = market::current_snapshot(conn).map_err(|e| e.to_string())?;
    let query = arg_str(args, "query").map(|q| q.trim().to_lowercase());
    let provider = arg_str(args, "provider");
    let limit = arg_limit(args, 50, 200);
    let mut items = Vec::new();
    for p in &snapshot.providers {
        if provider.as_ref().map(|want| *want != p.id).unwrap_or(false) {
            continue;
        }
        for m in &p.models {
            let matched = query
                .as_ref()
                .map(|q| {
                    m.model.to_lowercase().contains(q.as_str())
                        || p.name.to_lowercase().contains(q.as_str())
                })
                .unwrap_or(true);
            if matched {
                items.push(json!({
                    "provider": p.name,
                    "model": m.model,
                    "modelType": m.model_type,
                    "inputPer1m": m.input_per_1m,
                    "cachedInputPer1m": m.cached_input_per_1m,
                    "outputPer1m": m.output_per_1m,
                    "currency": m.currency,
                }));
            }
            if items.len() >= limit as usize {
                return Ok(json!({ "items": items, "total": items.len(), "truncated": true }));
            }
        }
    }
    Ok(json!({ "items": items, "total": items.len() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channels::domain::ChannelInput;
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
                chat_base_url: "https://api.example.com/v1".into(),
                anthropic_base_url: None,
                responses_base_url: None,
                official_url: None,
                notes: None,
                primary_credential: None,
            },
            "{}",
        )
        .unwrap();
        conn
    }

    #[test]
    fn list_channels_whitelisted_no_credentials() {
        let conn = setup();
        let ctx = ToolContext {
            data_dir: std::env::temp_dir(),
        };
        let text = call_tool(&conn, &ctx, "list_channels", &json!({})).unwrap();
        assert!(text.contains("测试渠道"));
        // 凭证红线：任何凭证字段都不出现在输出里
        assert!(!text.contains("credential"));
        assert!(!text.contains("apiKey"));
        assert!(!text.contains("token"));
    }

    #[test]
    fn search_records_filters_by_status() {
        let conn = setup();
        let ctx = ToolContext {
            data_dir: std::env::temp_dir(),
        };
        crate::requests::repo::insert_pending(
            &conn,
            "t-1",
            "ch-1",
            None,
            None,
            "openai_chat",
            "api_test",
        )
        .unwrap();
        let text = call_tool(
            &conn,
            &ctx,
            "search_request_records",
            &json!({ "status": "pending" }),
        )
        .unwrap();
        assert!(text.contains("t-1"));
        let miss = call_tool(
            &conn,
            &ctx,
            "search_request_records",
            &json!({ "status": "success" }),
        )
        .unwrap();
        assert!(!miss.contains("t-1"));
    }

    #[test]
    fn unknown_tool_is_rejected() {
        let conn = setup();
        let ctx = ToolContext {
            data_dir: std::env::temp_dir(),
        };
        let err = call_tool(&conn, &ctx, "nope", &json!({})).unwrap_err();
        assert!(err.contains("未知工具"));
    }
}
