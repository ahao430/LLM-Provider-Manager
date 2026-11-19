import type { ChannelRow } from "@/lib/tauri";

/** 渠道运维状态的展示元数据（suspect 为前端推导态，不落库）。 */
export const OPS_STATUS_META: Record<
  string,
  { label: string; badge: "default" | "secondary" | "destructive" | "outline"; dot: string }
> = {
  normal: { label: "正常", badge: "outline", dot: "bg-green-500" },
  suspect: { label: "疑似异常", badge: "secondary", dot: "bg-yellow-500" },
  fault: { label: "故障", badge: "destructive", dot: "bg-red-500" },
  maintenance: { label: "维护中", badge: "secondary", dot: "bg-blue-500" },
  deprecated: { label: "已弃用", badge: "outline", dot: "bg-gray-400" },
};

/**
 * 渠道展示状态：落库的 ops_status 优先；normal 且「已测模型最近一次全部非成功」时
 * 前端推导为 suspect（疑似异常，事实与推测分开——不写库、不改 enabled）。
 */
export function channelDisplayStatus(
  row: Pick<ChannelRow, "id" | "opsStatus">,
  latestTestStatus?: string | null,
): { status: string; meta: (typeof OPS_STATUS_META)[string] } {
  if (row.opsStatus !== "normal") {
    return { status: row.opsStatus, meta: OPS_STATUS_META[row.opsStatus] ?? OPS_STATUS_META.normal };
  }
  if (latestTestStatus && latestTestStatus !== "success") {
    return { status: "suspect", meta: OPS_STATUS_META.suspect };
  }
  return { status: "normal", meta: OPS_STATUS_META.normal };
}
