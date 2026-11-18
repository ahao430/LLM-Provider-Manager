import { Navigate, NavLink, useParams } from "react-router-dom";

import { ApiTestingPage } from "@/features/api-testing/ApiTestingPage";
import { AgentPage } from "@/features/agent/AgentPage";
import { ImageDrawingPage, ImageVisionPage } from "@/features/image-workbench/ImageWorkbenchPage";
import { cn } from "@/lib/utils";

/**
 * 测试中心：API 测试 / Agent 测试 / 画图 / 图像理解收敛为一个菜单。
 * 子页各自保留标题与工具栏；这里只提供 Tab 切换（路由化，支持前进后退）。
 */
const TABS = [
  { id: "api", label: "API 测试" },
  { id: "agent", label: "Agent 测试" },
  { id: "image", label: "画图" },
  { id: "vision", label: "图像理解" },
] as const;

export function TestingPage() {
  const { tab } = useParams();
  const current = TABS.find((t) => t.id === tab);
  if (!current) return <Navigate to="/testing/api" replace />;

  return (
    <div className="space-y-6">
      <div className="bg-muted text-muted-foreground inline-flex rounded-lg p-1">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/testing/${t.id}`}
            className={({ isActive }) =>
              cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "hover:text-foreground"
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      {current.id === "api" ? <ApiTestingPage /> : null}
      {current.id === "agent" ? <AgentPage /> : null}
      {current.id === "image" ? <ImageDrawingPage /> : null}
      {current.id === "vision" ? <ImageVisionPage /> : null}
    </div>
  );
}
