# 对话 Markdown

助手消息用 [Streamdown](https://streamdown.ai)（`streamdown` + `@streamdown/code` + `@streamdown/cjk`）渲染，不用 `markdown-it` 再包一层 React。

- 它按块解析，流式追加时未闭合的代码围栏、强调标记不会把后面的正文打乱。
- 自带 `rehype-sanitize` / `rehype-harden`，代码高亮走 Shiki（`@streamdown/code`）。
- `@streamdown/cjk` 修正中文标点贴着 `**` 时加粗失效，以及链接吞掉句号。
- 样式依赖 Tailwind v4 的 `@source`，色名映射在 `src/styles.css`。
