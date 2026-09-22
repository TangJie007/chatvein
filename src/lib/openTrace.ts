import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const LABEL = "trace";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function traceUrl(conversationId: string, turnId?: string | null): string {
  const params = turnId ? `?turn=${encodeURIComponent(turnId)}` : "";
  return `index.html#/trace/${encodeURIComponent(conversationId)}${params}`;
}

/** 打开（或聚焦）追踪窗口，并切到指定会话 / 轮次。 */
export async function openTraceWindow(conversationId: string, turnId?: string | null) {
  const payload = { conversationId, turnId: turnId ?? null };
  if (!inTauri()) {
    window.open(traceUrl(conversationId, turnId), "chatvein-trace");
    return;
  }
  const existing = await WebviewWindow.getByLabel(LABEL);
  if (existing) {
    await emitTo(LABEL, "trace-navigate", payload);
    await existing.show();
    await existing.setFocus();
    return;
  }
  const created = new WebviewWindow(LABEL, {
    url: traceUrl(conversationId, turnId),
    title: "追踪",
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    decorations: false,
    shadow: true,
    center: true,
  });
  created.once("tauri://error", (event) => {
    const message =
      event.payload instanceof Object && "payload" in event.payload
        ? String((event.payload as { payload?: unknown }).payload ?? "")
        : "";
    console.error("打开追踪窗口失败", message || event.payload);
  });
}
