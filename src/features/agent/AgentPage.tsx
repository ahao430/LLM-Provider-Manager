import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, MessageSquarePlus, Send, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AGENT_MODE_LABELS,
  createConversation,
  deleteConversation,
  listAgentMessages,
  listConversations,
  sendAgentMessage,
  type AgentMessageRow,
  type AgentMode,
  type ApiTestStreamEvent,
  type ConversationRow,
} from "@/lib/tauri";
import { useChannelsForTest, useModelsForTest } from "@/features/api-testing/api";

/** 内嵌 Agent：先选模式（Claude Code / Codex），再选渠道模型，连续对话。 */
export function AgentPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: conversations = [] } = useQuery({
    queryKey: ["agent-conversations"],
    queryFn: listConversations,
  });
  const [activeId, setActiveId] = useState("");
  const active = conversations.find((c) => c.id === activeId) ?? null;

  // 顶部三联动选择器
  const [mode, setMode] = useState<AgentMode>("claude_code");
  const { data: channels = [] } = useChannelsForTest();
  const enabledChannels = useMemo(() => channels.filter((c) => c.enabled), [channels]);
  const [channelId, setChannelId] = useState("");
  const { data: models = [] } = useModelsForTest(channelId);
  const [modelId, setModelId] = useState("");
  const selectedModel = models.find((m) => m.id === modelId);

  const { data: messages = [] } = useQuery({
    queryKey: ["agent-messages", activeId],
    queryFn: () => listAgentMessages(activeId),
    enabled: activeId !== "",
  });

  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 切换对话时同步顶部选择器
  useEffect(() => {
    if (active) {
      setMode(active.mode as AgentMode);
      setChannelId(active.channelId);
      setModelId(active.channelModelId ?? "");
    }
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeId && conversations.length > 0) setActiveId(conversations[0].id);
  }, [conversations, activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, streaming]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!channelId) throw new Error("请先选择渠道");
      const finalModel = selectedModel?.actualModelId ?? "";
      if (!finalModel) throw new Error("请先选择模型");
      return createConversation({
        channelId,
        channelModelId: modelId || null,
        model: finalModel,
        mode,
        system: null,
      });
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["agent-conversations"] });
      setActiveId(row.id);
      toast.success(`新对话已创建（${AGENT_MODE_LABELS[row.mode as AgentMode]} 模式）`);
    },
    onError: (e) => toast.error(`创建失败：${e}`),
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!active) throw new Error("请先点击「新建对话」");
      return sendAgentMessage(
        { conversationId: active.id, content },
        (event: ApiTestStreamEvent) => {
          if (event.type === "delta") setStreaming((prev) => prev + event.delta);
        }
      );
    },
    onSuccess: (reply) => {
      setStreaming("");
      setDraft("");
      if (reply.status !== "success") toast.warning(`回复完成：${reply.status}`);
      void queryClient.invalidateQueries({ queryKey: ["agent-messages", reply.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["agent-conversations"] });
    },
    onError: (error) => {
      setStreaming("");
      toast.error(`发送失败：${error}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, id) => {
      toast.success("对话已删除");
      if (activeId === id) setActiveId("");
      queryClient.invalidateQueries({ queryKey: ["agent-conversations"] });
    },
    onError: (e) => toast.error(`删除失败：${e}`),
  });

  async function handleSend() {
    if (!draft.trim() || sendMutation.isPending) return;
    if (!active) {
      try {
        await createMutation.mutateAsync();
      } catch {
        return; // createMutation 已 toast
      }
      return;
    }
    setStreaming("");
    await sendMutation.mutateAsync(draft.trim());
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bot className="size-6" />
            内嵌 Agent
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            选模式 → 选渠道模型 → 连续对话；每轮请求写入测试记录。
          </p>
        </div>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !channelId || !modelId}
        >
          <MessageSquarePlus className="size-4" />
          {createMutation.isPending ? "创建中…" : "新建对话"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <div className="text-sm font-medium">对话（{conversations.length}）</div>
          </CardHeader>
          <CardContent className="space-y-1">
            {conversations.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                暂无对话；选好模式 / 渠道 / 模型后点击「新建对话」。
              </p>
            ) : (
              conversations.map((c: ConversationRow) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                    c.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => setActiveId(c.id)}
                  >
                    <Badge variant="outline" className="mr-1 text-[9px]">
                      {c.mode === "claude_code" ? "CC" : "CDX"}
                    </Badge>
                    {c.title}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => deleteMutation.mutate(c.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-[32rem] flex-col">
          {/* 顶部三联动选择器 */}
          <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
            <div className="w-40 space-y-1">
              <Label className="text-xs">模式</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as AgentMode)}>
                <SelectTrigger className="h-8 w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude_code">{AGENT_MODE_LABELS.claude_code}</SelectItem>
                  <SelectItem value="codex">{AGENT_MODE_LABELS.codex}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-48 space-y-1">
              <Label className="text-xs">渠道</Label>
              <Select
                value={channelId}
                onValueChange={(v) => {
                  setChannelId(v);
                  setModelId("");
                }}
              >
                <SelectTrigger className="h-8 w-full text-sm">
                  <SelectValue placeholder="选择渠道" />
                </SelectTrigger>
                <SelectContent>
                  {enabledChannels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-52 space-y-1">
              <Label className="text-xs">模型</Label>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="h-8 w-full text-sm">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.actualModelId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {active ? (
            <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden pt-4">
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
                {messages.length === 0 && !streaming ? (
                  <div className="text-muted-foreground flex h-full min-h-40 items-center justify-center text-sm">
                    输入消息开始连续对话（Enter 发送，Shift+Enter 换行）
                  </div>
                ) : null}
                {messages.map((m: AgentMessageRow) => (
                  <MessageBubble
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    traceId={m.traceId}
                    onOpenTrace={(id) => navigate(`/requests/${id}`)}
                  />
                ))}
                {streaming ? (
                  <MessageBubble role="assistant" content={streaming} traceId={null} streaming />
                ) : null}
              </div>
              <div className="flex items-end gap-2 border-t pt-3">
                <Input
                  value={draft}
                  placeholder="输入消息…"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  className="flex-1"
                />
                <Button onClick={handleSend} disabled={sendMutation.isPending}>
                  <Send className="size-4" />
                  {sendMutation.isPending ? "发送中…" : "发送"}
                </Button>
              </div>
            </CardContent>
          ) : (
            <CardContent className="flex flex-1 items-center justify-center">
              <div className="text-muted-foreground text-sm">
                选好模式 / 渠道 / 模型后，点击「新建对话」
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </>
  );
}

function MessageBubble({
  role,
  content,
  traceId,
  streaming,
  onOpenTrace,
}: {
  role: string;
  content: string;
  traceId: string | null;
  streaming?: boolean;
  onOpenTrace?: (traceId: string) => void;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-1 ${isUser ? "items-end" : ""}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          {content || (streaming ? <span className="animate-pulse">…</span> : "")}
        </div>
        {traceId && !isUser && onOpenTrace ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-primary flex items-center gap-1 text-[10px] hover:underline"
            onClick={() => onOpenTrace(traceId)}
          >
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              记录
            </Badge>
            {traceId.slice(0, 8)}…
          </button>
        ) : null}
      </div>
    </div>
  );
}
