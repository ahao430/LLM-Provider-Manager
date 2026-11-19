import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, FileQuestion, Wrench } from "lucide-react";

import { ResponseText } from "@/components/ResponseText";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { reparseTestResponse, type ResponsePreview, type ToolCallPreview } from "@/lib/tauri";
import { useTestRaw } from "@/features/api-testing/api";

/** 一个对话回合（气泡）。 */
interface Turn {
  role: "system" | "user" | "assistant" | "tool";
  label: string;
  content: string;
  /** vision 等多模态块的图片占位数 */
  imageCount: number;
  toolName?: string;
  markdown?: boolean;
}

/** content 兼容字符串与 vision blocks 数组（type:text / type:image），拼文本 + 数图片。 */
function extractContent(content: unknown): { text: string; imageCount: number } {
  if (typeof content === "string") return { text: content, imageCount: 0 };
  if (Array.isArray(content)) {
    const parts: string[] = [];
    let images = 0;
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
        else if (b.type === "image" || b.type === "image_url" || b.source) images += 1;
      }
    }
    return { text: parts.join("\n"), imageCount: images };
  }
  return { text: "", imageCount: 0 };
}

/**
 * 从请求归档 body 提取消息回合（纯函数）。
 * openai_chat: body.messages[]（system 在首条）；anthropic: body.messages[] + 顶层 system；
 * openai_responses: body.input[] + instructions；agent_probe: body.prompt 单字符串。
 */
function buildTurns(
  body: Record<string, unknown> | null,
  requestType: string | null,
  preview: ResponsePreview | null
): Turn[] {
  // Agent 探针：单轮 prompt → result
  if (requestType === "agent_probe") {
    const prompt = body?.prompt;
    const turns: Turn[] = [];
    if (typeof prompt === "string" && prompt) {
      turns.push({ role: "user", label: "USER", content: prompt, imageCount: 0 });
    }
    if (preview && !preview.error && preview.text) {
      turns.push({ role: "assistant", label: "ASSISTANT", content: preview.text, imageCount: 0, markdown: true });
    }
    return turns;
  }

  const turns: Turn[] = [];
  const list =
    (Array.isArray(body?.messages) && body!.messages) ||
    (Array.isArray(body?.input) && body!.input) ||
    null;
  if (Array.isArray(list)) {
    for (const m of list as Record<string, unknown>[]) {
      if (!m || typeof m !== "object") continue;
      const role = typeof m.role === "string" ? m.role : "user";
      const { text, imageCount } = extractContent(m.content);
      const label = role.toUpperCase();
      turns.push({
        role: role === "system" ? "system" : role === "assistant" ? "assistant" : "user",
        label,
        content: text,
        imageCount,
        markdown: role === "assistant",
      });
    }
  }
  // 顶层 system（anthropic: body.system；responses: body.instructions）
  const topSystem =
    (typeof body?.system === "string" && body.system) ||
    (typeof body?.instructions === "string" && body.instructions) ||
    null;
  if (topSystem) {
    turns.unshift({ role: "system", label: "SYSTEM", content: topSystem, imageCount: 0 });
  }
  // 最终 assistant 回复（解析器产出；tool_calls 单独成 TOOL 气泡）
  if (preview && !preview.error) {
    if (preview.thinking) {
      turns.push({ role: "assistant", label: "THINKING", content: preview.thinking, imageCount: 0 });
    }
    if (preview.text) {
      turns.push({ role: "assistant", label: "ASSISTANT", content: preview.text, imageCount: 0, markdown: true });
    }
    for (const tc of preview.toolCalls) {
      turns.push(toolCallTurn(tc));
    }
  }
  return turns;
}

function toolCallTurn(tc: ToolCallPreview): Turn {
  let args = tc.arguments;
  try {
    args = JSON.stringify(JSON.parse(tc.arguments), null, 2);
  } catch {
    /* 保持原文 */
  }
  return {
    role: "tool",
    label: "TOOL",
    content: args || "（无参数）",
    imageCount: 0,
    toolName: tc.name ?? "unknown",
  };
}

/** 对话看板：把该次请求的完整交互（system / 用户 / 助手回复 / 工具调用）以气泡形式展示。 */
export function ConversationBoard({
  traceId,
  requestType,
}: {
  traceId: string;
  requestType: string | null;
}) {
  const rawQuery = useTestRaw(traceId, "request");
  const previewQuery = useQuery({
    queryKey: ["conversation-preview", traceId],
    queryFn: () => reparseTestResponse(traceId),
    staleTime: Infinity,
    retry: false,
  });

  const parsed = useMemo(() => {
    const text = rawQuery.data;
    if (!text) return null;
    try {
      const root = JSON.parse(text) as { body?: unknown };
      return root.body && typeof root.body === "object"
        ? (root.body as Record<string, unknown>)
        : null;
    } catch {
      return "parse-error" as const;
    }
  }, [rawQuery.data]);

  const turns = useMemo(
    () =>
      parsed && parsed !== "parse-error"
        ? buildTurns(parsed, requestType, previewQuery.data ?? null)
        : [],
    [parsed, requestType, previewQuery.data]
  );

  if (rawQuery.isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (rawQuery.isError) {
    return <p className="text-destructive text-sm">请求归档读取失败：{String(rawQuery.error)}</p>;
  }
  if (parsed === "parse-error" || !parsed) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
        <FileQuestion className="size-6" />
        该记录的请求归档不是结构化对话（可能为 Raw JSON 模式或旧格式），请到「Raw」页查看原文。
      </div>
    );
  }
  if (turns.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
        <FileQuestion className="size-6" />
        未能从归档中提取对话消息（vision 等记录的图片已摘要省略）。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {turns.map((t, i) => (
        <TurnBubble key={i} turn={t} />
      ))}
      {previewQuery.isLoading ? (
        <p className="text-muted-foreground text-xs">正在解析助手回复…</p>
      ) : previewQuery.isError ? (
        <p className="text-muted-foreground text-xs">
          助手回复解析失败（该归档可能无解析器）；完整原文见「Raw」页。
        </p>
      ) : null}
    </div>
  );
}

function TurnBubble({ turn }: { turn: Turn }) {
  // system 全宽灰卡；user 右对齐主色；assistant/tool 左对齐白/灰卡
  if (turn.role === "system") {
    return (
      <div className="rounded-md border bg-muted/40 p-3">
        <p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider">{turn.label}</p>
        <pre className="text-muted-foreground text-xs whitespace-pre-wrap break-words">{turn.content}</pre>
      </div>
    );
  }
  if (turn.role === "tool") {
    return (
      <div className="mr-12 rounded-md border bg-muted/30 p-3">
        <p className="text-muted-foreground mb-1 inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider">
          <Wrench className="size-3" />
          {turn.label} · {turn.toolName}
        </p>
        <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap break-words">{turn.content}</pre>
      </div>
    );
  }
  if (turn.label === "THINKING") {
    return (
      <details className="ml-12 rounded-md border bg-muted/20 p-3">
        <summary className="text-muted-foreground inline-flex cursor-pointer items-center gap-1 text-[10px] font-semibold tracking-wider">
          <Brain className="size-3" />
          思考过程（thinking）
        </summary>
        <pre className="text-muted-foreground mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap break-words">
          {turn.content}
        </pre>
      </details>
    );
  }
  const isUser = turn.role === "user";
  return (
    <div className={isUser ? "flex flex-col items-end" : "flex flex-col items-start"}>
      <div className={cnBubble(isUser)}>
        <p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider">
          {turn.label}
          {turn.imageCount > 0 ? (
            <Badge variant="secondary" className="ml-2 text-[9px]">
              [{turn.imageCount} 张图片已省略]
            </Badge>
          ) : null}
        </p>
        {turn.markdown ? (
          <ResponseText content={turn.content} maxH="max-h-[32rem]" />
        ) : (
          <pre className="text-sm whitespace-pre-wrap break-words">{turn.content || "（空）"}</pre>
        )}
      </div>
    </div>
  );
}

function cnBubble(isUser: boolean): string {
  return isUser
    ? "max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2"
    : "max-w-[85%] rounded-lg border bg-background px-3 py-2";
}
