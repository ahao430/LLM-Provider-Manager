import { describe, expect, it } from "vitest";

import {
  annotationEffective,
  annotationTooltip,
  toCnyForSort,
  type AnnotationPriceShape,
} from "@/lib/annotationPrice";

const shape = (over: Partial<AnnotationPriceShape>): AnnotationPriceShape => ({
  priceInputPer1m: null,
  priceOutputPer1m: null,
  priceCurrency: "CNY",
  priceMultiplier: 1,
  priceTiers: null,
  priceOffPeak: null,
  ...over,
});

describe("annotationEffective", () => {
  it("单一价 × 倍率", () => {
    const e = annotationEffective(
      shape({ priceInputPer1m: 2, priceOutputPer1m: 8, priceMultiplier: 0.8 })
    );
    expect(e.input).toBeCloseTo(1.6);
    expect(e.output).toBeCloseTo(6.4);
    expect(e.compareInput).toBeCloseTo(1.6);
    expect(e.inputSource).toBe("base");
  });

  it("比价键取阶梯最高档与低谷的最大值", () => {
    const e = annotationEffective(
      shape({
        priceInputPer1m: 2,
        priceOutputPer1m: 8,
        priceTiers: [
          { upTo: 0.128, input: 4, output: 16 },
          { upTo: null, input: 2, output: 8 },
        ],
        priceOffPeak: { window: "00:30–08:30", input: 5, output: null },
      })
    );
    // 比价：max(2,4,2,5)=5 / max(8,16,8,null)=16
    expect(e.compareInput).toBeCloseTo(5);
    expect(e.compareOutput).toBeCloseTo(16);
    // 展示：单一价优先
    expect(e.input).toBeCloseTo(2);
    expect(e.output).toBeCloseTo(8);
  });

  it("无单一价时展示取阶梯最高档", () => {
    const e = annotationEffective(
      shape({ priceTiers: [{ upTo: null, input: 3, output: 12 }] })
    );
    expect(e.input).toBeCloseTo(3);
    expect(e.output).toBeCloseTo(12);
    expect(e.inputSource).toBe("tier");
  });

  it("非法倍率按 1.0 处理不放大", () => {
    const e = annotationEffective(shape({ priceInputPer1m: 3, priceMultiplier: -2 }));
    expect(e.input).toBeCloseTo(3);
  });

  it("全空返回 null", () => {
    const e = annotationEffective(shape({}));
    expect(e.input).toBeNull();
    expect(e.compareOutput).toBeNull();
    expect(e.inputSource).toBeNull();
  });
});

describe("annotationTooltip", () => {
  it("倍率明细与低谷说明", () => {
    const tip = annotationTooltip(
      shape({
        priceInputPer1m: 2,
        priceOutputPer1m: 8,
        priceMultiplier: 0.8,
        priceOffPeak: { window: "00:30–08:30 UTC+8", input: 1, output: 4 },
      })
    );
    expect(tip).toContain("单一价：输入 2 / 输出 8（实际 1.6 / 6.4）");
    expect(tip).toContain("低谷（00:30–08:30 UTC+8）");
    expect(tip).toContain("倍率 0.8");
  });

  it("未标币种返回空串", () => {
    expect(annotationTooltip(shape({ priceCurrency: "" }))).toBe("");
  });
});

describe("toCnyForSort", () => {
  it("USD 折算用实时汇率，缺失兜底 7.2", () => {
    expect(toCnyForSort(2, "USD", 7.5)).toBeCloseTo(15);
    expect(toCnyForSort(2, "USD", null)).toBeCloseTo(14.4);
    expect(toCnyForSort(2, "CNY", null)).toBeCloseTo(2);
    expect(toCnyForSort(null, "CNY", 7.5)).toBeNull();
  });
});
