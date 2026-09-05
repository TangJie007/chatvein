# @chatvein/mcp-modsearch-sdk

MCP：网页搜索 / 单页抓取。优先 [ModSearch](https://github.com/liustack/modsearch)（Firecrawl 免注册链 + 引擎故障转移），**搜索最终兜底 DuckDuckGo**；读页失败则 HTTP 纯文本兜底。

## Tools

| 工具 | 说明 |
|------|------|
| `web_search` | `-q` 搜索；失败 → `duck-duck-scrape` |
| `read_page` | `-u` 抓取；失败 → `fetch` 去标签 |

返回 JSON，形状对齐 ModSearch [output schema](https://github.com/liustack/modsearch/blob/HEAD/skills/modsearch/references/output-schema.zh-CN.md)，并附加 `fallback` 字段。

## CLI

```bash
node dist/cli.js
node dist/cli.js --timeout=90000 --no-fallback
```

## Inspector

```bash
pnpm --filter @chatvein/mcp-modsearch-sdk inspect
# 或：pnpm mcp:inspect:modsearch
mcp-inspector --cli node dist/cli.js --method tools/list
```

## Chatvein

目录 id：`mcp_modsearch` → 自动挂 server 名 `modsearch`（工具前缀 `modsearch__*`）。
