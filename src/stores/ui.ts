import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 主题：浅色 / 深色 / 跟随系统。 */
export type Theme = "light" | "dark" | "system";

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** 循环切换 light → dark → system → light（侧边栏快捷按钮用）。 */
  cycleTheme: () => void;
}

/** 全局 UI 状态（侧边栏折叠、主题；localStorage 持久化）。 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      theme: "system",
      setTheme: (theme) => set({ theme }),
      cycleTheme: () =>
        set((state) => ({
          theme:
            state.theme === "light" ? "dark" : state.theme === "dark" ? "system" : "light",
        })),
    }),
    {
      name: "lcm-ui",
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed, theme: state.theme }),
    }
  )
);

export const THEME_LABELS: Record<Theme, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};
