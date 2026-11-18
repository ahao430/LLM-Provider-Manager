import { useQuery } from "@tanstack/react-query";
import { getAppInfo, getDatabaseStats } from "@/lib/tauri";

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
