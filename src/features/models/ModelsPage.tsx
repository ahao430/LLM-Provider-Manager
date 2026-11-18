import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listAllChannelModels,
  PROTOCOL_LABELS,
  MODEL_TYPE_LABELS,
  type AllChannelModelRow,
  type ModelType,
} from "@/lib/tauri";
import { ModelTestButton } from "@/features/models/ModelTestButton";

const TYPE_VARIANT: Record<ModelType, "default" | "secondary" | "outline" | "destructive"> = {
  multimodal: "default",
  image: "secondary",
  text: "outline",
  decision: "destructive",
};

/** 同名模型聚合组（多渠道合并为一行）。 */
interface ModelGroup {
  key: string;
  actualModelId: string;
  modelType: ModelType;
  channels: AllChannelModelRow[];
}

/** 模型列表：跨渠道以模型维度聚合（渠道合并展示、价格范围、分渠道测试）。 */
export function ModelsPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["all-channel-models"],
    queryFn: listAllChannelModels,
  });

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ModelType>("all");
  const [detail, setDetail] = useState<ModelGroup | null>(null);

  // 按 actualModelId（大小写不敏感）聚合
  const groups = useMemo(() => {
    const map = new Map<string, ModelGroup>();
    for (const row of rows) {
      const key = row.actualModelId.trim().toLowerCase();
      const group = map.get(key);
      if (group) {
        group.channels.push(row);
      } else {
        map.set(key, {
          key,
          actualModelId: row.actualModelId,
          modelType: row.modelType,
          channels: [row],
        });
      }
    }
    return [...map.values()].sort((a, b) => a.actualModelId.localeCompare(b.actualModelId));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (typeFilter !== "all" && g.modelType !== typeFilter) return false;
      if (q === "") return true;
      return (
        g.actualModelId.toLowerCase().includes(q) ||
        g.channels.some((c) => c.channelName.toLowerCase().includes(q))
      );
    });
  }, [groups, search, typeFilter]);

  return (
    <>
      <PageHeader
        title="模型列表"
        description="全部渠道的模型按模型维度聚合：同名模型合并展示，价格为标注价范围（仅参考，不算费用）；点击行查看各渠道详情并分开测试。"
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-2 size-4" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模型 / 渠道"
            className="h-8 w-60 pl-8 text-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | ModelType)}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {(["multimodal", "image", "text", "decision"] as ModelType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {MODEL_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">
          {filtered.length} 个模型 · 来自 {rows.length} 条渠道模型
        </span>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead className="w-20">类型</TableHead>
                <TableHead>渠道</TableHead>
                <TableHead className="w-56">标注价 / 百万（范围）</TableHead>
                <TableHead className="w-28">测试</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-8 text-center text-sm">
                    没有匹配的模型；先在「渠道管理」导入各渠道模型。
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((g) => (
                  <TableRow
                    key={g.key}
                    className="cursor-pointer"
                    onClick={() => setDetail(g)}
                  >
                    <TableCell>
                      <code className="text-xs font-medium">{g.actualModelId}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={TYPE_VARIANT[g.modelType]} className="text-[10px]">
                        {MODEL_TYPE_LABELS[g.modelType]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ChannelBadges channels={g.channels} />
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {priceRangeLabel(g.channels)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        {g.channels.slice(0, 2).map((c) => (
                          <ModelTestButton
                            key={c.id}
                            channelId={c.channelId}
                            actualModelId={c.actualModelId}
                            protocol={c.protocol}
                            label={g.channels.length > 1 ? c.channelName : undefined}
                          />
                        ))}
                        {g.channels.length > 2 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setDetail(g)}
                          >
                            +{g.channels.length - 2} 个渠道
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {detail ? <ModelDetailDialog group={detail} onClose={() => setDetail(null)} onOpenChannel={(id) => navigate(`/channels/${id}`)} /> : null}
    </>
  );
}

/** 渠道合并展示：最多 3 个徽章 + 剩余数量。 */
function ChannelBadges({ channels }: { channels: AllChannelModelRow[] }) {
  const shown = channels.slice(0, 3);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <Badge
          key={c.id}
          variant={c.channelEnabled ? "outline" : "secondary"}
          className="max-w-32 truncate text-[10px]"
          title={`${c.channelName}${c.channelEnabled ? "" : "（渠道已禁用）"}${c.enabled ? "" : " · 模型已禁用"}`}
        >
          {c.channelName}
        </Badge>
      ))}
      {channels.length > shown.length ? (
        <span className="text-muted-foreground text-[10px]">+{channels.length - shown.length}</span>
      ) : null}
    </div>
  );
}

/** 标注价范围：按币种分组，输入 / 输出各自取 min~max（仅展示比较，与费用估算无关）。 */
function priceRangeLabel(channels: AllChannelModelRow[]): string {
  const annotated = channels.filter((c) => c.priceCurrency);
  if (annotated.length === 0) return "—";
  const byCurrency = new Map<string, { ins: number[]; outs: number[] }>();
  for (const c of annotated) {
    const entry = byCurrency.get(c.priceCurrency) ?? { ins: [], outs: [] };
    if (c.priceInputPer1m !== null) entry.ins.push(c.priceInputPer1m);
    if (c.priceOutputPer1m !== null) entry.outs.push(c.priceOutputPer1m);
    byCurrency.set(c.priceCurrency, entry);
  }
  const fmt = (arr: number[]): string => {
    if (arr.length === 0) return "—";
    const min = Number(Math.min(...arr).toFixed(4));
    const max = Number(Math.max(...arr).toFixed(4));
    return min === max ? String(min) : `${min}~${max}`;
  };
  return [...byCurrency.entries()]
    .map(([cur, e]) => `${cur} ${fmt(e.ins)} / ${fmt(e.outs)}`)
    .join("；");
}

/** 详情弹窗：各渠道协议 / 启用状态 / 标注价 + 分渠道测试。 */
function ModelDetailDialog({
  group,
  onClose,
  onOpenChannel,
}: {
  group: ModelGroup;
  onClose: () => void;
  onOpenChannel: (channelId: string) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <code className="text-sm">{group.actualModelId}</code>
            <Badge variant={TYPE_VARIANT[group.modelType]} className="text-[10px]">
              {MODEL_TYPE_LABELS[group.modelType]}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {group.channels.length} 个渠道提供该模型；标注价仅参考，不算费用。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {group.channels.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="hover:text-primary truncate text-sm font-medium hover:underline"
                    onClick={() => {
                      onClose();
                      onOpenChannel(c.channelId);
                    }}
                  >
                    {c.channelName}
                  </button>
                  {!c.channelEnabled ? (
                    <Badge variant="secondary" className="text-[9px]">
                      渠道禁用
                    </Badge>
                  ) : null}
                  {!c.enabled ? (
                    <Badge variant="secondary" className="text-[9px]">
                      模型禁用
                    </Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground text-xs">
                  {PROTOCOL_LABELS[c.protocol] ?? c.protocol}
                  {c.priceCurrency
                    ? ` · 标注 ${c.priceCurrency} ${fmtNum(c.priceInputPer1m)} / ${fmtNum(c.priceOutputPer1m)} 每百万`
                    : " · 未标注价格"}
                </div>
              </div>
              <ModelTestButton
                channelId={c.channelId}
                actualModelId={c.actualModelId}
                protocol={c.protocol}
              />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fmtNum(v: number | null): string {
  return v === null ? "—" : String(Number(v.toFixed(4)));
}
