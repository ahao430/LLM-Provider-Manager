import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ExternalLink, Search } from "lucide-react";
import { openExternal } from "@/lib/external";

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
import { Skeleton } from "@/components/ui/skeleton";
import { listMarketPrices, type MarketModel } from "@/lib/tauri";

/** 市场价 → 标注表单回填（原价直接填市场价，倍率留给用户自行配置）。 */
export interface MarketPricePick {
  input: number | null;
  output: number | null;
  currency: string;
}

/**
 * 市场价格参考弹窗：按模型 ID 在市场快照里搜索匹配条目，
 * 展示各厂商的单一价 / 低谷价 / 备注阶梯说明，一键回填标注表单。
 */
export function MarketPriceRefDialog({
  modelId,
  onPick,
  onClose,
}: {
  modelId: string;
  onPick: (pick: MarketPricePick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(modelId);
  const snapshot = useQuery({
    queryKey: ["market-prices-ref"],
    queryFn: listMarketPrices,
    staleTime: 10 * 60_000,
  });

  const { exact, contains } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !snapshot.data) return { exact: [] as MarketHit[], contains: [] as MarketHit[] };
    const hits: { providerName: string; pricingUrl: string; model: MarketModel }[] = [];
    for (const p of snapshot.data.providers) {
      for (const m of p.models) {
        if (m.model.toLowerCase().includes(q)) {
          hits.push({ providerName: p.name, pricingUrl: p.pricingUrl, model: m });
        }
      }
    }
    return {
      exact: hits.filter((h) => h.model.model.toLowerCase() === q),
      contains: hits.filter((h) => h.model.model.toLowerCase() !== q).slice(0, 20),
    };
  }, [query, snapshot.data]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>市场价格参考 — {modelId}</DialogTitle>
          <DialogDescription>
            来自市场信息快照（只读）；点「回填」把该条目的原价与币种填入标注表单，倍率请自行配置。
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型 ID（默认为当前模型）"
            className="pl-8"
          />
        </div>

        {snapshot.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : snapshot.isError ? (
          <p className="text-destructive text-sm">市场快照读取失败：{String(snapshot.error)}</p>
        ) : exact.length === 0 && contains.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            未找到匹配的市场条目；可到「市场信息」页抓取最新数据后再试。
          </p>
        ) : (
          <div className="space-y-4">
            {exact.length > 0 ? <HitList title={`精确匹配（${exact.length}）`} hits={exact} onPick={onPick} /> : null}
            {contains.length > 0 ? <HitList title={`包含匹配（${contains.length}）`} hits={contains} onPick={onPick} /> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface MarketHit {
  providerName: string;
  pricingUrl: string;
  model: MarketModel;
}

function HitList({
  title,
  hits,
  onPick,
}: {
  title: string;
  hits: MarketHit[];
  onPick: (pick: MarketPricePick) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">{title}</p>
      {hits.map((h, i) => (
        <MarketHitRow key={`${h.model.model}-${h.providerName}-${i}`} hit={h} onPick={onPick} />
      ))}
    </div>
  );
}

const CURRENCY_SYMBOL: Record<string, string> = { CNY: "¥", USD: "$" };

function MarketHitRow({ hit, onPick }: { hit: MarketHit; onPick: (pick: MarketPricePick) => void }) {
  const m = hit.model;
  const sym = CURRENCY_SYMBOL[m.currency] ?? "";
  const fmt = (v: number | null) => (v === null ? "—" : `${sym}${Number(v.toFixed(4))}`);
  const off = m.offPeak;

  return (
    <div className="flex items-start gap-3 rounded-lg border p-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <code className="text-xs font-medium">{m.model}</code>
          <Badge variant="secondary" className="text-[10px]">
            {hit.providerName}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-xs tabular-nums">
          输入 {fmt(m.inputPer1m)} · 缓存 {fmt(m.cachedInputPer1m)} · 输出 {fmt(m.outputPer1m)}（{m.currency} 每百万）
          {off ? (
            <span title={off.window} className="text-muted-foreground/90">
              {" "}· 低谷 {fmt(off.inputPer1m)} / {fmt(off.outputPer1m)}
            </span>
          ) : null}
        </p>
        {m.note ? <p className="text-muted-foreground mt-0.5 text-[10px]">{m.note}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPick({ input: m.inputPer1m, output: m.outputPer1m, currency: m.currency })}
        >
          <ArrowDownToLine className="size-3.5" />
          回填
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => void openExternal(hit.pricingUrl)}
        >
          <ExternalLink className="size-3.5" />
          价格页
        </Button>
      </div>
    </div>
  );
}
