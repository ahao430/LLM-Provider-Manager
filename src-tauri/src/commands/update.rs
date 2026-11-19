//! 应用更新：查询 GitHub 最新已发布 Release，与当前版本比较；支持应用内下载
//! 安装包到 `<数据目录>/updates/` 并引导覆盖安装（挂载 dmg / 运行安装器）。
//!
//! 不做静默自动更新（发布流程为草稿 → 人工确认后发布；应用无更新签名配置）。

use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::AppState;

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
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    #[serde(default)]
    browser_download_url: String,
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

// ------------------------------------------------------------------
// 应用内下载与引导安装（v0.18.0）
// ------------------------------------------------------------------

/// 当前平台对应的资产 arch 令牌（tauri-action 命名：aarch64 / x64）。
fn arch_token(arch: &str) -> &'static str {
    match arch {
        "aarch64" => "aarch64",
        "x86_64" => "x64",
        _ => "x64",
    }
}

/// 从资产名列表挑选当前平台安装包（纯函数，按优先级排序）。
/// macOS 取 `*{arch}*.dmg`；Windows 优先 `*-setup.exe`（NSIS），回退 `.msi`；
/// Linux 优先 `.AppImage`，回退 `.deb`；跳过 lcm-mcp 二进制与校验文件。
fn pick_asset_name(names: &[String], os: &str, arch: &str, version: &str) -> Option<String> {
    let version_flat = version.replace('.', "_");
    let arch_tok = arch_token(arch);
    let mut best: Option<(i32, String)> = None;
    for name in names {
        let n = name.to_lowercase();
        // 排除 MCP 二进制与校验/说明文件
        if n.contains("lcm-mcp")
            || n.ends_with(".sig")
            || n.ends_with(".sha256")
            || n.ends_with(".txt")
        {
            continue;
        }
        // 资产名带版本（LCM_0.18.0_aarch64.dmg）；带 v 前缀的旧命名也兼容
        if !n.contains(&version_flat) && !n.contains(version) {
            continue;
        }
        // match guard 形式：guard 不满足时 fall through 到更低的 arm，最终 _ => 0
        // （与 arm 内 if-else 等价，且避免新版 clippy 的 collapsible_match）
        let rank = match os {
            "macos" if n.ends_with(".dmg") && n.contains(arch_tok) => 2,
            "windows" if n.ends_with("-setup.exe") => 3,
            "windows" if n.ends_with(".exe") => 2,
            "windows" if n.ends_with(".msi") => 1,
            "linux" if n.ends_with(".appimage") => 3,
            _ => 0,
        };
        let better = best.as_ref().map(|(b, _)| rank > *b).unwrap_or(true);
        if rank > 0 && better {
            best = Some((rank, name.clone()));
        }
    }
    best.map(|(_, n)| n)
}

/// 更新安装包存放目录。
fn updates_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("updates")
}

/// 应用内下载当前平台的更新安装包到 `<数据目录>/updates/`。
#[tauri::command]
pub async fn download_update(state: State<'_, AppState>) -> AppResult<DownloadedUpdate> {
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

    let latest = release.tag_name.trim().trim_start_matches('v').to_string();
    if !version_gt(&latest, &current) {
        return Err(AppError::Invalid("当前已是最新版本，无需下载".into()));
    }

    let names: Vec<String> = release.assets.iter().map(|a| a.name.clone()).collect();
    let asset_name = pick_asset_name(
        &names,
        std::env::consts::OS,
        std::env::consts::ARCH,
        &latest,
    )
    .ok_or_else(|| {
        AppError::Invalid("该 Release 没有当前平台的安装包资产（可到 Release 页手动下载）".into())
    })?;
    let url = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .map(|a| a.browser_download_url.clone())
        .ok_or_else(|| AppError::Invalid("安装包下载地址缺失".into()))?;

    // 流式下载到 <数据目录>/updates/（安装包可达数十 MB，长超时）
    let dir = updates_dir(&state);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Invalid(format!("创建更新目录失败: {e}")))?;
    let file_path = dir.join(&asset_name);
    let dl_client = reqwest::Client::builder()
        .user_agent(concat!("LCM/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| AppError::Invalid(format!("HTTP 客户端构建失败: {e}")))?;
    let mut resp = dl_client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("下载请求失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "下载返回 HTTP {}",
            resp.status()
        )));
    }
    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| AppError::Invalid(format!("创建安装包文件失败: {e}")))?;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| AppError::Invalid(format!("下载中断: {e}")))?
    {
        file.write_all(&chunk)
            .map_err(|e| AppError::Invalid(format!("写入安装包失败: {e}")))?;
    }
    Ok(DownloadedUpdate {
        file_path: file_path.to_string_lossy().into_owned(),
        file_name: asset_name,
    })
}

/// 引导安装：运行已下载的安装包（覆盖安装）。
/// macOS `open <dmg>` 挂载并弹出 Finder 拖装；Windows 运行 setup/msi；Linux xdg-open。
#[tauri::command]
pub fn install_update(state: State<'_, AppState>, file_path: String) -> AppResult<()> {
    // 安全校验：只允许执行 data_dir/updates 下已下载的安装包
    let dir = updates_dir(&state);
    let path = PathBuf::from(&file_path);
    let dir_canon = dir.canonicalize().ok();
    let path_canon = path
        .canonicalize()
        .map_err(|_| AppError::Invalid("安装包文件不存在（可能已被清理）".into()))?;
    match dir_canon {
        Some(d) if path_canon.starts_with(&d) => {}
        _ => {
            return Err(AppError::Invalid(
                "只允许安装已下载到更新目录内的安装包".into(),
            ))
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_canon)
            .spawn()
            .map_err(|e| AppError::Invalid(format!("启动安装器失败: {e}")))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| AppError::Invalid(format!("启动安装器失败: {e}")))?;
    }
    #[cfg(target_os = "linux")]
    {
        // AppImage 需要可执行位；deb 交给包管理器
        let _ = std::fs::set_permissions(
            &path_canon,
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        );
        std::process::Command::new("xdg-open")
            .arg(&path_canon)
            .spawn()
            .map_err(|e| AppError::Invalid(format!("启动安装器失败: {e}")))?;
    }
    Ok(())
}

/// 下载结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdate {
    /// 安装包绝对路径（data_dir/updates 下）
    pub file_path: String,
    pub file_name: String,
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

    #[test]
    fn asset_picking() {
        let names: Vec<String> = [
            "LCM_0.18.0_aarch64.dmg",
            "LCM_0.18.0_x64.dmg",
            "LCM_0.18.0_x64-setup.exe",
            "LCM_0.18.0_x64_en-US.msi",
            "LCM_0.18.0_amd64.AppImage",
            "lcm-mcp-aarch64-apple-darwin",
            "lcm-mcp-x86_64-pc-windows-msvc.exe",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        // macOS arm64
        assert_eq!(
            pick_asset_name(&names, "macos", "aarch64", "0.18.0").as_deref(),
            Some("LCM_0.18.0_aarch64.dmg")
        );
        // macOS x64
        assert_eq!(
            pick_asset_name(&names, "macos", "x86_64", "0.18.0").as_deref(),
            Some("LCM_0.18.0_x64.dmg")
        );
        // Windows 优先 NSIS setup.exe
        assert_eq!(
            pick_asset_name(&names, "windows", "x86_64", "0.18.0").as_deref(),
            Some("LCM_0.18.0_x64-setup.exe")
        );
        // Linux AppImage
        assert_eq!(
            pick_asset_name(&names, "linux", "x86_64", "0.18.0").as_deref(),
            Some("LCM_0.18.0_amd64.AppImage")
        );
        // 找不到时返回 None
        assert_eq!(pick_asset_name(&names, "ios", "aarch64", "0.18.0"), None);
    }
}
