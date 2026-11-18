import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderOpen, Loader2, Rocket, Terminal } from "lucide-react";
import { open as pickDirectory } from "@tauri-apps/plugin-dialog";

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
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_LABELS,
  runAgentProbe,
  type AgentLaunchRow,
  type AgentProbeOutcome,
  type AgentType,
} from "@/lib/tauri";
import { useChannelsForTest, useModelsForTest } from "@/features/api-testing/api";
import { useAgentLaunches } from "@/features/channels/api";

const LS_WORKING_DIR = "lcm-agent-probe-working-dir";
const LS_BINARY = (t: AgentType) => `lcm-agent-probe-binary-${t}`;

const STATUS_LABELS: Record<string, string> = {
  success: "成功",
  exit_error: "退出异常",
  timeout: "超时（已终止）",
  spawn_error: "启动失败",
};

/** Agent 测试：真实调用 claude / codex CLI（单次探针），LCM 不自己发请求。 */
export function AgentPage() {
  const queryClient = useQueryClient();
  const { data: channels = [] } = useChannelsForTest();
  const enabledChannels = channels.filter((c) => c.enabled);

  const [agentType, setAgentType] = useState<AgentType>("codex_cli");
  const [channelId, setChannelId] = useState("");
  const [model, setModel] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState(
    () => localStorage.getItem(LS_WORKING_DIR) ?? ""
  );
  const [binaryPath, setBinaryPath] = useState(
    () => localStorage.getItem(LS_BINARY("codex_cli")) ?? ""
  );
  const [prompt, setPrompt] = useState("");
  const [outcome, setOutcome] = useState<AgentProbeOutcome | null>(null);
  const { data: models = [] } = useModelsForTest(channelId);
  const { data: launches = [] } = useAgentLaunches(20);
  const runningRef = useRef(false);

  // 切换 Agent 类型时恢复各自的 CLI 路径覆盖
  useEffect(() => {
    setBinaryPath(localStorage.getItem(LS_BINARY(agentType)) ?? "");
  }, [agentType]);

  function persistBinary(value: string) {
    setBinaryPath(value);
    localStorage.setItem(LS_BINARY(agentType), value);
  }

  function persistWorkingDir(value: string) {
    setWorkingDirectory(value);
    localStorage.setItem(LS_WORKING_DIR, value);
  }

  async function pickDir() {
    try {
      const dir = await pickDirectory({ directory: true, multiple: false });
      if (typeof dir === "string") persistWorkingDir(dir);
    } catch (error) {
      toast.error(`选择目录失败：${error}`);
    }
  }

  // 运行中每秒刷新耗时（探针最长可跑 10 分钟）
  const [elapsed, setElapsed] = useState(0);
  const pending = runningRef.current;
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      forceTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [pending]);

  async function handleRun() {
    if (!channelId || !workingDirectory.trim() || !prompt.trim()) {
      toast.error("请填写渠道、工作目录与 Prompt");
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    forceTick((n) => n + 1);
    setOutcome(null);
    try {
      const res = await runAgentProbe({
        agentType,
        channelId,
        model: model.trim() || null,
        workingDirectory: workingDirectory.trim(),
        prompt: prompt.trim(),
        binaryPath: binaryPath.trim() || null,
      });
      setOutcome(res);
      if (res.status === "success") {
        toast.success(`Agent 调用成功（${(res.durationMs / 1000).toFixed(1)}s）`);
      } else {
        toast.warning(
          `Agent 未成功：${STATUS_LABELS[res.status] ?? res.status}${res.exitCode != null ? `（exit ${res.exitCode}）` : ""}`
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["agent-launches"] });
    } catch (error) {
      toast.error(`Agent 测试失败：${error}`);
    } finally {
      runningRef.current = false;
      forceTick((n) => n + 1);
    }
  }

  return (
    <>
      <PageHeader
        title="Agent 测试"
        description="真实调用 Claude Code / Codex CLI：选渠道与工作目录，发一条 prompt，收集 Agent 实际输出。LCM 不自己发请求；Agent 原生请求不归档为 LCM 测试记录。"
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4" />
              真实 Agent 调用
            </CardTitle>
            <CardDescription>
              凭证注入子进程环境（不落盘）；Claude Code 走 print 模式、Codex 走 exec 模式，超时 10 分钟。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Agent 类型</Label>
                <Select value={agentType} onValueChange={(v) => setAgentType(v as AgentType)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AGENT_LABELS) as AgentType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {AGENT_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>渠道</Label>
                <Select
                  value={channelId}
                  onValueChange={(v) => {
                    setChannelId(v);
                    setModel("");
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择渠道" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledChannels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {!c.hasPrimaryCredential ? (
                          <span className="text-muted-foreground">（未配置凭证）</span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>模型（可选，默认用渠道配置）</Label>
              <Select
                value={model || "auto"}
                onValueChange={(v) => setModel(v === "auto" ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">默认（不指定）</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.actualModelId}>
                      {m.actualModelId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>工作目录 *</Label>
              <div className="flex gap-2">
                <Input
                  value={workingDirectory}
                  onChange={(e) => persistWorkingDir(e.target.value)}
                  placeholder="Agent 运行的项目目录"
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={pickDir}>
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>
                {agentType === "claude_code_cli" ? "claude" : "codex"} 可执行文件路径（可选）
              </Label>
              <Input
                value={binaryPath}
                onChange={(e) => persistBinary(e.target.value)}
                placeholder={`默认按 PATH 查找 ${agentType === "claude_code_cli" ? "claude" : "codex"}`}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Prompt *</Label>
              <Textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="发给真实 Agent 的任务，如「用一句话介绍当前目录」"
              />
            </div>

            <Button
              onClick={handleRun}
              disabled={pending || !channelId || !workingDirectory.trim() || !prompt.trim()}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Agent 运行中… {elapsed}s
                </>
              ) : (
                <>
                  <Rocket className="size-4" />
                  发送给 Agent
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <ProbeResultCard outcome={outcome} />
          <LaunchHistoryCard launches={launches} />
        </div>
      </div>
    </>
  );
}

const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  success: "default",
  exit_error: "destructive",
  timeout: "destructive",
  spawn_error: "destructive",
};

/** 探针结果卡片：状态 / 耗时 / 回复正文 / 错误输出 / 警告 / 日志路径。 */
function ProbeResultCard({
  outcome,
}: {
  outcome: AgentProbeOutcome | null;
}) {
  if (!outcome) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>结果</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex min-h-40 items-center justify-center rounded-lg border border-dashed text-sm">
            Agent 的实际输出将在此显示
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Badge variant={STATUS_VARIANT[outcome.status] ?? "outline"}>
            {STATUS_LABELS[outcome.status] ?? outcome.status}
          </Badge>
          <Badge variant="outline">{AGENT_LABELS[outcome.agentType]}</Badge>
          <span className="text-muted-foreground text-xs tabular-nums">
            总耗时 {(outcome.durationMs / 1000).toFixed(1)}s
            {outcome.agentDurationMs != null ? ` · Agent 内部 ${(outcome.agentDurationMs / 1000).toFixed(1)}s` : ""}
          </span>
          {outcome.exitCode != null ? (
            <span className="text-muted-foreground text-xs tabular-nums">exit {outcome.exitCode}</span>
          ) : null}
        </CardTitle>
        {outcome.warnings.length > 0 ? (
          <CardDescription className="text-amber-600 dark:text-amber-400">
            {outcome.warnings.map((w) => (
              <span key={w} className="block">
                {w}
              </span>
            ))}
          </CardDescription>
          ) : null}
        </CardHeader>
      <CardContent className="space-y-3">
        <pre className="max-h-80 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
          {outcome.result || "（无输出）"}
        </pre>
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {outcome.costUsd != null ? (
            <span>成本 ${outcome.costUsd.toFixed(4)}</span>
          ) : null}
          {outcome.inputTokens != null || outcome.outputTokens != null ? (
            <span className="tabular-nums">
              Tokens {outcome.inputTokens ?? "—"}/{outcome.outputTokens ?? "—"}
            </span>
          ) : null}
          {outcome.sessionId ? <span className="font-mono">session {outcome.sessionId.slice(0, 8)}…</span> : null}
        </div>
        {outcome.stderr ? (
          <details>
            <summary className="text-muted-foreground cursor-pointer text-xs">错误输出（stderr）</summary>
            <pre className="text-destructive mt-2 max-h-40 overflow-auto rounded-md border p-2 text-xs">
              {outcome.stderr}
            </pre>
          </details>
        ) : null}
        <p className="text-muted-foreground text-xs break-all">日志：{outcome.logFile}</p>
      </CardContent>
    </Card>
  );
}

/** 最近启动 / 探针历史（agent_launches 快照）。 */
function LaunchHistoryCard({
  launches,
}: {
  launches: AgentLaunchRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">最近运行</CardTitle>
        <CardDescription>真实 Agent 启动与探针快照（不含凭证明文）。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {launches.length === 0 ? (
          <p className="text-muted-foreground text-sm">暂无运行记录。</p>
        ) : (
          launches.slice(0, 8).map((l) => (
            <div key={l.launchId} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
              <Badge variant={l.exitedAt ? "outline" : "secondary"} className="text-[10px]">
                {l.exitedAt ? "已退出" : "运行中"}
              </Badge>
              <span>{AGENT_LABELS[l.agentType as AgentType] ?? l.agentType}</span>
              <span className="text-muted-foreground truncate">{l.channelName ?? "—"}</span>
              <span className="text-muted-foreground truncate">{l.model ?? ""}</span>
              <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                {l.startedAt.slice(5, 16).replace("T", " ")}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
