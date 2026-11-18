import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Wallet } from "lucide-react";

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
  type RechargeRow,
} from "@/lib/tauri";

/** 渠道详情「资金」Tab：充值 / 账单 / 余额快照 / 估算余额。三类金额分开。 */
export function FundsTab({ channelId }: { channelId: string }) {
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
              手工录入实际结算金额；同渠道同账期同来源唯一（CSV/Excel 导入在 Phase 8）。
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setBillOpen(true)}>
            <Plus className="size-4" />录入账单
          </Button>
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
