import { useState } from "react";
import { CloudDownload, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useDeleteMarketSource,
  useFetchMarketSource,
  useMarketSources,
  useSaveMarketSource,
  useToggleMarketSource,
} from "@/features/market/api";
import type { MarketSourceRow } from "@/lib/tauri";

const KIND_LABELS: Record<string, string> = {
  newapi: "NewAPI",
  sub2api: "Sub2API",
  builtin: "内置",
};

/**
 * 市场数据源管理：NewAPI 类站点「模型广场」价格抓取。
 * 内置源（models.dev / 国内官网价）只读展示，不可新增 / 编辑 / 删除。
 */
export function MarketSourcesCard() {
  const { data: sources = [], isLoading } = useMarketSources();
  const fetchSource = useFetchMarketSource();
  const toggleSource = useToggleMarketSource();
  const deleteSource = useDeleteMarketSource();
  const [saveOpen, setSaveOpen] = useState(false);
  const [editing, setEditing] = useState<MarketSourceRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      window.setTimeout(() => setConfirmDelete(null), 4000);
      return;
    }
    try {
      await deleteSource.mutateAsync(id);
      toast.success("数据源已删除");
      setConfirmDelete(null);
    } catch (error) {
      toast.error(`${error}`);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">市场数据源</CardTitle>
          <CardDescription>
            NewAPI 类站点填「模型广场」页面地址（如 https://yiz.bjkhdf.cn/pricing），按站点
            /api/pricing 倍率折算为 USD 估算价（1 倍率 = $2/百万 token）。启用的源会并入市场信息页展示。
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setSaveOpen(true)}>
          <Plus className="size-4" />
          添加源
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">加载中…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>源</TableHead>
                <TableHead className="w-24">类型</TableHead>
                <TableHead>地址</TableHead>
                <TableHead className="w-24">启用</TableHead>
                <TableHead className="w-40">最近抓取</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <SourceIcon source={s} />
                      <span className="text-sm font-medium">{s.name}</span>
                      {s.builtin ? <Badge variant="secondary">内置</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {KIND_LABELS[s.kind] ?? s.kind}
                      {s.kind === "sub2api" ? " TODO" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-xs">
                    {s.baseUrl ? (
                      <a
                        href={s.baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary inline-flex items-center gap-0.5 hover:underline"
                        onClick={(e) => e.preventDefault()} // Tauri 内跳转走外部浏览器，行内 a 仅展示
                      >
                        {s.baseUrl}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={s.enabled}
                      disabled={s.builtin}
                      onCheckedChange={(v) => toggleSource.mutate({ sourceId: s.id, enabled: v })}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {s.fetchedAt ? (
                      <>
                        {fmtTime(s.fetchedAt)}
                        <span className="text-muted-foreground/80"> · {s.cachedModelCount ?? 0} 模型</span>
                      </>
                    ) : s.builtin ? (
                      "随应用快照"
                    ) : (
                      "未抓取"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {!s.builtin ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="抓取价格"
                            disabled={fetchSource.isPending}
                            onClick={() => fetchSource.mutate(s.id)}
                          >
                            <CloudDownload className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="编辑"
                            onClick={() => setEditing(s)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={confirmDelete === s.id ? "再次点击确认删除" : "删除"}
                            onClick={() => handleDelete(s.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">只读</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {saveOpen ? (
        <SourceFormDialog onClose={() => setSaveOpen(false)} />
      ) : editing ? (
        <SourceFormDialog source={editing} onClose={() => setEditing(null)} />
      ) : null}
    </Card>
  );
}

/** 源图标：favicon data URL 优先；缺失回退首字母块。 */
function SourceIcon({ source }: { source: MarketSourceRow }) {
  if (source.iconData) {
    return (
      <img
        src={source.iconData}
        alt=""
        className="size-4 shrink-0 rounded-sm object-contain"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (source.builtin && source.id === "builtin_modelsdev") {
    return <LetterIcon letter="M" />;
  }
  if (source.builtin && source.id === "builtin_cn") {
    return <LetterIcon letter="国" />;
  }
  return <LetterIcon letter="N" />;
}

function LetterIcon({ letter }: { letter: string }) {
  return (
    <span className="bg-muted text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold leading-none">
      {letter}
    </span>
  );
}

function fmtTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

// ------------------------------------------------------------------
// 新增 / 编辑源弹窗
// ------------------------------------------------------------------

function SourceFormDialog({ source, onClose }: { source?: MarketSourceRow; onClose: () => void }) {
  const save = useSaveMarketSource();
  const [name, setName] = useState(source?.name ?? "");
  const [kind, setKind] = useState(source?.kind ?? "newapi");
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? "");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!name.trim()) return toast.error("请填写源名称");
    if (!baseUrl.trim()) return toast.error("请填写模型广场页面地址");
    setBusy(true);
    try {
      await save.mutateAsync({
        id: source?.id ?? null,
        name: name.trim(),
        kind,
        baseUrl: baseUrl.trim(),
        enabled: source?.enabled ?? true,
      });
      toast.success(source ? "数据源已更新" : `数据源「${name.trim()}」已添加，可点击抓取获取价格`);
      onClose();
    } catch (error) {
      toast.error(`保存失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{source ? "编辑数据源" : "添加数据源"}</DialogTitle>
          <DialogDescription>
            NewAPI 类站点：填模型广场页面地址，LCM 请求站点 /api/pricing 折算价格。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>名称 *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 易准大模型" />
          </div>
          <div className="space-y-1.5">
            <Label>类型</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newapi">NewAPI（/api/pricing）</SelectItem>
                <SelectItem value="sub2api" disabled>
                  Sub2API（TODO，暂不可用）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>模型广场页面地址 *</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://yiz.bjkhdf.cn/pricing"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
