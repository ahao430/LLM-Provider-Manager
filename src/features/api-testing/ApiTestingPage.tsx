import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Send, Settings2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { ResponseText } from "@/components/ResponseText";
import { loadSessionState, saveSessionState } from "@/lib/sessionState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  PROTOCOL_LABELS,
  sendTestRequest,
  sendTestStream,
  setRecordsSession,
  type ApiTestStreamEvent,
  type ApiTestRequestPayload,
  type Protocol,
  type TestRunResult,
} from "@/lib/tauri";
import { useChannelsForTest, useModelsForTest, useSendTest } from "@/features/api-testing/api";
import {
  AbLegPicker,
  AbResultCompare,
  EMPTY_LEG,
  type AbLeg,
  type AbLegOutcome,
} from "@/features/api-testing/AbCompare";

/** API 测试工作台：单轮请求（下拉选模型自动填 ID），Raw / 流式 / 时间线全记录。 */
export function ApiTestingPage() {
  const { data: channels = [] } = useChannelsForTest();
  const enabledChannels = channels.filter((c) => c.enabled);

  // 会话级表单快照：进测试记录再返回时恢复（结果/流式状态不恢复，属临时态）
  const savedUi = loadSessionState("lcm-ui-api-test", {
    channelId: "",
    modelId: "",
    model: "",
    protocol: "openai_chat" as Protocol,
    message: "",
    system: "",
    stream: true,
    temperature: "",
    topP: "",
    maxTokens: "",
    stop: "",
    rawJsonMode: false,
    rawJson: "",
    abMode: false,
    legA: null,
    legB: null,
  });

  const [channelId, setChannelId] = useState(savedUi.channelId);
  const [modelId, setModelId] = useState(savedUi.modelId);
  const { data: channelModels = [] } = useModelsForTest(channelId);
  const selectedModel = channelModels.find((m) => m.id === modelId);

  // 模型 ID 自动填入（从渠道模型选择后）
  const [model, setModel] = useState(savedUi.model);
  const [protocol, setProtocol] = useState<Protocol>(savedUi.protocol);

  function pickModel(id: string) {
    setModelId(id);
    const m = channelModels.find((x) => x.id === id);
    if (m) {
      setModel(m.actualModelId);
      setProtocol(m.protocol);
    }
  }

  const [message, setMessage] = useState(savedUi.message);
  const [system, setSystem] = useState(savedUi.system);
  // 默认勾选流式（用户要求）：流式才能测出真实首字时间
  const [stream, setStream] = useState(savedUi.stream);
  const [showParams, setShowParams] = useState(false);
  const [temperature, setTemperature] = useState(savedUi.temperature);
  const [topP, setTopP] = useState(savedUi.topP);
  const [maxTokens, setMaxTokens] = useState(savedUi.maxTokens);
  const [stop, setStop] = useState(savedUi.stop);
  const [rawJsonMode, setRawJsonMode] = useState(savedUi.rawJsonMode);
  const [rawJson, setRawJson] = useState(savedUi.rawJson);

  const [liveDelta, setLiveDelta] = useState("");
  const [liveRaw, setLiveRaw] = useState<string[]>([]);
  const [result, setResult] = useState<TestRunResult | null>(null);
  const resultRef = useRef<TestRunResult | null>(null);

  // A/B 对比模式：双腿独立渠道/模型/协议，其余请求参数共享
  const [abMode, setAbMode] = useState(savedUi.abMode);
  const [legA, setLegA] = useState<AbLeg>(savedUi.legA ?? EMPTY_LEG);
  const [legB, setLegB] = useState<AbLeg>(savedUi.legB ?? EMPTY_LEG);
  const [abA, setAbA] = useState<AbLegOutcome>({ leg: legA, channelName: null, busy: false, result: null, error: null, liveDelta: "" });
  const [abB, setAbB] = useState<AbLegOutcome>({ leg: legB, channelName: null, busy: false, result: null, error: null, liveDelta: "" });
  const [abBusy, setAbBusy] = useState(false);

  // 表单快照写入（结果与流式增量不持久化）
  useEffect(() => {
    saveSessionState("lcm-ui-api-test", {
      channelId, modelId, model, protocol, message, system, stream,
      temperature, topP, maxTokens, stop, rawJsonMode, rawJson,
      abMode, legA, legB,
    });
  }, [channelId, modelId, model, protocol, message, system, stream, temperature, topP, maxTokens, stop, rawJsonMode, rawJson, abMode, legA, legB]);

  const sendMutation = useSendTest(channelId, (event: ApiTestStreamEvent) => {
    if (event.type === "delta") {
      setLiveDelta((prev) => prev + event.delta);
      setLiveRaw((prev) => [...prev, event.rawBlock]);
    } else if (event.type === "status") {
      toast.info(event.message);
    }
  });

  async function handleSend() {
    if (!channelId) {
      toast.error("请先选择渠道");
      return;
    }
    if (!rawJsonMode && !message.trim()) {
      toast.error("请输入消息内容");
      return;
    }
    setLiveDelta("");
    setLiveRaw([]);
    resultRef.current = null;
    try {
      const runResult = await sendMutation.mutateAsync({
        channelModelId: modelId || null,
        model: model.trim() || (rawJsonMode ? "(raw)" : ""),
        protocol,
        stream,
        system: system.trim() || null,
        messages: rawJsonMode
          ? []
          : [{ role: "user", content: message.trim() }],
        params: {
          temperature: temperature.trim() ? Number(temperature) : null,
          topP: topP.trim() ? Number(topP) : null,
          maxTokens: maxTokens.trim() ? Number(maxTokens) : null,
          stop: stop.trim()
            ? stop.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        },
        extraBody: null,
        customHeaders: [],
        customQuery: [],
        rawJson: rawJsonMode && rawJson.trim() ? safeJson(rawJson) : null,
      });
      resultRef.current = runResult;
      setResult(runResult);
      if (runResult.status === "success") {
        toast.success(`请求完成（${runResult.traceId.slice(0, 8)}…）`);
      } else {
        toast.warning(`请求结束：${runResult.status}`);
      }
    } catch (error) {
      toast.error(`请求失败：${error}`);
    }
  }

  // A/B 共享参数 → 各腿 payload（model/protocol/channelId 各腿独立；raw 模式不适用于 A/B）
  function abPayload(leg: AbLeg, shared: {
    stream: boolean; system: string; message: string;
    temperature: string; topP: string; maxTokens: string; stop: string;
  }): Omit<ApiTestRequestPayload, "channelId"> {
    return {
      channelModelId: leg.modelId || null,
      model: leg.model.trim() || "",
      protocol: leg.protocol,
      stream: shared.stream,
      system: shared.system.trim() || null,
      messages: [{ role: "user", content: shared.message.trim() }],
      params: {
        temperature: shared.temperature.trim() ? Number(shared.temperature) : null,
        topP: shared.topP.trim() ? Number(shared.topP) : null,
        maxTokens: shared.maxTokens.trim() ? Number(shared.maxTokens) : null,
        stop: shared.stop.trim()
          ? shared.stop.split(",").map((x) => x.trim()).filter(Boolean)
          : [],
      },
      extraBody: null,
      customHeaders: [],
      customQuery: [],
      rawJson: null,
    };
  }

  async function handleSendAb() {
    const shared = { stream, system, message, temperature, topP, maxTokens, stop };
    for (const [tag, leg] of [["A", legA], ["B", legB]] as const) {
      if (!leg.channelId) {
        toast.error(`腿 ${tag}：请先选择渠道`);
        return;
      }
      if (!message.trim()) {
        toast.error("请输入消息内容（A/B 两腿共享）");
        return;
      }
      if (!leg.model.trim()) {
        toast.error(`腿 ${tag}：请选择或填写模型`);
        return;
      }
    }
    const uuid = crypto.randomUUID();
    const nameOf = (id: string) => enabledChannels.find((c) => c.id === id)?.name ?? null;
    setAbBusy(true);
    setAbA({ leg: legA, channelName: nameOf(legA.channelId), busy: true, result: null, error: null, liveDelta: "" });
    setAbB({ leg: legB, channelName: nameOf(legB.channelId), busy: true, result: null, error: null, liveDelta: "" });

    const runLeg = async (
      leg: AbLeg,
      onDelta: (d: string) => void,
    ): Promise<TestRunResult> => {
      const payload: ApiTestRequestPayload = { ...abPayload(leg, shared), channelId: leg.channelId };
      if (shared.stream) {
        return sendTestStream(payload, (event: ApiTestStreamEvent) => {
          if (event.type === "delta") onDelta(event.delta);
        });
      }
      return sendTestRequest(payload);
    };

    const [ra, rb] = await Promise.allSettled([
      runLeg(legA, (d) => setAbA((p) => ({ ...p, liveDelta: p.liveDelta + d }))),
      runLeg(legB, (d) => setAbB((p) => ({ ...p, liveDelta: p.liveDelta + d }))),
    ]);

    const toOutcome = (
      r: PromiseSettledResult<TestRunResult>,
      prev: AbLegOutcome,
    ): AbLegOutcome => ({
      ...prev,
      busy: false,
      result: r.status === "fulfilled" ? r.value : prev.result,
      error: r.status === "rejected" ? String(r.reason) : null,
    });
    setAbA((p) => toOutcome(ra, p));
    setAbB((p) => toOutcome(rb, p));
    setAbBusy(false);

    const ok = [ra, rb].filter((r) => r.status === "fulfilled");
    const ids = ok.map((r) => (r as PromiseFulfilledResult<TestRunResult>).value.traceId);
    if (ids.length >= 2) {
      try {
        await setRecordsSession(ids, uuid);
      } catch {
        toast.info("对比记录已生成，但会话关联失败（可在记录详情手动查看）");
      }
    }
    if (ok.length === 2) {
      toast.success("A/B 两腿均已完成");
    } else if (ok.length === 1) {
      toast.warning("A/B 一腿完成，另一腿失败（详见对比卡片）");
    } else {
      toast.error("A/B 两腿均失败");
    }
  }

  return (
    <>
      <PageHeader
        title="API 测试工作台"
        description="单轮请求：下拉选模型，ID 自动填入。请求体、响应、处理过程完整记录。"
        actions={
          <>
            <label className="mr-2 flex items-center gap-2 text-sm">
              <Switch checked={abMode} onCheckedChange={setAbMode} />
              A/B 对比
            </label>
            {abMode ? (
              <Button onClick={handleSendAb} disabled={abBusy}>
                <Send className="size-4" />
                {abBusy ? "A/B 发送中…" : stream ? "同时发送（流式）" : "同时发送 A/B"}
              </Button>
            ) : (
              <Button onClick={handleSend} disabled={sendMutation.isPending || !channelId}>
                <Send className="size-4" />
                {sendMutation.isPending ? "发送中…" : stream ? "发送（流式）" : "发送"}
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>请求配置</CardTitle>
            <CardDescription>认证与地址按协议自动处理（渠道三协议 URL）。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {abMode ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <AbLegPicker tag="A" leg={legA} onChange={setLegA} enabledChannels={enabledChannels} />
                <AbLegPicker tag="B" leg={legB} onChange={setLegB} enabledChannels={enabledChannels} />
              </div>
            ) : (
              <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>渠道 *</Label>
                <Select value={channelId} onValueChange={(v) => { setChannelId(v); setModelId(""); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择渠道" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledChannels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {!c.hasPrimaryCredential ? (
                          <span className="text-muted-foreground">（未配置凭证）</span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>模型 *（下拉选自动填 ID）</Label>
                <Select value={modelId} onValueChange={pickModel}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择渠道模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {channelModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.actualModelId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>模型 ID</Label>
                <Input
                  value={selectedModel ? selectedModel.actualModelId : model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={selectedModel ? "已自动填入" : "手填（未选渠道模型时）"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>协议</Label>
                <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROTOCOL_LABELS) as Protocol[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROTOCOL_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
              </>
            )}

            {!rawJsonMode ? (
              <>
                <div className="space-y-1.5">
                  <Label>消息内容 *</Label>
                  <Textarea
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="要发送给模型的消息（单轮）…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>System Prompt（可选）</Label>
                  <Textarea
                    rows={2}
                    value={system}
                    onChange={(e) => setSystem(e.target.value)}
                    placeholder="系统提示词"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label>Raw JSON（请求体原样发送）</Label>
                <Textarea
                  rows={8}
                  className="font-mono text-xs"
                  value={rawJson}
                  onChange={(e) => setRawJson(e.target.value)}
                  placeholder='{"model":"...","messages":[...]}'
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={stream} onCheckedChange={setStream} />
                流式（SSE）
              </label>
              <label
                className="flex items-center gap-2 text-sm"
                title={abMode ? "A/B 对比模式使用共享消息内容，不适用 Raw JSON" : undefined}
              >
                <Switch checked={rawJsonMode} onCheckedChange={setRawJsonMode} disabled={abMode} />
                Raw JSON 模式
              </label>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
                onClick={() => setShowParams(!showParams)}
              >
                <Settings2 className="size-4" />
                参数
              </button>
            </div>

            {showParams ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>temperature</Label>
                  <Input type="number" step="any" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="默认" />
                </div>
                <div className="space-y-1.5">
                  <Label>top_p</Label>
                  <Input type="number" step="any" value={topP} onChange={(e) => setTopP(e.target.value)} placeholder="默认" />
                </div>
                <div className="space-y-1.5">
                  <Label>max_tokens</Label>
                  <Input type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="默认" />
                </div>
                <div className="space-y-1.5">
                  <Label>stop（逗号分隔）</Label>
                  <Input value={stop} onChange={(e) => setStop(e.target.value)} />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>响应</CardTitle>
            <CardDescription>
              {stream ? "流式增量实时显示；完整 SSE 原文已归档。" : "原始响应完整归档，Preview 只是解释。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {abMode ? (
              <AbResultCompare a={abA} b={abB} stream={stream} />
            ) : sendMutation.isPending && stream ? (
              <div className="min-h-48 whitespace-pre-wrap rounded-lg border p-3 text-sm">
                {liveDelta || <span className="text-muted-foreground">等待首 Token…</span>}
              </div>
            ) : result ? (
              <ResultPanel result={result} liveRaw={liveRaw} stream={stream} />
            ) : (
              <div className="text-muted-foreground flex min-h-48 items-center justify-center rounded-lg border border-dashed text-sm">
                配置请求后点击「发送」
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    toast.error(`Raw JSON 解析失败：${error}`);
    return null;
  }
}

function ResultPanel({
  result,
  liveRaw,
  stream,
}: {
  result: TestRunResult;
  liveRaw: string[];
  stream: boolean;
}) {
  const navigate = useNavigate();
  const { preview } = result;
  return (
    <Tabs defaultValue="preview">
      <TabsList>
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        {stream ? <TabsTrigger value="rawsse">SSE 块</TabsTrigger> : null}
      </TabsList>

      <TabsContent value="preview" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={result.status === "success" ? "default" : "destructive"}>{result.status}</Badge>
          {result.httpStatus != null ? <Badge variant="outline">HTTP {result.httpStatus}</Badge> : null}
          <Badge variant="outline" className="tabular-nums">
            首字 {result.ttftMs != null ? `${result.ttftMs} ms` : "—"}
          </Badge>
          <Badge variant="outline" className="tabular-nums">
            耗时 {result.durationMs != null ? `${result.durationMs} ms` : "—"}
          </Badge>
          {preview.providerRequestId ? (
            <span className="text-muted-foreground font-mono">request_id: {preview.providerRequestId}</span>
          ) : null}
        </div>
        {preview.thinking ? (
          <div>
            <div className="text-muted-foreground mb-1 text-xs font-medium">思考</div>
            <pre className="bg-muted/50 max-h-40 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{preview.thinking}</pre>
          </div>
        ) : null}
        {preview.text ? (
          <div>
            <div className="text-muted-foreground mb-1 text-xs font-medium">文本</div>
            <ResponseText content={preview.text} maxH="max-h-72" />
          </div>
        ) : null}
        {preview.toolCalls.length > 0 ? (
          <div>
            <div className="text-muted-foreground mb-1 text-xs font-medium">Tool Calls</div>
            <pre className="bg-muted/50 overflow-auto rounded-md p-3 text-xs">{JSON.stringify(preview.toolCalls, null, 2)}</pre>
          </div>
        ) : null}
        {preview.error ? (
          <div>
            <div className="text-destructive mb-1 text-xs font-medium">错误（原始对象）</div>
            <pre className="text-destructive max-h-48 overflow-auto rounded-md border p-3 text-xs">{JSON.stringify(preview.error, null, 2)}</pre>
          </div>
        ) : null}
        {preview.usage ? (
          <div className="text-muted-foreground text-xs">
            Tokens：输入 {preview.usage.input ?? "—"} / 输出 {preview.usage.output ?? "—"}
            {preview.usage.cacheRead != null ? ` / 缓存读 ${preview.usage.cacheRead}` : ""}
          </div>
        ) : null}
        <Button variant="link" size="sm" className="px-0" onClick={() => navigate(`/requests/${result.traceId}`)}>
          查看完整记录（Raw / 处理过程）→
        </Button>
      </TabsContent>

      <TabsContent value="timeline">
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">TTFB</dt>
            <dd className="font-medium tabular-nums">{result.ttfbMs != null ? `${result.ttfbMs} ms` : "—"}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">TTFT</dt>
            <dd className="font-medium tabular-nums">{result.ttftMs != null ? `${result.ttftMs} ms` : "—"}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">总耗时</dt>
            <dd className="font-medium tabular-nums">{result.durationMs != null ? `${result.durationMs} ms` : "—"}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">TPS（流式）</dt>
            <dd className="font-medium tabular-nums">
              {result.tokensPerSecond != null ? result.tokensPerSecond.toFixed(1) : "—"}
            </dd>
          </div>
        </dl>
      </TabsContent>

      {stream ? (
        <TabsContent value="rawsse">
          <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs">{liveRaw.join("\n\n") || "（无）"}</pre>
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
