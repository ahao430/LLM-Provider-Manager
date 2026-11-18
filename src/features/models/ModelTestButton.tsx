import { useState } from "react";
import { toast } from "sonner";
import { Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { quickTestChannel, type Protocol } from "@/lib/tauri";

/** 渠道模型快速测试按钮：按模型自身协议发最小请求（写入测试记录）。 */
export function ModelTestButton({
  channelId,
  actualModelId,
  protocol,
  label,
}: {
  channelId: string;
  actualModelId: string;
  protocol: Protocol;
  /** 按钮文字（默认「测试」） */
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await quickTestChannel(channelId, protocol, actualModelId);
      if (res.status === "success") {
        toast.success(`「${actualModelId}」连通（HTTP ${res.httpStatus}）`);
      } else {
        toast.warning(`「${actualModelId}」请求结束：${res.status}（HTTP ${res.httpStatus}）`);
      }
    } catch (e) {
      toast.error(`测试失败：${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={run}
      disabled={busy}
      title={`用 ${protocol} 协议发送最小请求`}
    >
      <Rocket className="size-3.5" />
      {busy ? "测试中…" : (label ?? "测试")}
    </Button>
  );
}
