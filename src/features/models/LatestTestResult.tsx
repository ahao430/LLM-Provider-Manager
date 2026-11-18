import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { listLatestModelTests, type LatestModelTestRow } from "@/lib/tauri";

/**
 * (渠道ID, 模型ID) → 最近一次测试 的查询与映射。
 * ModelTestButton 测试完成后会失效 ["latest-model-tests"]，本映射随之自动刷新。
 */
export function useLatestModelTestMap(): Map<string, LatestModelTestRow> {
  const { data: latestTests = [] } = useQuery({
    queryKey: ["latest-model-tests"],
    queryFn: listLatestModelTests,
  });
  return useMemo(() => {
    const map = new Map<string, LatestModelTestRow>();
    for (const t of latestTests) {
      map.set(`${t.channelId}|${t.model.trim().toLowerCase()}`, t);
    }
    return map;
  }, [latestTests]);
}

const STATUS_LABELS: Record<string, string> = {
  success: "成功",
  http_error: "HTTP 错误",
  protocol_error: "协议错误",
  stream_error: "流中断",
};

/**
 * 最近一次模型测试结果的行内展示：状态 / 首字 / 总耗时 / 失败摘要 / 时间，
 * 点击跳转对应测试记录。未测试时显示「未测试」。
 */
export function LatestTestResult({
  latest,
  showTime = true,
}: {
  latest: LatestModelTestRow | null | undefined;
  /** 是否显示测试时间（紧凑行可关闭） */
  showTime?: boolean;
}) {
  const navigate = useNavigate();

  if (!latest) {
    return <span className="text-muted-foreground text-xs">未测试</span>;
  }
  const ok = latest.status === "success";
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
      title={`打开测试记录 ${latest.traceId}`}
      onClick={() => navigate(`/requests/${latest.traceId}`)}
    >
      <Badge variant={ok ? "default" : "destructive"} className="px-1.5 py-0 text-[9px]">
        {STATUS_LABELS[latest.status] ?? latest.status}
      </Badge>
      <span className="tabular-nums">{fmtTiming(latest)}</span>
      {!ok && latest.errorMessage ? (
        <span className="text-destructive max-w-56 truncate" title={latest.errorMessage}>
          {latest.errorMessage}
        </span>
      ) : null}
      {showTime ? (
        <span className="text-muted-foreground tabular-nums">
          {latest.createdAt.slice(5, 16).replace("T", " ")}
        </span>
      ) : null}
    </button>
  );
}

/** 首字时间 + 总耗时（有则拼接，皆无显示 —）。 */
function fmtTiming(latest: LatestModelTestRow): string {
  const parts: string[] = [];
  if (latest.ttftMs !== null) parts.push(`首字 ${latest.ttftMs}ms`);
  if (latest.durationMs !== null) parts.push(`${latest.durationMs}ms`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
