//! 图片生成：POST {base}/images/generations（OpenAI 兼容）。
//!
//! 响应中 b64_json 自动归档；url 仅在用户允许归档时下载（本次实现先只支持 b64_json
//! 与保存 url 原文，url 下载归档由用户在详情页手动触发，避免未经确认的外网请求）。

use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::requests::repo as records;
use crate::storage::paths;
use crate::workbenches::api_testing::builder::{self, mask_header_value, request_target};

use super::attachments;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenRequest {
    pub channel_id: String,
    pub model: String,
    pub prompt: String,
    pub size: Option<String>,
    pub n: Option<i64>,
    /// response_format：url（默认）/ b64_json
    pub response_format: Option<String>,
    /// 其余 API 原生参数（原样合并）
    pub extra_body: Option<Value>,
    pub custom_headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenResult {
    pub trace_id: String,
    pub status: String,
    pub http_status: Option<u16>,
    pub images: Vec<ArchivedImage>,
    pub error: Option<Value>,
    pub raw_response_ref: Option<String>,
    pub usage_note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedImage {
    /// 归档相对路径（b64 归档时有值；url 形态时为 None）
    pub file_path: Option<String>,
    /// url 形态时的原始 URL（不自动下载）
    pub url: Option<String>,
    pub revised_prompt: Option<String>,
}

/// 发送前的准备（数据库锁内）：构建请求、Raw 请求归档、pending 记录。
pub fn prepare(
    conn: &Connection,
    data_dir: &Path,
    req: &ImageGenRequest,
) -> AppResult<PreparedImageGen> {
    if req.prompt.trim().is_empty() {
        return Err(AppError::Invalid("Prompt 不能为空".into()));
    }
    let target = request_target(
        conn,
        &req.channel_id,
        "openai_chat",
        "/images/generations",
        &[],
        &req.custom_headers,
    )?;

    let mut body = json!({
        "model": req.model.trim(),
        "prompt": req.prompt.trim(),
    });
    let obj = body.as_object_mut().expect("body 是 object");
    if let Some(size) = req.size.as_deref().filter(|s| !s.trim().is_empty()) {
        obj.insert("size".into(), json!(size.trim()));
    }
    if let Some(n) = req.n {
        obj.insert("n".into(), json!(n));
    }
    if let Some(rf) = req
        .response_format
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        obj.insert("response_format".into(), json!(rf.trim()));
    }
    if let Some(extra) = &req.extra_body {
        if let Some(extra_obj) = extra.as_object() {
            for (k, v) in extra_obj {
                obj.insert(k.clone(), v.clone());
            }
        }
    }

    let trace_id = uuid::Uuid::new_v4().to_string();
    records::insert_pending(
        conn,
        &trace_id,
        &req.channel_id,
        None,
        None,
        "openai_images",
        "image_generation",
    )?;
    for (name, note) in [
        (
            "request_serialization",
            "OpenAI Images：model + prompt + size/n/response_format",
        ),
        ("auth_header", "已注入认证 Header（值不进入任何记录）"),
    ] {
        records::log_event(
            conn,
            &trace_id,
            name,
            "prepare",
            "ok",
            false,
            Some(note),
            None,
        )?;
    }

    let raw_request = json!({
        "trace_id": trace_id,
        "url": target.url,
        "method": "POST",
        "headers": target.headers.iter().map(|(n, v)| (n.clone(), mask_header_value(n, v))).collect::<Vec<_>>(),
        "body": body,
    });
    let request_path = paths::write_archive_atomic(
        &paths::archive_requests_dir(data_dir),
        &format!("{trace_id}.json"),
        &serde_json::to_string_pretty(&raw_request)
            .map_err(|e| AppError::Invalid(format!("Raw 序列化失败: {e}")))?,
    )?;
    let request_ref = rel(data_dir, &request_path);

    Ok(PreparedImageGen {
        trace_id,
        target,
        body,
        request_ref,
    })
}

pub struct PreparedImageGen {
    pub trace_id: String,
    pub target: builder::RequestTarget,
    pub body: Value,
    pub request_ref: String,
}

/// 发送（异步，无锁）。
pub async fn send(prepared: &PreparedImageGen) -> AppResult<(u16, String, i64)> {
    let client = crate::util::http_client(prepared.target.timeout_secs, prepared.target.tls_verify)
        .map_err(AppError::Invalid)?;
    let start = std::time::Instant::now();
    let mut request = client.post(&prepared.target.url);
    for (name, value) in &prepared.target.headers {
        request = request.header(name, value);
    }
    let response = request
        .body(prepared.body.to_string())
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("HTTP 请求失败: {e}")))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|e| AppError::Invalid(format!("读取响应失败: {e}")))?;
    Ok((status, text, start.elapsed().as_millis() as i64))
}

/// 收尾（数据库锁内）：解析 data[].b64_json / url、b64 归档、attachments、Raw 响应归档。
pub fn finalize(
    conn: &Connection,
    data_dir: &Path,
    req: &ImageGenRequest,
    prepared: &PreparedImageGen,
    http_status: u16,
    body: &str,
    duration_ms: i64,
) -> AppResult<ImageGenResult> {
    // Raw 响应归档（b64 数据体积大，原样保存）
    let raw_response = json!({
        "trace_id": prepared.trace_id,
        "http_status": http_status,
        "body": body,
    });
    let response_path = paths::write_archive_atomic(
        &paths::archive_responses_dir(data_dir),
        &format!("{}.json", prepared.trace_id),
        &serde_json::to_string_pretty(&raw_response)
            .map_err(|e| AppError::Invalid(format!("Raw 响应序列化失败: {e}")))?,
    )?;
    let response_ref = rel(data_dir, &response_path);

    let root: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let mut images = Vec::new();
    let mut error = None;

    if let Some(err) = root.get("error") {
        error = Some(err.clone());
    } else if (200..300).contains(&http_status) {
        if let Some(items) = root.get("data").and_then(Value::as_array) {
            // 归档目录：archives/images/YYYY/MM/trace-id/
            let now = chrono::Local::now();
            let dir = data_dir
                .join("archives")
                .join("images")
                .join(now.format("%Y").to_string())
                .join(now.format("%m").to_string())
                .join(&prepared.trace_id);
            std::fs::create_dir_all(&dir)?;

            for item in items {
                let revised = item
                    .get("revised_prompt")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if let Some(b64) = item.get("b64_json").and_then(Value::as_str) {
                    let bytes = decode_base64(b64).ok_or_else(|| {
                        AppError::Invalid("b64_json 解码失败（响应包含非法 base64）".into())
                    })?;
                    let file_name = format!("img-{}.png", images.len() + 1);
                    let file_path = dir.join(&file_name);
                    std::fs::write(&file_path, &bytes)
                        .map_err(|e| AppError::Invalid(format!("图片归档写入失败: {e}")))?;
                    let rel_file = rel(data_dir, &file_path);
                    attachments::insert(
                        conn,
                        &prepared.trace_id,
                        "generated_image",
                        &rel_file,
                        Some("image/png"),
                        Some(bytes.len() as i64),
                        None,
                    )?;
                    records::log_event(
                        conn,
                        &prepared.trace_id,
                        "image_archiving",
                        "save",
                        "ok",
                        false,
                        Some(&rel_file),
                        None,
                    )?;
                    images.push(ArchivedImage {
                        file_path: Some(rel_file),
                        url: None,
                        revised_prompt: revised.clone(),
                    });
                } else if let Some(url) = item.get("url").and_then(Value::as_str) {
                    // url 形态：只记录原文，不自动下载（外网请求需用户确认）
                    images.push(ArchivedImage {
                        file_path: None,
                        url: Some(url.to_string()),
                        revised_prompt: revised.clone(),
                    });
                }
            }
            if images.is_empty() {
                error = Some(json!({"message": "响应 data 数组中没有 b64_json 或 url 图片"}));
            }
        } else {
            error = Some(json!({"message": "响应缺少 data 数组，无法解析图片"}));
        }
    } else {
        error = Some(json!({"http_status": http_status, "body": root}));
    }

    let status = if error.is_some() {
        if (200..300).contains(&http_status) {
            "protocol_error"
        } else {
            "http_error"
        }
    } else {
        "success"
    };
    records::log_event(
        conn,
        &prepared.trace_id,
        "preview_generation",
        "parse",
        if error.is_some() { "failed" } else { "ok" },
        false,
        Some(if error.is_some() {
            "响应包含错误"
        } else {
            "图片提取与归档完成"
        }),
        None,
    )?;
    records::finish(
        conn,
        &prepared.trace_id,
        status,
        None,
        error
            .as_ref()
            .and_then(Value::as_str)
            .map(str::to_owned)
            .as_deref(),
        None,
        Some(i64::from(http_status)),
        None,
        None,
        Some(duration_ms),
        None,
        None,
        None,
        None,
        Some(&prepared.request_ref),
        Some(&response_ref),
        Some(req.model.trim()),
    )?;

    Ok(ImageGenResult {
        trace_id: prepared.trace_id.clone(),
        status: status.to_string(),
        http_status: Some(http_status),
        images,
        error,
        raw_response_ref: Some(response_ref),
        usage_note: Some(
            "图片归档于 archives/images/YYYY/MM/<trace-id>/；url 形态不自动下载".into(),
        ),
    })
}

fn rel(data_dir: &Path, file: &Path) -> String {
    file.strip_prefix(data_dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file.to_string_lossy().into_owned())
}

/// 宽松 base64 解码（容忍换行）。
fn decode_base64(input: &str) -> Option<Vec<u8>> {
    let clean: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let table = |c: u8| -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some(u32::from(c - b'A')),
            b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let bytes: Vec<u8> = clean.bytes().collect();
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 {
            return None;
        }
        let mut n = 0u32;
        let mut valid = 0usize;
        for (i, &c) in chunk.iter().enumerate() {
            if c == b'=' {
                break;
            }
            n |= table(c)? << (18 - 6 * i);
            valid += 1;
        }
        match valid {
            2 => out.push((n >> 16) as u8),
            3 => {
                out.push((n >> 16) as u8);
                out.push((n >> 8) as u8);
            }
            4 => {
                out.push((n >> 16) as u8);
                out.push((n >> 8) as u8);
                out.push(n as u8);
            }
            _ => return None,
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip() {
        let original = b"hello image bytes \xff\xfe\x01";
        let encoded = attachments::base64_encode(original);
        assert_eq!(decode_base64(&encoded).unwrap(), original.to_vec());
    }
}

// ------------------------------------------------------------------
// 图片编辑（multipart /images/edits）
// ------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEditRequest {
    pub channel_id: String,
    pub model: String,
    pub prompt: String,
    /// 待编辑图片：base64（无 data: 前缀）+ MIME
    pub image_base64: String,
    pub image_mime: String,
    /// 可选蒙版
    pub mask_base64: Option<String>,
    pub size: Option<String>,
    pub n: Option<i64>,
}

/// 图片编辑（数据库锁内准备）：构建 multipart 请求体与 pending 记录。
pub fn prepare_edit(
    conn: &Connection,
    data_dir: &Path,
    req: &ImageEditRequest,
) -> AppResult<PreparedImageEdit> {
    if req.prompt.trim().is_empty() {
        return Err(AppError::Invalid("Prompt 不能为空".into()));
    }
    let image_bytes = decode_base64(&req.image_base64)
        .ok_or_else(|| AppError::Invalid("image_base64 解码失败（非法 base64）".into()))?;
    let target = request_target(
        conn,
        &req.channel_id,
        "openai_chat",
        "/images/edits",
        &[],
        &[],
    )?;

    let trace_id = uuid::Uuid::new_v4().to_string();
    records::insert_pending(
        conn,
        &trace_id,
        &req.channel_id,
        None,
        None,
        req.model.trim(),
        "image_edit",
    )?;
    records::log_event(
        conn,
        &trace_id,
        "request_serialization",
        "serialize",
        "ok",
        false,
        Some(&format!(
            "Image Edit：multipart（图片 {} KB，MIME {}），prompt {} 字符；图片原样上传未压缩",
            image_bytes.len() / 1024,
            req.image_mime,
            req.prompt.trim().len()
        )),
        None,
    )?;
    records::log_event(
        conn,
        &trace_id,
        "auth_header",
        "inject",
        "ok",
        false,
        Some("已注入认证 Header（值不进入任何记录）"),
        None,
    )?;

    // 请求 Raw 记录元信息（multipart 二进制体以摘要代替）
    let raw_request = json!({
        "trace_id": trace_id,
        "url": target.url,
        "method": "POST",
        "headers": target.headers.iter().map(|(n, v)| (n.clone(), mask_header_value(n, v))).collect::<Vec<_>>(),
        "body_note": format!(
            "multipart: image ({} bytes, {}), prompt: {}",
            image_bytes.len(),
            req.image_mime,
            req.prompt.trim()
        ),
    });
    let request_path = paths::write_archive_atomic(
        &paths::archive_requests_dir(data_dir),
        &format!("{trace_id}.json"),
        &serde_json::to_string_pretty(&raw_request)
            .map_err(|e| AppError::Invalid(format!("Raw 序列化失败: {e}")))?,
    )?;
    let request_ref = rel(data_dir, &request_path);

    Ok(PreparedImageEdit {
        trace_id,
        target,
        image_bytes,
        request_ref,
        request: req.clone(),
    })
}

pub struct PreparedImageEdit {
    pub trace_id: String,
    pub target: builder::RequestTarget,
    pub image_bytes: Vec<u8>,
    pub request_ref: String,
    pub request: ImageEditRequest,
}

/// 发送编辑请求（异步，multipart）。
pub async fn send_edit(prepared: &PreparedImageEdit) -> AppResult<(u16, String, i64)> {
    let client = crate::util::http_client(prepared.target.timeout_secs, prepared.target.tls_verify)
        .map_err(AppError::Invalid)?;
    let start = std::time::Instant::now();

    let image_part = reqwest::multipart::Part::bytes(prepared.image_bytes.clone())
        .file_name("image.png")
        .mime_str(&prepared.request.image_mime)
        .map_err(|e| AppError::Invalid(format!("图片 MIME 无效: {e}")))?;

    let mut form = reqwest::multipart::Form::new()
        .text("model", prepared.request.model.trim().to_string())
        .text("prompt", prepared.request.prompt.trim().to_string())
        .part("image", image_part);
    if let Some(mask) = &prepared.request.mask_base64 {
        if let Some(mask_bytes) = decode_base64(mask) {
            let mask_part = reqwest::multipart::Part::bytes(mask_bytes)
                .file_name("mask.png")
                .mime_str("image/png")
                .map_err(|e| AppError::Invalid(format!("蒙版 MIME 无效: {e}")))?;
            form = form.part("mask", mask_part);
        }
    }
    if let Some(size) = prepared
        .request
        .size
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        form = form.text("size", size.trim().to_string());
    }
    if let Some(n) = prepared.request.n {
        form = form.text("n", n.to_string());
    }

    let mut request = client.post(&prepared.target.url);
    for (name, value) in &prepared.target.headers {
        if name.eq_ignore_ascii_case("content-type") {
            continue; // multipart 自动生成 boundary
        }
        request = request.header(name, value);
    }
    let response = request
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("HTTP 请求失败: {e}")))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|e| AppError::Invalid(format!("读取响应失败: {e}")))?;
    Ok((status, text, start.elapsed().as_millis() as i64))
}

/// 编辑收尾（数据库锁内）：与生成一致的解析与归档。
pub fn finalize_edit(
    conn: &Connection,
    data_dir: &Path,
    req: &ImageEditRequest,
    prepared: &PreparedImageEdit,
    http_status: u16,
    body: &str,
    duration_ms: i64,
) -> AppResult<ImageGenResult> {
    finalize(
        conn,
        data_dir,
        &ImageGenRequest {
            channel_id: req.channel_id.clone(),
            model: req.model.clone(),
            prompt: req.prompt.clone(),
            size: req.size.clone(),
            n: req.n,
            response_format: None,
            extra_body: None,
            custom_headers: Vec::new(),
        },
        &PreparedImageGen {
            trace_id: prepared.trace_id.clone(),
            target: prepared.target.clone(),
            body: Value::Null,
            request_ref: prepared.request_ref.clone(),
        },
        http_status,
        body,
        duration_ms,
    )
}
