import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  CircleDollarSign,
  Pencil,
  RefreshCw,
  Rocket,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { listChannelModels, type AgentCompatStatus } from "@/lib/tauri";
import {
  useAgentCompat,
  useChannel,
  useDeleteChannel,
  useLaunchAgent,
  useSetChannelEnabled,
  useUpsertAgentCompat,
} from "@/features/channels/api";
import { ChannelFormDialog } from "@/features/channels/ChannelFormDialog";
import { CredentialField } from "@/features/channels/CredentialField";
import { ModelsTab } from "@/features/channels/ModelsTab";
import { PricingTab } from "@/features/channels/PricingTab";
import { FundsTab } from "@/features/channels/FundsTab";

const COMPAT_AGENTS = ["claude_code", "codex"] as const;

export function ChannelDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: channel, isLoading, isError, error } = useChannel(id);
  const setEnabled = useSetChannelEnabled();
  const deleteMutation = useDeleteChannel();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !channel) {
    return (
      <div className="space-y-4">
        <p className="text-destructive text-sm">渠道加载失败：{String(error)}</p>
        <Button variant="outline" onClick={() => navigate("/channels")}>
          <ArrowLeft className="size-4" />返回列表
        </Button>
      </div>
    );
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    try {
      await deleteMutation.mutateAsync(channel!.id);
      toast.success(`渠道「${channel!.name}」已删除`);
      navigate("/channels");
    } catch (err) {
      toast.error(`删除失败：${err}`);
    }
  }

  return (
    <>
      <PageHeader
        title={channel.name}
        description={channel.notes ?? channel.providerName ?? "自定义渠道"}
        actions={
          <>
            <div className="mr-2 flex items-center gap-2">
              <span className="text-muted-foreground text-sm">启用</span>
              <Switch
                checked={channel.enabled}
                onCheckedChange={(checked) =>
                  setEnabled.mutate({ id: channel.id, enabled: checked })
                }
              />
            </div>
            <Button variant="outline" onClick={() => navigate("/channels")}>
              <ArrowLeft className="size-4" />返回
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />编辑
            </Button>
            <Button variant="outline" onClick={() => setBalanceOpen(true)}>
              <CircleDollarSign className="size-4" />余额查询
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="size-4" />
              {confirmingDelete ? "确认删除？" : "删除"}
            </Button>
          </>
        }
      />

      {!channel.enabled ? (
        <p className="text-muted-foreground text-sm">渠道已禁用，启动 Agent / 发送请求前请先启用。</p>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="credentials">凭证</TabsTrigger>
          <TabsTrigger value="models">模型</TabsTrigger>
          <TabsTrigger value="pricing">价格</TabsTrigger>
          <TabsTrigger value="funds">资金</TabsTrigger>
          <TabsTrigger value="compat">Agent 兼容性</TabsTrigger>
          <TabsTrigger value="launcher">启动器</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Base URL（按协议）</CardTitle>
              <CardDescription>
                认证按协议自动派生：Anthropic → x-api-key；OpenAI 系 → Bearer。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">Chat Completions</dt>
                <dd className="font-mono text-xs break-all">{channel.effectiveUrls.openaiChat}</dd>
                <dt className="text-muted-foreground">Anthropic Messages</dt>
                <dd className="font-mono text-xs break-all">
                  {channel.effectiveUrls.anthropicMessages}
                  {channel.anthropicBaseUrl ? "" : "（默认同上）"}
                </dd>
                <dt className="text-muted-foreground">OpenAI Responses</dt>
                <dd className="font-mono text-xs break-all">
                  {channel.effectiveUrls.openaiResponses}
                  {channel.responsesBaseUrl ? "" : "（默认同上）"}
                </dd>
                <dt className="text-muted-foreground">TLS 验证</dt>
                <dd>{channel.tlsVerify ? "启用" : "关闭（有风险）"}</dd>
              </dl>
              {channel.externalLinks.length > 0 ? (
                <>
                  <Separator className="my-4" />
                  <ul className="flex flex-wrap gap-3">
                    {channel.externalLinks.map((l) => (
                      <li key={`${l.label}-${l.url}`}>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline text-sm underline-offset-4"
                        >
                          {l.label} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credentials" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API Key</CardTitle>
              <CardDescription>
                保存在系统凭证库。默认掩码显示，查看明文需点击眼睛图标。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CredentialField
                channelId={channel.id}
                kind="primary"
                masked={channel.primaryCredentialMasked}
                onChanged={() => undefined}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="models" className="space-y-4">
          <ModelsTab channelId={channel.id} />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <PricingTab channelId={channel.id} />
        </TabsContent>

        <TabsContent value="funds" className="space-y-4">
          <FundsTab channelId={channel.id} />
        </TabsContent>

        <TabsContent value="compat" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Agent 兼容性记录</CardTitle>
              <CardDescription>
                状态必须来自实际测试或可靠证据。不兼容时如实记录，不做适配掩盖。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {COMPAT_AGENTS.map((agent) => (
                <CompatEditor key={agent} channelId={channel.id} agent={agent} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="launcher" className="space-y-4">
          <LauncherPanel channelId={channel.id} channelName={channel.name} />
        </TabsContent>
      </Tabs>

      <ChannelFormDialog open={editOpen} onOpenChange={setEditOpen} channel={channel} />
      <BalanceQueryDialog
        open={balanceOpen}
        onOpenChange={setBalanceOpen}
        channelId={channel.id}
        initialPath={channel.balanceQuery?.path ?? ""}
        initialJsonPath={channel.balanceQuery?.jsonPath ?? ""}
      />
    </>
  );
}

// ------------------------------------------------------------------
// Agent 兼容性编辑
// ------------------------------------------------------------------

function CompatEditor({ channelId, agent }: { channelId: string; agent: string }) {
  const { data: rows = [] } = useAgentCompat(channelId);
  const upsert = useUpsertAgentCompat(channelId);
  const row = rows.find((r) => r.agent === agent);

  const [status, setStatus] = useState<AgentCompatStatus>(row?.status ?? "unverified");
  const [evidence, setEvidence] = useState(row?.evidence ?? "");

  const [initialized, setInitialized] = useState(false);
  if (!initialized && row) {
    setStatus(row.status);
    setEvidence(row.evidence ?? "");
    setInitialized(true);
  }

  async function save() {
    try {
      await upsert.mutateAsync({
        agent,
        status,
        evidence: evidence.trim() || null,
        notes: null,
      });
      toast.success(`${agent === "claude_code" ? "Claude Code" : "Codex"} 兼容性已保存`);
    } catch (error) {
      toast.error(`保存失败：${error}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <Label className="font-medium">
          {agent === "claude_code" ? "Claude Code" : "Codex"}
        </Label>
        <Select value={status} onValueChange={(v) => setStatus(v as AgentCompatStatus)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="supported">支持</SelectItem>
            <SelectItem value="unsupported">不支持</SelectItem>
            <SelectItem value="unverified">未验证</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <textarea
        rows={2}
        className="border-input placeholder:text-muted-foreground flex w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        placeholder="测试证据（何时、如何验证、结论）…"
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
      />
      <div className="flex items-center justify-between">
        {row?.testedAt ? (
          <span className="text-muted-foreground text-xs">上次验证：{row.testedAt}</span>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={upsert.isPending}>
          保存
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// 启动器
// ------------------------------------------------------------------

function LauncherPanel({ channelId, channelName }: { channelId: string; channelName: string }) {
  const launch = useLaunchAgent(channelId);
  const [agentType, setAgentType] = useState<"claude_code_cli" | "codex_cli">("claude_code_cli");
  const [model, setModel] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");

  const channelModels = useChannelModelsLite(channelId);

  async function pickDirectory() {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") {
        setWorkingDirectory(dir);
      }
    } catch (error) {
      toast.error(`选择目录失败：${error}`);
    }
  }

  async function handleLaunch() {
    if (!workingDirectory.trim()) {
      toast.error("请先选择项目工作目录");
      return;
    }
    try {
      const outcome = await launch.mutateAsync({
        agentType,
        model: model.trim() || null,
        workingDirectory: workingDirectory.trim(),
      });
      toast.success(
        `已启动（PID ${outcome.processId}），日志：${outcome.logFile}`
      );
      for (const warning of outcome.warnings) {
        toast.warning(warning, { duration: 8000 });
      }
    } catch (error) {
      toast.error(`启动失败：${error}`);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="size-4" />
            启动 Agent（渠道：{channelName}）
          </CardTitle>
          <CardDescription>
            启动式渠道切换：只注入启动配置，不修改已有配置，不经过网关。已运行的 Agent 不受影响。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Agent 类型</Label>
              <Select value={agentType} onValueChange={(v) => setAgentType(v as "claude_code_cli" | "codex_cli")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude_code_cli">Claude Code CLI</SelectItem>
                  <SelectItem value="codex_cli">Codex CLI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>模型（可选）</Label>
              {channelModels.length > 0 ? (
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="从渠道模型选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {channelModels.map((m) => (
                      <SelectItem key={m.id} value={m.actualModelId}>
                        {m.actualModelId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="手填模型 ID" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>项目工作目录 *</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="选择或输入目录"
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="icon" onClick={pickDirectory} title="浏览…">
                  📁
                </Button>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={handleLaunch} disabled={launch.isPending}>
              <Rocket className="size-4" />
              {launch.isPending ? "启动中…" : "启动 Agent"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function useChannelModelsLite(channelId: string) {
  const { data = [] } = useQuery({
    queryKey: ["channel-models", channelId],
    queryFn: () => listChannelModels(channelId),
    enabled: channelId !== "",
  });
  return data;
}

// ------------------------------------------------------------------
// 余额查询弹窗
// ------------------------------------------------------------------

function BalanceQueryDialog({
  open,
  onOpenChange,
  channelId,
  initialPath,
  initialJsonPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  initialPath: string;
  initialJsonPath: string;
}) {
  const [path, setPath] = useState(initialPath);
  const [jsonPath, setJsonPath] = useState(initialJsonPath);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const { setBalanceQuery } = await import("@/lib/tauri");
    try {
      await setBalanceQuery(channelId, path.trim(), jsonPath.trim());
      toast.success("余额查询配置已保存");
    } catch (error) {
      toast.error(`保存失败：${error}`);
    }
  }

  async function query() {
    setBusy(true);
    setResult(null);
    try {
      const { queryChannelBalance } = await import("@/lib/tauri");
      const res = await queryChannelBalance(channelId);
      if (res.value != null) {
        setResult(`余额：${JSON.stringify(res.value)}（HTTP ${res.httpStatus}）`);
      } else {
        setResult(`未提取到余额（HTTP ${res.httpStatus}）\n原始片段：${res.rawSnippet ?? ""}`);
      }
    } catch (error) {
      setResult(`查询失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>余额查询设置</DialogTitle>
          <DialogDescription>
            不同服务商余额接口不同（如 NewAPI
            /dashboard/billing/subscription）。配置后可随时查询；LCM 不自动同步。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>查询路径</Label>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/dashboard/billing/subscription 或完整 URL"
            />
          </div>
          <div className="space-y-1.5">
            <Label>余额 JSON 路径</Label>
            <Input
              value={jsonPath}
              onChange={(e) => setJsonPath(e.target.value)}
              placeholder="data.total_balance（点路径，支持数组下标）"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={save}>
              保存配置
            </Button>
            <Button onClick={query} disabled={busy || !path.trim()}>
              <RefreshCw className="size-4" />
              {busy ? "查询中…" : "立即查询"}
            </Button>
          </div>
          {result ? (
            <pre className="max-h-32 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
              {result}
            </pre>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
