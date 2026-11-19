//! 应用数据目录解析与目录布局。

use std::fs;
use std::path::Path;

use tauri::{AppHandle, Manager};

use crate::error::AppResult;

/// 数据目录的子目录布局（相对 app-data 根目录）。
const DIR_LAYOUT: &[&str] = &[
    "database",
    "archives/requests",
    "archives/responses",
    "archives/streams",
    "archives/images",
    "agent",
    "backups",
    "logs",
];

/// 解析 Tauri App Data Directory（不写死用户目录）。
pub fn resolve_data_dir(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    Ok(app.path().app_data_dir()?)
}

/// 确保数据目录布局存在（幂等）。
pub fn ensure_layout(data_dir: &Path) -> AppResult<()> {
    for sub in DIR_LAYOUT {
        fs::create_dir_all(data_dir.join(sub))?;
    }
    Ok(())
}

/// 归档子目录（Raw 请求 / 响应 / SSE）。
pub fn archive_requests_dir(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("archives").join("requests")
}

pub fn archive_responses_dir(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("archives").join("responses")
}

/// 把归档文件写入 archives/：先写临时文件再原子重命名（文件归档一致性，PLAN.md）。
pub fn write_archive_atomic(
    dir: &Path,
    file_name: &str,
    contents: &str,
) -> AppResult<std::path::PathBuf> {
    fs::create_dir_all(dir)?;
    let final_path = dir.join(file_name);
    let tmp_path = dir.join(format!(".{file_name}.tmp"));
    fs::write(&tmp_path, contents)?;
    fs::rename(&tmp_path, &final_path)?;
    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_layout_creates_all_directories() {
        let tmp = std::env::temp_dir().join(format!("lcm-test-layout-{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        ensure_layout(&tmp).unwrap();
        for sub in DIR_LAYOUT {
            assert!(tmp.join(sub).is_dir(), "缺少目录: {sub}");
        }
        // 幂等
        ensure_layout(&tmp).unwrap();
        fs::remove_dir_all(&tmp).ok();
    }
}
