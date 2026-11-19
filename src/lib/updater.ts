//! 应用内一键更新（tauri-plugin-updater）：下载 → minisign 验签 → 替换 → 自动重启。
//!
//! 与 tauri.ts 的 checkForUpdates（GitHub API 检测，提供 Release 页链接与说明）分工：
//! 检测展示走 GitHub API；实际下载安装走本模块的 updater 插件（latest.json + 签名校验）。
//! Linux 上仅 AppImage 安装支持（deb / rpm 由包管理器负责，此处会报错并引导走下载页）。

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Release 页（「打开下载页」入口；不依赖 GitHub API，无匿名限额问题）。 */
const RELEASE_PAGE = "https://github.com/ahao430/LLM-Provider-Manager/releases/latest";

/**
 * 更新检测（走 updater 清单 latest.json —— release 资产下载，不占 api.github.com
 * 匿名限额；清单由 Release workflow 随版本自动上传）。null = 已是最新。
 */
export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  publishedAt: string | null;
  notes: string | null;
  releaseUrl: string;
}

export async function checkAppUpdate(): Promise<AppUpdateInfo | null> {
  const update = await check();
  if (!update) return null;
  return {
    currentVersion: update.currentVersion,
    latestVersion: update.version,
    publishedAt: update.date ?? null,
    notes: update.body ?? null,
    releaseUrl: RELEASE_PAGE,
  };
}

/** 下载进度（字节；total 为 null 时服务器未返回 Content-Length）。 */
export interface UpdaterProgress {
  downloaded: number;
  total: number | null;
}

/**
 * 下载并安装当前可用的更新（内部先 check 拿到更新对象）。
 * onProgress 以字节流回调（Started 携带总大小，Progress 累计增量）。
 * 安装完成后**不自动重启**，由调用方决定时机（统一走 relaunchApp）。
 * 无可用更新 / latest.json 不可达 / 平台不支持时抛错。
 */
export async function installAppUpdate(
  onProgress?: (progress: UpdaterProgress) => void
): Promise<void> {
  const update = await check();
  if (!update) {
    throw new Error("当前已是最新版本（更新清单无更高版本）");
  }
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.({ downloaded, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        onProgress?.({ downloaded, total });
        break;
    }
  });
}

/** 更新安装完成后重启应用（替换已就位，重启即新版本）。 */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}
