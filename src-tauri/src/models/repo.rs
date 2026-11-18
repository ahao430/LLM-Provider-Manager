//! 模型与价格 SQL 读写。

use rusqlite::{params, Connection, OptionalExtension};

use crate::channels::domain::{AllChannelModelRow, ChannelModelInput, ChannelModelRow, ModelType};
use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

use super::domain::{AddPriceInput, GlobalModelRow, ModelPriceRow};

// ------------------------------------------------------------------
// 全局模型
// ------------------------------------------------------------------

pub fn list_global_models(conn: &Connection) -> AppResult<Vec<GlobalModelRow>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.name, m.family, m.notes, m.created_at, m.updated_at, \
         (SELECT COUNT(*) FROM channel_models cm WHERE cm.model_id = m.id) \
         FROM models m ORDER BY m.name",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(GlobalModelRow {
                id: row.get(0)?,
                name: row.get(1)?,
                family: row.get(2)?,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                channel_model_count: row.get(6)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// 按名称查找全局模型（大小写不敏感）；不存在返回 None。
pub fn find_global_model_by_name(
    conn: &Connection,
    name: &str,
) -> AppResult<Option<GlobalModelRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, family, notes, created_at, updated_at FROM models WHERE lower(name) = lower(?1)",
    )?;
    let row = stmt
        .query_row(params![name], |row| {
            Ok(GlobalModelRow {
                id: row.get(0)?,
                name: row.get(1)?,
                family: row.get(2)?,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                channel_model_count: 0,
            })
        })
        .optional()?;
    Ok(row)
}

/// 按 ID 查找全局模型；不存在返回 None。
pub fn find_global_model_by_id(conn: &Connection, id: &str) -> AppResult<Option<GlobalModelRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, family, notes, created_at, updated_at FROM models WHERE id = ?1",
    )?;
    let row = stmt
        .query_row(params![id], |row| {
            Ok(GlobalModelRow {
                id: row.get(0)?,
                name: row.get(1)?,
                family: row.get(2)?,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                channel_model_count: 0,
            })
        })
        .optional()?;
    Ok(row)
}

/// 创建全局模型（导入 / 手动）。
pub fn insert_global_model(
    conn: &Connection,
    name: &str,
    family: Option<&str>,
) -> AppResult<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO models (id, name, family, notes, created_at, updated_at) VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
        params![id, name.trim(), family.map(str::trim).filter(|s| !s.is_empty()), now],
    )?;
    Ok(id)
}

pub fn rename_global_model(
    conn: &Connection,
    id: &str,
    name: &str,
    family: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE models SET name = ?2, family = ?3, updated_at = ?4 WHERE id = ?1",
        params![
            id,
            name.trim(),
            family.map(str::trim).filter(|s| !s.is_empty()),
            now_rfc3339()
        ],
    )?;
    Ok(())
}

pub fn delete_global_model(conn: &Connection, id: &str) -> AppResult<()> {
    let used: i64 = conn.query_row(
        "SELECT COUNT(*) FROM channel_models WHERE model_id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    if used > 0 {
        return Err(AppError::Invalid(format!(
            "该全局模型仍被 {used} 个渠道模型引用，请先移除对应渠道模型"
        )));
    }
    conn.execute("DELETE FROM models WHERE id = ?1", params![id])?;
    Ok(())
}

// ------------------------------------------------------------------
// 渠道模型
// ------------------------------------------------------------------

const CM_COLUMNS: &str =
    "cm.id, cm.channel_id, cm.model_id, m.name, cm.actual_model_id, cm.protocol, \
     cm.model_type, cm.enabled, cm.notes, cm.created_at, cm.updated_at, \
     cm.price_input_per_1m, cm.price_output_per_1m, cm.price_currency";

fn channel_model_from(row: &rusqlite::Row) -> rusqlite::Result<ChannelModelRow> {
    // model_type 存储为 JSON 字符串（如 "text"）
    let model_type: ModelType = row
        .get::<_, String>(6)
        .ok()
        .and_then(|s| match s.as_str() {
            "multimodal" => Some(ModelType::Multimodal),
            "image" => Some(ModelType::Image),
            "text" => Some(ModelType::Text),
            "decision" => Some(ModelType::Decision),
            _ => None,
        })
        .unwrap_or(ModelType::Text);
    Ok(ChannelModelRow {
        id: row.get(0)?,
        channel_id: row.get(1)?,
        model_id: row.get(2)?,
        model_name: row.get(3)?,
        actual_model_id: row.get(4)?,
        protocol: row.get(5)?,
        model_type,
        enabled: row.get::<_, i64>(7)? != 0,
        notes: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        // 标注价格：仅展示比较用
        price_input_per_1m: row.get(11)?,
        price_output_per_1m: row.get(12)?,
        price_currency: row.get(13)?,
    })
}

/// 标注价格三字段写入值（None 价格 + 空币种 = 未标注）。
fn price_values(input: &ChannelModelInput) -> (Option<f64>, Option<f64>, String) {
    let currency = input
        .price_currency
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_uppercase();
    // 币种为空时价格一并忽略，避免出现“有价无币种”
    if currency.is_empty() {
        (None, None, String::new())
    } else {
        (
            input.price_input_per_1m,
            input.price_output_per_1m,
            currency,
        )
    }
}

pub fn list_channel_models(conn: &Connection, channel_id: &str) -> AppResult<Vec<ChannelModelRow>> {
    let sql = format!(
        "SELECT {CM_COLUMNS} FROM channel_models cm LEFT JOIN models m ON cm.model_id = m.id \
         WHERE cm.channel_id = ?1 ORDER BY cm.actual_model_id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![channel_id], channel_model_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn find_channel_model(conn: &Connection, id: &str) -> AppResult<Option<ChannelModelRow>> {
    let sql = format!(
        "SELECT {CM_COLUMNS} FROM channel_models cm LEFT JOIN models m ON cm.model_id = m.id \
         WHERE cm.id = ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt.query_row(params![id], channel_model_from).optional()?)
}

/// 全渠道模型视图（模型列表页）：跨渠道平铺，前端按模型 ID 聚合。
pub fn list_all_channel_models(conn: &Connection) -> AppResult<Vec<AllChannelModelRow>> {
    let mut stmt = conn.prepare(
        "SELECT cm.id, cm.channel_id, c.name, c.enabled, cm.model_id, cm.actual_model_id, \
         cm.protocol, cm.model_type, cm.enabled, cm.price_input_per_1m, cm.price_output_per_1m, \
         cm.price_currency \
         FROM channel_models cm JOIN channels c ON c.id = cm.channel_id \
         ORDER BY cm.actual_model_id, c.name",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let model_type = row
                .get::<_, String>(7)
                .ok()
                .and_then(|s| match s.as_str() {
                    "multimodal" => Some(ModelType::Multimodal),
                    "image" => Some(ModelType::Image),
                    "text" => Some(ModelType::Text),
                    "decision" => Some(ModelType::Decision),
                    _ => None,
                })
                .unwrap_or(ModelType::Text);
            Ok(AllChannelModelRow {
                id: row.get(0)?,
                channel_id: row.get(1)?,
                channel_name: row.get(2)?,
                channel_enabled: row.get::<_, i64>(3)? != 0,
                model_id: row.get(4)?,
                actual_model_id: row.get(5)?,
                protocol: row.get(6)?,
                model_type,
                enabled: row.get::<_, i64>(8)? != 0,
                price_input_per_1m: row.get(9)?,
                price_output_per_1m: row.get(10)?,
                price_currency: row.get(11)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn find_channel_model_by_actual(
    conn: &Connection,
    channel_id: &str,
    actual_model_id: &str,
) -> AppResult<Option<ChannelModelRow>> {
    let sql = format!(
        "SELECT {CM_COLUMNS} FROM channel_models cm LEFT JOIN models m ON cm.model_id = m.id \
         WHERE cm.channel_id = ?1 AND cm.actual_model_id = ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt
        .query_row(params![channel_id, actual_model_id], channel_model_from)
        .optional()?)
}

/// 创建渠道模型（导入路径：类型默认 text，notes 为空）。
pub fn insert_channel_model(conn: &Connection, input: &ChannelModelInput) -> AppResult<String> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let (price_in, price_out, currency) = price_values(input);
    conn.execute(
        "INSERT INTO channel_models (id, channel_id, model_id, actual_model_id, protocol, \
         model_type, enabled, notes, created_at, updated_at, \
         price_input_per_1m, price_output_per_1m, price_currency) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12)",
        params![
            id,
            input.channel_id,
            input.model_id,
            input.actual_model_id.trim(),
            input.protocol,
            input.model_type.unwrap_or(ModelType::Text).as_str(),
            input.enabled.unwrap_or(true) as i64,
            input
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            now_rfc3339(),
            price_in,
            price_out,
            currency
        ],
    )?;
    Ok(id)
}

/// 更新渠道模型（人工编辑路径，整行覆盖含标注价格）。
pub fn update_channel_model(conn: &Connection, input: &ChannelModelInput) -> AppResult<()> {
    let id = input
        .id
        .as_deref()
        .ok_or_else(|| AppError::Invalid("缺少渠道模型 ID".into()))?;
    let (price_in, price_out, currency) = price_values(input);
    conn.execute(
        "UPDATE channel_models SET model_id = ?2, actual_model_id = ?3, protocol = ?4, \
         model_type = ?5, enabled = ?6, notes = ?7, price_input_per_1m = ?8, \
         price_output_per_1m = ?9, price_currency = ?10, updated_at = ?11 WHERE id = ?1",
        params![
            id,
            input.model_id,
            input.actual_model_id.trim(),
            input.protocol,
            input.model_type.unwrap_or(ModelType::Text).as_str(),
            input.enabled.unwrap_or(true) as i64,
            input
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            price_in,
            price_out,
            currency,
            now_rfc3339()
        ],
    )?;
    Ok(())
}

pub fn delete_channel_model(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM channel_models WHERE id = ?1", params![id])?;
    Ok(())
}

// ------------------------------------------------------------------
// 价格（历史追加式）
// ------------------------------------------------------------------

const PRICE_COLUMNS: &str =
    "id, channel_model_id, input_price, output_price, cache_read_price, cache_write_price, \
     image_price, other_usage_price, currency, pricing_unit, discount_percent, effective_date, \
     notes, created_at";

fn price_from(row: &rusqlite::Row) -> rusqlite::Result<ModelPriceRow> {
    Ok(ModelPriceRow {
        id: row.get(0)?,
        channel_model_id: row.get(1)?,
        input_price: row.get(2)?,
        output_price: row.get(3)?,
        cache_read_price: row.get(4)?,
        cache_write_price: row.get(5)?,
        image_price: row.get(6)?,
        other_usage_price: row.get(7)?,
        currency: row.get(8)?,
        pricing_unit: row.get(9)?,
        discount_percent: row.get(10)?,
        effective_date: row.get(11)?,
        notes: row.get(12)?,
        created_at: row.get(13)?,
    })
}

/// 全部价格历史（按生效日期倒序）。
pub fn list_prices(conn: &Connection, channel_model_id: &str) -> AppResult<Vec<ModelPriceRow>> {
    let sql = format!(
        "SELECT {PRICE_COLUMNS} FROM model_prices WHERE channel_model_id = ?1 \
         ORDER BY effective_date DESC, created_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![channel_model_id], price_from)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// 生效价格：effective_date <= 今天的最新一条。没有则为 None。
pub fn find_effective_price(
    conn: &Connection,
    channel_model_id: &str,
    today: &str,
) -> AppResult<Option<ModelPriceRow>> {
    let sql = format!(
        "SELECT {PRICE_COLUMNS} FROM model_prices \
         WHERE channel_model_id = ?1 AND effective_date <= ?2 \
         ORDER BY effective_date DESC, created_at DESC LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt
        .query_row(params![channel_model_id, today], price_from)
        .optional()?)
}

/// 追加价格版本（不覆盖历史）。同一 (channel_model_id, effective_date) 已存在时拒绝。
pub fn insert_price(conn: &Connection, input: &AddPriceInput) -> AppResult<String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM model_prices WHERE channel_model_id = ?1 AND effective_date = ?2)",
            params![input.channel_model_id, input.effective_date],
            |row| row.get(0),
        )?;
    if exists {
        return Err(AppError::Invalid(format!(
            "生效日期 {} 已有价格记录（历史追加式，不覆盖）。如需修正请先删除该日期版本。",
            input.effective_date
        )));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let sql = format!(
        "INSERT INTO model_prices ({PRICE_COLUMNS}) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"
    );
    conn.execute(
        &sql,
        params![
            id,
            input.channel_model_id,
            input.input_price,
            input.output_price,
            input.cache_read_price,
            input.cache_write_price,
            input.image_price,
            input.other_usage_price,
            input.currency.trim(),
            input.pricing_unit.trim(),
            input.discount_percent,
            input.effective_date.trim(),
            input
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            now_rfc3339()
        ],
    )?;
    Ok(id)
}

/// 删除某个价格版本（仅允许删除未来生效的版本，历史不可删——由 service 层校验日期语义）。
pub fn delete_price(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM model_prices WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channels::repo as channel_repo;
    use crate::storage::migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        channel_repo::insert(
            &conn,
            "ch-1",
            &crate::channels::domain::ChannelInput {
                name: "测试渠道".into(),
                provider_id: None,
                chat_base_url: "https://api.example.com".into(),
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

    fn cm_input(model_name: &str) -> ChannelModelInput {
        ChannelModelInput {
            id: None,
            channel_id: "ch-1".into(),
            model_id: String::new(),
            actual_model_id: model_name.into(),
            protocol: "openai_chat".into(),
            model_type: None,
            notes: None,
            enabled: Some(true),
            price_input_per_1m: None,
            price_output_per_1m: None,
            price_currency: None,
        }
    }

    #[test]
    fn global_and_channel_model_flow() {
        let conn = setup();

        // 全局模型
        let gid = insert_global_model(&conn, "GLM-5.2", Some("glm")).unwrap();
        let found = find_global_model_by_name(&conn, "glm-5.2")
            .unwrap()
            .expect("大小写不敏感查找");
        assert_eq!(found.id, gid);

        // 渠道模型绑定全局模型
        let mut input = cm_input("glm-5.2");
        input.model_id = gid.clone();
        let cm_id = insert_channel_model(&conn, &input).unwrap();

        let list = list_channel_models(&conn, "ch-1").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].model_name.as_deref(), Some("GLM-5.2"));
        assert_eq!(list[0].model_type, ModelType::Text);

        // 同渠道同 actual_model_id 冲突由 UNIQUE 约束保证
        let dup = insert_channel_model(&conn, &input);
        assert!(dup.is_err());

        // 全局模型被引用时不可删除
        assert!(delete_global_model(&conn, &gid).is_err());

        // 编辑模型类型
        let mut edit = input;
        edit.id = Some(cm_id.clone());
        edit.model_type = Some(ModelType::Multimodal);
        update_channel_model(&conn, &edit).unwrap();
        let updated = find_channel_model(&conn, &cm_id).unwrap().unwrap();
        assert_eq!(updated.model_type, ModelType::Multimodal);

        // 删除渠道模型后全局模型可删
        delete_channel_model(&conn, &cm_id).unwrap();
        delete_global_model(&conn, &gid).unwrap();
    }

    #[test]
    fn all_channel_models_flattens_across_channels() {
        let conn = setup();
        // 第二个渠道，与 ch-1 共享同名模型
        channel_repo::insert(
            &conn,
            "ch-2",
            &crate::channels::domain::ChannelInput {
                name: "渠道乙".into(),
                provider_id: None,
                chat_base_url: "https://api2.example.com".into(),
                anthropic_base_url: None,
                responses_base_url: None,
                official_url: None,
                notes: None,
                primary_credential: None,
            },
            "{}",
        )
        .unwrap();

        let gid = insert_global_model(&conn, "G1", None).unwrap();
        let mut a = cm_input("glm-5.2");
        a.model_id = gid.clone();
        a.price_currency = Some("CNY".into());
        a.price_input_per_1m = Some(2.0);
        let mut b = cm_input("glm-5.2");
        b.model_id = gid;
        b.channel_id = "ch-2".into();
        b.price_currency = Some("CNY".into());
        b.price_input_per_1m = Some(4.0);
        insert_channel_model(&conn, &a).unwrap();
        insert_channel_model(&conn, &b).unwrap();

        let all = list_all_channel_models(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|r| r.actual_model_id == "glm-5.2"));
        assert!(all
            .iter()
            .any(|r| r.channel_id == "ch-1" && r.channel_name == "测试渠道"));
        assert!(all
            .iter()
            .any(|r| r.channel_id == "ch-2" && r.channel_name == "渠道乙"));
        // 标注价随行返回（仅展示比较）
        assert!(all.iter().any(|r| r.price_input_per_1m == Some(2.0)));
        assert!(all.iter().any(|r| r.price_input_per_1m == Some(4.0)));
    }

    #[test]
    fn price_history_is_append_only() {
        let conn = setup();
        let gid = insert_global_model(&conn, "M1", None).unwrap();
        let mut input = cm_input("m1");
        input.model_id = gid;
        let cm_id = insert_channel_model(&conn, &input).unwrap();

        let mk = |date: &str, price: f64| AddPriceInput {
            channel_model_id: cm_id.clone(),
            input_price: Some(price),
            output_price: Some(price * 2.0),
            cache_read_price: None,
            cache_write_price: None,
            image_price: None,
            other_usage_price: None,
            currency: "CNY".into(),
            pricing_unit: "per_1m_tokens".into(),
            discount_percent: Some(80.0),
            effective_date: date.into(),
            notes: None,
        };

        insert_price(&conn, &mk("2026-01-01", 10.0)).unwrap();
        // 同日期重复 → 拒绝（追加式，不覆盖）
        assert!(insert_price(&conn, &mk("2026-01-01", 99.0)).is_err());
        insert_price(&conn, &mk("2026-06-01", 8.0)).unwrap();

        let history = list_prices(&conn, &cm_id).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].effective_date, "2026-06-01");

        let effective = find_effective_price(&conn, &cm_id, "2026-05-01")
            .unwrap()
            .unwrap();
        assert_eq!(effective.effective_date, "2026-01-01");
        assert_eq!(effective.input_price, Some(10.0));
    }
}
