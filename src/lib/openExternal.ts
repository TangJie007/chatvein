import { openUrl } from "@tauri-apps/plugin-opener";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 用系统默认浏览器打开外部链接。
 * Tauri WebView 会拦截 window.open，必须走 opener 插件；其余环境回退 window.open。
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  if (inTauri()) {
    try {
      await openUrl(url);
      return;
    } catch (err) {
      console.error("openUrl 失败，回退 window.open", err);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
