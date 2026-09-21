# Hard 挡位独立图

正式设计文档见 [`docs/agent-graphs.md`](../../docs/agent-graphs.md) §7。

摘要：

```text
plan → select_tools → react → verify
                 ↑______________|  (未通过且未达上限则回环)
```

| 节点 | 作用 |
| --- | --- |
| `plan` | 结构化：goal / steps / success_criteria / risks |
| `select_tools` | 带计划文本选型；尊重角色 `tools` 分组白名单 |
| `react` | `create_agent`，`recursion_limit=28`，计划注入 system |
| `verify` | 对照成功标准与 tool_trace；最多 2 轮回环后收束 |

入口：`agents.graphs.pipeline._hard_node` → `hard.run_hard`。
