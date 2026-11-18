//! 通用小工具。

/// 当前时间的 RFC 3339（UTC）字符串，作为统一的 created_at / updated_at 值。
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 校验 Base URL：必须是 http(s) 开头且包含主机部分。
pub fn is_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

/// 共享 HTTP 客户端。TLS 默认启用证书验证，仅用户显式关闭时放宽。
pub fn http_client(timeout_secs: u64, tls_verify: bool) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs.min(600)))
        .user_agent(concat!("LCM/", env!("CARGO_PKG_VERSION")));
    if !tls_verify {
        builder = builder.danger_accept_invalid_certs(true);
    }
    builder
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败: {e}"))
}

#[cfg(test)]
mod tests {}
