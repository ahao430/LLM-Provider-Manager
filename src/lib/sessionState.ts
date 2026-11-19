import type { NavigateFunction } from "react-router-dom";

/** 会话级 UI 状态（sessionStorage）：页面切换不丢，应用重启清零。 */
export function loadSessionState<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // 对象浅合并（容错新增字段）；数组等非对象类型原样返回
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      fallback &&
      typeof fallback === "object" &&
      !Array.isArray(fallback)
    ) {
      return { ...fallback, ...parsed } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function saveSessionState(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 配额 / 序列化异常直接忽略（UI 状态不关键）
  }
}

/**
 * 返回上一页（保留来源页状态），无历史时回退到 fallback 路由。
 * react-router 在 history.state.idx 记录条目深度，>0 表示存在上一页。
 */
export function goBackOr(navigate: NavigateFunction, fallback: string): void {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate(fallback);
}

// ---- 滚动位置恢复（内存级：会话内路由切换有效） ----
const scrollPositions = new Map<string, number>();

export function saveScrollPosition(pathname: string, top: number): void {
  scrollPositions.set(pathname, top);
}

export function restoreScrollPosition(pathname: string): number {
  return scrollPositions.get(pathname) ?? 0;
}
