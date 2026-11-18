/**
 * 主导航配置。
 *
 * 导航顺序与 PLAN.md「功能概览」保持一致：
 * Dashboard / 渠道管理 / 模型列表 / 市场信息 / 测试中心 / 测试记录 / 设置
 * （测试功能收敛到「测试中心」一个菜单：API 测试 / Agent 测试 / 画图 / 图像理解）
 */
export interface NavItem {
  /** 路由路径（必须全局唯一） */
  path: string;
  /** 导航 key（必须全局唯一） */
  key: string;
  /** 展示名称 */
  label: string;
}

export const navItems: NavItem[] = [
  { path: "/dashboard", key: "dashboard", label: "Dashboard" },
  { path: "/channels", key: "channels", label: "渠道管理" },
  { path: "/models", key: "models", label: "模型列表" },
  { path: "/market", key: "market", label: "市场信息" },
  { path: "/testing", key: "testing", label: "测试中心" },
  { path: "/requests", key: "requests", label: "测试记录" },
  { path: "/settings", key: "settings", label: "设置" },
];

/** 精确匹配优先，其次前缀匹配（子路由高亮所属菜单，如 /channels/:id、/testing/api）。 */
export function findNavItem(pathname: string): NavItem | undefined {
  return (
    navItems.find((item) => item.path === pathname) ??
    navItems.find((item) => pathname.startsWith(`${item.path}/`))
  );
}
