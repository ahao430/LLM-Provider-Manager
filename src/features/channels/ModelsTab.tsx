import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CloudDownload,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";

import { ModelTestButton } from "@/features/models/ModelTestButton";
import { LatestTestResult, useLatestModelTestMap } from "@/features/models/LatestTestResult";

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
                  <span className="truncate">
                    {m.modelName ?? "未绑定全局模型"} · {PROTOCOL_LABELS[m.protocol] ?? m.protocol}
                    {m.priceCurrency ? (
                      <span className="text-foreground/80">
                        {" "}· 标注 {m.priceCurrency} {fmtAnnotation(m.priceInputPer1m)} / {fmtAnnotation(m.priceOutputPer1m)} 每百万
                      </span>
                    ) : null}
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

// ------------------------------------------------------------------
// 标注价格弹窗：输入 / 输出每百万价 + 币种（仅展示比较，不参与费用估算）
// ------------------------------------------------------------------

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
  const [busy, setBusy] = useState(false);

  async function save() {
    // 币种为空 = 清除标注；有币种时价格可留空（仅标一端）
    let priceIn: number | null = null;
    let priceOut: number | null = null;
    if (currency) {
      if (input.trim()) {
        const v = Number(input);
        if (!Number.isFinite(v) || v < 0) {
          toast.error("输入价须为非负数字");
          return;
        }
        priceIn = v;
      }
      if (output.trim()) {
        const v = Number(output);
        if (!Number.isFinite(v) || v < 0) {
          toast.error("输出价须为非负数字");
          return;
        }
        priceOut = v;
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
      });
      toast.success(currency ? `已标注「${row.actualModelId}」价格` : `已清除「${row.actualModelId}」标注`);
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
          <DialogTitle>标注价格 — {row.actualModelId}</DialogTitle>
          <DialogDescription>
            仅供标注与市场信息页比较查看，不参与本地测试费用计算。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>输入价 / 百万 token</Label>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="如 2"
                disabled={!currency || currency === "none"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>输出价 / 百万 token</Label>
              <Input
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                placeholder="如 8"
                disabled={!currency || currency === "none"}
              />
            </div>
          </div>
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
