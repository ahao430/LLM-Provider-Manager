import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkForUpdates, downloadUpdate, getAppInfo, getDatabaseStats, installUpdate, type DownloadedUpdate } from "@/lib/tauri";

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

/** 下载更新安装包到数据目录 updates/。 */
export function useDownloadUpdate() {
  return useMutation({ mutationFn: () => downloadUpdate() });
}

/** 运行已下载的安装包（覆盖安装）。 */
export function useInstallUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filePath: string) => installUpdate(filePath),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["update-check"] }),
  });
}

export type { DownloadedUpdate };

