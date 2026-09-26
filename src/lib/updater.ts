import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** 是否运行在 Tauri 桌面容器里（浏览器预览时无更新能力，静默降级）。 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function currentVersion(): Promise<string> {
  if (!isTauri()) return "0.1.0";
  return getVersion();
}

export type UpdateCheckResult =
  | { available: false }
  | { available: true; update: Update };

/** 检查更新；未配置 endpoint / 网络失败时抛错，由调用方展示。 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isTauri()) {
    throw new Error("更新功能仅在桌面应用中可用（浏览器预览不可用）");
  }
  const update = await check({ timeout: 30_000 });
  return update ? { available: true, update } : { available: false };
}

/** 下载并安装；onProgress 为 0-100 下载进度。Windows 安装完成后应用自动退出并启动安装器。 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (percent: number) => void
): Promise<void> {
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress?.(0);
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      if (total > 0) {
        onProgress?.(Math.min(100, Math.round((received / total) * 100)));
      }
    } else if (event.event === "Finished") {
      onProgress?.(100);
    }
  });
  // Windows：install 完成即退出并拉起安装器；macOS / Linux 需手动重启生效。
  if (!/windows/i.test(navigator.userAgent)) {
    await relaunch();
  }
}
