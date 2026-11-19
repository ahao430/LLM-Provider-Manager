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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { openExternal } from "@/lib/external";
import {
  useCnVendors,
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

/** builtin_apiprice 是「可独立抓取 / 开关」的内置汇总源；其余内置源只读。 */
const FETCHABLE_BUILTIN = "builtin_apiprice";

/**
 * 市场数据源管理，分三个区块：
 * 1. 内置汇总源（models.dev / apiprice.app / 国内叠加层）——只读；apiprice 可开关、可独立抓取；
 * 2. 国内厂商官网价明细（data_cn 叠加层每家厂商的官网价页）；
 * 3. 自定义源（NewAPI 类站点「模型广场」），可增删改。
 */
export function MarketSourcesCard() {
  const { data: sources = [], isLoading } = useMarketSources();
  const { data: cnVendors = [] } = useCnVendors();
  const fetchSource = useFetchMarketSource();
  const toggleSource = useToggleMarketSource();
  const deleteSource = useDeleteMarketSource();
  const [saveOpen, setSaveOpen] = useState(false);
  const [editing, setEditing] = useState<MarketSourceRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const builtinSources = sources.filter((s) => s.builtin);
  const customSources = sources.filter((s) => !s.builtin);

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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">市场数据源</CardTitle>
        <CardDescription>
          汇总源提供全厂商价格参考；启用的源会并入市场信息页展示（各自独立成组、标注来源，不做黑盒合并）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 区块一：内置汇总源 */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">内置汇总源</h3>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">加载中…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>源</TableHead>
                  <TableHead className="w-20">类型</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead className="w-20">启用</TableHead>
                  <TableHead className="w-40">最近抓取</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {builtinSources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <SourceIcon source={s} />
                        <span className="text-sm font-medium">{s.name}</span>
                        {s.id === FETCHABLE_BUILTIN ? (
                          <Badge variant="outline" className="text-[10px]">CC BY 4.0</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {KIND_LABELS[s.kind] ?? s.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs">
                      {s.baseUrl ? (
                        <button
                          type="button"
                          className="text-primary inline-flex items-center gap-0.5 hover:underline"
                          onClick={() => s.baseUrl && void openExternal(s.baseUrl)}
                        >
                          {s.baseUrl}
                          <ExternalLink className="size-3" />
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={s.enabled}
                        disabled={s.builtin && s.id !== FETCHABLE_BUILTIN}
                        onCheckedChange={(v) => toggleSource.mutate({ sourceId: s.id, enabled: v })}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {s.fetchedAt ? (
                        <>
                          {fmtTime(s.fetchedAt)}
                          <span className="text-muted-foreground/80"> · {s.cachedModelCount ?? 0} 模型</span>
                        </>
                      ) : s.id === FETCHABLE_BUILTIN ? (
                        "未抓取"
                      ) : (
                        "随应用快照"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {s.id === FETCHABLE_BUILTIN ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="抓取 apiprice 开放数据"
                            disabled={fetchSource.isPending}
                            onClick={() => fetchSource.mutate(s.id)}
                          >
                            <CloudDownload className="size-4" />
                          </Button>
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
          <p className="text-muted-foreground text-xs">
            models.dev 与国内叠加层由市场信息页「抓取数据」统一刷新；apiprice.app
            开放数据（官方 / 国内官方 / OpenRouter 三通道，带缓存与分时段价）在此独立抓取与开关。
          </p>
        </section>

        <Separator />

        {/* 区块二：国内厂商官网价明细 */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">国内厂商官网价（内置叠加层，每家官网链接）</h3>
          {cnVendors.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无国内叠加层数据。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cnVendors.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  title={`${v.name} 官网定价页（叠加层 ${v.modelCount} 条）`}
                  className="bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/50 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                  onClick={() => v.pricingUrl && void openExternal(v.pricingUrl)}
                >
                  {v.name}
                  <Badge variant="outline" className="text-[10px]">{v.modelCount} 条</Badge>
                  <ExternalLink className="size-3" />
                </button>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            国内厂商官方以人民币计价（部分含低谷分时段价），读取时叠加到对应海外条目旁；随应用内置，更新见版本发布。
          </p>
        </section>

        <Separator />

        {/* 区块三：自定义源 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">自定义源（NewAPI 模型广场）</h3>
            <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)}>
              <Plus className="size-4" />
              添加源
            </Button>
          </div>
          {customSources.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              暂无自定义源。NewAPI 类站点填「模型广场」页面地址（如 https://yiz.bjkhdf.cn/pricing），
              按站点 /api/pricing 倍率折算为 USD 估算价（1 倍率 = $2/百万 token）。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>源</TableHead>
                  <TableHead className="w-24">类型</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead className="w-20">启用</TableHead>
                  <TableHead className="w-40">最近抓取</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customSources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <SourceIcon source={s} />
                        <span className="text-sm font-medium">{s.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {KIND_LABELS[s.kind] ?? s.kind}
                        {s.kind === "sub2api" ? " TODO" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs">
                      <button
                        type="button"
                        className="text-primary inline-flex items-center gap-0.5 hover:underline"
                        onClick={() => s.baseUrl && void openExternal(s.baseUrl)}
                      >
                        {s.baseUrl}
                        <ExternalLink className="size-3" />
                      </button>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) => toggleSource.mutate({ sourceId: s.id, enabled: v })}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {s.fetchedAt ? (
                        <>
                          {fmtTime(s.fetchedAt)}
                          <span className="text-muted-foreground/80"> · {s.cachedModelCount ?? 0} 模型</span>
                        </>
                      ) : (
                        "未抓取"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
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
  if (source.builtin && source.id === FETCHABLE_BUILTIN) {
    return <LetterIcon letter="A" />;
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
