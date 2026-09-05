# 决策笔记：对话气泡 Markdown 渲染（markdown-it）

状态：已落地

## 背景

助手回复含标题、列表、代码块等 Markdown，但气泡此前用 `whitespace-pre-wrap` 纯文本展示。design/08 已锁定渲染栈；需在 **app renderer** 落地，且不得把 markdown 依赖带进 `@chatvein/*`。

## 决策

- 新增 `app/src/renderer/lib/markdown.ts`：`markdown-it`（`html:false` / `linkify` / `breaks`）+ `highlight.js`（按需注册语言）+ `DOMPurify.sanitize`。
- 组件 `<MarkdownText>`：流式时 rAF 节流 + 配对符补全（围栏 / 行内 \` / `**`）；定稿立即全量 `render`。
- `ChatMessage`：`role=agent` 走 Markdown；用户气泡仍纯文本。依赖仅装在 `@electrum/chatvein`（app）。

## 备选方案

### 为什么不用一期 Shiki？

design/08 默认 Shiki。一期改用 **highlight.js**：同步、半截代码可高亮、包体与冷启动更轻；接口仍是 markdown-it `highlight` 回调，后续可换成 Shiki 而不改组件契约。

### 为什么不用 react-markdown / marked？

壳是 Vue；与 Cursor/VSCode 同系选 markdown-it。marked 插件与消毒链路不如既定方案清晰。

### 为什么不做增量解析？

markdown-it 无状态整篇解析；对话气泡体量小，全量重解析足够，避免增量 AST 复杂度。

## 影响

- 收益：助手消息可读性对齐产品预期；XSS 经 `html:false` + DOMPurify 双保险。
- 代价：正文 token 流式 UI 尚未接事件时，`streaming` 预留；高亮语言集按需扩展；观感略逊 Shiki。
- 后续：接 `token` / `message_done` 时把 `streaming` 接到气泡即可。
