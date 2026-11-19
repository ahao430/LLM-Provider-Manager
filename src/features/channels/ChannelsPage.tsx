import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Copy, ExternalLink, FolderCog, KeyRound, LayoutGrid, List, Pencil, Plus, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { ProviderIcon } from "@/components/ProviderIcon";
import { openExternal } from "@/lib/external";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  copyChannelCredential,
  listChannelModels,
  listLatestBalances,
  refreshChannelBalance,
  MODEL_TYPE_LABELS,
  PROTOCOL_LABELS,
  type ChannelRow,
  type ModelType,
} from "@/lib/tauri";
import { useUiStore } from "@/stores/ui";
import { loadSessionState, saveSessionState } from "@/lib/sessionState";
import { ChannelFormDialog } from "@/features/channels/ChannelFormDialog";
import { ChannelCards } from "@/features/channels/ChannelCards";
import { CredentialsDialog } from "@/features/channels/CredentialsDialog";
import { ManageGroupsDialog } from "@/features/channels/ManageGroupsDialog";
import { ModelTestButton } from "@/features/models/ModelTestButton";
import { LatestTestResult, useLatestModelTestMap } from "@/features/models/LatestTestResult";
import { useChannelGroups, useChannels, useSetChannelEnabled } from "@/features/channels/api";

const columnHelper = createColumnHelper<ChannelRow>();

const TYPE_VARIANT: Record<ModelType, "default" | "secondary" | "outline" | "destructive"> = {
  multimodal: "default",
  image: "secondary",
  text: "outline",
  decision: "destructive",
};

/** 渠道列表：凭证复制 / 余额展示与查询 / 展开模型逐个测试 / 编辑进详情。 */
export function ChannelsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: channels = [], isLoading, isError, error } = useChannels();
  const setEnabled = useSetChannelEnabled();
  const { data: groups = [] } = useChannelGroups();
  const channelsView = useUiStore((s) => s.channelsView);
  const setChannelsView = useUiStore((s) => s.setChannelsView);
  const [createOpen, setCreateOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  // 会话级 UI 状态：进详情再返回时保留展开行 / 分页 / 筛选 / 排序
  const savedUi = loadSessionState("lcm-ui-channels", {
    expandedId: null as string | null,
    page: 1,
    pageSize: 20,
    groupFilter: "",
  });
  // 分组筛选（列表视图）：空串 = 全部分组
  const [groupFilter, setGroupFilter] = useState(savedUi.groupFilter);
  const [expandedId, setExpandedId] = useState<string | null>(savedUi.expandedId);
  const [balanceBusy, setBalanceBusy] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>(
    () => loadSessionState("lcm-ui-channels-sorting", [{ id: "name", desc: false }] as SortingState)
  );
  // 分页：总数 ≤ 10 时 Pagination 自身不渲染
  const [page, setPage] = useState(savedUi.page);
  const [pageSize, setPageSize] = useState(savedUi.pageSize);

  useEffect(() => {
    saveSessionState("lcm-ui-channels", { expandedId, page, pageSize, groupFilter });
  }, [expandedId, page, pageSize, groupFilter]);
  useEffect(() => {
    saveSessionState("lcm-ui-channels-sorting", sorting);
  }, [sorting]);

  // 各渠道最近一次余额快照
  const { data: latestBalances = [] } = useQuery({
    queryKey: ["latest-balances"],
    queryFn: listLatestBalances,
  });
  const balanceMap = useMemo(() => {
    const map = new Map<string, (typeof latestBalances)[number]>();
    for (const b of latestBalances) map.set(b.channelId, b);
    return map;
  }, [latestBalances]);

  // 分组筛选（两个视图共用）；空串 = 全部分组
  const visibleChannels = useMemo(
    () => (groupFilter ? channels.filter((c) => c.groupId === groupFilter) : channels),
    [channels, groupFilter]
  );

  async function refreshBalance(id: string) {
    setBalanceBusy(id);
    try {
      const res = await refreshChannelBalance(id);
      if (res.savedSnapshot) {
        void queryClient.invalidateQueries({ queryKey: ["latest-balances"] });
        toast.success(`余额 ${res.currency ?? ""} ${String(res.value ?? "")} 已记录`);
      } else {
        toast.warning(
          res.value === undefined || res.value === null
            ? `未取到余额：${res.rawSnippet?.slice(0, 120) ?? "无响应"}`
            : `取到值 ${JSON.stringify(res.value)}，但非数字，未写快照`
        );
      }
    } catch (e) {
      toast.error(`查询失败：${e}`);
    } finally {
      setBalanceBusy(null);
    }
  }

  async function copyCredential(id: string) {
    try {
      await copyChannelCredential(id);
      toast.success("凭证已复制到剪贴板");
    } catch (e) {
      toast.error(`复制失败：${e}`);
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "expander",
        header: "",
        cell: ({ row }) => (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            title={expandedId === row.original.id ? "收起模型" : "展开模型"}
            onClick={() => setExpandedId(expandedId === row.original.id ? null : row.original.id)}
          >
            {expandedId === row.original.id ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        ),
      }),
      columnHelper.accessor("name", {
        header: "名称",
        cell: (info) => {
          const row = info.row.original;
          return (
            <button
              type="button"
              className="hover:text-primary inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
              title={row.officialUrl ? `打开官网：${row.officialUrl}` : "未配置官网链接（点击行进入详情）"}
              onClick={() => {
                if (row.officialUrl) {
                  void openExternal(row.officialUrl);
                } else {
                  toast.info("该渠道未配置官网链接（可在编辑表单填写）");
                }
              }}
            >
              {info.getValue()}
              {row.officialUrl ? <ExternalLink className="size-3 shrink-0" /> : null}
            </button>
          );
        },
      }),
      columnHelper.accessor("providerName", {
        header: "服务商",
        cell: (info) => {
          const row = info.row.original;
          // 图标按服务商 code 查表（prov_ 前缀剥离）；无品牌图标时字母回退
          const code = row.providerId?.replace(/^prov_/, "");
          return (
            <span className="inline-flex items-center gap-1.5">
              <ProviderIcon id={code} name={row.providerName ?? ""} className="size-3.5" />
              {info.getValue() ?? "—"}
            </span>
          );
        },
      }),
      columnHelper.accessor((row) => row.groupName ?? "", {
        id: "group",
        header: "分组",
        cell: (info) =>
          info.row.original.groupName ? (
            <Badge variant="outline">{info.row.original.groupName}</Badge>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          ),
      }),
      columnHelper.accessor("baseUrl", {
        header: "Base URL",
        cell: (info) => (
          <span className="text-muted-foreground font-mono text-xs">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor((row) => row.hasPrimaryCredential, {
        id: "credential",
        header: "凭证",
        cell: (info) => {
          const row = info.row.original;
          return row.hasPrimaryCredential ? (
            <span className="inline-flex items-center gap-1">
              <span className="font-mono text-xs">{row.primaryCredentialMasked}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                title="复制凭证到剪贴板"
                onClick={() => copyCredential(row.id)}
              >
                <Copy className="size-3.5" />
              </button>
            </span>
          ) : (
            <Badge variant="destructive">未配置</Badge>
          );
        },
      }),
      columnHelper.display({
        id: "balance",
        header: "余额",
        cell: ({ row }) => {
          const balance = balanceMap.get(row.original.id);
          return (
            <span className="inline-flex items-center gap-1.5">
              {balance ? (
                <span className="text-xs tabular-nums" title={`快照时间 ${balance.capturedAt}`}>
                  {balance.currency} {balance.balance.toFixed(2)}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                title="查询余额（写快照）"
                disabled={balanceBusy === row.original.id}
                onClick={() => void refreshBalance(row.original.id)}
              >
                <RefreshCw
                  className={`size-3.5 ${balanceBusy === row.original.id ? "animate-spin" : ""}`}
                />
              </button>
            </span>
          );
        },
      }),
      columnHelper.accessor("enabled", {
        header: "启用",
        cell: (info) => (
          <Switch
            checked={info.getValue()}
            onCheckedChange={(checked) =>
              setEnabled.mutate({ id: info.row.original.id, enabled: checked })
            }
          />
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            title="编辑渠道（进详情页）"
            onClick={() => navigate(`/channels/${row.original.id}`)}
          >
            <Pencil className="size-4" />
          </Button>
        ),
      }),
    ],
    [navigate, setEnabled, expandedId, balanceMap, balanceBusy]
  );

  const table = useReactTable({
    data: visibleChannels,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // 排序后的行手动切片分页（数据量本地可控，不必引入分页 RowModel）
  const sortedRows = table.getRowModel().rows;
  const pageCount = Math.max(Math.ceil(sortedRows.length / pageSize), 1);
  const safePage = Math.min(page, pageCount);
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <>
      <PageHeader
        title="渠道管理"
        description="集中管理服务商、渠道、连接配置、凭证与 Agent 启动。同一服务商可点击「管理分组」归类；卡片视图按分组分区；置顶（Pin）的渠道会出现在首页仪表盘。"
        actions={
          <>
            <div className="bg-muted inline-flex rounded-lg p-1">
              <Button
                size="sm"
                variant={channelsView === "list" ? "secondary" : "ghost"}
                className="h-7 px-2"
                title="列表视图"
                onClick={() => setChannelsView("list")}
              >
                <List className="size-4" />
              </Button>
              <Button
                size="sm"
                variant={channelsView === "cards" ? "secondary" : "ghost"}
                className="h-7 px-2"
                title="卡片视图（按分组分区）"
                onClick={() => setChannelsView("cards")}
              >
                <LayoutGrid className="size-4" />
              </Button>
            </div>
            <Button variant="outline" onClick={() => setGroupsOpen(true)}>
              <FolderCog className="size-4" />
              管理分组
            </Button>
            <Button variant="outline" onClick={() => setCredentialsOpen(true)}>
              <KeyRound className="size-4" />
              凭证一览
            </Button>
            {channelsView === "list" ? (
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue placeholder="全部分组" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全部分组</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />新建渠道
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="text-destructive text-sm">加载渠道失败：{String(error)}</p>
      ) : channels.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          还没有渠道。点击右上角「新建渠道」开始，或先在 PLAN.md 了解渠道模板。
        </div>
      ) : channelsView === "cards" ? (
        <ChannelCards
          channels={visibleChannels}
          groups={groups}
          balanceMap={balanceMap}
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {pageRows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => navigate(`/channels/${row.original.id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} onClick={(e) => e.stopPropagation()}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {expandedId === row.original.id ? (
                    <ChannelModelsSubRow channelId={row.original.id} colSpan={columns.length} />
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          <div className="border-t px-3 pb-2">
            <Pagination
              page={safePage}
              pageCount={pageCount}
              pageSize={pageSize}
              total={sortedRows.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        </div>
      )}

      <ChannelFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(id) => navigate(`/channels/${id}`)}
      />
      <ManageGroupsDialog open={groupsOpen} onOpenChange={setGroupsOpen} />
      <CredentialsDialog open={credentialsOpen} onOpenChange={setCredentialsOpen} />
    </>
  );
}

/** 展开行：渠道模型清单（分页）+ 逐模型快速测试，测试后行内展示最近结果。 */
function ChannelModelsSubRow({ channelId, colSpan }: { channelId: string; colSpan: number }) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: ["channel-models", channelId],
    queryFn: () => listChannelModels(channelId),
  });
  // 最近一次测试结果：ModelTestButton 完成后自动失效刷新
  const latestMap = useLatestModelTestMap();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(Math.ceil(models.length / pageSize), 1);
  const safePage = Math.min(page, pageCount);
  const pageModels = models.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="bg-muted/30 p-0">
        {isLoading ? (
          <Skeleton className="m-3 h-16 w-[calc(100%-1.5rem)]" />
        ) : models.length === 0 ? (
          <p className="text-muted-foreground p-3 text-xs">
            暂无模型；进入渠道详情「模型」页签获取导入。
          </p>
        ) : (
          <div>
            <div className="divide-y">
              {pageModels.map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-6 py-1.5">
                  <code className="min-w-40 text-xs font-medium">{m.actualModelId}</code>
                  <Badge variant={TYPE_VARIANT[m.modelType]} className="text-[10px]">
                    {MODEL_TYPE_LABELS[m.modelType]}
                  </Badge>
                  <span className="text-muted-foreground text-[10px]">
                    {PROTOCOL_LABELS[m.protocol] ?? m.protocol}
                  </span>
                  {!m.enabled ? (
                    <Badge variant="secondary" className="text-[10px]">
                      已禁用
                    </Badge>
                  ) : null}
                  <span className="flex-1" />
                  <LatestTestResult
                    latest={latestMap.get(`${channelId}|${m.actualModelId.trim().toLowerCase()}`)}
                  />
                  <ModelTestButton
                    channelId={channelId}
                    actualModelId={m.actualModelId}
                    protocol={m.protocol}
                  />
                </div>
              ))}
            </div>
            <div className="px-4 pb-2">
              <Pagination
                page={safePage}
                pageCount={pageCount}
                pageSize={pageSize}
                total={models.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                unit="个"
              />
            </div>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
