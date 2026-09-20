# Agent 流水线：改写 + 难度图

全程使用 **主模型**（`ModelsService.get_runtime_config()` → `agents.llm`）。

| 包 | 职责 |
| --- | --- |
| `agents/router.py` | 一次 structured：`rewritten` + `difficulty` |
| `agents/tool_selector.py` | 只缩工具集（吃改写后文本） |
| `agents/service.py` | 按难度进不同图 |
| `mcps/` | 工具注册 + 按名 invoke |

```text
原文
  → understand（改写 + simple|medium|hard）
       ├─ simple  → 直接对话（主模型）
       ├─ medium  → tool_selector → create_agent（简洁 system）
       └─ hard    → tool_selector → create_agent（多步/核对 system）
```

落库 `Message.route` 写入难度档位；HTTP 额外返回 `rewritten` / `difficulty`。
原文仍作为用户消息入库，改写只供下游 Agent 使用。
