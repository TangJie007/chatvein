# packages/mcps

Chatvein 自研 MCP server 包（workspace：`packages/mcps/*`）。由 `@chatvein/tools` 按目录自动挂到 L3；也可用官方 [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) 单独调试。

| 包 | 工具前缀 | 用途 |
|----|----------|------|
| `@chatvein/mcp-openfile-sdk` | `openfile__*` | 系统文件管理器打开文件夹 |
| `@chatvein/mcp-modsearch-sdk` | `modsearch__*` | ModSearch 联网；搜索兜底 DuckDuckGo |
| `@chatvein/mcp-vmsandbox-sdk` | `vmsandbox__*` | 绑定 workspace；NodeVM 跑 scripts；可信包安装 |

## Inspector

根目录已装 `@modelcontextprotocol/inspector`（devDependency）。先 build 再开 UI：

```bash
# 空 Inspector（在 UI 里选 server）
pnpm mcp:inspect

# 直连本仓 MCP
pnpm mcp:inspect:openfile
pnpm mcp:inspect:modsearch
pnpm mcp:inspect:vmsandbox
pnpm mcp:inspect:filesystem     # 官方 FS，默认 jail=.

# 或在子包内
pnpm --filter @chatvein/mcp-openfile-sdk inspect
pnpm --filter @chatvein/mcp-modsearch-sdk inspect
pnpm --filter @chatvein/mcp-vmsandbox-sdk inspect
```

浏览器一般打开 `http://127.0.0.1:6274`。CLI 列工具：

```bash
mcp-inspector --cli node packages/mcps/vmsandbox/dist/cli.js --method tools/list
```

设计见 [`docs/design/12-Agent工具层.md`](../../docs/design/12-Agent工具层.md)、[`13-Prompt-MCP-Tool挂载.md`](../../docs/design/13-Prompt-MCP-Tool挂载.md)。
