//! MCP 输出统一二次脱敏（v0.18.0 安全加固）。
//!
//! 白名单序列化已确保凭证字段（凭证值、余额查询配置、凭证文件）不进入任何工具输出；
//! 本模块是对「自由文本」的兜底：notes / 错误消息 / 事件描述 / Raw 归档原文里
//! 若出现令牌样式的字符串（sk- / LTAI / AKLT / Bearer / 带 key 的 query 参数），
//! 一律掩码后再返回，保证令牌与百炼 AccessKey/AccessSecret 不出现在 MCP 回答中。

/// 掩码一个令牌样式片段（保留前 3 字符便于人工比对）。
fn mask_token(tok: &str) -> String {
    let prefix: String = tok.chars().take(3).collect();
    format!("{prefix}***（已脱敏）")
}

/// 对任意文本做令牌样式脱敏（对非匹配内容原样保留）。
pub fn redact_text(input: &str) -> String {
    let mut out = input.to_owned();
    // 常见令牌前缀：OpenAI 风格 sk-、阿里云 AccessKeyId LTAI、火山 AKLT
    out = redact_prefix(&out, "sk-", 8, true);
    out = redact_prefix(&out, "LTAI", 8, false);
    out = redact_prefix(&out, "AKLT", 8, false);
    // Bearer <长串>
    out = redact_bearer(&out);
    // URL query 中的敏感参数值：?key=…&api_key=…&token=…&access_key=…&secret=…&signature=…&access_token=…
    out = redact_query_values(&out);
    out
}

/// 掩码 `prefix + [A-Za-z0-9_-]{min}…` 形态的令牌。
fn redact_prefix(text: &str, prefix: &str, min: usize, allow_underscore_dash: bool) -> String {
    let mut result = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let plen = prefix.len();
    let mut i = 0usize;
    while i < text.len() {
        if i + plen <= text.len() && text.is_char_boundary(i + plen) && &text[i..i + plen] == prefix
        {
            // 前缀必须是词边界（前面不能是字母数字）
            let boundary_ok = i == 0
                || !bytes[i - 1].is_ascii_alphanumeric()
                    && bytes[i - 1] != b'_'
                    && bytes[i - 1] != b'-';
            if boundary_ok {
                let mut j = i + plen;
                while j < text.len() {
                    let b = bytes[j];
                    let ok = b.is_ascii_alphanumeric()
                        || (allow_underscore_dash && (b == b'_' || b == b'-'));
                    if !ok {
                        break;
                    }
                    j += 1;
                }
                if j - (i + plen) >= min {
                    let tok = &text[i..j];
                    result.push_str(&mask_token(tok));
                    i = j;
                    continue;
                }
            }
        }
        // 非前缀位置：逐字符复制（多字节 UTF-8 安全：仅按字节比较 ASCII 前缀，
        // 中文等多字节字符不会匹配 sk-/LTAI/AKLT 等 ASCII 前缀，直接进入 else 复制）
        let ch_len = utf8_char_len(bytes[i]);
        result.push_str(&text[i..i + ch_len]);
        i += ch_len;
    }
    result
}

/// 掩码 `Bearer <token>`（token 为 10+ 位字母数字._-）。
fn redact_bearer(text: &str) -> String {
    let lower = text.to_lowercase();
    let needle = "bearer ";
    let mut result = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut copied = 0usize;
    while let Some(pos) = lower[copied..].find(needle) {
        let abs = copied + pos;
        // 复制匹配点之前的内容
        result.push_str(&text[copied..abs]);
        // token 主体
        let mut j = abs + needle.len();
        while j < text.len() {
            let b = bytes[j];
            if !(b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-') {
                break;
            }
            j += 1;
        }
        if j - (abs + needle.len()) >= 10 {
            result.push_str("Bearer ");
            result.push_str(&mask_token(&text[abs + needle.len()..j]));
            copied = j;
        } else {
            // 非令牌（如 "Bearer" 单词）原样保留，继续向后找
            result.push_str(&text[abs..abs + needle.len()]);
            copied = abs + needle.len();
        }
    }
    result.push_str(&text[copied..]);
    result
}

/// 掩码 URL query 中的敏感参数值（key/token/api_key/access_key/secret/signature/access_token）。
fn redact_query_values(text: &str) -> String {
    let keys = [
        "key=",
        "token=",
        "api_key=",
        "access_key=",
        "secret=",
        "signature=",
        "access_token=",
    ];
    let mut result = String::from(text);
    // 简化实现：对每个 key 逐个处理（值终止于 & 引号或空白）
    for k in keys {
        let mut search_from = 0usize;
        loop {
            let lower_now = result.to_lowercase();
            let Some(pos) = lower_now[search_from..].find(k) else {
                break;
            };
            let abs = search_from + pos;
            let value_start = abs + k.len();
            let bytes = result.as_bytes();
            let mut j = value_start;
            while j < bytes.len() {
                let b = bytes[j];
                if b == b'&' || b == b'"' || b.is_ascii_whitespace() {
                    break;
                }
                j += 1;
            }
            if j > value_start {
                let replacement = format!("{}***（已脱敏）", &result[abs..value_start]);
                result.replace_range(abs..j, &replacement);
                search_from = abs + replacement.len();
            } else {
                search_from = value_start;
            }
        }
    }
    result
}

/// UTF-8 首字节 → 字符长度（多字节字符按整体复制，避免切半个字符）。
fn utf8_char_len(first_byte: u8) -> usize {
    match first_byte {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_token_shapes() {
        let text = "key is sk-abcdefghijklmnop1234 and AK/SK: LTAI5tAbcDefGhiJklm and AKLTxxxxxxxx12345678 and Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxx.yyy";
        let out = redact_text(text);
        assert!(out.contains("sk-***（已脱敏）"), "sk- 应被掩: {out}");
        assert!(out.contains("LTA***（已脱敏）"), "LTAI 应被掩: {out}");
        assert!(out.contains("AKL***（已脱敏）"), "AKLT 应被掩: {out}");
        assert!(
            out.contains("Bearer eyJ***（已脱敏）"),
            "Bearer 应被掩: {out}"
        );
        assert!(!out.contains("abcdefghijklmnop1234"));
        assert!(!out.contains("LTAI5tAbcDefGhiJklm"));
    }

    #[test]
    fn redacts_sensitive_query_values() {
        let text = "https://api.example.com/v1/models?api_key=sk-real-secret-123&page=2&token=abcdef123456789";
        let out = redact_text(text);
        assert!(out.contains("api_key=***（已脱敏）"));
        assert!(out.contains("token=***（已脱敏）"));
        assert!(out.contains("page=2"), "普通参数不应被掩");
    }

    #[test]
    fn keeps_plain_text_intact() {
        let text = "普通中文说明与 localhost:8080/path，sketch 一词不应被掩。";
        let out = redact_text(text);
        assert_eq!(out, text);
        // 词边界：task-12345678 不应以 sk- 形态被掩（前面是字母）
        let out2 = redact_text("task-12345678 fine");
        assert_eq!(out2, "task-12345678 fine");
    }

    #[test]
    fn utf8_safe_redaction() {
        let text = "渠道备注：密钥 sk-abcdef12345678，请勿外泄";
        let out = redact_text(text);
        assert!(out.contains("sk-***（已脱敏）"));
        assert!(out.contains("渠道备注"));
    }
}
