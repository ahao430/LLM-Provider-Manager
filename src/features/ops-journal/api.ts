import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  addOpsLog,
  addTodo,
  deleteOpsLog,
  deleteTodo,
  listOpsLogs,
  listTodos,
  opsCalendarMonth,
  opsDayItems,
  toggleTodo,
} from "@/lib/tauri";

export function useOpsLogs(limit = 20) {
  return useQuery({
    queryKey: ["ops-logs", limit],
    queryFn: () => listOpsLogs(limit),
  });
}

export function useTodos(includeDone = false) {
  return useQuery({
    queryKey: ["todos", includeDone],
    queryFn: () => listTodos(includeDone),
  });
}

// ------------------------------------------------------------------
// 日历（仪表盘日历卡）：月度聚合 + 当日明细
// ------------------------------------------------------------------

export function useOpsCalendar(year: number, month: number) {
  return useQuery({
    queryKey: ["ops-calendar", year, month],
    queryFn: () => opsCalendarMonth(year, month),
  });
}

export function useOpsDayItems(date: string | null) {
  return useQuery({
    queryKey: ["ops-day", date],
    queryFn: () => opsDayItems(date as string),
    enabled: !!date,
  });
}

/** 日历卡与列表页共用同一份数据，任何增删改都要同时刷新两类缓存。 */
function invalidateJournalCaches(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["ops-logs"] });
  void queryClient.invalidateQueries({ queryKey: ["todos"] });
  void queryClient.invalidateQueries({ queryKey: ["ops-calendar"] });
  void queryClient.invalidateQueries({ queryKey: ["ops-day"] });
  void queryClient.invalidateQueries({ queryKey: ["recent-ops-items"] });
}

export function useAddOpsLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ content, channelId }: { content: string; channelId?: string | null }) =>
      addOpsLog(content, channelId),
    onSuccess: () => invalidateJournalCaches(queryClient),
    onError: (e) => toast.error(`日志保存失败：${e}`),
  });
}

export function useDeleteOpsLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteOpsLog(id),
    onSuccess: () => invalidateJournalCaches(queryClient),
  });
}

export function useAddTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; channelId?: string | null; dueDate?: string | null }) =>
      addTodo(input),
    onSuccess: () => invalidateJournalCaches(queryClient),
    onError: (e) => toast.error(`待办保存失败：${e}`),
  });
}

export function useToggleTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => toggleTodo(id, done),
    onSuccess: () => invalidateJournalCaches(queryClient),
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTodo(id),
    onSuccess: () => invalidateJournalCaches(queryClient),
  });
}
