import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudDownload, ExternalLink, Search } from "lucide-react";

import { ProviderIcon } from "@/components/ProviderIcon";

import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { openExternal } from "@/lib/external";
import {
  fetchMarketPrices,
  listMarketPrices,
  MODEL_TYPE_LABELS,
  type MarketModel,
  type MarketProvider,
  type ModelType,
} from "@/lib/tauri";

const TYPE_VARIANT: Record<ModelType, "default" | "secondary" | "outline" | "destructive"> = {
  multimodal: "default",
  image: "secondary",
  text: "outline",
  decision: "destructive",
};

const CURRENCY_SYMBOL: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€" };

/** 市场信息：各厂商模型价格快照 + 渠道标注价并排比较（均为参考展示，不算费用）。 */
export function MarketPage() {
  const queryClient = useQueryClient();
  const { data: snapshot, isLoading } = useQuery({
    queryKey: ["market-prices"],
    queryFn: listMarketPrices,
    staleTime: Infinity,
  });

  const [providerId, setProviderId] = useState("all");
  const [search, setSearch] = useState("");
  // 分页（按模型行）：筛选变化回第一页；总数 ≤ 10 时 Pagination 自身不渲染
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 「抓取数据」：实时拉取 models.dev → 写入缓存 → 刷新展示
  const fetchMutation = useMutation({
    mutationFn: fetchMarketPrices,
    onSuccess: (fresh) => {
      void queryClient.invalidateQueries({ queryKey: ["market-prices"] });
      const count = fresh.providers.reduce((n, p) => n + p.models.length, 0);
      toast.success(`已抓取最新数据：${fresh.providers.length} 家厂商 / ${count} 个模型`);
    },
    onError: (error) => toast.error(`抓取失败：${error}`),
  });

  const providers = snapshot?.providers ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return providers
      .filter((p) => providerId === "all" || p.id === providerId)
      .map((p) => ({
        provider: p,
        models: p.models.filter(
          (m) => q === "" || m.model.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
        ),
      }))
      .filter((entry) => entry.models.length > 0);
  }, [providers, providerId, search]);

  // 摊平成模型行（分页按模型计数，不按厂商）
  const flatRows = useMemo(() => {
    const rows: { provider: MarketProvider; model: MarketModel }[] = [];
    for (const { provider, models } of filtered) {
      for (const model of models) rows.push({ provider, model });
    }
    return rows;
  }, [filtered]);
  const pageCount = Math.max(Math.ceil(flatRows.length / pageSize), 1);
  const safePage = Math.min(page, pageCount);
  const pageRows = flatRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const modelCount = filtered.reduce((n, e) => n + e.models.length, 0);

  const sourceLabel = snapshot
    ? snapshot.source === "models.dev"
      ? `已抓取（models.dev · ${fmtTime(snapshot.fetchedAt)}）`
      : `内置快照（${snapshot.snapshotDate}）`
    : "";

  return (
    <>
      <PageHeader
        title="市场信息"
        description={
          snapshot
            ? `各厂商模型价格快照 · ${sourceLabel} · USD/百万 token。仅供参考，不算费用。`
            : "各厂商模型价格参考"
        }
        actions={
          <Button onClick={() => fetchMutation.mutate()} disabled={fetchMutation.isPending}>
            <CloudDownload className="size-4" />
            {fetchMutation.isPending ? "抓取中…" : "抓取数据"}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={providerId}
          onValueChange={(v) => {
            setProviderId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-52 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部厂商</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-1.5">
                  <ProviderIcon id={p.id} name={p.name} className="size-3.5" />
                  {p.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-2 size-4" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="搜索模型 / 厂商"
            className="h-8 w-56 pl-8 text-sm"
          />
        </div>
        <span className="text-muted-foreground text-xs">
          {providers.length} 家厂商 · {modelCount} 个模型
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
                <TableHead className="w-36">厂商</TableHead>
                <TableHead className="w-20">类型</TableHead>
                <TableHead className="text-right">输入 / 百万</TableHead>
                <TableHead className="text-right">缓存 / 百万</TableHead>
                <TableHead className="text-right">输出 / 百万</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flatRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
                    没有匹配的模型
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map(({ provider, model }) => (
                  <MarketModelRow
                    key={`${provider.id}:${model.model}`}
                    provider={provider}
                    model={model}
                  />
                ))
              )}
            </TableBody>
          </Table>
          <div className="border-t px-3 pb-2">
            <Pagination
              page={safePage}
              pageCount={pageCount}
              pageSize={pageSize}
              total={flatRows.length}
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

      <p className="text-muted-foreground text-xs">
        「抓取数据」从 models.dev 拉取官方厂商价格（统一折算 USD）并保存在本地；内置快照随版本发布，可能滞后，点击「抓取数据」即可更新。中转 /
        聚合渠道（NewAPI、SiliconFlow 等）价格各异，以渠道页为准。
      </p>
    </>
  );
}

function fmtTime(iso: string | null): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "";
}

function MarketModelRow({
  provider,
  model,
}: {
  provider: MarketProvider;
  model: MarketModel;
}) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <code className="text-xs font-medium">{model.model}</code>
      </TableCell>
      <TableCell className="align-top">
        <button
          type="button"
          className="text-primary hover:underline inline-flex items-center gap-1 text-sm"
          title="打开官方价格页"
          onClick={() => void openExternal(provider.pricingUrl)}
        >
          <ProviderIcon id={provider.id} name={provider.name} className="size-3.5" />
          {provider.name}
          <ExternalLink className="size-3" />
        </button>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant={TYPE_VARIANT[model.modelType]} className="text-[10px]">
          {MODEL_TYPE_LABELS[model.modelType]}
        </Badge>
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">
        {fmtPrice(model.inputPer1m, model.currency)}
      </TableCell>
      <TableCell className="text-muted-foreground text-right align-top tabular-nums">
        {fmtPrice(model.cachedInputPer1m, model.currency, true)}
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">
        {fmtPrice(model.outputPer1m, model.currency)}
      </TableCell>
    </TableRow>
  );
}

function fmtPrice(value: number | null, currency: string, muted = false): string {
  if (value === null) return muted ? "" : "—";
  if (value === 0) return "免费";
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  return `${symbol}${Number(value.toFixed(4))}`;
}
