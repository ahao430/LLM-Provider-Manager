import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addModelPrice,
  createChannel,
  createChannelGroup,
  createGlobalModel,
  deleteChannel,
  deleteChannelGroup,
  deleteChannelModel,
  deleteGlobalModel,
  deleteModelPrice,
  fetchChannelModelList,
  getChannel,
  getEffectivePrice,
  getProviderTemplates,
  importChannelModels,
  launchAgent,
  listAgentCompat,
  listAgentLaunches,
  listChannels,
  listChannelGroups,
  listChannelModels,
  listGlobalModels,
  listModelPrices,
  createIncident,
  listIncidents,
  listProviders,
  renameChannelGroup,
  resolveIncident,
  saveChannelOps,
  setChannelDashboardPinned,
  setChannelEnabled,
  setChannelOpsStatus,
  updateChannel,
  upsertAgentCompat,
  upsertChannelModel,
  type AddPriceInput,
  type AgentCompatStatus,
  type ChannelInput,
  type ChannelModelInput,
  type ChannelOps,
  type ChannelOpsStatus,
  type ImportItem,
} from "@/lib/tauri";

export const channelKeys = {
  all: ["channels"] as const,
  detail: (id: string) => ["channel", id] as const,
  compat: (id: string) => ["channel", id, "compat"] as const,
};

export const groupKeys = {
  all: ["channel-groups"] as const,
};

// ------------------------------------------------------------------
// 分组与仪表盘置顶（v0.17.0）
// ------------------------------------------------------------------

export function useChannelGroups() {
  return useQuery({ queryKey: groupKeys.all, queryFn: listChannelGroups });
}

export function useCreateChannelGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createChannelGroup(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
}

export function useRenameChannelGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameChannelGroup(id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: groupKeys.all });
      void queryClient.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useDeleteChannelGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChannelGroup(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: groupKeys.all });
      void queryClient.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useSetChannelPinned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      setChannelDashboardPinned(id, pinned),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export const launchKeys = {
  all: ["agent-launches"] as const,
};

export function useChannels() {
  return useQuery({ queryKey: channelKeys.all, queryFn: listChannels });
}

export function useChannel(id: string) {
  return useQuery({ queryKey: channelKeys.detail(id), queryFn: () => getChannel(id) });
}

export function useProviders() {
  return useQuery({ queryKey: ["providers"], queryFn: listProviders, staleTime: Infinity });
}

export function useProviderTemplates() {
  return useQuery({
    queryKey: ["provider-templates"],
    queryFn: getProviderTemplates,
    staleTime: Infinity,
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChannelInput) => createChannel(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useUpdateChannel(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChannelInput) => updateChannel(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.all });
      void queryClient.invalidateQueries({ queryKey: channelKeys.detail(id) });
    },
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChannel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useSetChannelEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setChannelEnabled(id, enabled),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.all });
      void queryClient.invalidateQueries({ queryKey: channelKeys.detail(id) });
    },
  });
}

export function useAgentCompat(channelId: string) {
  return useQuery({
    queryKey: channelKeys.compat(channelId),
    queryFn: () => listAgentCompat(channelId),
  });
}

export function useUpsertAgentCompat(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agent,
      status,
      evidence,
      notes,
    }: {
      agent: string;
      status: AgentCompatStatus;
      evidence: string | null;
      notes: string | null;
    }) => upsertAgentCompat(channelId, agent, status, evidence, notes),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: channelKeys.compat(channelId) }),
  });
}

export function useAgentLaunches(limit = 50) {
  return useQuery({
    queryKey: [...launchKeys.all, limit],
    queryFn: () => listAgentLaunches(limit),
  });
}

export function useLaunchAgent(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { agentType: "claude_code_cli" | "codex_cli"; model: string | null; workingDirectory: string }) =>
      launchAgent({ channelId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: launchKeys.all }),
  });
}

// ------------------------------------------------------------------
// 模型与价格（Phase 2）
// ------------------------------------------------------------------

const modelKeys = {
  global: ["global-models"] as const,
  channel: (channelId: string) => ["channel-models", channelId] as const,
  prices: (channelModelId: string) => ["model-prices", channelModelId] as const,
  effective: (channelModelId: string) => ["effective-price", channelModelId] as const,
};

function invalidateModels(queryClient: ReturnType<typeof useQueryClient>, channelId: string) {
  void queryClient.invalidateQueries({ queryKey: modelKeys.channel(channelId) });
  void queryClient.invalidateQueries({ queryKey: modelKeys.global });
}

export function useGlobalModels() {
  return useQuery({ queryKey: modelKeys.global, queryFn: listGlobalModels });
}

export function useCreateGlobalModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, family }: { name: string; family: string | null }) =>
      createGlobalModel(name, family),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: modelKeys.global }),
  });
}

export function useDeleteGlobalModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteGlobalModel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: modelKeys.global }),
  });
}

export function useChannelModels(channelId: string) {
  return useQuery({
    queryKey: modelKeys.channel(channelId),
    queryFn: () => listChannelModels(channelId),
    enabled: channelId !== "",
  });
}

export function useUpsertChannelModel(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChannelModelInput) => upsertChannelModel(input),
    onSuccess: () => invalidateModels(queryClient, channelId),
  });
}

export function useDeleteChannelModel(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChannelModel(id),
    onSuccess: () => invalidateModels(queryClient, channelId),
  });
}

export function useFetchModelList(channelId: string) {
  return useMutation({ mutationFn: () => fetchChannelModelList(channelId) });
}

export function useImportModels(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ items }: { items: ImportItem[] }) => importChannelModels(channelId, items),
    onSuccess: () => invalidateModels(queryClient, channelId),
  });
}

export function useModelPrices(channelModelId: string) {
  return useQuery({
    queryKey: modelKeys.prices(channelModelId),
    queryFn: () => listModelPrices(channelModelId),
    enabled: channelModelId !== "",
  });
}

export function useEffectivePrice(channelModelId: string) {
  return useQuery({
    queryKey: modelKeys.effective(channelModelId),
    queryFn: () => getEffectivePrice(channelModelId),
    enabled: channelModelId !== "",
  });
}

export function useAddModelPrice(channelModelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddPriceInput) => addModelPrice(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: modelKeys.prices(channelModelId) });
      void queryClient.invalidateQueries({ queryKey: modelKeys.effective(channelModelId) });
    },
  });
}

export function useDeleteModelPrice(channelModelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteModelPrice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: modelKeys.prices(channelModelId) });
      void queryClient.invalidateQueries({ queryKey: modelKeys.effective(channelModelId) });
    },
  });
}

// ------------------------------------------------------------------
// 渠道运维（v0.33.0：健康状态 / 运维档案 / 故障事件）
// ------------------------------------------------------------------

export function useSetChannelOpsStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ChannelOpsStatus }) =>
      setChannelOpsStatus(id, status),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.all });
      void queryClient.invalidateQueries({ queryKey: channelKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
}

export function useSaveChannelOps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ops }: { id: string; ops: ChannelOps }) => saveChannelOps(id, ops),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.detail(id) });
    },
  });
}

export function useIncidents(channelId?: string) {
  return useQuery({
    queryKey: ["incidents", channelId ?? "all"],
    queryFn: () => listIncidents(channelId),
  });
}

export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; title: string; traceIds: string[]; rootCause?: string | null }) =>
      createIncident(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incidents"] });
      void queryClient.invalidateQueries({ queryKey: ["test-records"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
}

export function useResolveIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rootCause }: { id: string; rootCause?: string | null }) =>
      resolveIncident(id, rootCause),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incidents"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
}
