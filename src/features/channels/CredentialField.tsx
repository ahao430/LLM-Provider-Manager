import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearChannelCredential,
  revealChannelCredential,
  setChannelCredential,
  type CredentialKind,
} from "@/lib/tauri";

interface CredentialFieldProps {
  channelId: string;
  kind: CredentialKind;
  /** 列表展示的掩码（来自后端）；无凭证时为 null */
  masked: string | null;
  /** 保存后刷新详情 */
  onChanged: () => void;
}

/**
 * 凭证字段：默认掩码；眼睛图标受控查看明文；支持替换与清空。
 * 交互遵循 PLAN.md「凭证安全」：默认掩码、主动查看、未修改不重写。
 */
export function CredentialField({ channelId, kind, masked, onChanged }: CredentialFieldProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const hasCredential = masked != null || revealed != null;

  async function toggleReveal() {
    if (revealed != null) {
      setRevealed(null);
      return;
    }
    try {
      const plain = await revealChannelCredential(channelId, kind);
      if (plain == null) {
        toast.info("该凭证尚未设置");
        return;
      }
      setRevealed(plain);
    } catch (error) {
      toast.error(`读取凭证失败：${error}`);
    }
  }

  async function save() {
    const value = draft.trim();
    if (!value) return;
    setBusy(true);
    try {
      await setChannelCredential(channelId, kind, value);
      setDraft("");
      setRevealed(null);
      toast.success("凭证已保存到系统凭证库");
      onChanged();
    } catch (error) {
      toast.error(`保存失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await clearChannelCredential(channelId, kind);
      setRevealed(null);
      setDraft("");
      toast.success("凭证已清空");
      onChanged();
    } catch (error) {
      toast.error(`清空失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <KeyRound className="text-muted-foreground size-4 shrink-0" />
        {hasCredential ? (
          <code className="bg-muted flex-1 truncate rounded px-2 py-1 text-xs">
            {revealed ?? masked ?? "已设置"}
          </code>
        ) : (
          <span className="text-muted-foreground flex-1 text-sm">未设置</span>
        )}
        {hasCredential ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={revealed ? "隐藏明文" : "查看明文"}
            onClick={toggleReveal}
          >
            {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder="输入新凭证替换（留空不变）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1"
        />
        <Button type="button" size="sm" variant="outline" disabled={busy || !draft.trim()} onClick={save}>
          保存
        </Button>
        {hasCredential ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={clear}>
            清空
          </Button>
        ) : null}
      </div>
    </div>
  );
}
