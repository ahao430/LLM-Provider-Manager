import { useMemo, useState } from "react";
import { Flag, ListChecks, PenLine, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIncidents } from "@/features/channels/api";
import {
  useAddOpsLog,
  useAddTodo,
  useDeleteOpsLog,
  useDeleteTodo,
  useOpsLogs,
  useTodos,
  useToggleTodo,
} from "@/features/dashboard/ops-journal-api";
import type { OpsLogRow, TodoRow } from "@/lib/tauri";

const fmtTime = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;

/** 仪表盘运维区：近期事项表格（日志/待办/故障混合）+ 待办清单 + 运维日志。 */
export function OpsJournalCards() {
  return (
    <>
      <RecentItemsCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TodosCard />
        <OpsLogCard />
      </div>
    </>
  );
}

// ------------------------------------------------------------------
// 近期事项表格：三类动态混合（按时间倒序）
// ------------------------------------------------------------------

interface RecentItem {
  key: string;
  kind: "log" | "todo" | "incident";
  time: string;
  content: string;
  channelName: string | null;
  /** 待办：逾期 / 未完成；故障：未解决 */
  urgent: boolean;
  done: boolean;
}

function RecentItemsCard() {
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
      <CardHeader>
        <CardTitle className="text-base">近期事项</CardTitle>
        <CardDescription>运维日志 / 待办 / 未解决故障的混合动态（未完事项排前）。</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            暂无事项。在下方记录日志、添加待办，或到测试记录页标记故障事件。
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
              {items.slice(0, 12).map((item) => {
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
                      {fmtTime(item.time)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {incidents.some((i) => !i.resolvedAt) ? (
          <p className="text-muted-foreground mt-2 text-xs">
            有未解决故障——详情见渠道页「故障」Tab 或测试记录筛选。
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// 待办清单
// ------------------------------------------------------------------

function TodosCard() {
  const add = useAddTodo();
  const toggle = useToggleTodo();
  const remove = useDeleteTodo();
  const { data: todos = [] } = useTodos(true);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [showDone, setShowDone] = useState(false);

  async function handleAdd() {
    if (!title.trim()) {
      toast.error("请填写待办内容");
      return;
    }
    try {
      await add.mutateAsync({
        title: title.trim(),
        dueDate: dueDate || null,
      });
      setTitle("");
      setDueDate("");
    } catch {
      // 错误 toast 在 hook 内
    }
  }

  const visible = todos.filter((t) => showDone || !t.done);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">待办</CardTitle>
          <CardDescription>准备做什么；可设截止日期，逾期置顶标红。</CardDescription>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={() => setShowDone(!showDone)}
        >
          {showDone ? "隐藏已完成" : `已完成 ${todos.filter((t) => t.done).length}`}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
            placeholder="要做什么…"
            className="flex-1"
          />
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-36"
            title="截止日期（可选）"
          />
          <Button size="icon" onClick={handleAdd} disabled={add.isPending} title="添加待办">
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="space-y-1.5">
          {visible.length === 0 ? (
            <p className="text-muted-foreground py-3 text-center text-sm">暂无待办。</p>
          ) : (
            visible.map((t) => {
              const overdue = !t.done && t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10);
              return (
                <div key={t.id} className="group flex items-start gap-2 rounded-md border p-2">
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={(e) => toggle.mutate({ id: t.id, done: e.target.checked })}
                    className="accent-primary mt-0.5 size-4"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {t.title}
                      {t.channelName ? (
                        <Badge variant="outline" className="ml-1.5 text-[10px]">
                          {t.channelName}
                        </Badge>
                      ) : null}
                    </p>
                    {t.dueDate ? (
                      <p
                        className={`mt-0.5 text-xs tabular-nums ${overdue ? "font-medium text-red-500" : "text-muted-foreground"}`}
                      >
                        截止 {t.dueDate}
                        {overdue ? "（已逾期）" : ""}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
                    title="删除"
                    onClick={() => remove.mutate(t.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// 运维日志
// ------------------------------------------------------------------

function OpsLogCard() {
  const add = useAddOpsLog();
  const remove = useDeleteOpsLog();
  const { data: logs = [] } = useOpsLogs(20);
  const [content, setContent] = useState("");
  const [expanded, setExpanded] = useState(false);

  async function handleAdd() {
    if (!content.trim()) {
      toast.error("请填写日志内容");
      return;
    }
    try {
      await add.mutateAsync({ content: content.trim() });
      setContent("");
      setExpanded(false);
      toast.success("日志已记录");
    } catch {
      // 错误 toast 在 hook 内
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">运维日志</CardTitle>
          <CardDescription>记录每天做了什么（改配置 / 换 key / 充值 / 沟通…）。</CardDescription>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : "写日志"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {expanded ? (
          <div className="space-y-2">
            <Textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="今天做了什么（如：易准换 key、给 DeepSeek 充值 300、联系工单…）"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAdd} disabled={add.isPending}>
                {add.isPending ? "保存中…" : "记录"}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          {logs.length === 0 ? (
            <p className="text-muted-foreground py-3 text-center text-sm">暂无日志。</p>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="group flex items-start gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm whitespace-pre-wrap">{l.content}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {l.createdAt.slice(0, 19).replace("T", " ")}
                    {l.channelName ? (
                      <Badge variant="outline" className="ml-1.5 text-[10px]">
                        {l.channelName}
                      </Badge>
                    ) : null}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
                  title="删除"
                  onClick={() => remove.mutate(l.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
        {logs.length > 0 ? (
          <p className="text-muted-foreground text-xs">最近 {logs.length} 条（完整历史在数据库，随备份保留）。</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
