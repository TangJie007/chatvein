import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 每个用例后卸载组件树，避免跨用例的状态泄漏。
afterEach(() => cleanup());

// jsdom 的 crypto 可能缺少 randomUUID（useChatSession 发送时用它生成乐观气泡 id）。
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: () => "00000000-0000-4000-8000-000000000000",
  });
}
