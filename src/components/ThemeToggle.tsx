import { Monitor, Moon, Sun } from "lucide-react";

import { THEME_LABELS, useUiStore, type Theme } from "@/stores/ui";
import { cn } from "@/lib/utils";

const ICONS: Record<Theme, React.ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/** 主题快捷切换：循环 浅色 → 深色 → 跟随系统。 */
export function ThemeToggle({
  className,
  collapsed,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  const theme = useUiStore((s) => s.theme);
  const cycleTheme = useUiStore((s) => s.cycleTheme);
  const Icon = ICONS[theme];
  const next = theme === "light" ? "深色" : theme === "dark" ? "跟随系统" : "浅色";

  return (
    <button
      type="button"
      className={cn(
        "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
        collapsed && "justify-center px-0",
        className
      )}
      title={`主题：${THEME_LABELS[theme]}（点击切换为${next}）`}
      onClick={cycleTheme}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed ? <span className="truncate">主题：{THEME_LABELS[theme]}</span> : null}
    </button>
  );
}
