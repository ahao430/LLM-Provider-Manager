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
import { goBackOr } from "@/lib/sessionState";
import { Badge } from "@/components/ui/badge";
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
import {
  listChannelModels,
  type AgentCompatStatus,
  type BalanceQuery,
  type ChannelOpsStatus,
  type ChannelDetail,
} from "@/lib/tauri";
import {
  useAgentCompat,
  useChannel,
  useDeleteChannel,
  useIncidents,
  useLaunchAgent,
  useProviders,
  useResolveIncident,
  useSaveChannelOps,
  useSetChannelEnabled,
  useSetChannelOpsStatus,
  useUpsertAgentCompat,
} from "@/features/channels/api";
import { channelDisplayStatus } from "@/features/channels/opsStatus";
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
  const { data: providers = [] } = useProviders();
  const setEnabled = useSetChannelEnabled();
  const deleteMutation = useDeleteChannel();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  // 服务商 code（决定余额查询方式，与后端派生规则一致）
  const providerCode = channel
    ? (providers.find((p) => p.id === channel.providerId)?.code ?? "")
    : "";

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
        <Button variant="outline" onClick={() => goBackOr(navigate, "/channels")}>
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
            <Button variant="outline" onClick={() => goBackOr(navigate, "/channels")}>
              <ArrowLeft className="size-4" />返回
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />编辑
            </Button>
            <OpsStatusControl channel={channel} />
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
          <TabsTrigger value="incidents">故障</TabsTrigger>
          <TabsTrigger value="compat">Agent 兼容性</TabsTrigger>
          <TabsTrigger value="launcher">启动器</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OpsArchiveCard channel={channel} />
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
                <dt className="text-muted-foreground">运维状态</dt>
                <dd>
                  <OpsStatusControl channel={channel} compact />
                </dd>
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
          <FundsTab channelId={channel.id} balanceProvider={channel.balanceQuery?.provider} />
        </TabsContent>

        <TabsContent value="incidents" className="space-y-4">
          <IncidentsTab channelId={channel.id} />
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
        providerCode={providerCode}
        providerName={channel.providerName}
        initialQuery={channel.balanceQuery ?? null}
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
  providerCode,
  providerName,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  /** 渠道已选服务商的 code（决定查询方式，不再手选） */
  providerCode: string;
  providerName: string | null;
  initialQuery: BalanceQuery | null;
}) {
  // 查询方式由服务商派生（与后端 derive_balance_mode 同规则）
  const mode =
    providerCode === "newapi" ? "new_api" : providerCode === "bailian" ? "aliyun_bss" : "generic";
  const modeLabel =
    mode === "new_api"
      ? "NewAPI 用户额度（用户 ID + 系统访问令牌）"
      : mode === "aliyun_bss"
        ? "阿里云费用中心（百炼 AccessKey）"
        : "通用 HTTP（Bearer GET + JSON 路径）";

  const [path, setPath] = useState(initialQuery?.path ?? "");
  const [jsonPath, setJsonPath] = useState(initialQuery?.jsonPath ?? "");
  // new_api 额度按 $1 = 500,000 quota 折算默认 USD；其余默认 CNY（均可切换）
  const [currency, setCurrency] = useState(initialQuery?.currency || (mode === "new_api" ? "USD" : "CNY"));
  const [userId, setUserId] = useState(initialQuery?.userId ?? "");
  const [systemToken, setSystemToken] = useState("");
  const [akId, setAkId] = useState("");
  const [akSecret, setAkSecret] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const { setBalanceQuery } = await import("@/lib/tauri");
    try {
      await setBalanceQuery(channelId, {
        path: path.trim(),
        jsonPath: jsonPath.trim(),
        currency,
        userId: userId.trim(),
        // 凭证：填了才写（留空 = 保持不变；明文只进凭证文件）
        billingAccessKeyId: akId.trim() === "" ? null : akId.trim(),
        billingAccessKeySecret: akSecret.trim() === "" ? null : akSecret.trim(),
        billingSystemToken: systemToken.trim() === "" ? null : systemToken.trim(),
      });
      toast.success("余额查询配置已保存");
    } catch (error) {
      toast.error(`保存失败：${error}`);
    }
  }

  async function query() {
    setBusy(true);
    try {
      const { queryChannelBalance } = await import("@/lib/tauri");
      const res = await queryChannelBalance(channelId);
      if (res.value != null) {
        toast.success(
          `余额 ${res.currency ?? ""} ${JSON.stringify(res.value)}（HTTP ${res.httpStatus}）`
        );
      } else {
        toast.warning(
          `未提取到余额（HTTP ${res.httpStatus}）${res.rawSnippet ? `：${res.rawSnippet.slice(0, 120)}` : ""}`,
          { duration: 8000 }
        );
      }
    } catch (error) {
      toast.error(`查询失败：${error}`, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  const queryDisabled =
    busy || (mode === "generic" && !path.trim()) || (mode === "new_api" && !userId.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>余额查询设置</DialogTitle>
          <DialogDescription>
            查询方式由渠道服务商决定（当前：{providerName ?? "自定义"}），无需选择；LCM
            不自动同步余额。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>查询方式</Label>
            <div className="bg-muted flex h-9 items-center rounded-md border px-3 text-sm">
              {modeLabel}
            </div>
          </div>

          {mode === "new_api" ? (
            <>
              <div className="space-y-1.5">
                <Label>用户 ID *</Label>
                <Input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="对方实例的用户 ID（个人设置页可见）"
                />
              </div>
              <div className="space-y-1.5">
                <Label>系统访问令牌 *</Label>
                <Input
                  type="password"
                  value={systemToken}
                  onChange={(e) => setSystemToken(e.target.value)}
                  placeholder="对方实例「系统设置」生成的访问令牌（已配置时留空 = 保持不变）"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                走 {`{Base URL}`}/api/user/self 查询该用户剩余额度（Authorization =
                系统访问令牌，New-Api-User = 用户 ID），按 $1 = 500,000 quota
                折算。站点若以人民币结算（如设置了 1 ¥ = $1），币种选 CNY
                展示人民币。令牌存本地凭证文件，不明文展示；模型调用的渠道密钥不受影响。
              </p>
            </>
          ) : mode === "aliyun_bss" ? (
            <>
              <div className="space-y-1.5">
                <Label>AccessKey ID（secretId）</Label>
                <Input
                  value={akId}
                  onChange={(e) => setAkId(e.target.value)}
                  placeholder="LTAI...（已配置时留空 = 保持不变）"
                />
              </div>
              <div className="space-y-1.5">
                <Label>AccessKey Secret（secretKey）</Label>
                <Input
                  type="password"
                  value={akSecret}
                  onChange={(e) => setAkSecret(e.target.value)}
                  placeholder="已配置时留空 = 保持不变"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                走阿里云 BSS QueryAccountBalance（RPC V1 签名）；AccessKey 需具备费用中心读权限（bss:DescribeAccount）。密钥存本地凭证文件。
              </p>
            </>
          ) : (
            <>
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
            </>
          )}

          <div className="space-y-1.5">
            <Label>币种（展示与写余额快照用）</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CNY">CNY（人民币）</SelectItem>
                <SelectItem value="USD">USD（美元）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={save}>
              保存配置
            </Button>
            <Button
              onClick={query}
              disabled={queryDisabled}
              title={mode !== "generic" ? "凭证需先保存再查询" : undefined}
            >
              <RefreshCw className="size-4" />
              {busy ? "查询中…" : "立即查询"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------
// 运维状态控制（Badge 展示 + 手动设置；suspect 推导见 opsStatus.ts）
// ------------------------------------------------------------------

function OpsStatusControl({ channel, compact }: { channel: ChannelDetail; compact?: boolean }) {
  const setStatus = useSetChannelOpsStatus();
  const st = channelDisplayStatus(channel, null);
  const current = channel.opsStatus as ChannelOpsStatus;
  return (
    <div className="inline-flex items-center gap-1.5">
      {compact ? (
        <>
          <span className={`size-2 rounded-full ${st.meta.dot}`} />
          <span className="text-xs">{st.meta.label}</span>
        </>
      ) : (
        <Badge variant={st.meta.badge} className="gap-1">
          <span className={`size-2 rounded-full ${st.meta.dot}`} />
          {st.meta.label}
        </Badge>
      )}
      <Select
        value={current}
        onValueChange={(v) => setStatus.mutate({ id: channel.id, status: v as ChannelOpsStatus })}
        disabled={setStatus.isPending}
      >
        <SelectTrigger className="h-7 w-8 border-dashed px-1" title="手动设置运维状态" />
      </Select>
      <SelectContent className="hidden" />
    </div>
  );
}

// ------------------------------------------------------------------
// 运维档案卡（控制台 / 联系方式 / 有效期 / key 轮换；config_json.ops）
// ------------------------------------------------------------------

function OpsArchiveCard({ channel }: { channel: ChannelDetail }) {
  const save = useSaveChannelOps();
  const ops = channel.ops;
  const [form, setForm] = useState({
    consoleUrl: ops?.consoleUrl ?? "",
    contact: ops?.contact ?? "",
    expiresAt: ops?.expiresAt ?? "",
    keyRotationNote: ops?.keyRotationNote ?? "",
  });
  const [editing, setEditing] = useState(false);

  const expiresSoon =
    form.expiresAt &&
    (() => {
      const d = new Date(form.expiresAt);
      if (Number.isNaN(d.getTime())) return false;
      const days = (d.getTime() - Date.now()) / 86_400_000;
      return days >= 0 && days <= 7;
    })();

  async function handleSave() {
    try {
      await save.mutateAsync({ id: channel.id, ops: form });
      toast.success("运维档案已保存");
      setEditing(false);
    } catch (e) {
      toast.error(`保存失败：${e}`);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">运维档案</CardTitle>
          <CardDescription>
            控制台 / 联系方式 / 有效期 / key 轮换备注（出问题找得到人）；仅本机存储。
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
          {editing ? "取消编辑" : "编辑"}
        </Button>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>控制台地址</Label>
              <Input value={form.consoleUrl} onChange={(e) => setForm({ ...form, consoleUrl: e.target.value })} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label>联系方式 / 工单渠道</Label>
              <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="微信群 / 工单地址 / 邮箱" />
            </div>
            <div className="space-y-1.5">
              <Label>余额 / 合同有效期</Label>
              <Input value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} placeholder="2026-12-31 或文字说明" />
            </div>
            <div className="space-y-1.5">
              <Label>key 轮换备注</Label>
              <Input value={form.keyRotationNote} onChange={(e) => setForm({ ...form, keyRotationNote: e.target.value })} placeholder="如：每季度轮换" />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button size="sm" onClick={handleSave} disabled={save.isPending}>
                {save.isPending ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">控制台</dt>
            <dd>
              {form.consoleUrl ? (
                <a href={form.consoleUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">
                  {form.consoleUrl}
                </a>
              ) : (
                <span className="text-muted-foreground">—（点击「编辑」填写）</span>
              )}
            </dd>
            <dt className="text-muted-foreground">联系方式</dt>
            <dd>{form.contact || <span className="text-muted-foreground">—</span>}</dd>
            <dt className="text-muted-foreground">有效期</dt>
            <dd className={expiresSoon ? "font-medium text-yellow-600" : ""}>
              {form.expiresAt || <span className="text-muted-foreground">—</span>}
              {expiresSoon ? "（7 天内到期）" : ""}
            </dd>
            <dt className="text-muted-foreground">key 轮换</dt>
            <dd>{form.keyRotationNote || <span className="text-muted-foreground">—</span>}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// 故障事件 Tab（列表 + 标记解决）
// ------------------------------------------------------------------

function IncidentsTab({ channelId }: { channelId: string }) {
  const { data: incidents = [] } = useIncidents(channelId);
  const resolve = useResolveIncident();
  if (incidents.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center text-sm">
            暂无故障事件。在测试记录页多选失败记录后「标记为故障事件」。
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">故障事件</CardTitle>
        <CardDescription>相关失败记录的聚合复盘（起止 / 根因），只做标记不改记录状态。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {incidents.map((i) => (
          <div key={i.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              {i.resolvedAt ? (
                <Badge variant="outline">已解决</Badge>
              ) : (
                <Badge variant="destructive">未解决</Badge>
              )}
              <span className="text-sm font-medium">{i.title}</span>
              <span className="text-muted-foreground text-xs">
                {i.startedAt.slice(0, 19).replace("T", " ")} · {i.recordCount} 条记录
              </span>
            </div>
            {i.rootCause ? (
              <p className="text-muted-foreground mt-1.5 text-xs">根因：{i.rootCause}</p>
            ) : null}
            {!i.resolvedAt ? (
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: i.id })}
                >
                  标记解决
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
