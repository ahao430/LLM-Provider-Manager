import { describe, expect, it } from "vitest";
import { findNavItem, navItems } from "@/lib/navigation";

describe("主导航配置", () => {
  it("导航路径全局唯一", () => {
    const paths = navItems.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("导航 key 全局唯一", () => {
    const keys = navItems.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("所有路径以 / 开头且不含尾随斜杠", () => {
    for (const item of navItems) {
      expect(item.path.startsWith("/")).toBe(true);
      expect(item.path.endsWith("/")).toBe(false);
    }
  });

  it("findNavItem 按路径精确匹配", () => {
    expect(findNavItem("/settings")?.key).toBe("settings");
    expect(findNavItem("/not-exist")).toBeUndefined();
  });

  it("findNavItem 子路由前缀匹配所属菜单", () => {
    // 渠道详情高亮「渠道管理」；测试中心子 Tab 高亮「测试中心」
    expect(findNavItem("/channels/ch-123")?.key).toBe("channels");
    expect(findNavItem("/testing/api")?.key).toBe("testing");
    expect(findNavItem("/testing/agent")?.key).toBe("testing");
    expect(findNavItem("/requests/trace-1")?.key).toBe("requests");
  });

  it("测试功能收敛为一个测试中心菜单", () => {
    const labels = navItems.map((item) => item.label);
    expect(labels).toEqual([
      "仪表盘",
      "渠道管理",
      "模型列表",
      "市场信息",
      "测试中心",
      "测试记录",
      "运维记录",
      "设置",
    ]);
  });
});
