import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PenLine, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAddTodo, useOpsCalendar, useOpsDayItems, useToggleTodo } from "@/features/ops-journal/api";
import type { CalendarDay } from "@/lib/tauri";
import { fmtLocalTime } from "@/lib/time";

/** 本地时区日期串（YYYY-MM-DD）。不用 toISOString：它会转成 UTC，本地深夜会偏移一天，日历就会标错格。 */
function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 生成某月日历格（周一开头）。null 占位第一周之前的空白，保证每月 1 日对齐到正确的星期列。 */
function monthGrid(year: number, month: number): (string | null)[] {
  // getDay() 以周日为 0；+6 再 %7 把周一挪到 0 位，对齐「一 二 三 … 日」表头
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < offset; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return cells;
}

/**
 * 仪表盘运维日历卡：按天聚合日志 / 待办，有到期未完待办且日期已过的格子整格标红。
 * 点某天查看当日明细，并可直接给这天加待办；hooks 与「运维记录」页共用，增删后缓存自动一起刷新。
 */
export function OpsCalendarCard() {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  // 惰性初始化：选中日期只在首帧算一次本地「今天」，后续翻月不重置
  const [selected, setSelected] = useState<string>(() => localDateStr(now));
  const [quickTitle, setQuickTitle] = useState("");

  const { data: days = [] } = useOpsCalendar(cursor.year, cursor.month);
  const { data: dayItems, isLoading: dayLoading } = useOpsDayItems(selected);
  const addTodo = useAddTodo();
  const toggleTodo = useToggleTodo();

  const dayMap = useMemo(() => new Map<string, CalendarDay>(days.map((d) => [d.date, d])), [days]);
  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const today = localDateStr(new Date());
  const selLogs = dayItems?.logs ?? [];
  const selTodos = dayItems?.todos ?? [];

  function shiftMonth(delta: number) {
    setCursor((c) => {
      let year = c.year;
      let month = c.month + delta;
      if (month < 1) {
        year -= 1;
        month = 12;
      } else if (month > 12) {
        year += 1;
        month = 1;
      }
      return { year, month };
    });
  }

  async function handleQuickAdd() {
    if (!selected || !quickTitle.trim()) {
      return;
    }
    try {
      await addTodo.mutateAsync({ title: quickTitle.trim(), dueDate: selected });
      setQuickTitle("");
    } catch {
      // 错误 toast 在 hook 内
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">运维日历</CardTitle>
          <CardDescription>日志与待办的按天视图：点某天看当日明细，逾期未完的日期标红。</CardDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" title="上个月" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-20 text-center text-sm font-medium tabular-nums">
            {cursor.year}年{cursor.month}月
          </span>
          <Button variant="ghost" size="icon" className="size-7" title="下个月" onClick={() => shiftMonth(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-7 gap-1">
          {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
            <div key={w} className="text-muted-foreground text-center text-xs">
              {w}
            </div>
          ))}
          {cells.map((date, i) => {
            if (!date) {
              return <div key={`blank-${i}`} />;
            }
            const d = dayMap.get(date);
            const isToday = date === today;
            // 字符串直接比较：YYYY-MM-DD 字典序即时间序，无需构造 Date 对象
            const isOverdue = (d?.todoOpen ?? 0) > 0 && date < today;
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelected(date)}
                title={d ? `日志 ${d.logCount} · 待办 ${d.todoCount}（未完 ${d.todoOpen}）` : undefined}
                className={
                  "flex h-14 flex-col items-start justify-between rounded-md border p-1 text-xs transition-colors " +
                  (selected === date
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : isOverdue
                      ? "border-red-300 bg-red-50/60 hover:bg-red-100/70 dark:bg-red-950/30 dark:hover:bg-red-900/40"
                      : isToday
                        ? "border-primary/60 bg-primary/5 hover:bg-primary/10"
                        : "hover:bg-accent/60") +
                  ` ${isToday && selected !== date ? "ring-1 ring-primary/40" : ""}`
                }
              >
                <span className="leading-none">{Number(date.slice(8, 10))}</span>
                {/* inline-block + shrink-0：size-* 不改 display，裸 span 尺寸会坍缩/被拉伸 */}
                <span className="flex h-1.5 items-center gap-0.5">
                  {d && d.logCount > 0 ? (
                    <span className="inline-block size-1.5 shrink-0 rounded-full bg-sky-500" />
                  ) : null}
                  {d && d.todoOpen > 0 ? (
                    <span
                      className={`inline-block size-1.5 shrink-0 rounded-full ${isOverdue ? "bg-red-500" : "bg-amber-500"}`}
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-sky-500" />
            日志
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-amber-500" />
            待办到期
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-red-500" />
            逾期未完
          </span>
        </p>
        <div className="space-y-2 rounded-md border p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {selected
                ? `${Number(selected.slice(5, 7))}月${Number(selected.slice(8, 10))}日${
                    selected === today ? " · 今天" : ""
                  }`
                : "选择日期"}
            </p>
            <p className="text-muted-foreground text-xs">日志 {selLogs.length} · 待办 {selTodos.length}</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleQuickAdd()}
              placeholder="给这天加个待办…"
              className="flex-1"
            />
            <Button
              size="icon"
              onClick={() => void handleQuickAdd()}
              disabled={addTodo.isPending}
              title="添加待办"
            >
              <Plus className="size-4" />
            </Button>
          </div>
          {dayLoading ? <p className="text-muted-foreground text-center text-xs">加载中…</p> : null}
          {selTodos.map((t) => (
            <div key={t.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={t.done}
                onChange={(e) => toggleTodo.mutate({ id: t.id, done: e.target.checked })}
                className="accent-primary mt-0.5 size-3.5"
              />
              <p className={`min-w-0 flex-1 text-xs${t.done ? " text-muted-foreground line-through" : ""}`}>
                {t.title}
                {t.channelName ? (
                  <Badge variant="outline" className="ml-1.5 text-[10px]">
                    {t.channelName}
                  </Badge>
                ) : null}
              </p>
            </div>
          ))}
          {selLogs.map((l) => (
            <div key={l.id} className="flex items-start gap-2">
              <PenLine className="text-muted-foreground mt-0.5 size-3 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs whitespace-pre-wrap">{l.content}</p>
                <p className="text-muted-foreground text-[10px]">
                  {fmtLocalTime(l.createdAt)}
                  {l.channelName ? (
                    <Badge variant="outline" className="ml-1.5 text-[10px]">
                      {l.channelName}
                    </Badge>
                  ) : null}
                </p>
              </div>
            </div>
          ))}
          {!dayLoading && selTodos.length === 0 && selLogs.length === 0 ? (
            <p className="text-muted-foreground text-center text-xs">当日无待办与日志。</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
