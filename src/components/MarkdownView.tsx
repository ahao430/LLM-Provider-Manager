import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 响应文本的 Markdown 渲染。
 *
 * 选择 react-markdown 而非手写解析：组件映射只替换标签实现，不替换内容；
 * 默认跳过原始 HTML（无 dangerouslySetInnerHTML），XSS 风险低。
 * 不引入 @tailwindcss/typography，用组件映射直接给样式（可控且少一个插件依赖）。
 */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="space-y-1.5 text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-3 border-b pb-1 text-lg font-semibold" {...p} />,
          h2: (p) => <h2 className="mt-3 border-b pb-1 text-base font-semibold" {...p} />,
          h3: (p) => <h3 className="mt-2 text-sm font-semibold" {...p} />,
          h4: (p) => <h4 className="mt-2 text-sm font-semibold" {...p} />,
          p: (p) => <p className="leading-relaxed whitespace-pre-wrap" {...p} />,
          ul: (p) => <ul className="my-1.5 list-disc space-y-0.5 pl-5" {...p} />,
          ol: (p) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5" {...p} />,
          li: (p) => <li className="leading-relaxed" {...p} />,
          blockquote: (p) => (
            <blockquote className="border-l-2 pl-3 text-muted-foreground" {...p} />
          ),
          hr: () => <hr className="my-2" />,
          a: (p) => <a target="_blank" rel="noopener noreferrer" className="text-primary underline" {...p} />,
          strong: (p) => <strong className="font-semibold" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          // 行内代码与代码块：react-markdown 10 无 className 时为行内，有 language-xxx 时为块
          code: ({ className, children, ...rest }) =>
            className ? (
              <code
                className="block overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs"
                {...rest}
              >
                {children}
              </code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...rest}>
                {children}
              </code>
            ),
          pre: (p) => <pre className="my-1.5" {...p} />,
          table: (p) => (
            <div className="my-2 overflow-x-auto rounded-md border">
              <table className="w-full text-xs" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-muted/50" {...p} />,
          th: (p) => <th className="border-b px-2 py-1.5 text-left font-medium" {...p} />,
          td: (p) => <td className="border-b px-2 py-1.5 align-top" {...p} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
