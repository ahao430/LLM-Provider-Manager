//! API 测试工作台：响应解析（Preview 提取）与 SSE 增量解析。
//!
//! Preview 是解释结果：只提取响应里确实存在的内容，不做伪装；
//! 错误时保留原始错误对象。解析失败不丢弃原始数据（Raw 已归档）。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallPreview {
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsagePreview {
    pub input: Option<i64>,
    pub output: Option<i64>,
    pub cache_read: Option<i64>,
}

/// 统一 Preview 结构（text / thinking / tool_call / usage / finish / error）。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResponsePreview {
    pub text: String,
    pub thinking: String,
    pub tool_calls: Vec<ToolCallPreview>,
    pub finish: Option<String>,
    pub usage: Option<UsagePreview>,
    pub provider_request_id: Option<String>,
    /// HTTP 非成功或协议错误时，保留原始错误对象
    pub error: Option<Value>,
}

/// 按协议解析非流式响应体。
pub fn parse_response(protocol: &str, http_status: u16, body: &str) -> ResponsePreview {
    let mut preview = ResponsePreview::default();
    let parsed: Result<Value, _> = serde_json::from_str(body);
    let root = match parsed {
        Ok(v) => v,
        Err(_) => {
            if !(200..300).contains(&http_status) {
                preview.error = Some(Value::String(format!(
                    "HTTP {http_status}，响应不是 JSON：{}",
                    body.chars().take(400).collect::<String>()
                )));
            } else {
                preview.error = Some(Value::String(format!(
                    "HTTP {http_status}，响应解析失败：{}",
                    body.chars().take(400).collect::<String>()
                )));
            }
            return preview;
        }
    };

    // 错误优先：HTTP 错误或 body 带 error 对象时保留原始错误
    if let Some(err) = root.get("error") {
        preview.error = Some(err.clone());
        return preview;
    }
    if !(200..300).contains(&http_status) {
        preview.error = Some(json!({"http_status": http_status, "body": root}));
        return preview;
    }

    match protocol {
        "openai_chat" => parse_openai_chat(&root, &mut preview),
        "openai_responses" => parse_openai_responses(&root, &mut preview),
        "anthropic_messages" => parse_anthropic(&root, &mut preview),
        _ => preview.error = Some(Value::String(format!("未知协议: {protocol}"))),
    }
    preview
}

fn i64_of(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|k| value.get(*k).and_then(Value::as_i64))
}

fn parse_openai_chat(root: &Value, preview: &mut ResponsePreview) {
    preview.provider_request_id = root.get("id").and_then(Value::as_str).map(str::to_owned);
    if let Some(choice) = root
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
    {
        if let Some(message) = choice.get("message") {
            if let Some(text) = message.get("content").and_then(Value::as_str) {
                preview.text = text.to_string();
            }
            if let Some(thinking) = message
                .get("reasoning_content")
                .or_else(|| message.get("reasoning"))
                .and_then(Value::as_str)
            {
                preview.thinking = thinking.to_string();
            }
            if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
                for call in calls {
                    let function = call.get("function");
                    preview.tool_calls.push(ToolCallPreview {
                        id: call.get("id").and_then(Value::as_str).map(str::to_owned),
                        name: function
                            .and_then(|f| f.get("name"))
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        arguments: function
                            .and_then(|f| f.get("arguments"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    });
                }
            }
        }
        preview.finish = choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    if let Some(usage) = root.get("usage") {
        preview.usage = Some(UsagePreview {
            input: i64_of(usage, &["prompt_tokens"]),
            output: i64_of(usage, &["completion_tokens"]),
            cache_read: usage
                .get("prompt_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(Value::as_i64),
        });
    }
}

fn parse_anthropic(root: &Value, preview: &mut ResponsePreview) {
    preview.provider_request_id = root.get("id").and_then(Value::as_str).map(str::to_owned);
    if let Some(blocks) = root.get("content").and_then(Value::as_array) {
        let mut text_parts = Vec::new();
        let mut thinking_parts = Vec::new();
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(Value::as_str) {
                        text_parts.push(t.to_string());
                    }
                }
                Some("thinking") => {
                    if let Some(t) = block.get("thinking").and_then(Value::as_str) {
                        thinking_parts.push(t.to_string());
                    }
                }
                Some("tool_use") => {
                    preview.tool_calls.push(ToolCallPreview {
                        id: block.get("id").and_then(Value::as_str).map(str::to_owned),
                        name: block.get("name").and_then(Value::as_str).map(str::to_owned),
                        arguments: block
                            .get("input")
                            .map(|v| v.to_string())
                            .unwrap_or_default(),
                    });
                }
                _ => {}
            }
        }
        preview.text = text_parts.join("");
        preview.thinking = thinking_parts.join("\n\n");
    }
    preview.finish = root
        .get("stop_reason")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if let Some(usage) = root.get("usage") {
        preview.usage = Some(UsagePreview {
            input: i64_of(usage, &["input_tokens"]),
            output: i64_of(usage, &["output_tokens"]),
            cache_read: i64_of(usage, &["cache_read_input_tokens"]),
        });
    }
}

fn parse_openai_responses(root: &Value, preview: &mut ResponsePreview) {
    preview.provider_request_id = root.get("id").and_then(Value::as_str).map(str::to_owned);
    if let Some(items) = root.get("output").and_then(Value::as_array) {
        let mut text_parts = Vec::new();
        let mut thinking_parts = Vec::new();
        for item in items {
            match item.get("type").and_then(Value::as_str) {
                Some("message") => {
                    if let Some(content) = item.get("content").and_then(Value::as_array) {
                        for part in content {
                            if part.get("type").and_then(Value::as_str) == Some("output_text") {
                                if let Some(t) = part.get("text").and_then(Value::as_str) {
                                    text_parts.push(t.to_string());
                                }
                            }
                        }
                    }
                }
                Some("reasoning") => {
                    if let Some(summary) = item.get("summary").and_then(Value::as_array) {
                        for part in summary {
                            if let Some(t) = part.get("text").and_then(Value::as_str) {
                                thinking_parts.push(t.to_string());
                            }
                        }
                    }
                }
                Some("function_call") => {
                    preview.tool_calls.push(ToolCallPreview {
                        id: item.get("id").and_then(Value::as_str).map(str::to_owned),
                        name: item.get("name").and_then(Value::as_str).map(str::to_owned),
                        arguments: item
                            .get("arguments")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    });
                }
                _ => {}
            }
        }
        preview.text = text_parts.join("");
        preview.thinking = thinking_parts.join("\n\n");
    }
    preview.finish = root
        .get("status")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if let Some(usage) = root.get("usage") {
        preview.usage = Some(UsagePreview {
            input: i64_of(usage, &["input_tokens"]),
            output: i64_of(usage, &["output_tokens"]),
            cache_read: usage
                .get("input_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(Value::as_i64),
        });
    }
}

// ------------------------------------------------------------------
// SSE
// ------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SseEvent {
    // SSE event 字段；当前协议增量提取使用 data JSON 内的 type，此字段留作后续逐事件处理
    #[allow(dead_code)]
    pub event: String,
    pub data: String,
}

/// SSE 增量解析器：feed 任意大小的字节块，返回完整事件块。
/// 保留不完整数据在缓冲区；原始字节由调用方另行完整保存。
#[derive(Default)]
pub struct SseParser {
    buf: String,
}

impl SseParser {
    pub fn feed(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buf.push_str(chunk);
        let mut events = Vec::new();
        // SSE 事件块以空行分隔（兼容 \r\n\r\n）
        while let Some(pos) = find_block_end(&self.buf) {
            let block: String = self.buf.drain(..pos.0).collect();
            let consume = pos.1;
            for _ in 0..consume {
                self.buf.remove(0);
            }
            let (event, data) = parse_block(&block);
            if !data.is_empty() || !event.is_empty() {
                events.push(SseEvent { event, data });
            }
        }
        events
    }
}

/// 返回（块结束位置，分隔符长度）。
fn find_block_end(buf: &str) -> Option<(usize, usize)> {
    if let Some(i) = buf.find("\r\n\r\n") {
        return Some((i, 4));
    }
    if let Some(i) = buf.find("\n\n") {
        return Some((i, 2));
    }
    None
}

fn parse_block(block: &str) -> (String, String) {
    let mut event = String::new();
    let mut data_lines = Vec::new();
    for line in block.lines() {
        let line = line.trim().trim_end_matches(0x0d as char);
        if let Some(rest) = line.strip_prefix("event:") {
            event = rest.trim_start().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
        }
        // 注释行（":" 开头）与其它字段按规范忽略，但保留在 Raw 中
    }
    (event, data_lines.join("\n"))
}

/// 从单个 SSE data JSON 中提取增量文本（按协议）。返回 None 表示该块没有内容增量。
pub fn extract_stream_delta(protocol: &str, data: &str) -> Option<String> {
    if data == "[DONE]" {
        return None;
    }
    let root: Value = serde_json::from_str(data).ok()?;
    match protocol {
        "openai_chat" => root
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(|c| c.get("delta"))
            .and_then(|d| d.get("content"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        "anthropic_messages" => {
            // content_block_delta.delta.text / thinking
            root.get("delta")
                .and_then(|d| d.get("text").or_else(|| d.get("thinking")))
                .and_then(Value::as_str)
                .map(str::to_owned)
        }
        "openai_responses" => {
            // 事件形如 {"type":"response.output_text.delta","delta":"..."}
            if root.get("type").and_then(Value::as_str) == Some("response.output_text.delta") {
                root.get("delta").and_then(Value::as_str).map(str::to_owned)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// 流式 usage 提取（协议末尾事件常带 usage）。
pub fn extract_stream_usage(protocol: &str, data: &str) -> Option<UsagePreview> {
    let root: Value = serde_json::from_str(data).ok()?;
    match protocol {
        "openai_chat" => {
            let usage = root.get("usage")?;
            Some(UsagePreview {
                input: i64_of(usage, &["prompt_tokens"]),
                output: i64_of(usage, &["completion_tokens"]),
                cache_read: usage
                    .get("prompt_tokens_details")
                    .and_then(|d| d.get("cached_tokens"))
                    .and_then(Value::as_i64),
            })
        }
        "anthropic_messages" => {
            let usage = root.get("usage")?;
            Some(UsagePreview {
                input: i64_of(usage, &["input_tokens"]),
                output: i64_of(usage, &["output_tokens"]),
                cache_read: i64_of(usage, &["cache_read_input_tokens"]),
            })
        }
        "openai_responses" => {
            let usage = root.get("usage")?;
            Some(UsagePreview {
                input: i64_of(usage, &["input_tokens"]),
                output: i64_of(usage, &["output_tokens"]),
                cache_read: usage
                    .get("input_tokens_details")
                    .and_then(|d| d.get("cached_tokens"))
                    .and_then(Value::as_i64),
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_chat_preview() {
        let body = r#"{
          "id":"chatcmpl-1",
          "choices":[{"message":{"role":"assistant","content":"你好","reasoning_content":"想一想"},"finish_reason":"stop"}],
          "usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":2}}
        }"#;
        let p = parse_response("openai_chat", 200, body);
        assert_eq!(p.text, "你好");
        assert_eq!(p.thinking, "想一想");
        assert_eq!(p.finish.as_deref(), Some("stop"));
        assert_eq!(p.usage.as_ref().unwrap().input, Some(10));
        assert_eq!(p.usage.as_ref().unwrap().cache_read, Some(2));
        assert_eq!(p.provider_request_id.as_deref(), Some("chatcmpl-1"));
    }

    #[test]
    fn anthropic_preview_with_tool_use() {
        let body = r#"{
          "id":"msg_1",
          "content":[
            {"type":"text","text":"用工具"},
            {"type":"tool_use","id":"tu_1","name":"get_weather","input":{"city":"北京"}}
          ],
          "stop_reason":"tool_use",
          "usage":{"input_tokens":7,"output_tokens":9}
        }"#;
        let p = parse_response("anthropic_messages", 200, body);
        assert_eq!(p.text, "用工具");
        assert_eq!(p.tool_calls.len(), 1);
        assert_eq!(p.tool_calls[0].name.as_deref(), Some("get_weather"));
        assert_eq!(p.finish.as_deref(), Some("tool_use"));
    }

    #[test]
    fn error_body_is_preserved() {
        let body = r#"{"error":{"message":"bad key","type":"authentication_error"}}"#;
        let p = parse_response("openai_chat", 401, body);
        assert!(p.error.is_some());
        assert!(p.text.is_empty());
    }

    #[test]
    fn sse_parser_handles_split_chunks() {
        let mut parser = SseParser::default();
        let evts = parser.feed("data: {\"a\":1}\n\nda");
        assert_eq!(evts.len(), 1);
        let evts = parser.feed("ta: {\"b\":2}\n\n");
        assert_eq!(evts.len(), 1);
        assert_eq!(evts[0].data, "{\"b\":2}");
    }

    #[test]
    fn sse_parser_keeps_comments_and_event_field() {
        let mut parser = SseParser::default();
        let evts = parser.feed(": ping\n\n event: delta\ndata: hi\n\n");
        assert_eq!(evts.len(), 1);
        assert_eq!(evts[0].event, "delta");
        assert_eq!(evts[0].data, "hi");
    }

    #[test]
    fn stream_delta_per_protocol() {
        let d = extract_stream_delta(
            "openai_chat",
            r#"{"choices":[{"delta":{"content":"hello"}}]}"#,
        );
        assert_eq!(d.as_deref(), Some("hello"));

        let d = extract_stream_delta(
            "anthropic_messages",
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"世界"}}"#,
        );
        assert_eq!(d.as_deref(), Some("世界"));

        let d = extract_stream_delta(
            "openai_responses",
            r#"{"type":"response.output_text.delta","delta":"!"}"#,
        );
        assert_eq!(d.as_deref(), Some("!"));

        assert!(extract_stream_delta("openai_chat", "[DONE]").is_none());
    }
}
