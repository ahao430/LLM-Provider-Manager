import { useMutation, useQuery } from "@tanstack/react-query";
import { getAppInfo, getDatabaseStats } from "@/lib/tauri";
import {
  checkAppUpdate,
  installAppUpdate,
  relaunchApp,
  type AppUpdateInfo,
  type UpdaterProgress,
} from "@/lib/updater";

/** 应用信息（版本、数据目录）。基本不变，长缓存。 */
export function useAppInfo() {
  return useQuery({
    queryKey: ["app-info"],
    queryFn: getAppInfo,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** 数据库表统计。 */
export function useDatabaseStats() {
  return useQuery({
    queryKey: ["database-stats"],
    queryFn: getDatabaseStats,
    staleTime: 30_000,
  });
}

/**
 * 更新检测：走 updater 清单 latest.json（挂载即查，30 分钟缓存，侧边栏与设置「关于」共享）。
 * null = 已是最新；undefined = 尚未加载。
 */
export function useUpdateCheck() {
  return useQuery({
    queryKey: ["update-check"],
    queryFn: checkAppUpdate,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

export type { AppUpdateInfo };

/**
 * 一键更新（tauri-plugin-updater）：下载 → minisign 验签 → 替换 → 自动重启。
 * onProgress 由调用方传入驱动进度展示；失败（含 Linux deb/rpm 不支持）抛错给调用方提示。
 */
export function useAutoUpdate() {
  return useMutation({
    mutationFn: (onProgress?: (progress: UpdaterProgress) => void) =>
      installAppUpdate(onProgress).then(() => relaunchApp()),
  });
}
