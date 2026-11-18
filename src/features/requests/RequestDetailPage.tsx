import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Terminal } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copyTestCurl, diagnoseRequest, type Diagnosis } from "@/lib/tauri";
import { useReparse, useTestRaw, useTestRecord, useReplayRequest } from "@/features/api-testing/api";

/** 测试详情：Overview / Request Raw / Response Raw / Timeline / Processing。 */
export function RequestDetailPage() {
  const { traceId = "" } = useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useTestRecord(traceId);
  const reparse = useReparse(traceId);
  const replay = useReplayRequest();
  const [rawKind, setRawKind] = useState<"request" | "response">("response");
  const rawQuery = useTestRaw(traceId, rawKind);
  const [reparseResult, setReparseResult] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="space-y-4">
        <p className="text-destructive text-sm">加载失败：{String(error)}</p>
        <Button variant="outline" onClick={() => navigate("/requests")}>
          <ArrowLeft className="size-4" />返回列表
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={`测试 ${traceId.slice(0, 8)}…`}
        description={`${detail.channelName ?? "未知渠道"} · ${detail.model ?? "—"} · ${detail.protocol ?? "—"}`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await copyTestCurl(traceId);
                  toast.success("curl 命令已复制（含真实凭证，仅进剪贴板）");
                } catch (err) {
                  toast.error(`复制 curl 失败：${err}`);
                }
              }}
              title="以 curl 格式复制请求（Header 按当前渠道凭证重建）"
            >
              <Terminal className="size-4" />
              复制 curl
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const res = await replay.mutateAsync(traceId);
                  toast.success(`已重放，新 Trace：${res.traceId.slice(0, 8)}…（状态 ${res.status}）`);
                  navigate(`/requests/${res.traceId}`);
                } catch (err) {
                  toast.error(`重放失败：${err}`);
                }
              }}
              disabled={replay.isPending}
            >
              <RefreshCw className="size-4" />
              {replay.isPending ? "重放中…" : "重放请求"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/requests")}>
              <ArrowLeft className="size-4" />返回
            </Button>
          </>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
          <TabsTrigger value="processing">Processing</TabsTrigger>
          <TabsTrigger value="reparse">重新解析</TabsTrigger>
          <TabsTrigger value="diagnosis">错误诊断</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Badge variant={detail.status === "success" ? "default" : "destructive"}>{detail.status}</Badge>
                {detail.httpStatus != null ? <Badge variant="outline">HTTP {detail.httpStatus}</Badge> : null}
                {detail.parentTraceId ? <Badge variant="secondary">重放自 {detail.parentTraceId.slice(0, 8)}…</Badge> : null}
              </CardTitle>
              <CardDescription>耗时指标（未产生首 Token 时 TTFT 为空而非 0）。</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                <Metric label="TTFB" value={detail.ttfbMs != null ? `${detail.ttfbMs} ms` : "—"} />
                <Metric label="TTFT" value={detail.ttftMs != null ? `${detail.ttftMs} ms` : "—"} />
                <Metric label="总耗时" value={detail.durationMs != null ? `${detail.durationMs} ms` : "—"} />
                <Metric label="TPS" value={detail.tokensPerSecond != null ? detail.tokensPerSecond.toFixed(1) : "—"} />
                <Metric label="输入 Tokens" value={detail.inputTokens ?? "—"} />
                <Metric label="输出 Tokens" value={detail.outputTokens ?? "—"} />
                <Metric label="缓存 Tokens" value={detail.cacheTokens ?? "—"} />
                <Metric label="Request ID" value={detail.providerRequestId ?? "—"} />
                <Metric label="错误码" value={detail.errorCode ?? "—"} />
                <Metric label="创建时间" value={detail.createdAt} />
                <Metric label="完成时间" value={detail.completedAt ?? "—"} />
                <Metric label="Raw 文件" value={`${detail.requestRef ?? "—"} / ${detail.responseRef ?? "—"}`} />
              </dl>
              {detail.errorMessage ? (
                <p className="text-destructive mt-3 text-xs">{detail.errorMessage}</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-base">Raw 归档原文</CardTitle>
                <CardDescription>事实记录：脱敏 Header 后的完整归档。</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant={rawKind === "request" ? "default" : "outline"} onClick={() => setRawKind("request")}>
                  请求
                </Button>
                <Button size="sm" variant={rawKind === "response" ? "default" : "outline"} onClick={() => setRawKind("response")}>
                  响应
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {rawQuery.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : rawQuery.isError ? (
                <p className="text-destructive text-sm">{String(rawQuery.error)}</p>
              ) : (
                <pre className="max-h-[28rem] overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
                  {rawQuery.data}
                </pre>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="processing">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">处理过程（ProcessingEvent）</CardTitle>
              <CardDescription>工具每一步处理如实记录；changed=true 表示改变了请求/响应语义。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.processingEvents.map((e) => (
                <div key={e.eventId} className="flex items-start gap-3 rounded-md border p-2.5 text-xs">
                  <Badge variant={e.status === "ok" ? "secondary" : e.status === "failed" ? "destructive" : "outline"}>
                    {e.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono">{e.stage} / {e.operation}</div>
                    {e.description ? <div className="text-muted-foreground mt-0.5">{e.description}</div> : null}
                  </div>
                  <span className="text-muted-foreground whitespace-nowrap">{e.createdAt.slice(11, 19)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reparse">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                历史重新解析
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const preview = await reparse.mutateAsync();
                      setReparseResult(JSON.stringify(preview, null, 2));
                    } catch (err) {
                      setReparseResult(`重新解析失败：${err}`);
                    }
                  }}
                  disabled={reparse.isPending}
                >
                  <RefreshCw className="size-4" />
                  {reparse.isPending ? "解析中…" : "用当前解析器重新解析"}
                </Button>
              </CardTitle>
              <CardDescription>
                使用当前版本解析器对已归档 Raw 重新提取 Preview；不覆盖原始数据。原始响应文件永久保留。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reparseResult ? (
                <pre className="max-h-96 overflow-auto rounded-md border p-3 text-xs">{reparseResult}</pre>
              ) : (
                <p className="text-muted-foreground text-sm">点击按钮开始。</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnosis">
          <DiagnosisCard traceId={traceId} hasError={Boolean(detail.errorCode || detail.errorMessage)} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** 诊断卡片：知识库匹配结果，事实与建议分开、置信度明确（只读，不自动执行建议）。 */
function DiagnosisCard({ traceId, hasError }: { traceId: string; hasError: boolean }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["diagnosis", traceId],
    queryFn: () => diagnoseRequest(traceId),
  });

  const CONFIDENCE_VARIANT: Record<Diagnosis["confidence"], "default" | "secondary" | "outline"> = {
    confirmed: "default",
    probable: "secondary",
    unknown: "outline",
  };
  const CONFIDENCE_LABELS: Record<Diagnosis["confidence"], string> = {
    confirmed: "确认（错误码精确命中）",
    probable: "可能（状态 / 关键词命中）",
    unknown: "证据不足",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">错误诊断（知识库）</CardTitle>
        <CardDescription>
          事实与建议分开、置信度明确；诊断只读，LCM 不会自动执行任何建议。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <p className="text-destructive text-sm">诊断失败：{String(error)}</p>
        ) : (
          data ? (
            <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={CONFIDENCE_VARIANT[data.confidence]}>
                {CONFIDENCE_LABELS[data.confidence]}
              </Badge>
              {data.matched ? (
                <>
                  <Badge variant="outline">{data.matched.errorType}</Badge>
                  <span className="text-sm font-medium">{data.matched.title}</span>
                </>
              ) : null}
            </div>
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground text-xs">事实</p>
              <p className="text-xs">{data.evidence}</p>
              {data.matched ? <p className="mt-1 text-xs">{data.matched.facts}</p> : null}
            </div>
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground text-xs">建议（推测性内容，仅供参考）</p>
              <p className="text-xs">{data.advice}</p>
            </div>
            {data.failedEvents.length > 0 ? (
              <div>
                <p className="text-muted-foreground mb-1 text-xs">失败的处理事件</p>
                <ul className="space-y-0.5 text-xs">
                  {data.failedEvents.map((e, i) => (
                    <li key={i} className="font-mono">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!hasError ? (
              <p className="text-muted-foreground text-xs">该请求无错误记录；以上为通用状态。</p>
              ) : null}
            </>
          ) : null
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs break-all">{value ?? "—"}</dd>
    </div>
  );
}
