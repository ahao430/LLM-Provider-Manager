import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { loadSessionState, saveSessionState } from "@/lib/sessionState";
import { Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

/** 测试类型标签：request_type → 展示名（含历史数据兼容；vision 旧记录误标为协议名）。 */
const TYPE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  quick_test: { label: "快速测试", variant: "secondary" },
  api_test: { label: "API 测试", variant: "default" },
  agent_probe: { label: "Agent 测试", variant: "outline" },
  image_generation: { label: "画图", variant: "secondary" },
  image_edit: { label: "画图编辑", variant: "secondary" },
  image_understanding: { label: "图像理解", variant: "outline" },
};

function typeMeta(requestType: string | null) {
  return (
    TYPE_LABELS[requestType ?? ""] ?? {
      label: requestType || "—",
      variant: "outline" as const,
    }
  );
}

/** 类型筛选选项（all = 全部）。 */
type TypeFilter = "all" | keyof typeof TYPE_LABELS;

/** 展示行：普通记录单条；agent 会话（同 sessionId 的多轮探针）聚合为一组。 */
interface DisplayRow {
  key: string;
  records: RequestRecordRow[];
  /** 非空 = Agent 会话组 */
  sessionId: string | null;
}

const sum = (values: (number | null)[]) =>
  values.some((v) => v != null) ? values.reduce<number>((a, v) => a + (v ?? 0), 0) : null;

/** 测试记录列表：工作台请求历史（agent 会话按 sessionId 合并展示；本地分页，最近 1000 条）。 */
export function RequestsPage() {
  const navigate = useNavigate();
  // 后端单次上限 1000：本地分页足够（更早记录可清理或备份）
  const { data: records = [], isLoading, isError, error } = useTestRecords(1000);
  // 会话级状态：进详情再返回时保留页码 / 类型筛选
  const savedUi = loadSessionState("lcm-ui-requests", {
    page: 1,
    pageSize: 20,
    typeFilter: "all" as TypeFilter,
  });
  const [page, setPage] = useState(savedUi.page);
  const [pageSize, setPageSize] = useState(savedUi.pageSize);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(savedUi.typeFilter);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  useEffect(() => {
    saveSessionState("lcm-ui-requests", { page, pageSize, typeFilter });
  }, [page, pageSize, typeFilter]);

  // 类型筛选（记录数少，纯前端过滤；筛选变化回第一页）
  const filteredRecords = useMemo(
    () => (typeFilter === "all" ? records : records.filter((r) => r.requestType === typeFilter)),
    [records, typeFilter]
  );

  // 分组：agent_probe 且 sessionId 非空 → 按会话聚合（records 已按时间倒序，组内首条即最新）
  const displayRows = useMemo<DisplayRow[]>(() => {
    const sessionMap = new Map<string, RequestRecordRow[]>();
    for (const r of filteredRecords) {
      if (r.requestType === "agent_probe" && r.sessionId) {
        const list = sessionMap.get(r.sessionId) ?? [];
        list.push(r);
        sessionMap.set(r.sessionId, list);
      }
    }
    const rows: DisplayRow[] = [];
    const emitted = new Set<string>();
    for (const r of filteredRecords) {
      if (r.requestType === "agent_probe" && r.sessionId && sessionMap.has(r.sessionId)) {
        if (!emitted.has(r.sessionId)) {
          emitted.add(r.sessionId);
          rows.push({ key: `session:${r.sessionId}`, sessionId: r.sessionId, records: sessionMap.get(r.sessionId)! });
        }
      } else {
        rows.push({ key: r.traceId, sessionId: null, records: [r] });
      }
    }
    return rows;
  }, [filteredRecords]);

  const pageCount = Math.max(Math.ceil(displayRows.length / pageSize), 1);
  const safePage = Math.min(page, pageCount);
  const pageRows = displayRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <>
      <PageHeader
        title="测试记录"
        description="工作台测试历史。Raw 是事实记录，Preview 是解释结果；Agent 同一会话的多轮探针合并为一行，点击展开逐轮详情。"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v as TypeFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="quick_test">快速测试</SelectItem>
            <SelectItem value="api_test">API 测试</SelectItem>
            <SelectItem value="agent_probe">Agent 测试</SelectItem>
            <SelectItem value="image_generation">画图</SelectItem>
            <SelectItem value="image_edit">画图编辑</SelectItem>
            <SelectItem value="image_understanding">图像理解</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">
          {displayRows.length} 条记录（共 {records.length} 条）
        </span>
      </div>
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
          暂无测试记录。到测试中心发送第一条请求。
        </div>
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>类型</TableHead>
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
                {pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-muted-foreground py-8 text-center text-sm">
                      没有匹配的记录
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((row) => {
                    const latest = row.records[0];
                    if (row.sessionId) {
                      const expanded = expandedSession === row.sessionId;
                      const agentMeta = typeMeta("agent_probe");
                      return (
                        <Fragment key={row.key}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() => setExpandedSession(expanded ? null : row.sessionId)}
                          >
                            <TableCell className="text-xs whitespace-nowrap">
                              {latest.createdAt.slice(0, 19).replace("T", " ")}
                            </TableCell>
                            <TableCell>
                              <Badge variant={agentMeta.variant}>{agentMeta.label}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{latest.channelName ?? "—"}</TableCell>
                            <TableCell>
                              <code className="text-xs">{latest.model ?? "—"}</code>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="inline-flex items-center gap-1">
                                {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                                会话 · {row.records.length} 轮
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={STATUS_VARIANT[latest.status] ?? "outline"}>{latest.status}</Badge>
                            </TableCell>
                            <TableCell className="tabular-nums text-xs">
                              {sum(row.records.map((r) => r.durationMs)) ?? "—"} ms
                            </TableCell>
                            <TableCell className="tabular-nums text-xs">
                              {sum(row.records.map((r) => r.inputTokens)) ?? "—"}/
                              {sum(row.records.map((r) => r.outputTokens)) ?? "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs">—</TableCell>
                          </TableRow>
                          {expanded
                            ? row.records.map((r, idx) => (
                                <TableRow
                                  key={r.traceId}
                                  className="bg-muted/30 cursor-pointer"
                                  onClick={() => navigate(`/requests/${r.traceId}`)}
                                >
                                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap pl-8">
                                    {r.createdAt.slice(0, 19).replace("T", " ")}
                                  </TableCell>
                                  <TableCell colSpan={4}>
                                    <span className="text-muted-foreground text-xs">
                                      第 {row.records.length - idx} 轮
                                    </span>
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
                                  <TableCell className="text-muted-foreground text-xs">详情 →</TableCell>
                                </TableRow>
                              ))
                            : null}
                        </Fragment>
                      );
                    }
                    const r = latest;
                    const meta = typeMeta(r.requestType);
                    return (
                      <TableRow
                        key={row.key}
                        className="cursor-pointer"
                        onClick={() => navigate(`/requests/${r.traceId}`)}
                      >
                        <TableCell className="text-xs whitespace-nowrap">{r.createdAt.slice(0, 19).replace("T", " ")}</TableCell>
                        <TableCell>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{r.channelName ?? "—"}</TableCell>
                        <TableCell>
                          <code className="text-xs">{r.model ?? "—"}</code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {r.protocol
                              ? (PROTOCOL_LABELS[r.protocol as Protocol] ?? r.protocol)
                              : "—"}
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
                    );
                  })
                )}
              </TableBody>
            </Table>
            <div className="border-t px-3 pb-2">
              <Pagination
                page={safePage}
                pageCount={pageCount}
                pageSize={pageSize}
                total={displayRows.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                unit="条"
              />
            </div>
          </div>
          {records.length >= 1000 ? (
            <p className="text-muted-foreground text-xs">
              仅加载最近 1000 条；更早的记录请在「设置 → 数据」备份或清理。
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
