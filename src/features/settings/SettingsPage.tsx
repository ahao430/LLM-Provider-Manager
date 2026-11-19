import { useState } from "react";
import { toast } from "sonner";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Archive,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { openExternal } from "@/lib/external";
import { useAppInfo, useDatabaseStats } from "@/hooks/use-app-info";
import { THEME_LABELS, useUiStore, type Theme } from "@/stores/ui";
import {
  checkArchiveConsistency,
  checkForUpdates,
  cleanupOldData,
  createBackup,
  downloadUpdate,
  installUpdate,
  restoreBackup,
  type ConsistencyReport,
  type UpdateCheck,
} from "@/lib/tauri";

/** 设置：常规（外观）/ 数据库 / MCP 接入 / 数据（备份·一致性·清理）/ 关于（应用信息 + 更新）。 */
export function SettingsPage() {
  const { data: appInfo, isLoading: infoLoading, isError: infoError } = useAppInfo();
  const { data: stats, isLoading: statsLoading } = useDatabaseStats();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  return (
    <>
      <PageHeader title="设置" description="外观、数据库、MCP 接入、数据维护与更新。" />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">常规</TabsTrigger>
          <TabsTrigger value="database">数据库</TabsTrigger>
          <TabsTrigger value="mcp">MCP 接入</TabsTrigger>
          <TabsTrigger value="data">数据</TabsTrigger>
          <TabsTrigger value="about">关于</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>外观</CardTitle>
              <CardDescription>主题即时生效并记住选择（侧边栏底部也可快捷循环切换）。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Label>主题</Label>
                <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">{THEME_LABELS.light}</SelectItem>
                    <SelectItem value="dark">{THEME_LABELS.dark}</SelectItem>
                    <SelectItem value="system">{THEME_LABELS.system}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="database" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>数据库状态</CardTitle>
              <CardDescription>SQLite 各表行数（Tauri command: get_database_stats）。</CardDescription>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <SkeletonLine className="h-24 w-full" />
              ) : stats && stats.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="py-2 pr-4 font-medium">表名</th>
                      <th className="py-2 font-medium">行数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((row) => (
                      <tr key={row.table} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{row.table}</td>
                        <td className="py-2 tabular-nums">{row.rows}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-muted-foreground text-sm">数据库已初始化，暂无业务表数据。</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mcp" className="space-y-6">
          <McpCard dataDir={appInfo?.dataDir ?? ""} />
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <BackupCard />
          <ConsistencyCard />
          <CleanupCard />
        </TabsContent>

        <TabsContent value="about" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>应用信息</CardTitle>
              <CardDescription>来自 Rust 后端（Tauri command: get_app_info）。</CardDescription>
            </CardHeader>
            <CardContent>
              {infoLoading ? (
                <div className="space-y-2">
                  <SkeletonLine className="w-64" />
                  <SkeletonLine className="w-96" />
                </div>
              ) : infoError || !appInfo ? (
                <p className="text-destructive text-sm">无法读取应用信息（请确认以 Tauri 方式运行：pnpm tauri dev）。</p>
              ) : (
                <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                  <InfoRow label="应用名称" value={appInfo.name} />
                  <InfoRow label="版本" value={`v${appInfo.version}`} />
                  <InfoRow label="数据目录" value={appInfo.dataDir} mono />
                </dl>
              )}
            </CardContent>
          </Card>

          <UpdateCard />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ------------------------------------------------------------------
// 更新检测
// ------------------------------------------------------------------

function UpdateCard() {
  const { data: appInfo } = useAppInfo();
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);

  async function check() {
    setBusy(true);
    try {
      setResult(await checkForUpdates());
    } catch (error) {
      toast.error(`检测失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  /** 应用内下载安装包 → 确认后运行安装器（覆盖安装），与侧边栏升级按钮同一流程。 */
  async function downloadAndInstall() {
    setDownloading(true);
    try {
      toast.info("开始下载安装包…（保存到数据目录 updates/）");
      const res = await downloadUpdate();
      const ok = window.confirm(
        `安装包 ${res.fileName} 已下载完成。\n立即运行安装器覆盖安装？（应用将退出，安装后重新打开）`
      );
      if (!ok) {
        toast.info(`已保存到 ${res.filePath}，可稍后手动运行安装`);
        return;
      }
      await installUpdate(res.filePath);
      toast.success("安装器已启动，按引导完成覆盖安装即可");
    } catch (error) {
      toast.error(`更新失败：${error}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" />
            检测更新
          </CardTitle>
          <CardDescription>
            查询 GitHub 最新已发布 Release（需联网）。只检查并跳转下载页，不自动更新。
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={check} disabled={busy}>
          <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "检测中…" : "检测更新"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          当前版本：
          <Badge variant="outline" className="ml-1">
            v{appInfo?.version ?? "?"}
          </Badge>
        </p>

        {result ? (
          result.latestVersion === null ? (
            <p className="text-muted-foreground text-sm">
              尚无已发布版本（Release 构建并发布后可检测到）。
            </p>
          ) : result.hasUpdate ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>发现新版本</Badge>
                <span className="font-medium tabular-nums">
                  v{result.latestVersion}
                  {result.publishedAt ? (
                    <span className="text-muted-foreground ml-2 text-xs">
                      （{result.publishedAt.slice(0, 10)} 发布）
                    </span>
                  ) : null}
                </span>
              </div>
              {result.notes ? (
                <pre className="text-muted-foreground max-h-40 overflow-auto rounded-md border p-2 text-xs whitespace-pre-wrap">
                  {result.notes.slice(0, 600)}
                  {result.notes.length > 600 ? "\n…" : ""}
                </pre>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={downloadAndInstall} disabled={downloading}>
                  {downloading ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      下载中…
                    </>
                  ) : (
                    "下载并安装"
                  )}
                </Button>
                {result.releaseUrl ? (
                  <Button size="sm" variant="outline" onClick={() => void openExternal(result.releaseUrl!)}>
                    打开下载页
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-green-600" />
              已是最新版本（v{result.latestVersion}）
            </p>
          )
        ) : (
          <p className="text-muted-foreground text-sm">点击「检测更新」检查 GitHub 上的最新发布。</p>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all leading-5" : "font-medium"}>{value}</dd>
    </>
  );
}

function SkeletonLine({ className }: { className?: string }) {
  return <div className={`bg-accent animate-pulse rounded-md ${className ?? ""}`} />;
}

// ------------------------------------------------------------------
// 备份与恢复
// ------------------------------------------------------------------

function BackupCard() {
  const [password, setPassword] = useState("");
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [busy, setBusy] = useState<"create" | "restore" | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  async function create() {
    if (password.length < 8) {
      toast.error("备份密码至少 8 位");
      return;
    }
    const target = await saveDialog({
      title: "选择备份保存位置",
      defaultPath: `lcm-backup-${new Date().toISOString().slice(0, 10)}.lcmbackup`,
      filters: [{ name: "LCM 备份", extensions: ["lcmbackup"] }],
    });
    if (!target) return;
    setBusy("create");
    try {
      const summary = await createBackup({
        targetPath: target,
        password,
        includeCredentials,
      });
      toast.success(
        `备份完成：${(summary.bytes / 1024).toFixed(1)} KB（归档文件 ${summary.archivedFiles} 个${summary.includesCredentials ? "，含凭证" : ""}）`
      );
      setLastSummary(`备份文件：${summary.filePath}`);
      setPassword("");
    } catch (error) {
      toast.error(`备份失败：${error}`);
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (!restorePath || restorePassword.length < 8) {
      toast.error("请选择备份文件并输入密码");
      return;
    }
    if (!confirmRestore) {
      setConfirmRestore(true);
      window.setTimeout(() => setConfirmRestore(false), 5000);
      return;
    }
    setBusy("restore");
    try {
      const summary = await restoreBackup({ backupPath: restorePath, password: restorePassword });
      toast.success(
        `恢复完成（数据库 ✓ / 归档 ${summary.restoredFiles} 个 / 凭证 ${summary.restoredCredentials} 项），请重启应用生效`,
        { duration: 10000 }
      );
      if (summary.credentialErrors.length > 0) {
        toast.warning(`凭证导入问题 ${summary.credentialErrors.length} 项，详见日志`);
      }
      setLastSummary(`回滚备份目录：${summary.preRestoreBackupDir}`);
      setConfirmRestore(false);
    } catch (error) {
      toast.error(`恢复失败：${error}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="size-4" />
            创建加密备份
          </CardTitle>
          <CardDescription>
            .lcmbackup 格式：数据库 + 文件归档整包 AES-256-GCM 加密（PBKDF2 派生密钥）。
            凭证默认不包含；勾选后以独立加密段打包，绝不以明文落盘。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              type="password"
              placeholder="备份密码（至少 8 位）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button onClick={create} disabled={busy !== null}>
              {busy === "create" ? "备份中…" : "选择位置并备份"}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={includeCredentials} onCheckedChange={setIncludeCredentials} />
            包含凭证（恢复时自动写回系统凭证库）
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Undo2 className="size-4" />
            从备份恢复
          </CardTitle>
          <CardDescription>
            恢复前自动把当前数据移入回滚目录（pre-restore-*）。恢复完成后需要重启应用生效。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              placeholder="备份文件路径"
              value={restorePath}
              onChange={(e) => setRestorePath(e.target.value)}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              onClick={async () => {
                const file = await openDialog({
                  title: "选择备份文件",
                  filters: [{ name: "LCM 备份", extensions: ["lcmbackup"] }],
                  multiple: false,
                });
                if (typeof file === "string") setRestorePath(file);
              }}
            >
              浏览…
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              type="password"
              placeholder="备份密码"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
            />
            <Button variant="destructive" onClick={restore} disabled={busy !== null}>
              {confirmRestore ? "确认恢复？" : busy === "restore" ? "恢复中…" : "恢复"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            恢复会覆盖当前数据库与归档文件；已自动保留回滚副本，仍请谨慎操作。
          </p>
        </CardContent>
      </Card>

      {lastSummary ? (
        <p className="text-muted-foreground font-mono text-xs break-all">{lastSummary}</p>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------
// 归档一致性检查
// ------------------------------------------------------------------

function ConsistencyCard() {
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      setReport(await checkArchiveConsistency());
    } catch (error) {
      toast.error(`检查失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            归档一致性检查
          </CardTitle>
          <CardDescription>
            对比数据库引用与 archives/ 磁盘文件：缺失（引用但文件丢失）与孤儿（文件存在但无引用）。只报告，不自动处理。
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={check} disabled={busy}>
          {busy ? "检查中…" : "开始检查"}
        </Button>
      </CardHeader>
      <CardContent>
        {!report ? (
          <p className="text-muted-foreground text-sm">点击「开始检查」。</p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-600" />
              <span>
                归档文件 {report.archiveFiles} 个 · 数据库引用 {report.referencedFiles} 个
              </span>
            </div>
            {report.missingFiles.length === 0 && report.orphanFiles.length === 0 ? (
              <Badge>一致，无问题</Badge>
            ) : null}
            {report.missingFiles.length > 0 ? (
              <div>
                <div className="text-destructive text-xs font-medium">
                  缺失 {report.missingFiles.length} 个：
                </div>
                <ul className="text-muted-foreground mt-1 space-y-0.5 font-mono text-[10px]">
                  {report.missingFiles.slice(0, 10).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.orphanFiles.length > 0 ? (
              <div>
                <div className="text-xs font-medium">
                  孤儿 {report.orphanFiles.length} 个（{(report.orphanBytes / 1024).toFixed(1)} KB）：
                </div>
                <ul className="text-muted-foreground mt-1 space-y-0.5 font-mono text-[10px]">
                  {report.orphanFiles.slice(0, 10).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// 数据清理
// ------------------------------------------------------------------

function CleanupCard() {
  const [before, setBefore] = useState(new Date().toISOString().slice(0, 10));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!confirm) {
      setConfirm(true);
      window.setTimeout(() => setConfirm(false), 5000);
      return;
    }
    setBusy(true);
    try {
      const summary = await cleanupOldData(before);
      toast.success(
        `已清理 ${summary.deletedRecords} 条记录、${summary.deletedFiles} 个归档文件（${before} 之前）`
      );
      setConfirm(false);
    } catch (error) {
      toast.error(`清理失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="size-4" />
          数据清理
        </CardTitle>
        <CardDescription>
          删除指定日期之前的测试记录（含处理事件）与其归档文件。默认长期保留（PLAN.md「数据保留」）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr_auto]">
          <Label className="self-center">清理此日期之前：</Label>
          <Input type="date" value={before} onChange={(e) => setBefore(e.target.value)} />
          <Button variant="destructive" onClick={run} disabled={busy}>
            <Trash2 className="size-4" />
            {confirm ? "确认清理？" : busy ? "清理中…" : "清理"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          渠道 / 模型 / 价格 / 充值等管理数据不受影响，仅清理测试记录与对应 Raw 文件。
        </p>
      </CardContent>
    </Card>
  );
}

/** MCP 接入卡片：只读工具清单 + 注册命令（可复制）。 */
function McpCard({ dataDir }: { dataDir: string }) {
  const claudeCmd = `claude mcp add lcm -- /path/to/lcm-mcp --data-dir ${dataDir || "<数据目录>"}`;
  const codexSnippet = `[mcp_servers.lcm]\ncommand = "/path/to/lcm-mcp"\nargs = ["--data-dir", "${dataDir || "<数据目录>"}"]`;

  async function copy(text: string, label: string) {
    try {
      await writeText(text);
      toast.success(`${label}已复制`);
    } catch (error) {
      toast.error(`复制失败：${error}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP（外部 AI Agent 只读接入）</CardTitle>
        <CardDescription>把 LCM 数据以只读工具开放给 Claude Code / Codex 等外部 Agent。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground text-xs">
          12 个只读工具：list_channels / list_models / search_request_records / get_request_record /
          get_request_error / get_request_raw / list_balances / list_funds / search_market_prices /
          diagnose_request_error / search_error_docs / get_error_chain。
          凭证零输出（红线）；数据库以只读方式打开，App 无需常驻。
        </p>
        <div className="space-y-1">
          <Label>1. 构建 MCP 命令</Label>
          <code className="bg-muted block overflow-x-auto rounded-md px-2.5 py-1.5 text-xs">
            cargo build --release --bin lcm-mcp
          </code>
          <p className="text-muted-foreground text-xs">
            产物 <code>src-tauri/target/release/lcm-mcp</code>（开发期 target/debug 亦可）；把下述命令中的 /path/to/lcm-mcp 换成实际路径。
          </p>
        </div>
        <div className="space-y-1">
          <Label>2. 注册到 Claude Code</Label>
          <div className="flex items-center gap-2">
            <code className="bg-muted min-w-0 flex-1 overflow-x-auto rounded-md px-2.5 py-1.5 text-xs whitespace-pre">
              {claudeCmd}
            </code>
            <Button size="sm" variant="outline" onClick={() => copy(claudeCmd, "注册命令")}>
              复制
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label>3. 注册到 Codex（config.toml）</Label>
          <div className="flex items-start gap-2">
            <pre className="bg-muted min-w-0 flex-1 overflow-x-auto rounded-md px-2.5 py-1.5 text-xs">
              {codexSnippet}
            </pre>
            <Button size="sm" variant="outline" onClick={() => copy(codexSnippet, "Codex 配置片段")}>
              复制
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
