# ReAct 空转护栏与图步数

## 分工

| 层 | 作用 | 谁先刹车 |
| --- | --- | --- |
| `ToolCallLimit` / `ModelCallLimit` | 控空转（search / 工具 / 模型次数） | **主刹车** |
| `recursion_limit` | LangGraph 图步安全网 | 须 **大于** 上面预算，否则误伤正常多跳 |

## 工具次数（LangChain 文档示例）

| 护栏 | medium / hard |
| --- | --- |
| `web_search` | 3 |
| 全体工具 | 10 |
| 模型调用（触顶 end） | medium 12 / hard 16 |
| 同参去重 | 保留 |

## 图步公式

```text
recursion_limit = 2 × max_model_calls + margin
```

实现：`react_recursion_limit()` / `RECURSION_LIMIT_MARGIN`（`graphs/common.py`）。

- **`2 ×`**：`create_agent` 一轮约「模型节点 + 工具节点」各计 1 步。
- **`margin = 10`**：为 middleware、并行 tool 等额外节点预留。取值参考社区常见
  `create_agent` 默认量级（约 25）相对「纯 2×轮次」多出的缓冲；过小会像旧
  medium=`12` 一样，天气「定位 + 搜索」就撞限。

当前推导：

| 档 | max_model_calls | recursion_limit |
| --- | --- | --- |
| medium | 12 | **34** |
| hard | 16 | **42** |

调模型上限时只改 `_MAX_MODEL_CALLS`，图步数自动跟公式走，勿再手写偏小常量。
