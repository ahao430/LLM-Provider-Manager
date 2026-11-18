import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Network,
  Boxes,
  Store,
  FlaskConical,
  History,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  channels: Network,
  models: Boxes,
  market: Store,
  testing: FlaskConical,
  requests: History,
  settings: Settings,
};

export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "bg-sidebar text-sidebar-foreground flex h-full shrink-0 flex-col border-r transition-[width] duration-200",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-bold">
          L
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">LCM</div>
            <div className="text-muted-foreground truncate text-xs">Local Channel Manager</div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {navItems.map((item) => {
          const Icon = iconMap[item.key] ?? LayoutDashboard;
          return (
            <NavLink
              key={item.key}
              to={item.path}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-0"
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="space-y-1 border-t p-2">
        <ThemeToggle collapsed={collapsed} />
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
            collapsed && "justify-center px-0"
          )}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && <span>收起侧边栏</span>}
        </button>
      </div>
    </aside>
  );
}
