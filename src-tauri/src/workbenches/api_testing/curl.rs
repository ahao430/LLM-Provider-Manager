//! curl 命令生成：把已归档的测试请求重建为可执行的 curl 命令。
//!
//! 安全边界：URL / Header 由 `builder::build` 按当前渠道配置重建（含真实凭证），
//! 凭证只进剪贴板（用户主动操作，与「复制凭证」同一安全级别），不落库、不进日志。
//! 仅支持 API 测试工作台的记录——画图 / 图像理解归档的 body 是摘要或 multipart 二进制，
//! 重建会失真，明确拒绝。

/// 生成单行可执行的 curl 命令（POSIX shell 单引号转义）。
pub fn build_command(url: &str, headers: &[(String, String)], body: &str) -> String {
    let mut cmd = format!("curl -X POST {}", quote(url));
    for (name, value) in headers {
        cmd.push_str(&format!(" -H {}", quote(&format!("{name}: {value}"))));
    }
    if !body.is_empty() {
        cmd.push_str(&format!(" --data {}", quote(body)));
    }
    cmd
}

/// POSIX shell 单引号包裹：' → '\''（单引号内无法直接表示单引号的通用写法）。
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_curl_with_headers_and_body() {
        let cmd = build_command(
            "https://api.example.com/v1/chat/completions",
            &[
                ("Content-Type".to_string(), "application/json".to_string()),
                ("Authorization".to_string(), "Bearer sk-test".to_string()),
            ],
            r#"{"model":"glm-5.2","messages":[]}"#,
        );
        assert!(cmd.starts_with("curl -X POST 'https://api.example.com/v1/chat/completions'"));
        assert!(cmd.contains("-H 'Content-Type: application/json'"));
        assert!(cmd.contains("-H 'Authorization: Bearer sk-test'"));
        assert!(cmd.contains(r#"--data '{"model":"glm-5.2","messages":[]}'"#));
    }

    #[test]
    fn escapes_single_quotes_posix_style() {
        let cmd = build_command("https://api.example.com", &[], "{\"text\":\"it's\"}");
        // ' → '\''：外壳拼接后还原为 it's
        assert!(cmd.contains(r#"--data '{"text":"it'\''s"}'"#));
    }
}
