import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  addOpsLog,
  addTodo,
  deleteOpsLog,
  deleteTodo,
  listOpsLogs,
  listTodos,
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

export function useAddOpsLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ content, channelId }: { content: string; channelId?: string | null }) =>
      addOpsLog(content, channelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-logs"] });
      void queryClient.invalidateQueries({ queryKey: ["recent-ops-items"] });
    },
    onError: (e) => toast.error(`日志保存失败：${e}`),
  });
}

export function useDeleteOpsLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteOpsLog(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ops-logs"] }),
  });
}

export function useAddTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; channelId?: string | null; dueDate?: string | null }) =>
      addTodo(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
      void queryClient.invalidateQueries({ queryKey: ["recent-ops-items"] });
    },
    onError: (e) => toast.error(`待办保存失败：${e}`),
  });
}

export function useToggleTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => toggleTodo(id, done),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTodo(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });
}
