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
import { useUiStore, type MarketCurrency } from "@/stores/ui";
import {
  fetchMarketPrices,
  getMarketFx,
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

/** 兜底汇率：从未成功获取实时汇率时使用（页脚标注）。 */
const FALLBACK_FX = 7.2;

const CURRENCY_MODES: { value: MarketCurrency; label: string }[] = [
  { value: "native", label: "默认" },
  { value: "USD", label: "$ 美元" },
  { value: "CNY", label: "¥ 人民币" },
];

/** 市场信息：各厂商模型价格快照（国内厂商 CNY 官价 + 低谷分时段价 + 币种切换折算）。 */
export function MarketPage() {
  const queryClient = useQueryClient();
  const { data: snapshot, isLoading } = useQuery({
    queryKey: ["market-prices"],
    queryFn: listMarketPrices,
    staleTime: Infinity,
  });
  const { data: fx } = useQuery({
    queryKey: ["market-fx"],
    queryFn: getMarketFx,
    staleTime: 5 * 60 * 1000,
  });
  const currencyMode = useUiStore((s) => s.marketCurrency);
  const setCurrencyMode = useUiStore((s) => s.setMarketCurrency);

  const [providerId, setProviderId] = useState("all");
  const [search, setSearch] = useState("");
  // 分页（按模型行）：筛选变化回第一页；总数 ≤ 10 时 Pagination 自身不渲染
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 实际折算汇率：优先实时值；从未获取过用兜底值（脚注标注来源）
  const liveRate = fx?.rate ?? null;
  const rate = liveRate ?? FALLBACK_FX;
  const rateLabel = liveRate
    ? `按汇率 ${liveRate} 折算（frankfurter · ${fmtTime(fx?.fetchedAt ?? null)}）`
    : `默认汇率 ${FALLBACK_FX}（未获取到实时汇率）`;

  // 「抓取数据」：实时拉取 models.dev（顺带更新汇率）→ 写入缓存 → 刷新展示
  const fetchMutation = useMutation({
    mutationFn: fetchMarketPrices,
    onSuccess: (fresh) => {
      void queryClient.invalidateQueries({ queryKey: ["market-prices"] });
      void queryClient.invalidateQueries({ queryKey: ["market-fx"] });
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

  // source 形如 "bundled + cn/2026-11" 或 "models.dev + cn/2026-11"（国内价叠加层标注）
  const baseSource = snapshot?.source.split(" + cn/")[0] ?? "";
  const cnDate = snapshot?.source.match(/\+ cn\/([\d-]+)/)?.[1];
  const sourceLabel = snapshot
    ? `${baseSource === "models.dev" ? `已抓取（models.dev · ${fmtTime(snapshot.fetchedAt)}）` : `内置快照（${snapshot.snapshotDate}）`}${cnDate ? ` · 国内价 ${cnDate}` : ""}`
    : "";

  return (
    <>
      <PageHeader
        title="市场信息"
        description={
          snapshot
            ? `各厂商模型价格快照 · ${sourceLabel} · 每百万 token，币种见列。仅供参考，不算费用。`
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
        {/* 币种切换：默认=各厂商原生币种；USD/CNY=按汇率折算（≈ 标注） */}
        <div className="bg-muted inline-flex rounded-lg p-0.5">
          {CURRENCY_MODES.map((m) => (
            <Button
              key={m.value}
              size="sm"
              variant={currencyMode === m.value ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setCurrencyMode(m.value)}
            >
              {m.label}
            </Button>
          ))}
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
                    displayCurrency={currencyMode}
                    fxRate={rate}
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
        国际厂商价格来自 models.dev（USD）；国内厂商为官网抓取的人民币价（低谷分时段价见行内小字），由
        `pnpm market:cn-refresh` 维护快照，以各官方价格页为准。中转 / 聚合渠道（NewAPI
        等）价格各异，以渠道页为准。折算视图：{rateLabel}。
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
  displayCurrency,
  fxRate,
}: {
  provider: MarketProvider;
  model: MarketModel;
  displayCurrency: MarketCurrency;
  fxRate: number;
}) {
  // native = 各厂商原生币种；否则折算到目标币种（≈ 标注，脚注说明汇率）
  const conv = (value: number | null): { text: string; approx: boolean } => {
    if (displayCurrency === "native" || value === null) {
      return { text: fmtPrice(value, model.currency), approx: false };
    }
    if (model.currency === displayCurrency) {
      return { text: fmtPrice(value, model.currency), approx: false };
    }
    const converted = model.currency === "USD" ? value * fxRate : value / fxRate;
    return { text: fmtPrice(Number(converted.toFixed(4)), displayCurrency), approx: true };
  };
  const input = conv(model.inputPer1m);
  const cached = conv(model.cachedInputPer1m);
  const output = conv(model.outputPer1m);
  // 低谷价始终与主价同币种展示（折算视图下同步折算）
  const off = model.offPeak;

  return (
    <TableRow>
      <TableCell className="align-top">
        <code className="text-xs font-medium">{model.model}</code>
        {model.note ? (
          <p className="text-muted-foreground mt-0.5 max-w-64 text-[10px]">{model.note}</p>
        ) : null}
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
        <PriceCell approx={input.approx} text={input.text} />
        {off ? <PriceSubLine label="低谷" value={conv(off.inputPer1m).text} window={off.window} /> : null}
      </TableCell>
      <TableCell className="text-muted-foreground text-right align-top tabular-nums">
        <PriceCell approx={cached.approx} text={cached.text} />
        {off ? <PriceSubLine label="低谷" value={conv(off.cachedInputPer1m).text} window={off.window} /> : null}
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">
        <PriceCell approx={output.approx} text={output.text} />
        {off ? <PriceSubLine label="低谷" value={conv(off.outputPer1m).text} window={off.window} /> : null}
      </TableCell>
    </TableRow>
  );
}

/** 主价（折算值加 ≈ 前缀）。 */
function PriceCell({ text, approx }: { text: string; approx: boolean }) {
  return approx ? <span>≈ {text}</span> : <span>{text}</span>;
}

/** 低谷分时段价：主价下方小字（window 全文放悬浮提示；无价不渲染）。 */
function PriceSubLine({ label, value, window }: { label: string; value: string; window: string }) {
  if (!value || value === "—" || value === "免费") return null;
  return (
    <p className="text-muted-foreground text-[10px] whitespace-nowrap" title={window}>
      {label} {value}
    </p>
  );
}

function fmtPrice(value: number | null, currency: string): string {
  if (value === null) return "—";
  if (value === 0) return "免费";
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  return `${symbol}${Number(value.toFixed(4))}`;
}
