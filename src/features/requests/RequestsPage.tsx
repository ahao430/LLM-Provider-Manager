import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROTOCOL_LABELS, type Protocol, type RequestRecordRow } from "@/lib/tauri";
import { useTestRecords } from "@/features/api-testing/api";

const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  success: "default",
  pending: "secondary",
  http_error: "destructive",
  protocol_error: "destructive",
  stream_error: "destructive",
  storage_error: "destructive",
  failed: "destructive",
};

/** 测试记录列表：工作台 API 请求历史。 */
export function RequestsPage() {
  const navigate = useNavigate();
  const { data: records = [], isLoading, isError, error } = useTestRecords(100);

  return (
    <>
      <PageHeader
        title="测试记录"
        description="工作台测试历史。Raw 是事实记录，Preview 是解释结果；点击行查看完整详情。"
      />
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="text-destructive text-sm">加载失败：{String(error)}</p>
      ) : records.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          暂无测试记录。到 API 测试工作台发送第一条请求。
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>渠道</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>协议</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>TPS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r: RequestRecordRow) => (
                <TableRow
                  key={r.traceId}
                  className="cursor-pointer"
                  onClick={() => navigate(`/requests/${r.traceId}`)}
                >
                  <TableCell className="text-xs whitespace-nowrap">{r.createdAt.slice(0, 19).replace("T", " ")}</TableCell>
                  <TableCell className="text-sm">{r.channelName ?? "—"}</TableCell>
                  <TableCell>
                    <code className="text-xs">{r.model ?? "—"}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {r.protocol ? (PROTOCOL_LABELS[r.protocol as Protocol] ?? r.protocol) : "—"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {r.durationMs != null ? `${r.durationMs} ms` : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {r.inputTokens ?? "—"}/{r.outputTokens ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {r.tokensPerSecond != null ? r.tokensPerSecond.toFixed(1) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
