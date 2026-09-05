# 决策笔记：MCP modsearch（ModSearch + DuckDuckGo 兜底）

状态：已落地

## 背景

Chat 需要稳定联网检索与单页抓取。[ModSearch](https://github.com/liustack/modsearch) 提供免注册 Firecrawl 链与多引擎故障转移，但 CLI 失败/额度耗尽时仍需本地兜底。能力应按 MCP-first 挂到 L3，而不是再绑一层 community `duckduckgo_search` 作为默认。

## 决策

- 新增 `@chatvein/mcp-modsearch-sdk`（`packages/mcps/modsearch`）。
- 工具：`web_search`（ModSearch `-q` → 失败则 `duck-duck-scrape`）、`read_page`（ModSearch `-u` → 失败则 HTTP 去标签文本）。
- 依赖 `@liustack/modsearch` 包内 CLI（`dist/main.js`），不另造搜索引擎。
- `@chatvein/tools` 目录项 `mcp_modsearch`；`withDefaultMcpModsearch` 自动注入（不依赖 workspace）。
- community `duckduckgo_search` 改为 `defaultEnabled: false`（兜底已进 MCP）。

## 备选方案

### 为什么不直接把 `@liustack/modsearch` 当 LangChain Tool？

与 filesystem/openfile 一致走 MCP，Cursor/CLI/Electron 可共用同一 server；输出契约保持 ModSearch JSON。

### 为什么读页兜底不用 DuckDuckGo？

DDG 是搜索引擎，不适合任意 URL 抓取；读页失败用 HTTP 纯文本即可。

### 为什么不把 DuckDuckGo 塞进 ModSearch 引擎链？

上游引擎表不含 DDG；在 MCP 层做「链失败后的最后一跳」更清晰，也不改 upstream 配置语义。

## 影响

- 默认对话在 `tools=full` 时出现 `modsearch__web_search` / `modsearch__read_page`。
- CodeReview 白名单加入 `mcp_modsearch`。
- 需联网环境；ModSearch 冷启动可能较慢（默认超时 60s 后走 DDG）。
