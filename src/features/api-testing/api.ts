import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDashboardStats,
  getTestRaw,
  getTestRecord,
  listChannels,
  listChannelModels,
  listTestRecords,
  reparseTestResponse,
  replayTestRequest,
  sendTestRequest,
  sendTestStream,
  type ApiTestMessagePayload,
  type ApiTestStreamEvent,
  type ApiTestRequestPayload,
  type ChannelRow,
  type RequestRecordRow,
  type ResponsePreview,
} from "@/lib/tauri";

export function useChannelsForTest() {
  return useQuery({ queryKey: ["channels"], queryFn: listChannels, staleTime: 10_000 });
}

export function useModelsForTest(channelId: string) {
  return useQuery({
    queryKey: ["channel-models", channelId],
    queryFn: () => listChannelModels(channelId),
    enabled: channelId !== "",
  });
}

export function useSendTest(channelId: string, onStreamDelta?: (event: ApiTestStreamEvent) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: Omit<ApiTestRequestPayload, "channelId">) => {
      const payload: ApiTestRequestPayload = { ...req, channelId };
      if (!payload.stream) {
        return sendTestRequest(payload);
      }
      return sendTestStream(payload, onStreamDelta);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["test-records"] }),
  });
}

export function useTestRecords(limit = 100) {
  return useQuery({
    queryKey: ["test-records", limit],
    queryFn: () => listTestRecords(limit),
  });
}

export function useTestRecord(traceId: string) {
  return useQuery({
    queryKey: ["test-record", traceId],
    queryFn: () => getTestRecord(traceId),
    enabled: traceId !== "",
  });
}

export function useTestRaw(traceId: string, kind: "request" | "response" | null) {
  return useQuery({
    queryKey: ["test-raw", traceId, kind],
    queryFn: () => getTestRaw(traceId, kind as "request" | "response"),
    enabled: traceId !== "" && kind != null,
    staleTime: Infinity,
  });
}

export function useReparse(traceId: string) {
  return useMutation({
    mutationFn: () => reparseTestResponse(traceId),
  });
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
    staleTime: 15_000,
  });
}

export function useReplayRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (traceId: string) => replayTestRequest(traceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["test-records"] }),
  });
}

export type { ChannelRow, RequestRecordRow, ResponsePreview, ApiTestMessagePayload };
