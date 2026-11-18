import { useState } from "react";
import { toast } from "sonner";
import { CircleDollarSign, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ModelPriceRow } from "@/lib/tauri";
import {
  useAddModelPrice,
  useChannelModels,
  useEffectivePrice,
  useDeleteModelPrice,
  useModelPrices,
} from "@/features/channels/api";

const PRICE_FIELDS = [
  { key: "inputPrice", label: "输入", discounted: "input" },
  { key: "outputPrice", label: "输出", discounted: "output" },
  { key: "cacheReadPrice", label: "缓存读", discounted: "cacheRead" },
  { key: "cacheWritePrice", label: "缓存写", discounted: "cacheWrite" },
  { key: "imagePrice", label: "图像", discounted: "image" },
  { key: "otherUsagePrice", label: "其他", discounted: "otherUsage" },
] as const;

const UNIT_LABELS: Record<string, string> = {
  per_1m_tokens: "每百万 Token",
  per_1k_tokens: "每千 Token",
  per_image: "每张图",
};

const todayStr = () => new Date().toISOString().slice(0, 10);

/** 渠道详情页的「价格」Tab：生效价格（官方价 + 折扣价）、历史版本、新增版本。 */
export function PricingTab({ channelId }: { channelId: string }) {
  const { data: models = [] } = useChannelModels(channelId);
  const [selectedId, setSelectedId] = useState("");
  const activeId = selectedId || (models[0]?.id ?? "");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="size-4" />
            价格管理
          </CardTitle>
          <CardDescription>
            价格以渠道模型为维度，历史追加式：改价请新增一个版本，不覆盖历史。
            折扣 80 表示按官方价 80% 计算。官方价格 / 实际折扣价 / 本地估算费用分开呈现。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {models.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              该渠道还没有渠道模型，请先在「模型」Tab 获取导入或手动添加。
            </p>
          ) : (
            <div className="max-w-md space-y-1.5">
              <Label>选择渠道模型</Label>
              <Select value={activeId} onValueChange={setSelectedId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择渠道模型" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.actualModelId}
                      {m.modelName && m.modelName !== m.actualModelId ? `（${m.modelName}）` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {activeId ? (
        <>
          <EffectivePriceCard channelModelId={activeId} />
          <PriceHistoryCard channelModelId={activeId} />
        </>
      ) : null}
    </div>
  );
}

function EffectivePriceCard({ channelModelId }: { channelModelId: string }) {
  const { data: effective, isLoading } = useEffectivePrice(channelModelId);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!effective) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">当前生效价格</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">尚未配置价格。添加价格版本后按生效日期自动启用。</p>
        </CardContent>
      </Card>
    );
  }

  const unit = UNIT_LABELS[effective.pricingUnit] ?? effective.pricingUnit;
  const hasDiscount = effective.discountPercent != null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          当前生效价格
          <Badge variant="outline">生效日期 {effective.effectiveDate}</Badge>
          {hasDiscount ? <Badge>折扣 {effective.discountPercent}%</Badge> : null}
        </CardTitle>
        <CardDescription>
          {effective.currency} · {unit}。{hasDiscount ? "上行原价，下行折扣后价格。" : "未配置折扣。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {PRICE_FIELDS.map((f) => {
            const original = effective[f.key];
            const discounted = effective.discounted[f.discounted];
            return (
              <div key={f.key} className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{f.label}</div>
                {original == null ? (
                  <div className="text-muted-foreground mt-1 text-sm">—</div>
                ) : (
                  <div className="mt-1">
                    {hasDiscount ? (
                      <>
                        <div className="text-muted-foreground text-xs line-through">
                          {original.toFixed(4)}
                        </div>
                        <div className="text-sm font-semibold tabular-nums">
                          {discounted?.toFixed(4)}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm font-semibold tabular-nums">{original.toFixed(4)}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PriceHistoryCard({ channelModelId }: { channelModelId: string }) {
  const { data: history = [] } = useModelPrices(channelModelId);
  const deletePrice = useDeleteModelPrice(channelModelId);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      window.setTimeout(() => setConfirmDelete(null), 4000);
      return;
    }
    try {
      await deletePrice.mutateAsync(id);
      toast.success("未来生效的价格版本已删除");
      setConfirmDelete(null);
    } catch (error) {
      // 已生效/历史版本由后端拒绝删除（价格历史只追加）
      toast.error(`${error}`);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">价格历史（{history.length}）</CardTitle>
          <CardDescription>
            只追加不覆盖；已生效 / 历史版本不可删除，如需改价请新增未来生效日期的版本。
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />新增价格版本
        </Button>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-muted-foreground text-sm">暂无价格记录。</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>生效日期</TableHead>
                <TableHead>输入 / 输出</TableHead>
                <TableHead>折扣</TableHead>
                <TableHead>币种 · 单位</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>录入时间</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((row: ModelPriceRow) => {
                const isFuture = row.effectiveDate > todayStr();
                return (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums">{row.effectiveDate}</TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {row.inputPrice ?? "—"} / {row.outputPrice ?? "—"}
                    </TableCell>
                    <TableCell>
                      {row.discountPercent != null ? (
                        <Badge variant="secondary">{row.discountPercent}%</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.currency} · {UNIT_LABELS[row.pricingUnit] ?? row.pricingUnit}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-40 truncate text-xs">
                      {row.notes ?? ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{row.createdAt}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!isFuture}
                        title={isFuture ? "删除该版本" : "已生效版本不可删除"}
                        onClick={() => handleDelete(row.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {addOpen ? (
        <AddPriceDialog
          channelModelId={channelModelId}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </Card>
  );
}

function AddPriceDialog({ channelModelId, onClose }: { channelModelId: string; onClose: () => void }) {
  const addPrice = useAddModelPrice(channelModelId);
  const [currency, setCurrency] = useState("CNY");
  const [unit, setUnit] = useState("per_1m_tokens");
  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});

  function price(key: string): number | null {
    const v = prices[key]?.trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function save() {
    const input = {
      channelModelId,
      inputPrice: price("inputPrice"),
      outputPrice: price("outputPrice"),
      cacheReadPrice: price("cacheReadPrice"),
      cacheWritePrice: price("cacheWritePrice"),
      imagePrice: price("imagePrice"),
      otherUsagePrice: price("otherUsagePrice"),
      currency,
      pricingUnit: unit,
      discountPercent: discount.trim() ? Number(discount.trim()) : null,
      effectiveDate,
      notes: notes.trim() || null,
    };
    const anyPrice = PRICE_FIELDS.some((f) => price(f.key) != null);
    if (!anyPrice) {
      toast.error("至少填写一项价格");
      return;
    }
    try {
      await addPrice.mutateAsync(input);
      toast.success(`价格版本已新增（生效日期 ${effectiveDate}）`);
      onClose();
    } catch (error) {
      toast.error(`保存失败：${error}`);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>新增价格版本</DialogTitle>
          <DialogDescription>追加式保存：同一生效日期已存在版本时会拒绝，不覆盖历史。</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>币种</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CNY">CNY（人民币）</SelectItem>
                <SelectItem value="USD">USD（美元）</SelectItem>
                <SelectItem value="EUR">EUR（欧元）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>计价单位</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_1m_tokens">每百万 Token</SelectItem>
                <SelectItem value="per_1k_tokens">每千 Token</SelectItem>
                <SelectItem value="per_image">每张图</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>生效日期 *</Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>折扣 %（可选）</Label>
            <Input
              type="number"
              placeholder="80 = 八折"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PRICE_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type="number"
                step="any"
                placeholder="留空表示未定价"
                value={prices[f.key] ?? ""}
                onChange={(e) => setPrices({ ...prices, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label>备注</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={addPrice.isPending}>
            保存版本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
