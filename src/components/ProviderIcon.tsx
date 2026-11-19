import { PROVIDER_ICON_DEFS, type ProviderIconDef } from "@/lib/providerIcons";
import { cn } from "@/lib/utils";

/** 品牌图标查表：支持市场 id（openai/deepseek/…）与渠道服务商 code（bailian/newapi/…）别名。 */
function lookupIconDef(id: string | null | undefined): ProviderIconDef | null {
  if (!id) return null;
  const key = id.toLowerCase().normalize();
  const ALIAS: Record<string, string> = {
    // 市场厂商 id → simple-icons slug
    google: "googlegemini",
    mistral: "mistralai",
    alibaba: "alibabacloud",
    // 渠道服务商 code → 品牌 slug
    bailian: "alibabacloud",
  };
  const mapped = ALIAS[key];
  return PROVIDER_ICON_DEFS[mapped ?? key] ?? null;
}

/** 字母回退块（查不到品牌的厂商）。 */
function LetterFallback({ name, className }: { name: string; className?: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold leading-none",
        className
      )}
    >
      {letter}
    </span>
  );
}

/**
 * 厂商品牌图标：查表渲染 simple-icons 品牌色 SVG；查不到的品牌回退字母块（名称首字符）。
 * 不做任何远程加载；近黑色品牌色在深色模式下自动反色。
 */
export function ProviderIcon({
  id,
  name,
  className,
}: {
  id?: string | null;
  name?: string | null;
  className?: string;
}) {
  const def = lookupIconDef(id);
  if (def) {
    const rgbSum =
      parseInt(def.hex.slice(0, 2), 16) +
      parseInt(def.hex.slice(2, 4), 16) +
      parseInt(def.hex.slice(4, 6), 16);
    return (
      <svg
        viewBox="0 0 24 24"
        fill={"#" + def.hex}
        aria-hidden
        className={cn("size-4 shrink-0", rgbSum < 150 && "dark:invert", className)}
      >
        <path d={def.path} />
      </svg>
    );
  }
  return <LetterFallback name={name ?? id ?? "?"} className={className} />;
}