import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock,
  CloudDownload,
  Layers,
  Plus,
  Rocket,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { ModelTestButton } from "@/features/models/ModelTestButton";
import { LatestTestResult, useLatestModelTestMap } from "@/features/models/LatestTestResult";
import { MarketPriceRefDialog } from "@/features/channels/MarketPriceRefDialog";
import { annotationEffective, annotationTooltip, type PriceOffPeak, type PriceTier } from "@/lib/annotationPrice";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  defaultModelTypeFor,
  defaultProtocolFor,
  PROTOCOL_LABELS,
  quickTestChannel,
  type ChannelModelRow,
  type ModelType,
  type Protocol,
  type QuickTestResult,
  type RemoteModel,
} from "@/lib/tauri";
import {
  useChannelModels,
  useCreateGlobalModel,
  useDeleteChannelModel,
  useFetchModelList,
  useGlobalModels,
  useImportModels,
  useUpsertChannelModel,
} from "@/features/channels/api";

/** 渠道详情页「模型」Tab：获取 / 导入（多选 + 类型标记）/ 手动添加 / 快速测试。 */
export function ModelsTab({ channelId }: { channelId: string }) {
  const [manageOpen, setManageOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [quickTestOpen, setQuickTestOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setManageOpen(true)}>
          <CloudDownload className="size-4" />
          模型管理
        </Button>
        <Button variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          手动添加
        </Button>
        <Button variant="outline" onClick={() => setQuickTestOpen(true)}>
          <Rocket className="size-4" />
          快速测试
        </Button>
      </div>
      <ChannelModelsList channelId={channelId} />

      {manageOpen ? <ModelManageDialog channelId={channelId} onClose={() => setManageOpen(false)} /> : null}
      {addOpen ? <ModelAddDialog channelId={channelId} onClose={() => setAddOpen(false)} /> : null}
      {quickTestOpen ? <QuickTestDialog channelId={channelId} onClose={() => setQuickTestOpen(false)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------
// 模型列表（类型标记 + 行内编辑）
// ------------------------------------------------------------------

const TYPE_VARIANT: Record<ModelType, "default" | "secondary" | "outline" | "destructive"> = {
  multimodal: "default",
  image: "secondary",
  text: "outline",
  decision: "destructive",
};
const TYPE_LABEL: Record<ModelType, string> = {
  multimodal: "多模态",
  image: "图像",
  text: "文本",
  decision: "决策",
};

function ChannelModelsList({ channelId }: { channelId: string }) {
  const { data: models = [], isLoading } = useChannelModels(channelId);
  const upsert = useUpsertChannelModel(channelId);
  const deleteModel = useDeleteChannelModel(channelId);
  // 最近一次测试结果：行内「测试」按钮完成后自动失效刷新
  const latestMap = useLatestModelTestMap();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [priceEdit, setPriceEdit] = useState<ChannelModelRow | null>(null);

  const sorted = useMemo(
    () => [...models].sort((a, b) => a.actualModelId.localeCompare(b.actualModelId)),
    [models]
  );

  async function changeType(row: ChannelModelRow, modelType: ModelType) {
    try {
      await upsert.mutateAsync({
        id: row.id,
        channelId,
        modelId: row.modelId,
        actualModelId: row.actualModelId,
        protocol: row.protocol,
        modelType,
        notes: row.notes,
        enabled: row.enabled,
        // 标注价整行覆盖保存：改类型时回传现有值
        priceInputPer1m: row.priceInputPer1m,
        priceOutputPer1m: row.priceOutputPer1m,
        priceCurrency: row.priceCurrency || null,
        priceMultiplier: row.priceMultiplier,
        priceTiers: row.priceTiers,
        priceOffPeak: row.priceOffPeak,
      });
      toast.success(`${row.actualModelId} 类型已标记为「${TYPE_LABEL[modelType]}」`);
    } catch (error) {
      toast.error(`更新失败：${error}`);
    }
  }

  async function changeProtocol(row: ChannelModelRow, protocol: Protocol) {
    try {
      await upsert.mutateAsync({
        id: row.id,
        channelId,
        modelId: row.modelId,
        actualModelId: row.actualModelId,
        protocol,
        modelType: row.modelType,
        notes: row.notes,
        enabled: row.enabled,
        priceInputPer1m: row.priceInputPer1m,
        priceOutputPer1m: row.priceOutputPer1m,
        priceCurrency: row.priceCurrency || null,
        priceMultiplier: row.priceMultiplier,
        priceTiers: row.priceTiers,
        priceOffPeak: row.priceOffPeak,
      });
      toast.success(
        `${row.actualModelId} 接口类型已改为「${PROTOCOL_LABELS[protocol]}」，测试将按此调用`
      );
    } catch (error) {
      toast.error(`更新失败：${error}`);
    }
  }

  async function toggleEnabled(row: ChannelModelRow, enabled: boolean) {
    try {
      await upsert.mutateAsync({
        id: row.id,
        channelId,
        modelId: row.modelId,
        actualModelId: row.actualModelId,
        protocol: row.protocol,
        modelType: row.modelType,
        notes: row.notes,
        enabled,
        priceInputPer1m: row.priceInputPer1m,
        priceOutputPer1m: row.priceOutputPer1m,
        priceCurrency: row.priceCurrency || null,
        priceMultiplier: row.priceMultiplier,
        priceTiers: row.priceTiers,
        priceOffPeak: row.priceOffPeak,
      });
    } catch (error) {
      toast.error(`更新失败：${error}`);
    }
  }

  async function handleDelete(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      window.setTimeout(() => setConfirmDelete(null), 4000);
      return;
    }
    try {
      await deleteModel.mutateAsync(id);
      toast.success("渠道模型已删除");
      setConfirmDelete(null);
    } catch (error) {
      toast.error(`删除失败：${error}`);
    }
  }

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="rounded-xl border p-4 space-y-1">
      <div className="text-sm font-medium">渠道模型（{models.length}）</div>
      <p className="text-muted-foreground text-xs">
        类型默认按模型名称推断（图像 / 多模态命名规则），可随时手动修改。
      </p>
      {sorted.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          暂无模型，点击「模型管理」获取导入。
        </p>
      ) : (
        sorted.map((m) => (
          <div key={m.id} className="rounded-lg border">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                className="text-muted-foreground shrink-0"
                onClick={() => setExpanded(expanded === m.id ? null : m.id)}
              >
                {expanded === m.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="truncate text-xs font-medium">{m.actualModelId}</code>
                  <Badge variant={TYPE_VARIANT[m.modelType]} className="text-[10px]">
                    {TYPE_LABEL[m.modelType]}
                  </Badge>
                  {!m.enabled ? <Badge variant="secondary">已禁用</Badge> : null}
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                  <span
                    className="truncate"
                    title={m.priceCurrency ? annotationTooltip(m) || undefined : undefined}
                  >
                    {m.modelName ?? "未绑定全局模型"} · {PROTOCOL_LABELS[m.protocol] ?? m.protocol}
                    {m.priceCurrency ? <AnnotatedPriceSpan row={m} /> : null}
                  </span>
                  <LatestTestResult
                    latest={latestMap.get(`${channelId}|${m.actualModelId.trim().toLowerCase()}`)}
                  />
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="标注价格（仅展示比较，不算费用）"
                className={m.priceCurrency ? "text-primary" : undefined}
                onClick={() => setPriceEdit(m)}
              >
                <CircleDollarSign className="size-4" />
              </Button>
              <Select
                value={m.protocol}
                onValueChange={(v) => changeProtocol(m, v as Protocol)}
              >
                <SelectTrigger className="h-7 w-28 text-xs" title="接口类型（测试按此调用）">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROTOCOL_LABELS) as Protocol[]).map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      {PROTOCOL_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={m.modelType} onValueChange={(v) => changeType(m, v as ModelType)}>
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["multimodal", "image", "text", "decision"] as ModelType[]).map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Switch checked={m.enabled} onCheckedChange={(v) => toggleEnabled(m, v)} />
              <ModelTestButton
                channelId={channelId}
                actualModelId={m.actualModelId}
                protocol={m.protocol}
              />
              <Button variant="ghost" size="icon" title="删除" onClick={() => handleDelete(m.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            {expanded === m.id && m.notes ? (
              <div className="bg-muted/40 border-t px-4 py-2 text-xs">{m.notes}</div>
            ) : null}
          </div>
        ))
      )}
      {priceEdit ? (
        <PriceAnnotationDialog
          channelId={channelId}
          row={priceEdit}
          onClose={() => setPriceEdit(null)}
        />
      ) : null}
    </div>
  );
}

function fmtAnnotation(v: number | null): string {
  return v === null ? "—" : String(Number(v.toFixed(4)));
}

/** 行内标注价（实际价 = 原价 × 倍率）；阶梯 / 低谷 / 倍率≠1 时附标记，明细见悬浮。 */
function AnnotatedPriceSpan({ row }: { row: ChannelModelRow }) {
  const eff = annotationEffective(row);
  const marks: string[] = [];
  if (row.priceMultiplier !== 1) marks.push(`×${row.priceMultiplier}`);
  if (eff.hasTiers) marks.push("阶梯");
  if (eff.hasOffPeak) marks.push("分时段");
  return (
    <span className="text-foreground/80">
      {" "}· 标注 {row.priceCurrency} {fmtAnnotation(eff.input)} / {fmtAnnotation(eff.output)} 每百万
      {marks.length > 0 ? (
        <Badge variant="secondary" className="ml-1 px-1 py-0 text-[9px]">
          {marks.join(" · ")}
        </Badge>
      ) : null}
    </span>
  );
}

// ------------------------------------------------------------------
// 标注价格弹窗：与市场价统一格式（单一 / 阶梯 / 分时段）+ 倍率 + 市场价参考
// 仅展示比较，不参与费用估算
// ------------------------------------------------------------------

/** 阶梯编辑行（字符串便于输入框受控编辑）。 */
interface TierRow {
  upTo: string;
  input: string;
  output: string;
}

/** 低谷编辑行。 */
interface OffPeakRow {
  window: string;
  input: string;
  output: string;
}

function PriceAnnotationDialog({
  channelId,
  row,
  onClose,
}: {
  channelId: string;
  row: ChannelModelRow;
  onClose: () => void;
}) {
  const upsert = useUpsertChannelModel(channelId);
  const [input, setInput] = useState(row.priceInputPer1m === null ? "" : String(row.priceInputPer1m));
  const [output, setOutput] = useState(row.priceOutputPer1m === null ? "" : String(row.priceOutputPer1m));
  const [currency, setCurrency] = useState(row.priceCurrency || "");
  const [multiplier, setMultiplier] = useState(
    row.priceMultiplier === 1 ? "" : String(row.priceMultiplier)
  );
  const [tiers, setTiers] = useState<TierRow[]>(
    (row.priceTiers ?? []).map((t) => ({
      upTo: t.upTo === null ? "" : String(t.upTo),
      input: t.input === null ? "" : String(t.input),
      output: t.output === null ? "" : String(t.output),
    }))
  );
  const [offPeak, setOffPeak] = useState<OffPeakRow | null>(
    row.priceOffPeak
      ? {
          window: row.priceOffPeak.window,
          input: row.priceOffPeak.input === null ? "" : String(row.priceOffPeak.input),
          output: row.priceOffPeak.output === null ? "" : String(row.priceOffPeak.output),
        }
      : null
  );
  const [refOpen, setRefOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function parseNum(v: string): number | null | "invalid" {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : "invalid";
  }

  async function save() {
    // 币种为空 = 清除全部标注（价格 / 倍率 / 阶梯 / 低谷）；有币种时各项可留空（仅标一端）
    let priceIn: number | null = null;
    let priceOut: number | null = null;
    let mult: number | null = null;
    let tierList: PriceTier[] | null = null;
    let op: PriceOffPeak | null = null;
    if (currency) {
      const inV = parseNum(input);
      if (inV === "invalid") return toast.error("输入原价须为非负数字");
      const outV = parseNum(output);
      if (outV === "invalid") return toast.error("输出原价须为非负数字");
      priceIn = inV;
      priceOut = outV;

      if (multiplier.trim()) {
        const m = Number(multiplier);
        if (!Number.isFinite(m) || m <= 0) return toast.error("倍率须为正数（0.8 = 八折）");
        mult = m;
      }

      if (tiers.length > 0) {
        tierList = [];
        for (const [i, t] of tiers.entries()) {
          const upTo = parseNum(t.upTo);
          if (upTo === "invalid") return toast.error(`阶梯 ${i + 1} 上限须为非负数字（百万 token）`);
          const ti = parseNum(t.input);
          if (ti === "invalid") return toast.error(`阶梯 ${i + 1} 输入价须为非负数字`);
          const to = parseNum(t.output);
          if (to === "invalid") return toast.error(`阶梯 ${i + 1} 输出价须为非负数字`);
          if (upTo === null && ti === null && to === null) {
            return toast.error(`阶梯 ${i + 1} 至少填一项（上限 / 输入 / 输出）`);
          }
          tierList.push({ upTo, input: ti, output: to });
        }
      }

      if (offPeak) {
        const wi = parseNum(offPeak.input);
        if (wi === "invalid") return toast.error("低谷输入价须为非负数字");
        const wo = parseNum(offPeak.output);
        if (wo === "invalid") return toast.error("低谷输出价须为非负数字");
        if (!offPeak.window.trim()) return toast.error("请填写低谷时段描述（如 00:30–08:30 UTC+8）");
        op = { window: offPeak.window.trim(), input: wi, output: wo };
      }

      if (priceIn === null && priceOut === null && !tierList && !op) {
        return toast.error("至少填写一项价格（原价 / 阶梯 / 低谷）");
      }
    }
    setBusy(true);
    try {
      await upsert.mutateAsync({
        id: row.id,
        channelId,
        modelId: row.modelId,
        actualModelId: row.actualModelId,
        protocol: row.protocol,
        modelType: row.modelType,
        notes: row.notes,
        enabled: row.enabled,
        priceInputPer1m: priceIn,
        priceOutputPer1m: priceOut,
        priceCurrency: currency || null,
        priceMultiplier: mult,
        priceTiers: tierList,
        priceOffPeak: op,
      });
      toast.success(currency ? `已标注「${row.actualModelId}」价格` : `已清除「${row.actualModelId}」标注`);
      onClose();
    } catch (error) {
      toast.error(`保存失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  /** 市场价回填：原价与币种直接填入，倍率保持用户当前值。 */
  function handleMarketPick(pick: { input: number | null; output: number | null; currency: string }) {
    setCurrency(pick.currency);
    setInput(pick.input === null ? "" : String(pick.input));
    setOutput(pick.output === null ? "" : String(pick.output));
    setRefOpen(false);
    toast.success("已回填市场原价与币种（倍率请按渠道折扣自行配置）");
  }

  const enabled = Boolean(currency);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>标注价格 — {row.actualModelId}</DialogTitle>
          <DialogDescription>
            与市场价统一格式：单一 / 阶梯 / 分时段；实际价 = 原价 × 倍率（比价与排序按最高实际价）。
            仅供标注与市场比较，不参与本地测试费用计算。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>币种</Label>
              <Select
                value={currency || "none"}
                onValueChange={(v) => setCurrency(v === "none" ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未标注（清除）</SelectItem>
                  <SelectItem value="CNY">CNY（人民币）</SelectItem>
                  <SelectItem value="USD">USD（美元）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>输入原价 / 百万</Label>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="如 2"
                disabled={!enabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label>输出原价 / 百万</Label>
              <Input
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                placeholder="如 8"
                disabled={!enabled}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 items-end gap-3">
            <div className="space-y-1.5">
              <Label title="实际价 = 原价 × 倍率；1 = 原价，0.8 = 八折">倍率</Label>
              <Input
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
                placeholder="1 = 原价；0.8 = 八折"
                disabled={!enabled}
              />
            </div>
            <Button variant="outline" disabled={!enabled} onClick={() => setRefOpen(true)}>
              <Search className="size-4" />
              查市场价
            </Button>
            <p className="text-muted-foreground col-span-1 text-[10px] leading-tight">
              实际价 = 原价 × 倍率；展示与比价均为实际价，悬浮明细见标注标记。
            </p>
          </div>

          {/* 阶梯价（可折叠，与市场「每百万 token」口径一致） */}
          {enabled && tiers.length > 0 ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="inline-flex items-center gap-1 text-xs font-medium">
                  <Layers className="size-3.5" />
                  阶梯价（按累计输入 token 上限，单位：百万）
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  title="移除全部阶梯"
                  onClick={() => setTiers([])}
                >
                  <X className="size-4" />
                </Button>
              </div>
              {tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      {i + 1}｜≤ 上限（空 = 无上限）
                    </Label>
                    <Input
                      value={t.upTo}
                      onChange={(e) =>
                        setTiers(tiers.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))
                      }
                      placeholder="如 0.128"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">输入价</Label>
                    <Input
                      value={t.input}
                      onChange={(e) =>
                        setTiers(tiers.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">输出价</Label>
                    <Input
                      value={t.output}
                      onChange={(e) =>
                        setTiers(tiers.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="删除该档"
                    onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTiers([...tiers, { upTo: "", input: "", output: "" }])}
              >
                <Plus className="size-3.5" />
                加一档
              </Button>
            </div>
          ) : null}

          {/* 分时段（低谷）价 */}
          {enabled && offPeak ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="inline-flex items-center gap-1 text-xs font-medium">
                  <Clock className="size-3.5" />
                  分时段（低谷）价
                </p>
                <Button variant="ghost" size="icon" title="移除低谷价" onClick={() => setOffPeak(null)}>
                  <X className="size-4" />
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">时段描述</Label>
                <Input
                  value={offPeak.window}
                  onChange={(e) => setOffPeak({ ...offPeak, window: e.target.value })}
                  placeholder="如 00:30–08:30 UTC+8"
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">低谷输入价</Label>
                  <Input
                    value={offPeak.input}
                    onChange={(e) => setOffPeak({ ...offPeak, input: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">低谷输出价</Label>
                  <Input
                    value={offPeak.output}
                    onChange={(e) => setOffPeak({ ...offPeak, output: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {enabled && (tiers.length === 0 || !offPeak) ? (
            <div className="flex gap-2">
              {tiers.length === 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!enabled}
                  onClick={() => setTiers([{ upTo: "", input: "", output: "" }])}
                >
                  <Layers className="size-3.5" />
                  添加阶梯价
                </Button>
              ) : null}
              {!offPeak ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!enabled}
                  onClick={() => setOffPeak({ window: "", input: "", output: "" })}
                >
                  <Clock className="size-3.5" />
                  添加分时段价
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {refOpen ? (
        <MarketPriceRefDialog
          modelId={row.actualModelId}
          onPick={handleMarketPick}
          onClose={() => setRefOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}

// ------------------------------------------------------------------
// 模型管理弹窗：获取列表 → 全选/多选 → 填入
// ------------------------------------------------------------------

function ModelManageDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const fetchList = useFetchModelList(channelId);
  const importMutation = useImportModels(channelId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const remote = fetchList.data;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (remote && selected.size === remote.models.length) {
      setSelected(new Set());
    } else if (remote) {
      setSelected(new Set(remote.models.map((m: RemoteModel) => m.id)));
    }
  }

  async function importSelected() {
    if (selected.size === 0) return;
    try {
      // 接口类型由后端按名称默认（claude → anthropic_messages）
      const outcome = await importMutation.mutateAsync({
        items: [...selected].map((actualModelId) => ({ actualModelId })),
      });
      const skipInfo =
        outcome.skipped.length > 0 ? `，跳过 ${outcome.skipped.length} 条（已存在）` : "";
      toast.success(`已导入 ${outcome.created.length} 个模型${skipInfo}`);
      onClose();
    } catch (error) {
      toast.error(`导入失败：${error}`);
    }
  }

  const allSelected = remote ? selected.size === remote.models.length : false;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>模型管理 — 获取并导入</DialogTitle>
          <DialogDescription>
            调用渠道 /models 接口获取列表，勾选后确认写入（已存在的不覆盖）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() =>
              fetchList.mutate(undefined, {
                onSuccess: (data) => {
                  toast.success(`获取到 ${data.models.length} 个模型`);
                  setSelected(new Set());
                },
                onError: (error) => toast.error(`获取失败：${error}`),
              })
            }
            disabled={fetchList.isPending}
          >
            <CloudDownload className="size-4" />
            {fetchList.isPending ? "获取中…" : "获取模型列表"}
          </Button>
          {remote && remote.models.length > 0 ? (
            <Button size="sm" variant="outline" onClick={selectAll}>
              <CheckCheck className="size-4" />
              {allSelected ? "取消全选" : "全选"}
            </Button>
          ) : null}
        </div>

        {fetchList.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : remote ? (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
            {remote.models.length === 0 ? (
              <p className="text-muted-foreground text-sm">渠道返回了空列表。</p>
            ) : (
              remote.models.map((m: RemoteModel) => (
                <label
                  key={m.id}
                  className="hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)}
                    className="accent-primary size-4"
                  />
                  <code className="text-xs">{m.id}</code>
                  {selected.has(m.id) ? <Check className="text-muted-foreground size-3" /> : null}
                </label>
              ))
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">点击「获取模型列表」开始。</p>
        )}

        <DialogFooter>
          <span className="text-muted-foreground mr-auto text-xs">已选 {selected.size} 个</span>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={importSelected} disabled={selected.size === 0 || importMutation.isPending}>
            导入所选
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------
// 手动添加弹窗：模型名称 + 模型 ID + 类型
// ------------------------------------------------------------------

function ModelAddDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const { data: globals = [] } = useGlobalModels();
  const createGlobal = useCreateGlobalModel();
  const upsert = useUpsertChannelModel(channelId);

  const [actualModelId, setActualModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [modelType, setModelType] = useState<ModelType>("text");
  const [typeTouched, setTypeTouched] = useState(false);
  const [protocol, setProtocol] = useState<Protocol>("openai_chat");
  const [protocolTouched, setProtocolTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // 类型与接口类型都按名称自动默认（gpt-image → 图像、deepseek-v4.1-flash / glm-5.3-flash → 多模态等），
  // 用户手动选过后不再覆盖
  useEffect(() => {
    if (!typeTouched) setModelType(defaultModelTypeFor(actualModelId));
  }, [actualModelId, typeTouched]);
  useEffect(() => {
    if (!protocolTouched) setProtocol(defaultProtocolFor(actualModelId));
  }, [actualModelId, protocolTouched]);

  async function save() {
    if (!actualModelId.trim()) {
      toast.error("模型 ID 不能为空");
      return;
    }
    setBusy(true);
    try {
      // 显示名非空时用它建全局模型（或查已有），否则直接用模型 ID
      const name = displayName.trim() || actualModelId.trim();
      let modelId = globals.find((g) => g.name.toLowerCase() === name.toLowerCase())?.id;
      if (!modelId) {
        const row = await createGlobal.mutateAsync({ name, family: null });
        modelId = row.id;
      }
      await upsert.mutateAsync({
        id: null,
        channelId,
        modelId,
        actualModelId: actualModelId.trim(),
        protocol,
        modelType,
        notes: null,
        enabled: true,
        priceInputPer1m: null,
        priceOutputPer1m: null,
        priceCurrency: null,
      });
      toast.success(`模型「${actualModelId}」已添加（${TYPE_LABEL[modelType]}）`);
      onClose();
    } catch (error) {
      toast.error(`保存失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>手动添加模型</DialogTitle>
          <DialogDescription>
            模型名称为全局身份（可自定义展示名），模型 ID 为渠道实际使用的标识。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>模型 ID *（渠道实际标识）</Label>
            <Input value={actualModelId} onChange={(e) => setActualModelId(e.target.value)} placeholder="如 glm-5.2" />
          </div>
          <div className="space-y-1.5">
            <Label>模型名称（可选，默认同 ID）</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="如 GLM-5.2" />
          </div>
          <div className="space-y-1.5">
            <Label>类型</Label>
            <Select
              value={modelType}
              onValueChange={(v) => {
                setModelType(v as ModelType);
                setTypeTouched(true);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["multimodal", "image", "text", "decision"] as ModelType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              默认按名称推断：claude / gemini / gpt-4o·4.1·5 / o 系等 → 多模态，gpt-image 等图像命名 →
              图像，deepseek-v4.1-flash、glm-5.3-flash → 多模态；其余文本。可随时手动改。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>接口类型（测试按此调用）</Label>
            <Select
              value={protocol}
              onValueChange={(v) => {
                setProtocol(v as Protocol);
                setProtocolTouched(true);
              }}
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
            <p className="text-muted-foreground text-xs">默认按名称推断：含 claude → Anthropic Messages，否则 Chat Completions。</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "保存中…" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------
// 快速测试弹窗：三种协议格式
// ------------------------------------------------------------------

function QuickTestDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [protocol, setProtocol] = useState<Protocol>("openai_chat");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuickTestResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await quickTestChannel(channelId, protocol);
      setResult(res);
      if (res.status === "success") {
        toast.success(`连通（HTTP ${res.httpStatus}），文本「${res.text.slice(0, 40)}」`);
      } else {
        toast.warning(`请求结束：${res.status}（HTTP ${res.httpStatus}）`);
      }
    } catch (error) {
      toast.error(`快速测试失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>快速测试</DialogTitle>
          <DialogDescription>
            向渠道发送最小请求（"ping"），验证三种协议格式的连通性；结果写入测试记录。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>协议格式</Label>
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
          <Button onClick={run} disabled={busy}>
            <Rocket className="size-4" />
            {busy ? "测试中…" : "发送测试"}
          </Button>
          {result ? (
            <div className="rounded-md border p-3 text-xs">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant={result.status === "success" ? "default" : "destructive"}>
                  {result.status}
                </Badge>
                <Badge variant="outline">HTTP {result.httpStatus}</Badge>
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap">
                {result.text || "（无文本）"}
              </pre>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
