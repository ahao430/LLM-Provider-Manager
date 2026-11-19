import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  deleteMarketSource,
  fetchMarketSource,
  listMarketSources,
  saveMarketSource,
  toggleMarketSource,
  type MarketSourceInput,
} from "@/lib/tauri";

export function useMarketSources() {
  return useQuery({
    queryKey: ["market-sources"],
    queryFn: listMarketSources,
  });
}

export function useSaveMarketSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MarketSourceInput) => saveMarketSource(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["market-sources"] });
    },
  });
}

export function useDeleteMarketSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => deleteMarketSource(sourceId),
    onSuccess: (_, sourceId) => {
      void queryClient.invalidateQueries({ queryKey: ["market-sources"] });
      void queryClient.invalidateQueries({ queryKey: ["market-prices"] });
      void queryClient.removeQueries({ queryKey: ["market-source-fetch", sourceId] });
    },
  });
}

export function useToggleMarketSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, enabled }: { sourceId: string; enabled: boolean }) =>
      toggleMarketSource(sourceId, enabled),
    // 停用 / 启用改变市场快照内容，一并失效
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["market-sources"] });
      void queryClient.invalidateQueries({ queryKey: ["market-prices"] });
    },
  });
}

export function useFetchMarketSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => fetchMarketSource(sourceId),
    onSuccess: (snap) => {
      void queryClient.invalidateQueries({ queryKey: ["market-sources"] });
      void queryClient.invalidateQueries({ queryKey: ["market-prices"] });
      const count = snap.providers.reduce((n, p) => n + p.models.length, 0);
      toast.success(`已抓取：${snap.providers[0]?.name ?? "源"} · ${count} 个模型`);
    },
    onError: (error) => toast.error(`抓取失败：${error}`),
  });
}
