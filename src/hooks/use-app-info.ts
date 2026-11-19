import { useMutation, useQuery } from "@tanstack/react-query";
import { checkForUpdates, getAppInfo, getDatabaseStats } from "@/lib/tauri";
import { installAppUpdate, relaunchApp, type UpdaterProgress } from "@/lib/updater";

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
 * 更新检测：应用启动时挂载即查询 GitHub 最新 Release（staleTime 30 分钟，
 * 侧边栏与设置「关于」共享同一缓存）。
 */
export function useUpdateCheck() {
  return useQuery({
    queryKey: ["update-check"],
    queryFn: checkForUpdates,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

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
