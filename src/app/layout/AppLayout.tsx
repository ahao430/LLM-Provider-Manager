import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/app/layout/Sidebar";
import { restoreScrollPosition, saveScrollPosition } from "@/lib/sessionState";

export function AppLayout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);

  // 路由切换时恢复该页上次的滚动高度（内存级，会话内有效）
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const top = restoreScrollPosition(location.pathname);
    requestAnimationFrame(() => {
      main.scrollTop = top;
    });
  }, [location.pathname]);

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <Sidebar />
      {/* 顶栏已移除（v0.18.0）：内容直达顶部；版本号在侧边栏底部 */}
      <main
        ref={mainRef}
        className="min-w-0 flex-1 overflow-y-auto"
        onScroll={(e) => saveScrollPosition(location.pathname, (e.target as HTMLElement).scrollTop)}
      >
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6 xl:max-w-7xl 2xl:max-w-none">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
