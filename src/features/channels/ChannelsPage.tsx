import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Copy, Pencil, Plus } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
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
  copyChannelCredential,
  getChannel,
  listChannelModels,
  MODEL_TYPE_LABELS,
  PROTOCOL_LABELS,
  type ChannelDetail,
  type ChannelRow,
  type ModelType,
} from "@/lib/tauri";
import { ChannelFormDialog } from "@/features/channels/ChannelFormDialog";
import { ModelTestButton } from "@/features/models/ModelTestButton";
import { useChannels, useSetChannelEnabled } from "@/features/channels/api";

const columnHelper = createColumnHelper<ChannelRow>();

const TYPE_VARIANT: Record<ModelType, "default" | "secondary" | "outline" | "destructive"> = {
  multimodal: "default",
  image: "secondary",
  text: "outline",
  decision: "destructive",
};

/** 渠道列表：凭证复制 / 行内编辑 / 展开查看模型并逐模型快速测试。 */
export function ChannelsPage() {
  const navigate = useNavigate();
  const { data: channels = [], isLoading, isError, error } = useChannels();
  const setEnabled = useSetChannelEnabled();
  const [createOpen, setCreateOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<ChannelDetail | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);

  async function openEdit(id: string) {
    try {
      setEditChannel(await getChannel(id));
    } catch (e) {
      toast.error(`读取渠道失败：${e}`);
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
        cell: (info) => (
          <button
            type="button"
            className="hover:text-primary font-medium underline-offset-4 hover:underline"
            onClick={() => navigate(`/channels/${info.row.original.id}`)}
          >
            {info.getValue()}
          </button>
        ),
      }),
      columnHelper.accessor("providerName", {
        header: "服务商",
        cell: (info) => info.getValue() ?? "—",
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
            title="编辑渠道"
            onClick={() => void openEdit(row.original.id)}
          >
            <Pencil className="size-4" />
          </Button>
        ),
      }),
    ],
    [navigate, setEnabled, expandedId]
  );

  const table = useReactTable({
    data: channels,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      <PageHeader
        title="渠道管理"
        description="集中管理服务商、渠道、连接配置、凭证与 Agent 启动。同一服务商可配置多个渠道实例。"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />新建渠道
          </Button>
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
              {table.getRowModel().rows.map((row) => (
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
        </div>
      )}

      <ChannelFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(id) => navigate(`/channels/${id}`)}
      />
      {editChannel ? (
        <ChannelFormDialog open onOpenChange={(open) => !open && setEditChannel(null)} channel={editChannel} />
      ) : null}
    </>
  );
}

/** 展开行：渠道模型清单 + 逐模型快速测试。 */
function ChannelModelsSubRow({ channelId, colSpan }: { channelId: string; colSpan: number }) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: ["channel-models", channelId],
    queryFn: () => listChannelModels(channelId),
  });

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
          <div className="divide-y">
            {models.map((m) => (
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
                <ModelTestButton
                  channelId={channelId}
                  actualModelId={m.actualModelId}
                  protocol={m.protocol}
                />
              </div>
            ))}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
