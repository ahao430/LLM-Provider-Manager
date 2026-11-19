import { createPortal } from "react-dom";
import { Toaster as Sonner } from "sonner";

/**
 * 全局通知组件（Sonner）。样式令牌与 shadcn/ui 保持一致。
 *
 * 用 createPortal 挂到 document.body 根部：toast 的 fixed 定位不应受任何
 * transform / 滚动容器祖先影响（WKWebView 上曾出现 toast 跟随文档滚动、
 * 在视口底部渲染并撑出页面滚动条的问题，见 v0.30.4）。
 */
function Toaster() {
  return createPortal(
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "bg-popover text-popover-foreground border-border rounded-lg border shadow-lg",
          description: "text-muted-foreground",
        },
      }}
    />,
    document.body,
    "lcm-toaster"
  );
}

export { Toaster };
