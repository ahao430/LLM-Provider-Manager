//! 模型领域类型。

use serde::{Deserialize, Serialize};

/// 全局模型（统一身份）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalModelRow {
    pub id: String,
    pub name: String,
    pub family: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// 引用该全局模型的渠道模型数量
    pub channel_model_count: i64,
}

/// 价格行（历史追加式）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceRow {
    pub id: String,
    pub channel_model_id: String,
    pub input_price: Option<f64>,
    pub output_price: Option<f64>,
    pub cache_read_price: Option<f64>,
    pub cache_write_price: Option<f64>,
    pub image_price: Option<f64>,
    pub other_usage_price: Option<f64>,
    pub currency: String,
    pub pricing_unit: String,
    /// 80 表示按原价 80% 计算
    pub discount_percent: Option<f64>,
    pub effective_date: String,
    pub notes: Option<String>,
    pub created_at: String,
}

/// 新增价格版本的输入。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPriceInput {
    pub channel_model_id: String,
    pub input_price: Option<f64>,
    pub output_price: Option<f64>,
    pub cache_read_price: Option<f64>,
    pub cache_write_price: Option<f64>,
    pub image_price: Option<f64>,
    pub other_usage_price: Option<f64>,
    pub currency: String,
    pub pricing_unit: String,
    pub discount_percent: Option<f64>,
    pub effective_date: String,
    pub notes: Option<String>,
}

/// 生效价格（含折扣后金额）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePrice {
    #[serde(flatten)]
    pub row: ModelPriceRow,
    /// 各项折扣后价格（discount_percent 为空时等于原价）
    pub discounted: DiscountedPrices,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscountedPrices {
    pub input: Option<f64>,
    pub output: Option<f64>,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
    pub image: Option<f64>,
    pub other_usage: Option<f64>,
}

/// 按折扣比例计算单项价格（折扣 80 = 原价 × 0.8）。
pub fn apply_discount(price: Option<f64>, discount_percent: Option<f64>) -> Option<f64> {
    let price = price?;
    let factor = match discount_percent {
        Some(d) if d > 0.0 && d <= 100.0 => d / 100.0,
        // 非法折扣按原价计，不放大
        _ => 1.0,
    };
    Some((price * factor * 1_000_000.0).round() / 1_000_000.0)
}

/// 远端模型列表条目。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModel {
    pub id: String,
    pub display_name: Option<String>,
}

/// 模型列表获取结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModelList {
    pub channel_id: String,
    pub url: String,
    pub http_status: u16,
    pub models: Vec<RemoteModel>,
    pub note: Option<String>,
    /// 上次成功获取的模型 id 集合（首次获取为 None）——供上下架 diff
    #[serde(default)]
    pub previous_ids: Option<Vec<String>>,
}

/// 导入结果（如实报告创建与跳过）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub created: Vec<String>,
    pub skipped: Vec<SkippedImport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedImport {
    pub actual_model_id: String,
    pub reason: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discount_math() {
        assert_eq!(apply_discount(Some(10.0), Some(80.0)), Some(8.0));
        assert_eq!(apply_discount(Some(3.5), None), Some(3.5));
        // 非法折扣不放大
        assert_eq!(apply_discount(Some(10.0), Some(150.0)), Some(10.0));
        assert_eq!(apply_discount(None, Some(80.0)), None);
    }

    #[test]
    fn model_type_serde_roundtrip() {
        use crate::channels::domain::ModelType;

        let json = serde_json::to_value(ModelType::Multimodal).unwrap();
        assert_eq!(json, "multimodal");
        let back: ModelType = serde_json::from_value(json).unwrap();
        assert_eq!(back, ModelType::Multimodal);
        assert_eq!(serde_json::to_value(ModelType::default()).unwrap(), "text");
    }
}
