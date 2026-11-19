/**
 * 时间展示助手：后端时间戳一律 UTC RFC3339 存储，展示时换算为本地时区。
 * 历史遗留：运维日志/待办页此前直接截取 UTC 字符串展示，比本地时间早 8 小时。
 */

/** UTC ISO → 本地 "MM-DD HH:mm" */
export function fmtLocalTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "YYYY-MM-DD" → "MM-DD"（due_date 等本地日期直通） */
export function fmtDayLabel(date: string): string {
  return date.slice(5, 10);
}
