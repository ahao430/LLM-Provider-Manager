import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { ResponseText } from "@/components/ResponseText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { annotationEffective } from "@/lib/annotationPrice";
import {
  listChannelPriceAnnotations,
  PROTOCOL_LABELS,
  type ChannelModelRow,
  type ChannelPriceAnnotation,
  type ChannelRow,
  type Protocol,
  type TestRunResult,
} from "@/lib/tauri";
import { useModelsForTest } from "@/features/api-testing/api";

// ------------------------------------------------------------------
// A/B 腿选择器（渠道 + 模型 + 协议；协议跟随所选模型，可手改）
// ------------------------------------------------------------------

/** 一条 A/B 腿的配置（每腿独立渠道 / 模型 / 协议）。 */
export interface AbLeg {
  channelId: string;
  modelId: string;
  model: string;
  protocol: Protocol;
}

export const EMPTY_LEG: AbLeg = {
  channelId: "",
  modelId: "",
  model: "",
  protocol: "openai_chat",
};

export function AbLegPicker({
  tag,
  leg,
  onChange,
  enabledChannels,
}: {
  /** A / B 标签 */
  tag: string;
  leg: AbLeg;
  onChange: (leg: AbLeg) => void;
  enabledChannels: ChannelRow[];
}) {
  const { data: channelModels = [] } = useModelsForTest(leg.channelId);
  const selected = channelModels.find((m) => m.id === leg.modelId);

  function pickModel(id: string) {
    const m = channelModels.find((x) => x.id === id);
    onChange({
      ...leg,
      modelId: id,
      model: m?.actualModelId ?? leg.model,
      protocol: m?.protocol ?? leg.protocol,
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Badge variant={tag === "A" ? "default" : "secondary"}>腿 {tag}</Badge>
        <span className="text-muted-foreground text-xs">
          {channelName(enabledChannels, leg.channelId) ?? "未选渠道"}
          {selected ? ` · ${selected.actualModelId}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>渠道 *</Label>
          <Select
            value={leg.channelId}
            onValueChange={(v) => onChange({ ...leg, channelId: v, modelId: "", model: "" })}
          >
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
          <Label>模型 *（下拉自动填 ID 与协议）</Label>
          <Select value={leg.modelId} onValueChange={pickModel}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择渠道模型" />
            </SelectTrigger>
            <SelectContent>
              {channelModels.map((m: ChannelModelRow) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.actualModelId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>模型 ID</Label>
          <Input
            value={selected ? selected.actualModelId : leg.model}
            onChange={(e) => onChange({ ...leg, model: e.target.value })}
            placeholder={selected ? "已自动填入" : "手填（未选渠道模型时）"}
          />
        </div>
        <div className="space-y-1.5">
          <Label>协议</Label>
          <Select
            value={leg.protocol}
            onValueChange={(v) => onChange({ ...leg, protocol: v as Protocol })}
          >
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
    </div>
  );
}

function channelName(channels: ChannelRow[], id: string): string | null {
  return channels.find((c) => c.id === id)?.name ?? null;
}

// ------------------------------------------------------------------
// 花费估算（标注价 × usage；估算必须标注 ≈）
// ------------------------------------------------------------------

/** 标注价快照（一次查询全渠道共享）。 */
export function useAbAnnotations() {
  return useQuery({
    queryKey: ["channel-price-annotations"],
    queryFn: listChannelPriceAnnotations,
    staleTime: 60_000,
  });
}

// ------------------------------------------------------------------
// A/B 结果对比
// ------------------------------------------------------------------

export interface AbLegOutcome {
  leg: AbLeg;
  channelName: string | null;
  busy: boolean;
  result: TestRunResult | null;
  error: string | null;
  liveDelta: string;
}

export function AbResultCompare({
  a,
  b,
  stream,
}: {
  a: AbLegOutcome;
  b: AbLegOutcome;
  stream: boolean;
}) {
  const navigate = useNavigate();
  const { data: annotations = [] } = useAbAnnotations();

  const costA = estimateCost(annotations, a);
  const costB = estimateCost(annotations, b);
  const tpsA = approxTps(a.result);
  const tpsB = approxTps(b.result);

  return (
    <div className="space-y-4">
      {/* 指标对比表 */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b text-left text-xs">
              <th className="p-2 font-medium">指标</th>
              <th className="p-2 font-medium">
                A · {a.channelName ?? "—"}
                <span className="text-muted-foreground ml-1">{a.leg.model || "—"}</span>
              </th>
              <th className="p-2 font-medium">
                B · {b.channelName ?? "—"}
                <span className="text-muted-foreground ml-1">{b.leg.model || "—"}</span>
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-b">
              <td className="text-muted-foreground p-2 text-xs">状态</td>
              <td className="p-2"><StatusBadge outcome={a} /></td>
              <td className="p-2"><StatusBadge outcome={b} /></td>
            </tr>
            <MetricRow label="TTFB" a={ms(a.result?.ttfbMs)} b={ms(b.result?.ttfbMs)} lowerWins />
            <MetricRow label="TTFT（首字）" a={ms(a.result?.ttftMs)} b={ms(b.result?.ttftMs)} lowerWins />
            <MetricRow label="总耗时" a={ms(a.result?.durationMs)} b={ms(b.result?.durationMs)} lowerWins />
            <MetricRow
              label="Tokens 入 / 出"
              a={tokens(a.result)}
              b={tokens(b.result)}
            />
            <MetricRow label="≈ TPS（出/耗时）" a={tpsA} b={tpsB} higherWins />
            <MetricRow
              label="≈ 花费（按标注价）"
              a={costA ? `${costA.currency} ${costA.amount.toFixed(6)}` : "—"}
              b={costB ? `${costB.currency} ${costB.amount.toFixed(6)}` : "—"}
              lowerWins
            />
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        ≈ 为估算值（TPS = 输出 token ÷ 总耗时；花费按渠道标注价 × 实际 usage 折算，无标注价显示 —），仅供参考。
      </p>

      {/* 响应文本并排 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LegText title="A" outcome={a} stream={stream} onOpen={(id) => navigate(`/requests/${id}`)} />
        <LegText title="B" outcome={b} stream={stream} onOpen={(id) => navigate(`/requests/${id}`)} />
      </div>
    </div>
  );
}

function StatusBadge({ outcome }: { outcome: AbLegOutcome }) {
  if (outcome.busy) return <Badge variant="outline">请求中…</Badge>;
  if (outcome.error) return <Badge variant="destructive" title={outcome.error}>失败</Badge>;
  if (!outcome.result) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant={outcome.result.status === "success" ? "default" : "destructive"}>
        {outcome.result.status}
      </Badge>
      {outcome.result.httpStatus != null ? (
        <Badge variant="outline">HTTP {outcome.result.httpStatus}</Badge>
      ) : null}
    </span>
  );
}

function MetricRow({
  label,
  a,
  b,
  lowerWins,
  higherWins,
}: {
  label: string;
  a: string;
  b: string;
  lowerWins?: boolean;
  higherWins?: boolean;
}) {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  let aWins = false;
  let bWins = false;
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb && (lowerWins || higherWins)) {
    if (lowerWins) {
      aWins = na < nb;
      bWins = nb < na;
    } else {
      aWins = na > nb;
      bWins = nb > na;
    }
  }
  return (
    <tr className="border-b last:border-0">
      <td className="text-muted-foreground p-2 text-xs">{label}</td>
      <td className={`p-2 ${aWins ? "font-semibold text-green-600" : ""}`}>{a}</td>
      <td className={`p-2 ${bWins ? "font-semibold text-green-600" : ""}`}>{b}</td>
    </tr>
  );
}

function LegText({
  title,
  outcome,
  stream,
  onOpen,
}: {
  title: string;
  outcome: AbLegOutcome;
  stream: boolean;
  onOpen: (traceId: string) => void;
}) {
  const text = outcome.result?.preview.text || (outcome.busy && stream ? outcome.liveDelta : "");
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">腿 {title} 响应</span>
        {outcome.result ? (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onOpen(outcome.result!.traceId)}>
            记录 <ExternalLink className="size-3" />
          </Button>
        ) : null}
      </div>
      {outcome.error ? (
        <pre className="text-destructive max-h-60 overflow-auto text-xs whitespace-pre-wrap">{outcome.error}</pre>
      ) : text ? (
        <ResponseText content={text} maxH="max-h-60" />
      ) : (
        <p className="text-muted-foreground min-h-16 text-xs">
          {outcome.busy ? "等待响应…" : "—"}
        </p>
      )}
    </div>
  );
}

function ms(v: number | null | undefined): string {
  return v != null ? `${v} ms` : "—";
}

function tokens(r: TestRunResult | null): string {
  if (!r?.preview.usage) return "—";
  const u = r.preview.usage;
  return `${u.input ?? "—"} / ${u.output ?? "—"}`;
}

function approxTps(r: TestRunResult | null): string {
  const out = r?.preview.usage?.output;
  const dur = r?.durationMs;
  if (!out || !dur) return "—";
  return ((out / dur) * 1000).toFixed(1);
}

/** 标注价 × usage 的花费估算（无标注价返回 null）。 */
function estimateCost(
  annotations: ChannelPriceAnnotation[],
  outcome: AbLegOutcome,
): { amount: number; currency: string } | null {
  const usage = outcome.result?.preview.usage;
  if (!usage?.input || !usage?.output) return null;
  const ann = annotations.find(
    (a) =>
      a.channelId === outcome.leg.channelId &&
      a.actualModelId.trim().toLowerCase() === outcome.leg.model.trim().toLowerCase(),
  );
  if (!ann) return null;
  const eff = annotationEffective({
    priceInputPer1m: ann.priceInputPer1m,
    priceOutputPer1m: ann.priceOutputPer1m,
    priceCurrency: ann.priceCurrency,
    priceMultiplier: ann.priceMultiplier,
    priceTiers: ann.priceTiers,
    priceOffPeak: ann.priceOffPeak,
  });
  const inCost = (eff.input ?? 0) * (usage.input / 1_000_000);
  const outCost = (eff.output ?? 0) * (usage.output / 1_000_000);
  return { amount: inCost + outCost, currency: ann.priceCurrency };
}
