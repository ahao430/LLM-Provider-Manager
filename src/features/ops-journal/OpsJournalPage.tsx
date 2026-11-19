import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useAddOpsLog,
  useAddTodo,
  useDeleteOpsLog,
  useDeleteTodo,
  useOpsLogs,
  useTodos,
  useToggleTodo,
} from "@/features/ops-journal/api";

/**
 * 运维记录页（/ops）：待办与运维日志的完整管理。
 * 仪表盘「近期事项」卡为汇总视图，管理入口跳转到本页。
 */
export function OpsJournalPage() {
  return (
    <>
      <PageHeader
        title="运维记录"
        description="渠道管理的日常：待办（准备做什么）与运维日志（每天做了什么）。随本机备份保留。"
      />
      <Tabs defaultValue="todos">
        <TabsList>
          <TabsTrigger value="todos">待办</TabsTrigger>
          <TabsTrigger value="logs">日志</TabsTrigger>
        </TabsList>
        <TabsContent value="todos" className="space-y-4">
          <TodosCard />
        </TabsContent>
        <TabsContent value="logs" className="space-y-4">
          <OpsLogCard />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ------------------------------------------------------------------
// 待办（标题 + 可选截止日；逾期置顶标红，勾选完成 / 重开）
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
      await add.mutateAsync({ title: title.trim(), dueDate: dueDate || null });
      setTitle("");
      setDueDate("");
    } catch {
      // 错误 toast 在 hook 内
    }
  }

  const visible = todos.filter((t) => showDone || !t.done);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">待办清单</CardTitle>
          <CardDescription>逾期的排最前并标红；勾选完成后可在「已完成」里查看 / 重开。</CardDescription>
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
            <p className="text-muted-foreground py-6 text-center text-sm">暂无待办。</p>
          ) : (
            visible.map((t) => {
              const overdue = !t.done && t.dueDate && t.dueDate < today;
              return (
                <div key={t.id} className="group flex items-start gap-2 rounded-md border p-2.5">
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={(e) => toggle.mutate({ id: t.id, done: e.target.checked })}
                    className="accent-primary mt-0.5 size-4"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}>
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
// 运维日志（只追加；误写可删单条）
// ------------------------------------------------------------------

function OpsLogCard() {
  const add = useAddOpsLog();
  const remove = useDeleteOpsLog();
  const { data: logs = [] } = useOpsLogs(50);
  const [content, setContent] = useState("");

  async function handleAdd() {
    if (!content.trim()) {
      toast.error("请填写日志内容");
      return;
    }
    try {
      await add.mutateAsync({ content: content.trim() });
      setContent("");
    } catch {
      // 错误 toast 在 hook 内
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">运维日志</CardTitle>
        <CardDescription>
          记录每天做了什么（换 key / 充值 / 联系工单 / 改配置…）；只追加，误写可删单条。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="今天做了什么…（Enter 保存，Shift+Enter 换行）"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleAdd();
            }
          }}
        />
        <div className="space-y-1.5">
          {logs.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">暂无日志。</p>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="group flex items-start gap-2 rounded-md border p-2.5">
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
        {logs.length >= 50 ? (
          <p className="text-muted-foreground text-xs">仅显示最近 50 条。</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
