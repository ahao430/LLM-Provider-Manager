import { Fragment, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchMarketPrices,
  getMarketFx,
  listChannelPriceAnnotations,
  listMarketPrices,
  MODEL_TYPE_LABELS,
  type ChannelPriceAnnotation,
  type MarketModel,
  type MarketProvider,
  type ModelType,
} from "@/lib/tauri";
import { annotationEffective, annotationTooltip, toCnyForSort } from "@/lib/annotationPrice";
import { openExternal } from "@/lib/external";
import { useUiStore, type MarketCurrency } from "@/stores/ui";

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
  // 比价排序：模型名 / 市场输入价 / 市场输出价（键 = max(单一, 低谷) 的市场价，折算后比较）
  const [priceSort, setPriceSort] = useState<"name" | "input" | "output">("name");
  // 价格排序方向（按模型名时忽略）
  const [priceDir, setPriceDir] = useState<"asc" | "desc">("asc");
  // 比价模式：搜索时把模型列表的渠道标注行插入表格并排比价
  const [compareMode, setCompareMode] = useState(false);
  // 渠道标注（比价列）：actualModelId（小写）→ 标注行
  const annotationsQuery = useQuery({
    queryKey: ["channel-price-annotations"],
    queryFn: listChannelPriceAnnotations,
    staleTime: 60_000,
  });
  const annotationMap = useMemo(() => {
    const map = new Map<string, ChannelPriceAnnotation[]>();
    for (const a of annotationsQuery.data ?? []) {
      const key = a.actualModelId.trim().toLowerCase();
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    return map;
  }, [annotationsQuery.data]);
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

  // 摊平成模型行（分页按模型计数，不按厂商）；价格排序按 max(单一, 低谷) 市场价折算 CNY
  const flatRows = useMemo(() => {
    const rows: { provider: MarketProvider; model: MarketModel }[] = [];
    for (const { provider, models } of filtered) {
      for (const model of models) rows.push({ provider, model });
    }
    if (priceSort === "name") return rows;
    const fxForSort = fx?.rate ?? null;
    const keyOf = (m: MarketModel): number | null => {
      const vals =
        priceSort === "input"
          ? [m.inputPer1m, m.offPeak?.inputPer1m ?? null]
          : [m.outputPer1m, m.offPeak?.outputPer1m ?? null];
      let best: number | null = null;
      for (const v of vals) {
        const cny = toCnyForSort(v, m.currency, fxForSort);
        if (cny !== null && (best === null || cny > best)) best = cny;
      }
      return best;
    };
    return [...rows].sort((a, b) => {
      const av = keyOf(a.model);
      const bv = keyOf(b.model);
      if (av === null && bv === null) return a.model.model.localeCompare(b.model.model);
      if (av === null) return 1;
      if (bv === null) return -1;
      const diff = av - bv;
      return priceDir === "asc" ? diff : -diff; // 无价始终垫底
    });
  }, [filtered, priceSort, priceDir, fx]);
  const pageCount = Math.max(Math.ceil(flatRows.length / pageSize), 1);
  const safePage = Math.min(page, pageCount);
  const pageRows = flatRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const modelCount = filtered.reduce((n, e) => n + e.models.length, 0);

  /** 比价模式：按当前搜索词匹配的渠道标注行（市场无此模型时也能单独展示）。 */
  const matchedAnnotations = () => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return [...annotationMap.entries()]
      .filter(([modelKey]) => modelKey.includes(q))
      .flatMap(([, list]) => list);
  };

  // source 形如 "bundled + cn/2026-11 + sources"（国内价叠加层 / 自定义源标注）
  const baseSource = snapshot?.source.split(" + cn/")[0] ?? "";
  const cnDate = snapshot?.source.match(/\+ cn\/([\d-]+)/)?.[1];
  const sourceLabel = snapshot
    ? `${baseSource === "models.dev" ? `已抓取 models.dev · ${fmtTime(snapshot.fetchedAt)}` : `内置快照 ${snapshot.snapshotDate}`}${cnDate ? ` · 国内价 ${cnDate}` : ""}`
    : "";

  const QUICK_MODELS = ["glm", "gpt", "deepseek", "claude", "gemini", "kimi", "qwen", "minimax"];

  return (
    <>
      <PageHeader
        title="市场信息"
        description={
          snapshot
            ? `各厂商模型价格快照 · ${sourceLabel} · 每百万 token，币种见列。数据来源见各行厂商链接。仅供参考，不算费用。`
            : "各厂商模型价格参考"
        }
        actions={
          <div className="flex flex-col items-end gap-0.5">
            <Button onClick={() => fetchMutation.mutate()} disabled={fetchMutation.isPending}>
              <CloudDownload className="size-4" />
              {fetchMutation.isPending ? "抓取中…" : "抓取数据"}
            </Button>
            <span className="text-muted-foreground text-[10px]">
              {snapshot?.fetchedAt ? `抓取于 ${fmtTime(snapshot.fetchedAt)}` : "未抓取（用内置快照）"}
            </span>
          </div>
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
        {/* 常用模型快捷筛选：点击模糊搜索，再点取消 */}
        <div className="flex flex-wrap items-center gap-1">
          {QUICK_MODELS.map((chip) => {
            const active = search.trim().toLowerCase() === chip;
            return (
              <Button
                key={chip}
                size="sm"
                variant={active ? "secondary" : "ghost"}
                className="h-7 rounded-full px-2.5 text-xs"
                onClick={() => {
                  setSearch(active ? "" : chip);
                  setPage(1);
                }}
              >
                {chip}
              </Button>
            );
          })}
        </div>
        <Select
          value={priceSort}
          onValueChange={(v) => {
            setPriceSort(v as "name" | "input" | "output");
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-36 text-sm" title="排序键 = max(单一价, 低谷价, 阶梯最高档) 折算 CNY（无价垫底）">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">按模型名</SelectItem>
            <SelectItem value="input">按输入价</SelectItem>
            <SelectItem value="output">按输出价</SelectItem>
          </SelectContent>
        </Select>
        {priceSort !== "name" ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            title={priceDir === "asc" ? "当前从低到高，点击切换为从高到低" : "当前从高到低，点击切换为从低到高"}
            onClick={() => setPriceDir(priceDir === "asc" ? "desc" : "asc")}
          >
            {priceDir === "asc" ? "低 → 高" : "高 → 低"}
          </Button>
        ) : null}
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
        {/* 比价模式：搜索特定模型时把模型列表的渠道标注行插进来并排比价 */}
        {search.trim() !== "" ? (
          <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs">
            <Switch checked={compareMode} onCheckedChange={setCompareMode} />
            比价（加入模型列表渠道标注）
          </label>
        ) : null}
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
                {!compareMode ? (
                  <TableHead
                    className="w-44"
                    title="渠道标注实际价（原价 × 倍率，含阶梯 / 低谷最高档）；悬浮看明细"
                  >
                    渠道标注（实际价）
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {flatRows.length === 0 && !compareMode ? (
                <TableRow>
                  <TableCell colSpan={compareMode ? 6 : 7} className="text-muted-foreground py-8 text-center text-sm">
                    没有匹配的模型
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {pageRows.map(({ provider, model }) => {
                    const key = `${provider.id}:${model.model}`;
                    // 比价模式：同名模型的渠道标注行紧跟市场行（不参与分页计数）
                    const anns = compareMode
                      ? (annotationMap.get(model.model.trim().toLowerCase()) ?? [])
                      : [];
                    return (
                      <Fragment key={key}>
                        <MarketModelRow
                          provider={provider}
                          model={model}
                          displayCurrency={currencyMode}
                          fxRate={rate}
                          hideCompareCell={compareMode}
                          annotations={
                            compareMode ? [] : (annotationMap.get(model.model.trim().toLowerCase()) ?? [])
                          }
                        />
                        {anns.map((a) => (
                          <AnnotationCompareRow key={a.channelModelId} annotation={a} />
                        ))}
                      </Fragment>
                    );
                  })}
                  {compareMode && flatRows.length === 0
                    ? // 市场无此模型时只显示标注行（自建渠道独有模型也能比价）
                      matchedAnnotations().map((a) => (
                        <AnnotationCompareRow key={a.channelModelId} annotation={a} />
                      ))
                    : null}
                </>
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
        国际厂商价格来自{" "}
        <a
          href="https://models.dev"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
          onClick={(e) => {
            e.preventDefault();
            void openExternal("https://models.dev");
          }}
        >
          models.dev
        </a>
        （USD）；国内厂商为官网抓取的人民币价（低谷分时段价见行内小字），由 `pnpm market:cn-refresh`
        维护快照；自定义源价格为 NewAPI 倍率折算的估算值。数据来源以各行「厂商」链接（价格页）为准。折算视图：
        {rateLabel}。
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
  hideCompareCell,
  annotations,
}: {
  provider: MarketProvider;
  model: MarketModel;
  displayCurrency: MarketCurrency;
  fxRate: number;
  /** 比价模式：渠道标注以独立行展示，隐藏本行的比价单元格 */
  hideCompareCell?: boolean;
  /** 本模型的渠道标注（比价列数据；hideCompareCell 时忽略） */
  annotations?: ChannelPriceAnnotation[];
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
      {hideCompareCell ? null : (
        <TableCell className="align-top">
          <AnnotationCompareCell annotations={annotations ?? []} />
        </TableCell>
      )}
    </TableRow>
  );
}

/** 比价模式下的渠道标注行：厂商列展示「模型列表 · 渠道名」，价格为标注实际价（最高档口径）。 */
function AnnotationCompareRow({ annotation: a }: { annotation: ChannelPriceAnnotation }) {
  const eff = annotationEffective(a);
  const sym = CURRENCY_SYMBOL[a.priceCurrency] ?? "";
  const fmt = (v: number | null) => (v === null ? "—" : `${sym}${Number(v.toFixed(4))}`);
  const marks = [
    a.priceMultiplier !== 1 ? `×${a.priceMultiplier}` : null,
    eff.hasTiers ? "阶梯" : null,
    eff.hasOffPeak ? "分时段" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <TableRow className="bg-muted/40">
      <TableCell className="align-top">
        <code className="text-xs font-medium">{a.actualModelId}</code>
      </TableCell>
      <TableCell className="align-top">
        <span
          className="inline-flex items-center gap-1.5 text-sm"
          title={`来源：模型列表的渠道标注（渠道 ${a.channelName}）\n${annotationTooltip(a)}`}
        >
          <Badge variant="secondary" className="text-[9px]">
            模型列表
          </Badge>
          {a.channelName}
        </span>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant="outline" className="text-[10px]">
          标注
        </Badge>
      </TableCell>
      <TableCell className="text-right align-top tabular-nums text-xs">
        {fmt(eff.input)}
        {marks ? <span className="text-muted-foreground text-[10px]"> {marks}</span> : null}
      </TableCell>
      <TableCell className="text-muted-foreground text-right align-top text-xs">—</TableCell>
      <TableCell className="text-right align-top tabular-nums text-xs">{fmt(eff.output)}</TableCell>
    </TableRow>
  );
}

/** 渠道标注比价格：各渠道的实际价（原价 × 倍率，最高档口径），悬浮显示明细。 */
function AnnotationCompareCell({ annotations }: { annotations: ChannelPriceAnnotation[] }) {
  if (annotations.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <div className="space-y-1">
      {annotations.map((a) => {
        const eff = annotationEffective(a);
        const sym = CURRENCY_SYMBOL[a.priceCurrency] ?? "";
        const fmt = (v: number | null) => (v === null ? "—" : `${sym}${Number(v.toFixed(4))}`);
        const marks =
          a.priceMultiplier !== 1 || eff.hasTiers || eff.hasOffPeak
            ? `（${[
                a.priceMultiplier !== 1 ? `×${a.priceMultiplier}` : null,
                eff.hasTiers ? "阶梯" : null,
                eff.hasOffPeak ? "分时段" : null,
              ]
                .filter(Boolean)
                .join(" ")}）`
            : "";
        return (
          <p
            key={a.channelModelId}
            className="text-xs tabular-nums"
            title={`${a.channelName} · 标注明细：\n${annotationTooltip(a)}`}
          >
            <span className="font-medium">{a.channelName}</span>{" "}
            <span className="text-muted-foreground">
              {fmt(eff.input)} / {fmt(eff.output)} {marks}
            </span>
          </p>
        );
      })}
    </div>
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
