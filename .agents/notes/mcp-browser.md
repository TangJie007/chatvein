# mcp-browser（进程内 Playwright）

## 为何不用 `@playwright/mcp` 子进程

与 `mcp-fs` / `mcp-web` 一致：桌面端走 `builtin://` 进程内 LangChain `@tool`，避免再依赖 Node/`npx`、多一份 MCP 传输与打包体积。工具名与参数对齐上游 Core + Tabs，语义上仍是「Playwright MCP 能力」。

## 为何不打包浏览器二进制

Chromium 等本体数百 MB，对桌面安装包不可接受。只依赖 `playwright` Python 包；用户本机执行 `playwright install chromium`（或设 `CHATVEIN_BROWSER_EXECUTABLE`）。探测失败则不注册 `mcp-browser` 分组。

## 安全偏离（长期）

不注册 `browser_run_code_unsafe`（上游标明 RCE-equivalent：在 Playwright **服务端进程**执行任意 JS）。`browser_evaluate` 仅在页面上下文执行。上传与截图落盘限制在主空间 / `browser-output`。

## 后期需要补：`--caps`

上游官方用 `--caps=` / `PLAYWRIGHT_MCP_CAPS` **opt-in**；市面 `@playwright/mcp` 已实现，ChatVein 首版故意不对齐。

| cap | 上游能力（摘要） | 补齐条件 |
| --- | --- | --- |
| `vision` | 坐标鼠标（`browser_mouse_*_xy` 等），偏截图驱动 | 有真实「canvas / 无 a11y tree」场景；需提示模型会吃截图 |
| `pdf` | `browser_pdf_save` | 导出需求明确；落盘仍限主空间 |
| `devtools` | 开发者工具类 | 调试向；注意信息面扩大 |
| `storage` | 存储相关 | 读本机态风险，设置页单独开关 |
| `network` | 网络相关（超出已有 console/network 列表时） | 与现有 `browser_network_*` 去重后再扩 |
| `testing` | 测试断言 | 偏 harness，非日常 Agent 主路径 |

补齐原则：设置页按 cap 开关 + 缺依赖时灰掉；**不要**借 caps 顺带引入 `browser_run_code_unsafe`。产品 backlog 总表见 `docs/agents.md`「当前不做、后期需要补」。
