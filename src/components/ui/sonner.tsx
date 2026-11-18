import { Toaster as Sonner } from "sonner";

/** 全局通知组件（Sonner）。样式令牌与 shadcn/ui 保持一致。 */
function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "bg-popover text-popover-foreground border-border rounded-lg border shadow-lg",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}

export { Toaster };
