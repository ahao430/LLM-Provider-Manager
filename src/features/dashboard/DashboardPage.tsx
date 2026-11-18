import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardStats } from "@/features/api-testing/api";

/** Dashboard：渠道/模型/请求整体情况。充值与供应商账单分开统计。 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { data: stats, isLoading, isError, error } = useDashboardStats();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (isError || !stats) {
    return <p className="text-destructive text-sm">统计加载失败：{String(error)}</p>;
  }

  const successRate =
    stats.requests.total > 0
      ? ((stats.requests.success / stats.requests.total) * 100).toFixed(1)
      : "—";

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="渠道"
          value={`${stats.channelEnabled} / ${stats.channelTotal}`}
          note="启用 / 总数"
          onClick={() => navigate("/channels")}
        />
        <StatCard
          title="模型"
          value={`${stats.channelModels}`}
          note={`渠道模型（全局 ${stats.globalModels}）`}
          onClick={() => navigate("/channels")}
        />
        <StatCard
          title="测试"
          value={`${stats.requests.total}`}
          note={`成功 ${stats.requests.success} · 失败 ${stats.requests.failed} · 成功率 ${successRate}%`}
          onClick={() => navigate("/requests")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MoneyCard
          title="累计充值"
          note={`充值 ${stats.rechargeCount} 笔`}
          amounts={stats.rechargeTotals}
          empty="暂无充值记录"
        />
        <MoneyCard title="供应商账单" note="手工录入 / 导入" amounts={stats.billTotals} empty="暂无账单" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecordListCard
          title="最近测试"
          records={stats.recentRequests}
          empty="暂无测试记录"
          onOpen={(id) => navigate(`/requests/${id}`)}
        />
        <RecordListCard
          title="最近错误"
          records={stats.recentErrors}
          empty="没有错误记录 🎉"
          onOpen={(id) => navigate(`/requests/${id}`)}
        />
      </div>
    </>
  );
}

function StatCard({
  title,
  value,
  note,
  onClick,
}: {
  title: string;
  value: string;
  note: string;
  onClick?: () => void;
}) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-xs">{note}</p>
      </CardContent>
    </Card>
  );
}

function MoneyCard({
  title,
  note,
  amounts,
  empty,
}: {
  title: string;
  note: string;
  amounts: { currency: string; amount: number }[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {amounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{empty}</p>
        ) : (
          amounts.map((a) => (
            <div key={a.currency} className="flex items-center justify-between text-sm">
              <Badge variant="outline">{a.currency}</Badge>
              <span className="font-medium tabular-nums">{a.amount.toFixed(2)}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function RecordListCard({
  title,
  records,
  empty,
  onOpen,
}: {
  title: string;
  records: { traceId: string; model: string | null; status: string; createdAt: string }[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {records.length === 0 ? (
          <p className="text-muted-foreground text-sm">{empty}</p>
        ) : (
          records.map((r) => (
            <button
              key={r.traceId}
              type="button"
              onClick={() => onOpen(r.traceId)}
              className="hover:bg-accent/50 flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Badge variant={r.status === "success" ? "default" : "destructive"}>{r.status}</Badge>
                <code className="text-muted-foreground truncate text-xs">{r.model ?? "—"}</code>
              </span>
              <span className="text-muted-foreground whitespace-nowrap text-xs">
                {r.createdAt.slice(5, 16).replace("T", " ")}
              </span>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}
