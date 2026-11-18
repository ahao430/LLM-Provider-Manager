import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/**
 * 通用分页条：上一页 / 下一页 + 每页数量调整。
 * 总数 ≤ 10 时不渲染（单页且无翻页意义，保持界面干净）。
 */
export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  unit = "条",
}: {
  /** 当前页（1 起） */
  page: number;
  /** 总页数（≥1） */
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** 计数单位（条 / 个） */
  unit?: string;
}) {
  if (total <= 10) return null;

  const safePageCount = Math.max(pageCount, 1);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
      <span className="text-muted-foreground text-xs tabular-nums">
        第 {page} / {safePageCount} 页 · 共 {total} {unit}
      </span>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">每页</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-7 w-[4.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-3.5" />
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page >= safePageCount}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
