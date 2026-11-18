import { openUrl as openerOpenUrl } from "@tauri-apps/plugin-opener";

/** 在系统浏览器打开外链（市场信息价格页等）。 */
export async function openExternal(url: string): Promise<void> {
  try {
    await openerOpenUrl(url);
  } catch {
    // 兜底：插件异常时退回 window.open（浏览器环境 / 权限缺失）
    window.open(url, "_blank", "noreferrer");
  }
}
