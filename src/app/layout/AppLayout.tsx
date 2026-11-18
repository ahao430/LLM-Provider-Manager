import { Outlet, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Sidebar } from "@/app/layout/Sidebar";
import { findNavItem } from "@/lib/navigation";
import { useAppInfo } from "@/hooks/use-app-info";

export function AppLayout() {
  const location = useLocation();
  const current = findNavItem(location.pathname);
  const { data: appInfo } = useAppInfo();

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
          <div className="text-muted-foreground truncate text-sm">
            LCM{current ? ` / ${current.label}` : ""}
          </div>
          <div className="flex items-center gap-2">
            {appInfo ? (
              <Badge variant="secondary">v{appInfo.version}</Badge>
            ) : (
              <Badge variant="outline">v?</Badge>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
