/**
 * 渠道标注价格的计算口径（与市场价统一格式：单一 / 阶梯 / 分时段 + 倍率）。
 *
 * 与 Rust 侧 `channels::domain::annotation_compare_price` 保持同一口径：
 * - 实际价 = 原价 × 倍率（倍率缺省 1.0，非法 ≤0 按 1.0 处理不放大）
 * - 比价 / 排序键 = max(单一价, 阶梯最高档, 低谷价) × 倍率（输入 / 输出独立）
 * - 主展示价 = 单一价 × 倍率；无单一价时展示阶梯最高档 × 倍率
 *
 * 仅展示比较用，不参与本地测试费用估算（估算走 model_prices 价格历史）。
 */

/** 阶梯价一档（upTo = 累计输入 token 上限，单位百万；null = 无上限最后一档）。 */
export interface PriceTier {
  upTo: number | null;
  input: number | null;
  output: number | null;
}

/** 分时段（低谷）价。 */
export interface PriceOffPeak {
  window: string;
  input: number | null;
  output: number | null;
}

/** 标注价格形态（ChannelModelRow / AllChannelModelRow / ChannelPriceAnnotation 共有字段的最小集）。 */
export interface AnnotationPriceShape {
  priceInputPer1m: number | null;
  priceOutputPer1m: number | null;
  priceCurrency: string;
  priceMultiplier: number;
  priceTiers: PriceTier[] | null;
  priceOffPeak: PriceOffPeak | null;
}

export interface AnnotationEffective {
  /** 主展示价：单一价 × 倍率（无单一价取阶梯最高档 × 倍率） */
  input: number | null;
  output: number | null;
  /** 比价 / 排序键：max(单一, 阶梯最高档, 低谷) × 倍率（输入 / 输出独立） */
  compareInput: number | null;
  compareOutput: number | null;
  /** 展示主价实际来自哪一形态（悬浮明细用） */
  inputSource: "base" | "tier" | "offPeak" | null;
  outputSource: "base" | "tier" | "offPeak" | null;
  hasTiers: boolean;
  hasOffPeak: boolean;
}

const round6 = (v: number): number => Math.round(v * 1_000_000) / 1_000_000;

const normMultiplier = (m: number): number => (Number.isFinite(m) && m > 0 ? m : 1.0);

function maxSource(
  base: number | null,
  extras: { value: number | null; source: "tier" | "offPeak" }[]
): { value: number | null; source: AnnotationEffective["inputSource"] } {
  let best: { value: number | null; source: AnnotationEffective["inputSource"] } = {
    value: base,
    source: base !== null ? "base" : null,
  };
  for (const e of extras) {
    if (e.value !== null && (best.value === null || e.value > best.value)) {
      best = { value: e.value, source: e.source };
    }
  }
  return best;
}

/** 计算标注价的实际价与比价键（与后端 annotation_compare_price 同口径）。 */
export function annotationEffective(shape: AnnotationPriceShape): AnnotationEffective {
  const m = normMultiplier(shape.priceMultiplier);
  const tiers = shape.priceTiers ?? [];
  const op = shape.priceOffPeak;
  const mul = (v: number | null) => (v === null ? null : round6(v * m));

  // 比价键：恒取 max(单一, 阶梯最高档, 低谷)
  const inMax = maxSource(shape.priceInputPer1m, [
    ...tiers.map((t) => ({ value: t.input, source: "tier" as const })),
    { value: op?.input ?? null, source: "offPeak" as const },
  ]);
  const outMax = maxSource(shape.priceOutputPer1m, [
    ...tiers.map((t) => ({ value: t.output, source: "tier" as const })),
    { value: op?.output ?? null, source: "offPeak" as const },
  ]);

  // 主展示价：单一价优先，无单一价取最高档（阶梯 / 低谷）
  const display = (
    base: number | null,
    max: { value: number | null; source: AnnotationEffective["inputSource"] }
  ) =>
    base !== null
      ? { value: base, source: "base" as const }
      : { value: max.value, source: max.value !== null ? max.source : null };
  const inDisp = display(shape.priceInputPer1m, inMax);
  const outDisp = display(shape.priceOutputPer1m, outMax);

  return {
    input: mul(inDisp.value),
    output: mul(outDisp.value),
    compareInput: mul(inMax.value),
    compareOutput: mul(outMax.value),
    inputSource: inDisp.value !== null ? inDisp.source : null,
    outputSource: outDisp.value !== null ? outDisp.source : null,
    hasTiers: tiers.length > 0,
    hasOffPeak: Boolean(op),
  };
}

/** 悬浮明细：原价 × 倍率 = 实际价，含阶梯各档与低谷；无标注返回空串。 */
export function annotationTooltip(shape: AnnotationPriceShape): string {
  if (!shape.priceCurrency) return "";
  const m = normMultiplier(shape.priceMultiplier);
  const lines: string[] = [];
  const cur = shape.priceCurrency;
  const fmt = (v: number | null) => (v === null ? "—" : String(Number(v.toFixed(6))));
  const eff = (v: number | null) => (v === null ? "—" : fmt(round6(v * m)));

  if (shape.priceInputPer1m !== null || shape.priceOutputPer1m !== null) {
    lines.push(
      `单一价：输入 ${fmt(shape.priceInputPer1m)} / 输出 ${fmt(shape.priceOutputPer1m)}（实际 ${eff(
        shape.priceInputPer1m
      )} / ${eff(shape.priceOutputPer1m)}）`
    );
  }
  for (const [i, t] of (shape.priceTiers ?? []).entries()) {
    const cap = t.upTo === null ? "无上限" : `≤${t.upTo}M tokens`;
    lines.push(`阶梯${i + 1}（${cap}）：输入 ${fmt(t.input)} / 输出 ${fmt(t.output)}（实际 ${eff(t.input)} / ${eff(t.output)}）`);
  }
  if (shape.priceOffPeak) {
    const op = shape.priceOffPeak;
    lines.push(
      `低谷（${op.window}）：输入 ${fmt(op.input)} / 输出 ${fmt(op.output)}（实际 ${eff(op.input)} / ${eff(op.output)}）`
    );
  }
  const hasAny = shape.priceInputPer1m !== null || shape.priceOutputPer1m !== null || shape.priceTiers?.length || shape.priceOffPeak;
  if (!hasAny) return `币种 ${cur}（未填价格）`;
  const mulNote = m === 1.0 ? "" : `；倍率 ${m}（实际价 = 原价 × ${m}）`;
  const cmp = annotationEffective(shape);
  lines.push(
    `比价口径（按最高）：输入 ${fmt(cmp.compareInput)} / 输出 ${fmt(
      cmp.compareOutput
    )} ${cur}${mulNote}`
  );
  return lines.join("\n");
}

/**
 * 跨币种排序辅助：USD → CNY 折算（其余币种原样返回）。
 * fxRate 缺失时用兜底 7.2（≈ 估算语义，仅排序用）。
 */
export function toCnyForSort(value: number | null, currency: string, fxRate: number | null | undefined): number | null {
  if (value === null) return null;
  if (currency === "CNY") return value;
  if (currency === "USD") return value * (fxRate && fxRate > 0 ? fxRate : 7.2);
  return value;
}
