# `@chatvein/mcp-openfile-sdk`

MCP server：在系统文件管理器中打开文件夹。

- 传入**目录** → 打开该目录
- 传入**文件** → 打开该文件所在目录

## CLI

```bash
# 限制在允许目录内（推荐，与 workspace jail 对齐）
npx @chatvein/mcp-openfile-sdk /path/to/workspace

# 或 build 后
node dist/cli.js /path/to/workspace
```

未传允许目录时，可打开任意已存在路径（仅适合本机调试；Chat 默认会传入 `workspaceRoot`）。

## Inspector

```bash
pnpm --filter @chatvein/mcp-openfile-sdk inspect
# 或：pnpm mcp:inspect:openfile
# 带 jail：mcp-inspector node dist/cli.js D:/Chatvein/workspaces/my-ws
```

## Cursor / MCP 配置示例

```json
{
  "mcpServers": {
    "openfile": {
      "command": "node",
      "args": [
        "path/to/packages/mcps/openfile/dist/cli.js",
        "D:/Chatvein/workspaces/my-ws"
      ]
    }
  }
}
```

## 工具

| 名称 | 说明 |
| --- | --- |
| `open_folder` | 打开路径对应文件夹（文件则取其父目录） |
| `list_allowed_directories` | 列出 CLI 传入的允许根目录 |

## 库 API

```ts
import { resolveFolderToOpen, openFolderInOs } from '@chatvein/mcp-openfile-sdk'

const { folder, kind } = await resolveFolderToOpen('./src/index.ts')
await openFolderInOs(folder) // kind === 'file' 时 folder 为父目录
```
