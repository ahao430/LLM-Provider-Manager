import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, ShieldAlert } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  exportChannelCredentials,
  listChannelCredentials,
  type ChannelCredentialRow,
} from "@/lib/tauri";

/** 组装 CSV 文本（UTF-8 BOM 由后端导出负责；剪贴板版自行加 BOM 便于 Excel 粘贴）。 */
function toCsv(rows: ChannelCredentialRow[]): string {
  const header = "渠道名,服务商,Base URL,Token";
  const lines = rows.map(
    (r) =>
      [
        r.channelName,
        r.providerName ?? "",
        r.baseUrl,
        r.token,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
  );
  return "\u{feff}" + [header, ...lines].join("\n");
}

/**
 * 凭证一览弹窗：全部渠道主凭证明文（用户主动触发），
 * 支持 CSV 一键复制与 CSV / Excel 文件导出（save 对话框选路径）。
 */
export function CredentialsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["channel-credentials"],
    queryFn: listChannelCredentials,
    enabled: open,
    staleTime: 0,
  });
  const configured = rows.filter((r) => r.token);

  const copyCsv = useMutation({
    mutationFn: async () => {
      const csv = toCsv(configured);
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(csv);
      return configured.length;
    },
    onSuccess: (n) => toast.success(`已复制 ${n} 条凭证（CSV，含表头，可粘贴进 Excel）`),
    onError: (e) => toast.error(`复制失败：${e}`),
  });

  const doExport = useMutation({
    mutationFn: async (format: "csv" | "xlsx") => {
      const path = await saveDialog({
        title: format === "csv" ? "导出凭证 CSV" : "导出凭证 Excel",
        defaultPath: `lcm-凭证-${new Date().toISOString().slice(0, 10)}.${format}`,
        filters: [
          { name: format.toUpperCase(), extensions: [format] },
        ],
      });
      if (!path) return null;
      const count = await exportChannelCredentials(path, format);
      return { path, count };
    },
    onSuccess: (res) => {
      if (!res) return;
      toast.success(`已导出 ${res.count} 条到 ${res.path}（明文文件请妥善保管，勿外传）`);
    },
    onError: (e) => toast.error(`导出失败：${e}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            凭证一览
            <Badge variant="destructive" className="text-[10px]">
              <ShieldAlert className="size-3" />
              明文敏感
            </Badge>
          </DialogTitle>
          <DialogDescription>
            全部渠道主凭证明文（仅本机存储，页面不会上传）。导出文件请妥善保管，勿提交仓库或外传。
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">还没有渠道。</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-medium">渠道</th>
                  <th className="px-2 py-1.5 font-medium">服务商</th>
                  <th className="px-2 py-1.5 font-medium">Base URL</th>
                  <th className="px-2 py-1.5 font-medium">Token</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.channelId} className="border-t">
                    <td className="px-2 py-1.5 font-medium">{r.channelName}</td>
                    <td className="text-muted-foreground px-2 py-1.5">{r.providerName ?? "—"}</td>
                    <td className="text-muted-foreground max-w-56 truncate px-2 py-1.5 font-mono" title={r.baseUrl}>
                      {r.baseUrl || "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.token ? (
                        <span className="font-mono break-all">{r.token}</span>
                      ) : (
                        <span className="text-muted-foreground">未配置</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => copyCsv.mutate()} disabled={configured.length === 0 || copyCsv.isPending}>
            <FileText className="size-3.5" />
            复制全部（CSV）
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={configured.length === 0 || doExport.isPending}
            onClick={() => doExport.mutate("csv")}
          >
            <FileText className="size-3.5" />
            导出 CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={configured.length === 0 || doExport.isPending}
            onClick={() => doExport.mutate("xlsx")}
          >
            <FileSpreadsheet className="size-3.5" />
            导出 Excel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
