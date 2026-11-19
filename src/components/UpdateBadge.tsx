import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAppInfo, useAutoUpdate, useUpdateCheck } from "@/hooks/use-app-info";
import { cn } from "@/lib/utils";
import type { UpdaterProgress } from "@/lib/updater";

const PROGRESS_TOAST_ID = "updater-progress";

function progressText(p: UpdaterProgress): string {
  const mb = (n: number) => (n / 1048576).toFixed(1);
  return p.total
    ? `下载更新中 ${mb(p.downloaded)} / ${mb(p.total)} MB`
    : `下载更新中 ${mb(p.downloaded)} MB`;
}

/**
 * 侧边栏版本行：启动即检测更新（useUpdateCheck）；点击版本号可手动重新检查。
 * 有新版本时一键更新（下载验签 → 自动重启生效，无需手动覆盖安装）。
 */
export function UpdateBadge({ collapsed }: { collapsed: boolean }) {
  const queryClient = useQueryClient();
  const { data: appInfo } = useAppInfo();
  const { data: update, isFetching, refetch } = useUpdateCheck();
  const autoUpdate = useAutoUpdate();

  async function handleCheck() {
    await queryClient.invalidateQueries({ queryKey: ["update-check"] });
    try {
      const res = await refetch();
      const latest = res.data?.latestVersion;
      if (res.data?.hasUpdate && latest) {
        toast.info(`发现新版本 v${latest}，点旁边「升级」按钮一键更新（自动重启）`);
      } else if (latest) {
        toast.success(`已是最新版本（v${latest}）`);
      } else {
        toast.info("尚无已发布版本");
      }
    } catch (e) {
      toast.error(`检查更新失败（需联网）：${e}`);
    }
  }

  async function handleUpgrade() {
    if (!update?.latestVersion) return;
    try {
      await autoUpdate.mutateAsync((progress) => {
        toast.loading(progressText(progress), { id: PROGRESS_TOAST_ID });
      });
      toast.success(`v${update.latestVersion} 更新完成，正在重启…`, {
        id: PROGRESS_TOAST_ID,
      });
    } catch (e) {
      toast.error(
        `一键更新失败：${e}。可到设置 → 关于「打开下载页」手动下载（Linux deb/rpm 安装请用包管理器升级）`,
        { id: PROGRESS_TOAST_ID, duration: 10000 }
      );
    }
  }

  const hasUpdate = Boolean(update?.hasUpdate && update.latestVersion);
  return (
    <div
      className={cn(
        "flex min-h-7 items-center justify-between gap-2 px-3 py-1",
        collapsed && "justify-center px-0"
      )}
    >
      {appInfo ? (
        <button
          type="button"
          className={cn(
            "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs tabular-nums",
            collapsed && "px-0"
          )}
          title="点击检查更新"
          onClick={handleCheck}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3 opacity-0 group-hover:opacity-100" />
          )}
          {!collapsed && `v${appInfo.version}`}
        </button>
      ) : null}
      {hasUpdate ? (
        <Button
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          title="下载更新并自动重启（无需手动覆盖安装）"
          onClick={handleUpgrade}
          disabled={autoUpdate.isPending}
        >
          {autoUpdate.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ArrowUpCircle className="size-3" />
          )}
          {!collapsed && (autoUpdate.isPending ? "更新中…" : `升级 v${update!.latestVersion}`)}
        </Button>
      ) : null}
    </div>
  );
}
