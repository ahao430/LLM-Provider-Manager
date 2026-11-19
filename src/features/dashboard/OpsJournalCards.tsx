import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, ListChecks, PenLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIncidents } from "@/features/channels/api";
import { useOpsLogs, useTodos } from "@/features/ops-journal/api";
import { fmtDayLabel, fmtLocalTime } from "@/lib/time";
import type { OpsLogRow, TodoRow } from "@/lib/tauri";

/**
 * 仪表盘近期事项汇总卡：日志 / 待办 / 未解决故障的混合动态表格。
 * 管理入口（添加 / 勾选 / 删除）在「运维记录」页（/ops）。
 */
export function RecentItemsCard() {
  const navigate = useNavigate();
  const { data: logs = [] } = useOpsLogs(10);
  const { data: todos = [] } = useTodos(true);
  const { data: incidents = [] } = useIncidents();

  const items = useMemo<RecentItem[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const list: RecentItem[] = [];
    for (const l of logs as OpsLogRow[]) {
      list.push({
        key: `log:${l.id}`,
        kind: "log",
        time: l.createdAt,
        timeLabel: fmtLocalTime(l.createdAt),
        content: l.content,
        channelName: l.channelName,
        urgent: false,
        done: true,
      });
    }
    for (const t of todos as TodoRow[]) {
      list.push({
        key: `todo:${t.id}`,
        kind: "todo",
        time: t.dueDate ?? t.createdAt,
        timeLabel: t.dueDate ? fmtDayLabel(t.dueDate) : fmtLocalTime(t.createdAt),
        content: t.title,
        channelName: t.channelName,
        urgent: !t.done && !!t.dueDate && t.dueDate < today,
        done: t.done,
      });
    }
    for (const i of incidents) {
      list.push({
        key: `incident:${i.id}`,
        kind: "incident",
        time: i.startedAt,
        timeLabel: fmtLocalTime(i.startedAt),
        content: `故障：${i.title}`,
        channelName: null,
        urgent: !i.resolvedAt,
        done: Boolean(i.resolvedAt),
      });
    }
    // 未完成/未解决的排前，同组按时间倒序
    return list.sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return b.time.localeCompare(a.time);
    });
  }, [logs, todos, incidents]);

  const KIND_META = {
    log: { label: "日志", variant: "secondary" as const, icon: PenLine },
    todo: { label: "待办", variant: "outline" as const, icon: ListChecks },
    incident: { label: "故障", variant: "destructive" as const, icon: Flag },
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">近期事项</CardTitle>
          <CardDescription>运维日志 / 待办 / 未解决故障的混合动态（未完事项排前）。</CardDescription>
        </div>
        <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => navigate("/ops")}>
          管理待办与日志 →
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            暂无事项。到「运维记录」页记录日志、添加待办，或到测试记录页标记故障事件。
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">类型</TableHead>
                <TableHead>事项</TableHead>
                <TableHead className="w-32">渠道</TableHead>
                <TableHead className="w-28">时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.slice(0, 10).map((item) => {
                const meta = KIND_META[item.kind];
                const Icon = meta.icon;
                return (
                  <TableRow key={item.key} className={item.urgent ? "" : "opacity-80"}>
                    <TableCell>
                      <Badge variant={meta.variant} className="gap-1">
                        <Icon className="size-3" />
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`max-w-96 truncate text-sm ${item.done && item.kind !== "incident" ? "text-muted-foreground line-through" : ""}`}
                      title={item.content}
                    >
                      {item.urgent ? (
                        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-red-500 align-middle" />
                      ) : null}
                      {item.content}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {item.channelName ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs tabular-nums">
                      {item.timeLabel}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface RecentItem {
  key: string;
  kind: "log" | "todo" | "incident";
  /** 排序键（UTC ISO 或本地 due_date 字符串） */
  time: string;
  /** 展示用（本地时区） */
  timeLabel: string;
  content: string;
  channelName: string | null;
  /** 待办逾期 / 故障未解决 */
  urgent: boolean;
  done: boolean;
}
