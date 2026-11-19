import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  className?: string;
  actions?: React.ReactNode;
}

/** 页面统一标题区（滚动吸顶：负 margin 盖住内容 wrapper 的 p-6，全宽贴顶）。 */
export function PageHeader({ title, description, className, actions }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 -mx-6 -mt-6 flex items-start justify-between gap-4 border-b border-border/60 bg-background/95 px-6 pb-3 pt-6 backdrop-blur supports-[backdrop-filter]:bg-background/75",
        className
      )}
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
