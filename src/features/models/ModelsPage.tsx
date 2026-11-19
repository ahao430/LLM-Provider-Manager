import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { loadSessionState, saveSessionState } from "@/lib/sessionState";
import { Pagination } from "@/components/Pagination";
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
  getMarketFx,
  PROTOCOL_LABELS,
  MODEL_TYPE_LABELS,
  type AllChannelModelRow,
  type LatestModelTestRow,
  type ModelType,
} from "@/lib/tauri";
import { ModelTestButton } from "@/features/models/ModelTestButton";
import { LatestTestResult, useLatestModelTestMap } from "@/features/models/LatestTestResult";
import { annotationEffective, annotationTooltip, toCnyForSort } from "@/lib/annotationPrice";

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

type PriceSort = "name" | "asc" | "desc";

/** 组内全部渠道的最高实际价（比价键折算 CNY 后取 max；无标注 = null，排序垫底）。 */
function groupCompareMax(group: ModelGroup, fxRate: number | null | undefined): number | null {
  let best: number | null = null;
  for (const c of group.channels) {
    const eff = annotationEffective(c);
    for (const v of [eff.compareInput, eff.compareOutput]) {
      const cny = toCnyForSort(v, c.priceCurrency, fxRate);
      if (cny !== null && (best === null || cny > best)) best = cny;
    }
  }
  return best;
}

/** 价格排序（实际价口径，跨币种折算；默认按模型名）。 */
function sortedGroups(groups: ModelGroup[], sort: PriceSort, fxRate: number | null | undefined): ModelGroup[] {
  if (sort === "name") return groups;
  return [...groups].sort((a, b) => {
    const av = groupCompareMax(a, fxRate);
    const bv = groupCompareMax(b, fxRate);
    if (av === null && bv === null) return a.actualModelId.localeCompare(b.actualModelId);
    if (av === null) return 1;
    if (bv === null) return -1;
    return sort === "asc" ? av - bv : bv - av;
  });
}

/** 模型列表：跨渠道以模型维度聚合（渠道合并展示、价格范围、最近测试、分渠道测试）。 */
export function ModelsPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["all-channel-models"],
    queryFn: listAllChannelModels,
  });
  // (channelId, model) → 最近一次测试（测试按钮完成后自动失效刷新）
  const latestMap = useLatestModelTestMap();

  // 会话级 UI 状态：进测试记录再返回时保留搜索 / 筛选 / 分页
  const savedUi = loadSessionState("lcm-ui-models", {
    search: "",
    typeFilter: "all" as "all" | ModelType,
    priceSort: "name" as PriceSort,
    page: 1,
    pageSize: 20,
  });
  const [search, setSearch] = useState(savedUi.search);
  const [typeFilter, setTypeFilter] = useState<"all" | ModelType>(savedUi.typeFilter);
  const [priceSort, setPriceSort] = useState<PriceSort>(savedUi.priceSort);
  const [detail, setDetail] = useState<ModelGroup | null>(null);
  // 分页：筛选变化重置回第一页；总数 ≤ 10 时 Pagination 自身不渲染
  const [page, setPage] = useState(savedUi.page);
  const [pageSize, setPageSize] = useState(savedUi.pageSize);

  useEffect(() => {
    saveSessionState("lcm-ui-models", { search, typeFilter, priceSort, page, pageSize });
  }, [search, typeFilter, priceSort, page, pageSize]);

  // 汇率（跨币种排序折算 USD→CNY 用；缺失兜底 7.2）
  const fxQuery = useQuery({
    queryKey: ["market-fx"],
    queryFn: getMarketFx,
    staleTime: 10 * 60_000,
  });

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

  const pageCount = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const safePage = Math.min(page, pageCount);
  const pageGroups = useMemo(
    () =>
      sortedGroups(filtered, priceSort, fxQuery.data?.rate ?? null).slice(
        (safePage - 1) * pageSize,
        safePage * pageSize
      ),
    [filtered, priceSort, fxQuery.data, safePage, pageSize]
  );

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
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="搜索模型 / 渠道"
            className="h-8 w-60 pl-8 text-sm"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v as "all" | ModelType);
            setPage(1);
          }}
        >
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
        <Select
          value={priceSort}
          onValueChange={(v) => {
            setPriceSort(v as PriceSort);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-40 text-sm" title="按最高实际价（原价 × 倍率，含阶梯 / 低谷）排序；跨币种按汇率折算">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">按模型名</SelectItem>
            <SelectItem value="desc">实际价从高到低</SelectItem>
            <SelectItem value="asc">实际价从低到高</SelectItem>
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
                <TableHead
                  className="w-56"
                  title="实际价范围 = 原价 × 倍率（含阶梯最高档 / 低谷）；比价与排序按最高实际价"
                >
                  标注实际价 / 百万（范围）
                </TableHead>
                <TableHead className="w-36">最近测试</TableHead>
                <TableHead className="w-28">测试</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
                    没有匹配的模型；先在「渠道管理」导入各渠道模型。
                  </TableCell>
                </TableRow>
              ) : (
                pageGroups.map((g) => {
                  const latest = latestOfGroup(g, latestMap);
                  return (
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
                        <LatestTestResult latest={latest} />
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
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              unit="个"
            />
          </div>
        </div>
      )}

      {detail ? (
        <ModelDetailDialog
          group={detail}
          latestMap={latestMap}
          onClose={() => setDetail(null)}
          onOpenChannel={(id) => navigate(`/channels/${id}`)}
        />
      ) : null}
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

/** 标注实际价范围（原价 × 倍率，取最高档）：按币种分组，输入 / 输出各自取 min~max（仅展示比较，与费用估算无关）。 */
function priceRangeLabel(channels: AllChannelModelRow[]): string {
  const annotated = channels.filter((c) => c.priceCurrency);
  if (annotated.length === 0) return "—";
  const byCurrency = new Map<string, { ins: number[]; outs: number[] }>();
  for (const c of annotated) {
    const eff = annotationEffective(c);
    const entry = byCurrency.get(c.priceCurrency) ?? { ins: [], outs: [] };
    if (eff.compareInput !== null) entry.ins.push(eff.compareInput);
    if (eff.compareOutput !== null) entry.outs.push(eff.compareOutput);
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

/** 组内最近一次测试（跨渠道取最新）。 */
function latestOfGroup(
  group: ModelGroup,
  latestMap: Map<string, LatestModelTestRow>
): LatestModelTestRow | null {
  let best: LatestModelTestRow | null = null;
  for (const c of group.channels) {
    const t = latestMap.get(`${c.channelId}|${c.actualModelId.trim().toLowerCase()}`);
    if (t && (!best || t.createdAt > best.createdAt)) best = t;
  }
  return best;
}

/** 详情弹窗：各渠道协议 / 启用状态 / 标注价 / 最近测试 + 分渠道测试。 */
function ModelDetailDialog({
  group,
  latestMap,
  onClose,
  onOpenChannel,
}: {
  group: ModelGroup;
  latestMap: Map<string, LatestModelTestRow>;
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
          {group.channels.map((c) => {
            const latest = latestMap.get(`${c.channelId}|${c.actualModelId.trim().toLowerCase()}`);
            return (
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
                  <div
                    className="text-muted-foreground text-xs"
                    title={c.priceCurrency ? annotationTooltip(c) || undefined : undefined}
                  >
                    {PROTOCOL_LABELS[c.protocol] ?? c.protocol}
                    {c.priceCurrency
                      ? ` · 标注 ${c.priceCurrency} ${fmtNum(annotationEffective(c).input)} / ${fmtNum(annotationEffective(c).output)} 每百万实际价`
                      : " · 未标注价格"}
                  </div>
                  <div className="text-xs">
                    <LatestTestResult latest={latest} />
                  </div>
                </div>
                <ModelTestButton
                  channelId={c.channelId}
                  actualModelId={c.actualModelId}
                  protocol={c.protocol}
                />
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fmtNum(v: number | null): string {
  return v === null ? "—" : String(Number(v.toFixed(4)));
}
