import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CloudDownload, FileUp, Plus, Trash2, Wallet } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  addBalanceSnapshot,
  addBill,
  addRecharge,
  deleteBalanceSnapshot,
  deleteBill,
  deleteRecharge,
  getChannelFunds,
  importBailianBills,
  importBillsFromFile,
  queryBailianTransactions,
  type BailianTransaction,
  type RechargeRow,
} from "@/lib/tauri";

/** 渠道详情「资金」Tab：充值 / 账单 / 余额快照 / 估算余额。三类金额分开。 */
export function FundsTab({
  channelId,
  balanceProvider,
}: {
  channelId: string;
  /** 余额查询方式（aliyun_bss 时可拉取百炼账单） */
  balanceProvider?: string;
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["channel-funds", channelId] });
  const { data: funds, isLoading } = useQuery({
    queryKey: ["channel-funds", channelId],
    queryFn: () => getChannelFunds(channelId),
  });

  const todayStr = () => new Date().toISOString().slice(0, 10);

  // 充值表单
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [recharge, setRecharge] = useState({
    amount: "",
    currency: "CNY",
    paymentMethod: "",
    transactionId: "",
    rechargedAt: todayStr(),
    notes: "",
  });

  // 账单表单
  const [billOpen, setBillOpen] = useState(false);
  const [bailianOpen, setBailianOpen] = useState(false);
  const [bill, setBill] = useState({
    billingPeriod: new Date().toISOString().slice(0, 7),
    amount: "",
    currency: "CNY",
    notes: "",
  });

  // 快照表单
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({ balance: "", currency: "CNY", notes: "" });

  const deleteRechargeMutation = useMutation({
    mutationFn: deleteRecharge,
    onSuccess: () => {
      toast.success("充值记录已删除");
      invalidate();
    },
    onError: (e) => toast.error(`删除失败：${e}`),
  });
  const deleteBillMutation = useMutation({
    mutationFn: deleteBill,
    onSuccess: () => {
      toast.success("账单已删除");
      invalidate();
    },
    onError: (e) => toast.error(`删除失败：${e}`),
  });
  const deleteSnapshotMutation = useMutation({
    mutationFn: deleteBalanceSnapshot,
    onSuccess: () => {
      toast.success("快照已删除");
      invalidate();
    },
    onError: (e) => toast.error(`删除失败：${e}`),
  });

  async function saveRecharge() {
    const amount = Number(recharge.amount);
    if (!Number.isFinite(amount) || recharge.amount.trim() === "") {
      toast.error("请填写金额");
      return;
    }
    try {
      await addRecharge({
        channelId,
        amount,
        currency: recharge.currency,
        paymentMethod: recharge.paymentMethod.trim() || null,
        transactionId: recharge.transactionId.trim() || null,
        rechargedAt: recharge.rechargedAt,
        notes: recharge.notes.trim() || null,
      });
      toast.success("充值记录已添加");
      setRechargeOpen(false);
      setRecharge((r) => ({ ...r, amount: "", transactionId: "", notes: "" }));
      invalidate();
    } catch (e) {
      toast.error(`保存失败：${e}`);
    }
  }

  async function saveBill() {
    const amount = Number(bill.amount);
    if (!Number.isFinite(amount) || bill.amount.trim() === "") {
      toast.error("请填写金额");
      return;
    }
    try {
      await addBill({
        channelId,
        billingPeriod: bill.billingPeriod,
        amount,
        currency: bill.currency,
        source: "manual",
        notes: bill.notes.trim() || null,
      });
      toast.success("供应商账单已录入");
      setBillOpen(false);
      setBill((b) => ({ ...b, amount: "", notes: "" }));
      invalidate();
    } catch (e) {
      toast.error(`保存失败：${e}`);
    }
  }

  /** CSV / Excel 账单导入（列序：账期 YYYY-MM、金额、币种、备注）。 */
  const [importing, setImporting] = useState(false);
  async function handleImportBills() {
    const picked = await openDialog({
      multiple: false,
      title: "选择账单文件（.csv / .xlsx）",
      filters: [{ name: "账单文件", extensions: ["csv", "xlsx"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    setImporting(true);
    try {
      const report = await importBillsFromFile(channelId, picked);
      if (report.failed.length > 0) {
        const preview = report.failed
          .slice(0, 3)
          .map((f) => `第 ${f.row} 行：${f.reason}`)
          .join("\n");
        toast.warning(
          `导入完成：新增 ${report.created} / 跳过重复 ${report.skipped} / 失败 ${report.failed.length}\n${preview}${report.failed.length > 3 ? "\n…" : ""}`,
          { duration: 8000 }
        );
      } else {
        toast.success(
          `导入完成：新增 ${report.created}${report.skipped > 0 ? `（跳过重复 ${report.skipped}）` : ""}`
        );
      }
      invalidate();
    } catch (e) {
      toast.error(`导入失败：${e}`);
    } finally {
      setImporting(false);
    }
  }

  async function saveSnapshot() {
    const balance = Number(snapshot.balance);
    if (!Number.isFinite(balance) || snapshot.balance.trim() === "") {
      toast.error("请填写余额");
      return;
    }
    try {
      await addBalanceSnapshot({
        channelId,
        balance,
        currency: snapshot.currency,
        capturedAt: new Date().toISOString(),
        notes: snapshot.notes.trim() || null,
      });
      toast.success("余额快照已记录");
      setSnapshotOpen(false);
      setSnapshot((s) => ({ ...s, balance: "", notes: "" }));
      invalidate();
    } catch (e) {
      toast.error(`保存失败：${e}`);
    }
  }

  const { data: recharges = [] } = useQuery({
    queryKey: ["recharges", channelId],
    queryFn: () => import("@/lib/tauri").then((m) => m.listRecharges(channelId)),
  });
  const { data: bills = [] } = useQuery({
    queryKey: ["bills", channelId],
    queryFn: () => import("@/lib/tauri").then((m) => m.listBills(channelId)),
  });
  const { data: snapshots = [] } = useQuery({
    queryKey: ["balance-snapshots", channelId],
    queryFn: () => import("@/lib/tauri").then((m) => m.listBalanceSnapshots(channelId)),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4" />
            资金汇总
          </CardTitle>
          <CardDescription>
            充值、供应商账单、本地测试费用是三种不同的数字；估算余额 = 累计充值 − 供应商账单
            （不含赠送 / 退款 / 其他消费），仅供参考。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : funds ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">累计充值</div>
                {funds.rechargeTotals.length === 0 ? (
                  <div className="text-muted-foreground mt-1 text-sm">—</div>
                ) : (
                  funds.rechargeTotals.map((t) => (
                    <div key={t.currency} className="mt-1 flex items-center justify-between">
                      <Badge variant="outline">{t.currency}</Badge>
                      <span className="font-medium tabular-nums">{t.amount.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">供应商账单</div>
                {funds.billTotals.length === 0 ? (
                  <div className="text-muted-foreground mt-1 text-sm">—</div>
                ) : (
                  funds.billTotals.map((t) => (
                    <div key={t.currency} className="mt-1 flex items-center justify-between">
                      <Badge variant="outline">{t.currency}</Badge>
                      <span className="font-medium tabular-nums">{t.amount.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">估算余额（充值 − 账单）</div>
                {funds.estimatedBalance.length === 0 ? (
                  <div className="text-muted-foreground mt-1 text-sm">—</div>
                ) : (
                  funds.estimatedBalance.map((t) => (
                    <div key={t.currency} className="mt-1 flex items-center justify-between">
                      <Badge variant="outline">{t.currency}</Badge>
                      <span
                        className={`font-medium tabular-nums ${t.amount < 0 ? "text-destructive" : ""}`}
                      >
                        {t.amount.toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">充值记录</CardTitle>
            <CardDescription>每笔充值单独保存。</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setRechargeOpen(true)}>
            <Plus className="size-4" />添加充值
          </Button>
        </CardHeader>
        <CardContent>
          {recharges.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无充值记录。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>支付方式</TableHead>
                  <TableHead>流水号</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recharges.map((r: RechargeRow) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{r.rechargedAt}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.currency}</Badge>{" "}
                      <span className="tabular-nums">{r.amount.toFixed(2)}</span>
                    </TableCell>
                    <TableCell className="text-xs">{r.paymentMethod ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {r.transactionId ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-32 truncate text-xs">
                      {r.notes ?? ""}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteRechargeMutation.mutate(r.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">供应商账单</CardTitle>
            <CardDescription>
              手工录入实际结算金额；同渠道同账期同来源唯一。支持 CSV / Excel 导入
              （列序：账期 YYYY-MM、金额、币种、备注，首行为表头）。
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {balanceProvider === "aliyun_bss" ? (
              <Button size="sm" variant="outline" onClick={() => setBailianOpen(true)}>
                <CloudDownload className="size-4" />拉取百炼账单
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={handleImportBills} disabled={importing}>
              <FileUp className="size-4" />
              {importing ? "导入中…" : "导入 CSV/Excel"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBillOpen(true)}>
              <Plus className="size-4" />录入账单
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bills.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无账单。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账期</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="tabular-nums">{b.billingPeriod}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{b.currency}</Badge>{" "}
                      <span className="tabular-nums">{b.amount.toFixed(2)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{b.source}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-32 truncate text-xs">
                      {b.notes ?? ""}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => deleteBillMutation.mutate(b.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">余额快照</CardTitle>
            <CardDescription>
              从供应商控制台人工抄录的余额；LCM 不自动同步、不假装能同步。
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSnapshotOpen(true)}>
            <Plus className="size-4" />记录快照
          </Button>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无快照。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>抄录时间</TableHead>
                  <TableHead>余额</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs whitespace-nowrap">{s.capturedAt.slice(0, 19).replace("T", " ")}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.currency}</Badge>{" "}
                      <span className="tabular-nums">{s.balance.toFixed(2)}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-40 truncate text-xs">
                      {s.notes ?? ""}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteSnapshotMutation.mutate(s.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 充值对话框 */}
      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加充值</DialogTitle>
            <DialogDescription>金额与币种按实际支付填写；不同币种分开统计。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>金额 *</Label>
                <Input type="number" step="any" value={recharge.amount} onChange={(e) => setRecharge({ ...recharge, amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>币种</Label>
                <Select value={recharge.currency} onValueChange={(v) => setRecharge({ ...recharge, currency: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNY">CNY</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>充值时间</Label>
                <Input type="date" value={recharge.rechargedAt} onChange={(e) => setRecharge({ ...recharge, rechargedAt: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>支付方式</Label>
                <Input value={recharge.paymentMethod} onChange={(e) => setRecharge({ ...recharge, paymentMethod: e.target.value })} placeholder="alipay / wechat / card" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>流水号</Label>
              <Input value={recharge.transactionId} onChange={(e) => setRecharge({ ...recharge, transactionId: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>备注</Label>
              <Textarea rows={2} value={recharge.notes} onChange={(e) => setRecharge({ ...recharge, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechargeOpen(false)}>取消</Button>
            <Button onClick={saveRecharge}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 账单对话框 */}
      <Dialog open={billOpen} onOpenChange={setBillOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>录入供应商账单</DialogTitle>
            <DialogDescription>账期为 YYYY-MM；同账期同来源不可重复录入。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>金额 *</Label>
                <Input type="number" step="any" value={bill.amount} onChange={(e) => setBill({ ...bill, amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>币种</Label>
                <Select value={bill.currency} onValueChange={(v) => setBill({ ...bill, currency: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNY">CNY</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>账期 *</Label>
              <Input type="month" value={bill.billingPeriod} onChange={(e) => setBill({ ...bill, billingPeriod: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>备注</Label>
              <Textarea rows={2} value={bill.notes} onChange={(e) => setBill({ ...bill, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillOpen(false)}>取消</Button>
            <Button onClick={saveBill}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 百炼账单拉取对话框 */}
      {bailianOpen ? (
        <BailianBillsDialog
          channelId={channelId}
          onClose={() => setBailianOpen(false)}
          onImported={invalidate}
        />
      ) : null}

      {/* 快照对话框 */}
      <Dialog open={snapshotOpen} onOpenChange={setSnapshotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>记录余额快照</DialogTitle>
            <DialogDescription>从供应商控制台抄录的当前余额。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>余额 *</Label>
                <Input type="number" step="any" value={snapshot.balance} onChange={(e) => setSnapshot({ ...snapshot, balance: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>币种</Label>
                <Select value={snapshot.currency} onValueChange={(v) => setSnapshot({ ...snapshot, currency: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNY">CNY</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>备注</Label>
              <Textarea rows={2} value={snapshot.notes} onChange={(e) => setSnapshot({ ...snapshot, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnapshotOpen(false)}>取消</Button>
            <Button onClick={saveSnapshot}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------
// 百炼（阿里云费用中心）账单拉取
// ------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function BailianBillsDialog({
  channelId,
  onClose,
  onImported,
}: {
  channelId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [start, setStart] = useState(daysAgo(30));
  const [end, setEnd] = useState(daysAgo(0));
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rows, setRows] = useState<BailianTransaction[]>([]);
  const [nextToken, setNextToken] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [accountName, setAccountName] = useState("");

  // 按月汇总（预览导入结果；消费为负、充值为正，净额求和）
  const monthly = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const r of rows) {
      const period = r.transactionTime.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(period)) continue;
      const amount = Number(r.amount.replace(/,/g, ""));
      if (!Number.isFinite(amount)) continue;
      const entry = map.get(period) ?? { amount: 0, count: 0 };
      entry.amount += amount;
      entry.count += 1;
      map.set(period, entry);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, e]) => ({ period, ...e }));
  }, [rows]);

  async function fetchPage(token?: string) {
    setBusy(true);
    try {
      const res = await queryBailianTransactions(channelId, start, end, token);
      setRows((prev) => (token ? [...prev, ...res.transactions] : res.transactions));
      setNextToken(res.nextToken);
      setTotalCount(res.totalCount);
      setAccountName(res.accountName);
      if (!token && res.transactions.length === 0) toast.info("该时间范围内没有收支明细");
    } catch (e) {
      toast.error(`查询失败：${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function importBills() {
    if (rows.length === 0) return;
    setImporting(true);
    try {
      const imported = await importBailianBills(
        channelId,
        "CNY",
        rows.map((r) => ({ transactionTime: r.transactionTime, amount: r.amount }))
      );
      toast.success(
        imported.length > 0
          ? `已导入 ${imported.length} 个月度账单：${imported
              .map((m) => `${m.billingPeriod}（${m.amount.toFixed(2)}）`)
              .join("、")}`
          : "没有可导入的明细"
      );
      onImported();
      onClose();
    } catch (e) {
      toast.error(`导入失败：${e}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>拉取百炼账单（阿里云费用中心）</DialogTitle>
          <DialogDescription>
            QueryAccountTransactionDetails 收支明细{accountName ? ` · 账户 ${accountName}` : ""}；
            导入按月汇总为净额账单（同渠道同账期覆盖替换，来源 aliyun_bss）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">开始日期</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">结束日期</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <Button size="sm" className="h-8" onClick={() => void fetchPage()} disabled={busy}>
            <CloudDownload className="size-4" />
            {busy ? "查询中…" : "查询"}
          </Button>
          {nextToken ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void fetchPage(nextToken)}
              disabled={busy}
            >
              加载更多（已 {rows.length}/{totalCount}）
            </Button>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">时间</TableHead>
                    <TableHead className="text-xs">类型</TableHead>
                    <TableHead className="text-right text-xs">金额（CNY）</TableHead>
                    <TableHead className="text-xs">资金类型</TableHead>
                    <TableHead className="text-xs">备注</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const amount = Number(r.amount.replace(/,/g, ""));
                    return (
                      <TableRow key={`${r.transactionTime}-${i}`}>
                        <TableCell className="text-xs whitespace-nowrap">{r.transactionTime}</TableCell>
                        <TableCell className="text-xs">{r.transactionType || "—"}</TableCell>
                        <TableCell
                          className={`text-right text-xs tabular-nums ${amount < 0 ? "text-destructive" : ""}`}
                        >
                          {Number.isFinite(amount) ? amount.toFixed(2) : r.amount}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{r.fundType || "—"}</TableCell>
                        <TableCell className="text-muted-foreground max-w-40 truncate text-xs" title={r.remarks}>
                          {r.remarks || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {monthly.length > 0 ? (
              <div className="text-xs">
                <span className="text-muted-foreground">按月汇总（净额）：</span>
                {monthly.map((m) => (
                  <Badge key={m.period} variant="outline" className="mx-1 tabular-nums">
                    {m.period} {m.amount.toFixed(2)}（{m.count} 笔）
                  </Badge>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            设置日期范围后点击「查询」；导入会按月求和写入供应商账单（净额 = 充值 − 消费）。
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button onClick={importBills} disabled={importing || rows.length === 0}>
            {importing ? "导入中…" : `导入到账单（${rows.length} 条 → ${monthly.length || 0} 个月度）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
