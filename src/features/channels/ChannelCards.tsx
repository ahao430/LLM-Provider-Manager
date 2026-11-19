import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Pin, PinOff, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/components/ProviderIcon";
import { copyChannelCredential, refreshChannelBalance, type ChannelGroupRow, type ChannelRow, type LatestBalanceRow } from "@/lib/tauri";
import { useSetChannelEnabled, useSetChannelPinned } from "@/features/channels/api";

interface ChannelCardsProps {
  channels: ChannelRow[];
  groups: ChannelGroupRow[];
  balanceMap: Map<string, LatestBalanceRow>;
}

/**
 * 渠道卡片视图：按分组分区（组顺序 = 分组列表序，未分组殿后），
 * 卡片含凭证状态 / 余额 / 启用开关 / 仪表盘置顶。
 */
export function ChannelCards({ channels, groups, balanceMap }: ChannelCardsProps) {
  const sections = useMemo(() => {
    const byGroup = new Map<string, ChannelRow[]>();
    const ungrouped: ChannelRow[] = [];
    for (const c of channels) {
      if (c.groupId) {
        const list = byGroup.get(c.groupId) ?? [];
        list.push(c);
        byGroup.set(c.groupId, list);
      } else {
        ungrouped.push(c);
      }
    }
    const ordered: { key: string; name: string; channels: ChannelRow[] }[] = [];
    for (const g of groups) {
      const items = byGroup.get(g.id);
      if (items && items.length > 0) {
        ordered.push({ key: g.id, name: g.name, channels: items });
      }
    }
    if (ungrouped.length > 0) {
      ordered.push({ key: "__ungrouped__", name: "未分组", channels: ungrouped });
    }
    return ordered;
  }, [channels, groups]);

  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <section key={s.key}>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-medium">{s.name}</h2>
            <Badge variant="outline">{s.channels.length}</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {s.channels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                balance={balanceMap.get(c.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ChannelCard({
  channel,
  balance,
}: {
  channel: ChannelRow;
  balance: LatestBalanceRow | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setEnabled = useSetChannelEnabled();
  const setPinned = useSetChannelPinned();
  const [balanceBusy, setBalanceBusy] = useState(false);

  async function handleRefreshBalance() {
    setBalanceBusy(true);
    try {
      const res = await refreshChannelBalance(channel.id);
      if (res.savedSnapshot) {
        void queryClient.invalidateQueries({ queryKey: ["latest-balances"] });
        toast.success(`余额 ${res.currency ?? ""} ${String(res.value ?? "")} 已记录`);
      } else {
        toast.warning(`未取到余额${res.rawSnippet ? `：${res.rawSnippet.slice(0, 120)}` : ""}`);
      }
    } catch (e) {
      toast.error(`查询失败：${e}`);
    } finally {
      setBalanceBusy(false);
    }
  }

  async function handleCopyCredential() {
    try {
      await copyChannelCredential(channel.id);
      toast.success("凭证已复制到剪贴板");
    } catch (e) {
      toast.error(`复制失败：${e}`);
    }
  }

  return (
    <Card className="gap-3 py-3">
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <button
              type="button"
              className="hover:underline truncate"
              onClick={() => navigate(`/channels/${channel.id}`)}
            >
              {channel.name}
            </button>
            {channel.dashboardPinned ? <Pin className="size-3.5 shrink-0 text-primary" /> : null}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              title={channel.dashboardPinned ? "取消仪表盘置顶" : "置顶到首页仪表盘"}
              onClick={() => setPinned.mutate({ id: channel.id, pinned: !channel.dashboardPinned })}
            >
              {channel.dashboardPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              title="编辑（进详情页）"
              onClick={() => navigate(`/channels/${channel.id}`)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Switch
              checked={channel.enabled}
              onCheckedChange={(checked) => setEnabled.mutate({ id: channel.id, enabled: checked })}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {channel.providerName ? (
            <Badge variant="secondary">
              <span className="flex items-center gap-1">
                <ProviderIcon
                  id={channel.providerId?.replace(/^prov_/, "")}
                  name={channel.providerName}
                  className="size-3"
                />
                {channel.providerName}
              </span>
            </Badge>
          ) : null}
          <Badge variant={channel.hasPrimaryCredential ? "outline" : "destructive"}>
            {channel.hasPrimaryCredential ? "已配置凭证" : "未配置凭证"}
          </Badge>
          {channel.groupName ? <Badge variant="outline">{channel.groupName}</Badge> : null}
        </div>
        <p className="text-muted-foreground font-mono truncate text-xs" title={channel.chatBaseUrl}>
          {channel.chatBaseUrl}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className={balance ? "tabular-nums" : "text-muted-foreground"} title={balance ? `快照时间 ${balance.capturedAt}` : undefined}>
            {balance ? `余额 ${balance.currency} ${balance.balance}` : "无余额记录"}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            title="查询余额（写快照）"
            disabled={balanceBusy}
            onClick={handleRefreshBalance}
          >
            <RefreshCw className={`size-3 ${balanceBusy ? "animate-spin" : ""}`} />
          </Button>
          {channel.hasPrimaryCredential ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={handleCopyCredential}
            >
              复制凭证
            </button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
