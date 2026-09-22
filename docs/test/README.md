# Agent 工具测试集（人工评测）

在 ChatVein 里用**自然语言**测「Agent 会不会正确选型并调用工具」。  
不是 `pytest`，而是对着 UI / Trace 验收。

## 怎么测

1. 新开一个会话（干净 `output/` / `runs/`）。
2. 把用例里的「用户输入」原样发给 Agent。
3. 打开 Trace / 工具轨迹，对照「期望工具」与「验收」。
4. 在下表勾选通过与否。

| 状态 | 含义 |
| --- | --- |
| ✅ | 选型正确、参数合理、结果可用 |
| ⚠️ | 能完成任务但绕路/多轮空转 |
| ❌ | 未调到工具 / 路径错 / 会话根丢失 / 胡编结果 |

## 目录

| 文件 | 分组 |
| --- | --- |
| [01-fs.md](./01-fs.md) | `mcp-fs` 文件系统 |
| [02-core.md](./02-core.md) | `core` 时间 / 计算 / 本机 |
| [03-web.md](./03-web.md) | `mcp-web` 搜索与抓取 |
| [04-sqlite.md](./04-sqlite.md) | `mcp-sqlite` 只读库 |
| [05-kb.md](./05-kb.md) | `mcp-kb` 知识库 |
| [06-sandbox.md](./06-sandbox.md) | `mcp-codesandbox` 代码沙箱 |
| [07-shell.md](./07-shell.md) | Bash / PowerShell |
| [08-ip.md](./08-ip.md) | `mcp-ip` 归属地 |
| [09-ocr.md](./09-ocr.md) | `mcp-ocr` 识字 |
| [10-browser.md](./10-browser.md) | `mcp-browser`（需本机浏览器） |
| [11-combo.md](./11-combo.md) | 多工具组合 / 回归坑 |

## 通用验收要点

- **会话内路径**：产物应在 `output/`（相对路径如 `output/xxx.txt` 即可）；不要写到主空间根。
- **扩展名**：用户说了 `.txt` / `.md` 等，文件名必须带上。
- **会话外路径**：须绝对路径 + 确认弹窗；相对 `../` 应被拒绝。
- **会话 ContextVar**：ReAct 超时线程须继承沙箱（否则会报「当前没有会话工作区」）。
- **停手**：结果够了应作答，不要同参空转。

工作区权威说明见 [`../workspace.md`](../workspace.md)；工具矩阵见 [`../agents.md`](../agents.md)。
