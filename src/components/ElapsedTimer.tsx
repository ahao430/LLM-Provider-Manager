import { useEffect, useState } from "react";

/**
 * 请求计时器：running 时按秒跳动显示「已用时 Xs」，结束后冻结为最终耗时。
 * startedAt 为 epoch ms；未开始（startedAt=null）不渲染。
 */
export function ElapsedTimer({
  startedAt,
  running,
  finishedAt,
}: {
  startedAt: number | null;
  running: boolean;
  finishedAt: number | null;
}) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!running || startedAt == null) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running, startedAt]);

  if (startedAt == null) return null;
  const end = running ? Date.now() : (finishedAt ?? Date.now());
  const elapsed = Math.max(0, Math.round((end - startedAt) / 1000));
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums">
      {running ? `已用时 ${elapsed}s` : `耗时 ${elapsed}s`}
    </span>
  );
}
