//! 应用更新检测：查询 GitHub 最新已发布 Release，与当前版本比较。
//!
//! 应用内一键更新（下载 → minisign 验签 → 替换 → 自动重启）由 tauri-plugin-updater
//! 承担（最新清单 latest.json，见 tauri.conf.json plugins.updater）。本模块只做
//! GitHub API 检测：提供版本号 / 发布时间 / 更新说明 / Release 页链接，兼作
//! latest.json 不可用（如旧版本升级路径、清单异常）时的降级检测与「打开下载页」入口。

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const RELEASES_API: &str =
    "https://api.github.com/repos/ahao430/LLM-Provider-Manager/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// 当前应用版本
    pub current: String,
    /// 最新已发布版本（去 v 前缀）；None = 尚无已发布 Release
    pub latest_version: Option<String>,
    pub latest_tag: Option<String>,
    /// Release 页面（跳转下载）
    pub release_url: Option<String>,
    pub published_at: Option<String>,
    /// 更新说明（Release body，可能为空）
    pub notes: Option<String>,
    pub has_update: bool,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates() -> AppResult<UpdateCheck> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent(concat!("LCM/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Invalid(format!("HTTP 客户端构建失败: {e}")))?;
    let resp = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("访问 GitHub API 失败（需联网）: {e}")))?;

    // /releases/latest 不返回草稿；404 = 尚无已发布版本
    if resp.status().as_u16() == 404 {
        return Ok(UpdateCheck {
            current,
            latest_version: None,
            latest_tag: None,
            release_url: None,
            published_at: None,
            notes: None,
            has_update: false,
        });
    }
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "GitHub API 返回 HTTP {}",
            resp.status()
        )));
    }
    let release: GithubRelease = resp
        .json()
        .await
        .map_err(|e| AppError::Invalid(format!("Release 响应解析失败: {e}")))?;

    let latest_version = release.tag_name.trim().trim_start_matches('v').to_string();
    let has_update = version_gt(&latest_version, &current);
    Ok(UpdateCheck {
        current,
        has_update,
        latest_version: Some(latest_version),
        latest_tag: Some(release.tag_name),
        release_url: if release.html_url.is_empty() {
            None
        } else {
            Some(release.html_url)
        },
        published_at: release.published_at,
        notes: release
            .body
            .map(|b| b.trim().to_string())
            .filter(|b| !b.is_empty()),
    })
}

/// a > b 按数值段比较（"0.12.1" > "0.12.0"；解析失败的段按 0；忽略 -rc 等后缀）。
fn version_gt(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> {
        s.split('-')
            .next()
            .unwrap_or(s)
            .split('.')
            .map(|p| p.parse().unwrap_or(0))
            .collect()
    };
    let (va, vb) = (parse(a), parse(b));
    for i in 0..va.len().max(vb.len()) {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_comparison() {
        assert!(version_gt("0.12.1", "0.12.0"));
        assert!(version_gt("0.13.0", "0.12.99"));
        assert!(version_gt("1.0.0", "0.99.99"));
        assert!(version_gt("0.12.0.1", "0.12.0"));
        assert!(!version_gt("0.12", "0.12.0"));
        assert!(!version_gt("0.12.0-rc1", "0.12.0"));
    }
}
