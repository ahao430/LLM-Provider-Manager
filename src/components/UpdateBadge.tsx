import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAppInfo, useDownloadUpdate, useInstallUpdate, useUpdateCheck } from "@/hooks/use-app-info";
import { cn } from "@/lib/utils";

/**
 * 侧边栏版本行：启动即检测更新（useUpdateCheck）；点击版本号可手动重新检查。
 * 有新版本时一键下载安装包并引导覆盖安装。
 */
export function UpdateBadge({ collapsed }: { collapsed: boolean }) {
  const queryClient = useQueryClient();
  const { data: appInfo } = useAppInfo();
  const { data: update, isFetching, refetch } = useUpdateCheck();
  const download = useDownloadUpdate();
  const install = useInstallUpdate();
  const [installing, setInstalling] = useState(false);

  async function handleCheck() {
    await queryClient.invalidateQueries({ queryKey: ["update-check"] });
    try {
      const res = await refetch();
      const latest = res.data?.latestVersion;
      if (res.data?.hasUpdate && latest) {
        toast.info(`发现新版本 v${latest}，点旁边「升级」按钮下载安装`);
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
      toast.info(`开始下载 v${update.latestVersion} 安装包…（已存到数据目录 updates/）`);
      const res = await download.mutateAsync();
      const ok = window.confirm(
        `安装包 ${res.fileName} 已下载完成。\n立即运行安装器覆盖安装？（应用将退出，安装后重新打开）`
      );
      if (!ok) {
        toast.info(`已保存到 ${res.filePath}，可稍后手动运行安装`);
        return;
      }
      setInstalling(true);
      await install.mutateAsync(res.filePath);
      toast.success("安装器已启动，按引导完成覆盖安装即可");
    } catch (e) {
      toast.error(`更新失败：${e}`);
    } finally {
      setInstalling(false);
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
          onClick={handleUpgrade}
          disabled={download.isPending || installing}
        >
          {download.isPending || installing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ArrowUpCircle className="size-3" />
          )}
          {!collapsed && (download.isPending ? "下载中…" : `升级 v${update!.latestVersion}`)}
        </Button>
      ) : null}
    </div>
  );
}
