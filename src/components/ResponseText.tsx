import { MarkdownView } from "@/components/MarkdownView";
import { Button } from "@/components/ui/button";
import { useUiStore, type ResponseRenderMode } from "@/stores/ui";

const MODES: { value: ResponseRenderMode; label: string }[] = [
  { value: "markdown", label: "Markdown" },
  { value: "text", label: "文本" },
];

/**
 * 模型响应文本：Markdown / 纯文本双模式，偏好经 useUiStore 全局共用（三处测试响应区一致）。
 * 默认 markdown；thinking / 错误 / 工具调用等事实性内容不经过此组件，保持纯文本。
 */
export function ResponseText({
  content,
  maxH = "max-h-96",
  textCls = "text-sm",
}: {
  content: string;
  maxH?: string;
  textCls?: string;
}) {
  const mode = useUiStore((s) => s.responseRenderMode);
  const setMode = useUiStore((s) => s.setResponseRenderMode);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        {MODES.map((m) => (
          <Button
            key={m.value}
            size="sm"
            variant={mode === m.value ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setMode(m.value)}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <div className={`rounded-md border p-3 ${maxH} overflow-auto ${textCls}`}>
        {mode === "markdown" ? (
          <MarkdownView content={content} />
        ) : (
          <pre className="whitespace-pre-wrap break-words">{content || "（无文本）"}</pre>
        )}
      </div>
    </div>
  );
}
