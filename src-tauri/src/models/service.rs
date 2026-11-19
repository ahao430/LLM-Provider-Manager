//! 模型业务编排：导入（不覆盖人工配置）、校验、生效价格。

use rusqlite::Connection;

use crate::channels::domain::{
    default_protocol_for, ChannelModelInput, ChannelModelRow, ModelType,
};
use crate::error::{AppError, AppResult};

use super::domain::{AddPriceInput, EffectivePrice, ImportOutcome, ModelPriceRow, SkippedImport};
use super::repo;

const KNOWN_PROTOCOLS: &[&str] = &["openai_chat", "openai_responses", "anthropic_messages"];

/// YYYY-MM-DD 日期格式校验（不引入正则依赖）。
fn is_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| matches!(i, 4 | 7) || b.is_ascii_digit())
}

/// 导入单项。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub actual_model_id: String,
}

/// 按模型名称推断默认类型（仅默认值，用户可随时手动修改）。
/// - 图像：image / dall-e / seedream / cogview / wanx / flux / stable-diffusion 等图像生成命名。
/// - 多模态：视觉系命名（omni / vision / -vl / vl- / qvq / 4o），天生多模态的家族
///   （Claude 3+ 全系、Gemini 全系、GPT-4o / 4.1 / 4-turbo / 5 系、OpenAI o 系），
///   及已知多模态型号（deepseek-v4.1-flash、glm-5.3-flash）。
/// - 其余默认文本；决策不做自动推断。
pub fn default_model_type_for(model_id: &str) -> ModelType {
    const IMAGE_MARKERS: &[&str] = &[
        "image",
        "dall-e",
        "seedream",
        "seededit",
        "cogview",
        "wanx",
        "flux",
        "stable-diffusion",
    ];
    // 多模态家族与视觉系命名
    const VISION_MARKERS: &[&str] = &[
        "omni",
        "vision",
        "-vl",
        "vl-",
        "qvq",
        "4o",
        "claude",
        "gemini",
        "gpt-4.1",
        "gpt-4-turbo",
        "gpt-5",
    ];
    /// 已知多模态型号（按名称精确匹配，小写比较）。
    const KNOWN_MULTIMODAL: &[&str] = &["deepseek-v4.1-flash", "glm-5.3-flash"];

    let name = model_id.trim().to_lowercase();
    if IMAGE_MARKERS.iter().any(|m| name.contains(m)) {
        return ModelType::Image;
    }
    if VISION_MARKERS.iter().any(|m| name.contains(m))
        || KNOWN_MULTIMODAL.contains(&name.as_str())
        || name.starts_with("o1")
        || name.starts_with("o3")
        || name.starts_with("o4")
    {
        return ModelType::Multimodal;
    }
    ModelType::Text
}

/// 导入渠道模型：
/// - 已存在 (channel_id, actual_model_id) → 跳过，保留人工配置（不覆盖备注/价格/能力/接口类型）。
/// - 未绑定全局模型 → 按名称复用或新建全局模型。
/// - 接口类型按名称默认：含 claude → anthropic_messages，否则 openai_chat。
/// - 类型按名称默认：图像 / 多模态命名 → image / multimodal，否则 text（可手动改）。
pub fn import_channel_models(
    conn: &Connection,
    channel_id: &str,
    items: &[ImportItem],
) -> AppResult<ImportOutcome> {
    let mut created = Vec::new();
    let mut skipped = Vec::new();

    for item in items {
        let actual = item.actual_model_id.trim();
        if actual.is_empty() {
            continue;
        }
        if repo::find_channel_model_by_actual(conn, channel_id, actual)?.is_some() {
            skipped.push(SkippedImport {
                actual_model_id: actual.to_string(),
                reason: "已存在，保留人工配置".into(),
            });
            continue;
        }

        let model_id = match repo::find_global_model_by_name(conn, actual)? {
            Some(existing) => existing.id,
            None => repo::insert_global_model(conn, actual, None)?,
        };

        let input = ChannelModelInput {
            id: None,
            channel_id: channel_id.to_string(),
            model_id,
            actual_model_id: actual.to_string(),
            protocol: default_protocol_for(actual).to_string(),
            model_type: Some(default_model_type_for(actual)),
            notes: None,
            enabled: Some(true),
            price_input_per_1m: None,
            price_output_per_1m: None,
            price_currency: None,
            price_multiplier: None,
            price_tiers: None,
            price_off_peak: None,
        };
        repo::insert_channel_model(conn, &input)?;
        created.push(actual.to_string());
    }

    Ok(ImportOutcome { created, skipped })
}

fn validate_protocol(protocol: &str) -> AppResult<()> {
    if KNOWN_PROTOCOLS.contains(&protocol) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "不支持的协议: {protocol}（应为 openai_chat / openai_responses / anthropic_messages）"
        )))
    }
}

/// 新建 / 编辑渠道模型（人工路径）。
pub fn upsert_channel_model(
    conn: &Connection,
    input: &ChannelModelInput,
) -> AppResult<ChannelModelRow> {
    validate_protocol(&input.protocol)?;
    if input.actual_model_id.trim().is_empty() {
        return Err(AppError::Invalid("实际模型 ID 不能为空".into()));
    }
    // 倍率校验：> 0（repo 层会把非法值归一为 1.0，这里显式报错防止静默修正）
    if let Some(m) = input.price_multiplier {
        if m <= 0.0 {
            return Err(AppError::Invalid("价格倍率必须大于 0".into()));
        }
    }
    // 全局模型必须存在（前端先建或从下拉选择，传的是全局模型 ID）
    if repo::find_global_model_by_id(conn, &input.model_id)?.is_none() {
        return Err(AppError::Invalid(
            "全局模型不存在：请先在全局模型列表创建，或从下拉中选择".into(),
        ));
    }
    let model_id = input.model_id.clone();

    // 唯一性：(channel_id, actual_model_id)
    let mut normalized = input.clone();
    normalized.model_id = model_id;
    let editing_id = input.id.clone();

    let existing =
        repo::find_channel_model_by_actual(conn, &input.channel_id, &input.actual_model_id)?;
    match (existing, &editing_id) {
        (Some(found), Some(_)) => {
            if found.id != *editing_id.as_ref().unwrap() {
                return Err(AppError::Invalid(format!(
                    "该渠道已存在实际模型 ID「{}」，同渠道不可重复",
                    input.actual_model_id
                )));
            }
        }
        (Some(_), None) => {
            return Err(AppError::Invalid(format!(
                "该渠道已存在实际模型 ID「{}」，同渠道不可重复",
                input.actual_model_id
            )));
        }
        _ => {}
    }

    match &editing_id {
        Some(_) => {
            repo::update_channel_model(conn, &normalized)?;
            repo::find_channel_model(conn, editing_id.unwrap().as_str())?
                .ok_or_else(|| AppError::Invalid("渠道模型不存在".into()))
        }
        None => {
            let id = repo::insert_channel_model(conn, &normalized)?;
            repo::find_channel_model(conn, &id)?
                .ok_or_else(|| AppError::Invalid("渠道模型创建失败".into()))
        }
    }
}

/// 生效价格（含折扣后金额）。折扣 80 = 按原价 80% 计算。
pub fn effective_price(
    conn: &Connection,
    channel_model_id: &str,
    today: &str,
) -> AppResult<Option<EffectivePrice>> {
    let row: Option<ModelPriceRow> = repo::find_effective_price(conn, channel_model_id, today)?;
    Ok(row.map(|row| {
        let discounted = super::domain::DiscountedPrices {
            input: super::domain::apply_discount(row.input_price, row.discount_percent),
            output: super::domain::apply_discount(row.output_price, row.discount_percent),
            cache_read: super::domain::apply_discount(row.cache_read_price, row.discount_percent),
            cache_write: super::domain::apply_discount(row.cache_write_price, row.discount_percent),
            image: super::domain::apply_discount(row.image_price, row.discount_percent),
            other_usage: super::domain::apply_discount(row.other_usage_price, row.discount_percent),
        };
        EffectivePrice { row, discounted }
    }))
}

/// 追加价格版本（校验 + 追加式，历史不覆盖）。
pub fn add_price(conn: &Connection, input: &AddPriceInput) -> AppResult<String> {
    let has_any = [
        input.input_price,
        input.output_price,
        input.cache_read_price,
        input.cache_write_price,
        input.image_price,
        input.other_usage_price,
    ]
    .iter()
    .any(|p| p.is_some());
    if !has_any {
        return Err(AppError::Invalid("至少填写一项价格".into()));
    }
    if !is_date(&input.effective_date) {
        return Err(AppError::Invalid(format!(
            "生效日期格式应为 YYYY-MM-DD：{}",
            input.effective_date
        )));
    }
    if let Some(d) = input.discount_percent {
        if !(0.0 < d && d <= 100.0) {
            return Err(AppError::Invalid(
                "折扣必须为 (0, 100] 区间的百分比，如 80 表示八折".into(),
            ));
        }
    }
    if input.currency.trim().is_empty() || input.pricing_unit.trim().is_empty() {
        return Err(AppError::Invalid("币种与计价单位不能为空".into()));
    }
    repo::insert_price(conn, input)
}

/// 删除价格版本：仅允许删除「未来生效」的版本；已生效/历史版本不可删（数据约束：不覆盖历史价格）。
pub fn delete_price(conn: &Connection, price_id: &str, today: &str) -> AppResult<()> {
    let target_date: Option<String> = conn
        .query_row(
            "SELECT effective_date FROM model_prices WHERE id = ?1",
            rusqlite::params![price_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::Invalid("价格版本不存在".into()))
        .ok();
    match target_date {
        Some(date) if date.as_str() > today => super::repo::delete_price(conn, price_id),
        _ => Err(AppError::Invalid(
            "已生效或历史价格版本不可删除（价格历史只追加）；如需改价请新增一个未来生效日期的版本"
                .into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channels::domain::{ChannelInput, ModelType};
    use crate::channels::repo as channel_repo;
    use crate::storage::migrations;

    #[test]
    fn default_model_type_matches_named_families() {
        // 图像命名 → image
        assert_eq!(default_model_type_for("gpt-image-1"), ModelType::Image);
        assert_eq!(default_model_type_for("Qwen-Image-Edit"), ModelType::Image);
        assert_eq!(
            default_model_type_for("doubao-seedream-4.0"),
            ModelType::Image
        );
        // 用户指定的多模态型号 → multimodal
        assert_eq!(
            default_model_type_for("deepseek-v4.1-flash"),
            ModelType::Multimodal
        );
        assert_eq!(
            default_model_type_for("GLM-5.3-Flash"),
            ModelType::Multimodal
        );
        // 视觉命名与天生多模态家族 → multimodal
        assert_eq!(default_model_type_for("GPT-4o"), ModelType::Multimodal);
        assert_eq!(default_model_type_for("qwen-vl-max"), ModelType::Multimodal);
        assert_eq!(
            default_model_type_for("claude-sonnet-4-5"),
            ModelType::Multimodal
        );
        assert_eq!(
            default_model_type_for("gemini-2.5-pro"),
            ModelType::Multimodal
        );
        assert_eq!(default_model_type_for("gpt-5.1"), ModelType::Multimodal);
        assert_eq!(default_model_type_for("o4-mini"), ModelType::Multimodal);
        // 其余默认文本
        assert_eq!(default_model_type_for("gpt-3.5-turbo"), ModelType::Text);
        assert_eq!(default_model_type_for("glm-5.3"), ModelType::Text);
        assert_eq!(default_model_type_for("deepseek-v3.2"), ModelType::Text);
    }

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
    fn import_creates_and_preserves_existing() {
        let conn = setup();
        let items = vec![
            ImportItem {
                actual_model_id: "glm-5.2".into(),
            },
            ImportItem {
                actual_model_id: "deepseek-v4".into(),
            },
            ImportItem {
                actual_model_id: "claude-sonnet-4-5".into(),
            },
        ];
        let out = import_channel_models(&conn, "ch-1", &items).unwrap();
        assert_eq!(out.created.len(), 3);
        assert!(out.skipped.is_empty());

        // 接口类型按名称默认：claude → anthropic_messages，其余 openai_chat
        let claude = repo::find_channel_model_by_actual(&conn, "ch-1", "claude-sonnet-4-5")
            .unwrap()
            .unwrap();
        assert_eq!(claude.protocol, "anthropic_messages");
        let glm = repo::find_channel_model_by_actual(&conn, "ch-1", "glm-5.2")
            .unwrap()
            .unwrap();
        assert_eq!(glm.protocol, "openai_chat");

        // 人工编辑备注
        let row = repo::find_channel_model_by_actual(&conn, "ch-1", "glm-5.2")
            .unwrap()
            .unwrap();
        let edit = ChannelModelInput {
            id: Some(row.id.clone()),
            channel_id: "ch-1".into(),
            model_id: row.model_id.clone(),
            actual_model_id: "glm-5.2".into(),
            protocol: "openai_chat".into(),
            model_type: None,
            notes: Some("人工备注".into()),
            enabled: Some(true),
            price_input_per_1m: None,
            price_output_per_1m: None,
            price_currency: None,
            price_multiplier: None,
            price_tiers: None,
            price_off_peak: None,
        };
        upsert_channel_model(&conn, &edit).unwrap();

        // 重复导入 → 跳过，且人工备注保留
        let out2 = import_channel_models(&conn, "ch-1", &items).unwrap();
        assert!(out2.created.is_empty());
        assert_eq!(out2.skipped.len(), 3);
        let row2 = repo::find_channel_model_by_actual(&conn, "ch-1", "glm-5.2")
            .unwrap()
            .unwrap();
        assert_eq!(row2.notes.as_deref(), Some("人工备注"));
    }

    #[test]
    fn effective_price_with_discount() {
        let conn = setup();
        let items = vec![ImportItem {
            actual_model_id: "m1".into(),
        }];
        import_channel_models(&conn, "ch-1", &items).unwrap();
        let cm = repo::find_channel_model_by_actual(&conn, "ch-1", "m1")
            .unwrap()
            .unwrap();

        add_price(
            &conn,
            &AddPriceInput {
                channel_model_id: cm.id.clone(),
                input_price: Some(10.0),
                output_price: Some(20.0),
                cache_read_price: None,
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

        let eff = effective_price(&conn, &cm.id, "2026-06-01")
            .unwrap()
            .unwrap();
        assert_eq!(eff.row.input_price, Some(10.0));
        assert_eq!(eff.discounted.input, Some(8.0));
        assert_eq!(eff.discounted.output, Some(16.0));

        // 生效日期之前无价格
        assert!(effective_price(&conn, &cm.id, "2025-12-31")
            .unwrap()
            .is_none());
    }
}
