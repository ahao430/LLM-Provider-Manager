//! 本地 API 使用费用估算。
//!
//! 规则（PLAN.md「资金与账单管理」）：
//! - 本地估算费用 = 测试请求的 Token Usage × 价格配置，仅代表本工具记录的请求。
//! - 必须与供应商账单区分，展示时标注为估算值。
//! - 价格按「生效日期 <= 请求创建日期」的最新版本；折扣按百分比计算。
//! - 计价单位支持 per_1m_tokens / per_1k_tokens；其余单位（如按张）暂不参与 Token 估算。
//! - 只有「Token 数与对应价格都存在」的项目才计入；部分定价不虚构完整账单。

use rusqlite::Connection;
use serde::Serialize;

use crate::models::repo as models_repo;
use crate::requests::repo::RequestRecordRow;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostEstimate {
    pub amount: f64,
    pub currency: String,
    /// 计入说明（哪些项目参与了估算）
    pub items: Vec<String>,
}

/// 估算单条请求的本地费用；无渠道模型绑定或无可用价格时返回 None。
pub fn estimate_record_cost(conn: &Connection, record: &RequestRecordRow) -> Option<CostEstimate> {
    let channel_model_id = record.channel_model_id.as_deref()?;
    let date = record.created_at.get(..10)?;
    let price = models_repo::find_effective_price(conn, channel_model_id, date)
        .ok()
        .flatten()?;

    let unit_div = match price.pricing_unit.as_str() {
        "per_1m_tokens" => 1_000_000.0,
        "per_1k_tokens" => 1_000.0,
        _ => return None, // 按张等非 Token 计价暂不参与
    };
    let discount = price
        .discount_percent
        .filter(|d| *d > 0.0 && *d <= 100.0)
        .map(|d| d / 100.0)
        .unwrap_or(1.0);

    let mut amount = 0.0f64;
    let mut items = Vec::new();

    if let (Some(tokens), Some(unit_price)) = (record.input_tokens, price.input_price) {
        amount += tokens as f64 * unit_price / unit_div * discount;
        items.push(format!("输入 {} tokens", tokens));
    }
    if let (Some(tokens), Some(unit_price)) = (record.output_tokens, price.output_price) {
        amount += tokens as f64 * unit_price / unit_div * discount;
        items.push(format!("输出 {} tokens", tokens));
    }
    if let (Some(tokens), Some(unit_price)) = (record.cache_tokens, price.cache_read_price) {
        amount += tokens as f64 * unit_price / unit_div * discount;
        items.push(format!("缓存 {} tokens", tokens));
    }

    if items.is_empty() {
        return None;
    }
    // 保留 6 位小数，避免浮点噪声
    Some(CostEstimate {
        amount: (amount * 1_000_000.0).round() / 1_000_000.0,
        currency: price.currency.clone(),
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channels::domain::ChannelInput;
    use crate::channels::domain::ChannelModelInput;
    use crate::channels::repo as channel_repo;
    use crate::models::domain::AddPriceInput;
    use crate::models::repo as models_repo;
    use crate::requests::repo::insert_pending;
    use crate::storage::migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        channel_repo::insert(
            &conn,
            "ch-1",
            &ChannelInput {
                name: "测试".into(),
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
        let gid = models_repo::insert_global_model(&conn, "m1", None).unwrap();
        let cm_id = models_repo::insert_channel_model(
            &conn,
            &ChannelModelInput {
                id: None,
                channel_id: "ch-1".into(),
                model_id: gid.clone(),
                actual_model_id: "m1".into(),
                protocol: "openai_chat".into(),
                model_type: None,
                notes: None,
                enabled: Some(true),
                price_input_per_1m: None,
                price_output_per_1m: None,
                price_currency: None,
                price_multiplier: None,
                price_tiers: None,
                price_off_peak: None,
            },
        )
        .unwrap();
        models_repo::insert_price(
            &conn,
            &AddPriceInput {
                channel_model_id: cm_id.clone(),
                input_price: Some(10.0), // 每百万 10 元
                output_price: Some(30.0),
                cache_read_price: Some(2.0),
                cache_write_price: None,
                image_price: None,
                other_usage_price: None,
                currency: "CNY".into(),
                pricing_unit: "per_1m_tokens".into(),
                discount_percent: Some(80.0),
                effective_date: "2026-01-01".into(),
                notes: None,
            },
        )
        .unwrap();
        conn
    }

    #[test]
    fn estimate_uses_effective_price_and_discount() {
        let conn = setup();
        let cm_id = models_repo::find_channel_model_by_actual(&conn, "ch-1", "m1")
            .unwrap()
            .unwrap()
            .id;
        insert_pending(
            &conn,
            "t1",
            "ch-1",
            Some(&cm_id),
            None,
            "openai_chat",
            "api_test",
        )
        .unwrap();
        // 补充 usage 与创建日期（模拟已完成记录）
        crate::requests::repo::finish(
            &conn,
            "t1",
            "success",
            None,
            None,
            None,
            Some(200),
            None,
            None,
            Some(1000),
            Some(1_000_000),
            Some(100_000),
            Some(50_000),
            None,
            None,
            None,
            Some("m1"),
        )
        .unwrap();
        conn.execute(
            "UPDATE request_records SET created_at = '2026-06-01T00:00:00+00:00' WHERE trace_id = 't1'",
            [],
        )
        .unwrap();

        let record = crate::requests::repo::get(&conn, "t1").unwrap();
        let est = estimate_record_cost(&conn, &record).unwrap();
        // 折扣 80%：输入 1M×10×0.8=8；输出 0.1M×30×0.8=2.4；缓存 50k×2×0.8=0.08
        assert!((est.amount - 10.48).abs() < 1e-6, "实际 {}", est.amount);
        assert_eq!(est.currency, "CNY");
        assert_eq!(est.items.len(), 3);
    }

    #[test]
    fn no_binding_means_no_estimate() {
        let conn = setup();
        insert_pending(&conn, "t2", "ch-1", None, None, "openai_chat", "api_test").unwrap();
        let record = crate::requests::repo::get(&conn, "t2").unwrap();
        assert!(estimate_record_cost(&conn, &record).is_none());
    }
}
