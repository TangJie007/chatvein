# Agent 图设计

ChatVein 对话 Agent 用 **LangGraph** 编排：总图先理解并判难度，再进入 **simple / medium / hard** 三张子图。全程默认走**主模型**（`ModelsService.get_runtime_config()` → `agents.llm.get_chat_model`）；角色可覆盖模型与生成参数。

功能清单见 [`features.md`](./features.md)；工具目录见 [`agents.md`](./agents.md)。

---

## 1. 设计目标

| 目标 | 做法 |
| --- | --- |
| 按任务成本分流 | simple 不挂工具；medium 少量工具；hard 规划 + 更高递归 + 结果核对 |
| 工具面可控 | 先选型缩集，再 `create_agent`；角色可再收窄分组 |
| 复杂任务可核对 | hard 用结构化 success_criteria，对照回复与 tool_trace |
| 可观测 | 节点写 `trace.note` / `span`；追踪窗展示 path |
| 可离线降级 | 无 API Key 时启发式路由与直接 `run_tools`，不拖垮会话 |

**不在图内做的事**：流式 token 推送、HITL 审批节点（Bash 确认在工具层）、多智能体并行分发。

---

## 2. 总览

```text
用户原文
    │
    ▼
┌───────────────────────────────────────┐
│  chat_pipeline（agents/graphs/pipeline）│
│                                         │
│  START → understand                     │
│            │                            │
│            ├─ simple → simple 子图 → END│
│            ├─ medium → medium 子图 → END│
│            └─ hard   → hard 子图   → END│
└───────────────────────────────────────┘
    │
    ▼
run_pipeline 组装 reply / difficulty / tool_trace / trace …
    │
    ▼
HTTP 落库 + 会话 workspace 洞察
```

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| 入口 | `agents/service.py` → `run_chat` | 对外唯一聊天入口 |
| 总图 | `agents/graphs/pipeline.py` | understand + 条件边分流 |
| 理解 | `agents/router.py` | structured：改写 + 难度 |
| simple | `agents/graphs/simple.py` | 无工具直答 |
| medium | `agents/graphs/medium.py` | 选型 → ReAct |
| hard | `agents/graphs/hard.py` | plan → 选型 → ReAct → verify |
| 选型 | `agents/tool_selector.py` | 候选工具缩集 + 角色白名单展开；允许空工具集（直答） |
| 状态 | `agents/graphs/state.py` | `ChatState` TypedDict |
| 记忆 | `agents/memory.py` | 历史 → LangChain messages |
| 共用 | `agents/graphs/common.py` | `last_text` / `allowed_from_role` / `build_react_graph` / `merge_tool_traces` |

---

## 3. 共享状态 `ChatState`

```text
message          用户原文（HTTP 传入）
rewritten        改写后意图（下游只用这个）
difficulty       simple | medium | hard
route_reason     路由理由
history          短期记忆（不含本轮用户句）
role             RolesService.get_runtime（可空）

selected_tools / candidate_tools / tool_plan_reason
reply / used_llm / tool_trace

# hard 专用
plan / plan_text
verify_passed / verify_reason / verify_focus / verify_round
```

条件边只读 `difficulty`；子图读写选型与回复字段。角色提示通过 `_merged_system(role, BASE)` 叠在挡位 system **之上**，避免丢掉工作区 / 工具约定。

---

## 4. 总图节点

### 4.1 `understand`

1. 调用 `router.understand(message)`。
2. 主模型 structured（`UnderstandDecision`）：
   - `rewritten`：清晰中文意图（不编造新需求）
   - `difficulty`：`simple` | `medium` | `hard`
   - `reason`：简短理由
3. 写入 state，并 `note(route=…)` 供追踪。

**难度语义（提示词约定）**

| 档位 | 典型场景 |
| --- | --- |
| simple | 闲聊、寒暄、单句知识问答，通常不需要本地工具 |
| medium | 一次或少量工具：文件、搜索、计算、只读 SQL、知识库、沙箱跑一小段 Python |
| hard | 多步、要规划、多次工具或交叉验证（如据报错反复改代码再执行） |

**离线**：无模型时不改写；启发式命中工具 → `medium`，否则 `simple`（不会自动标 hard）。

### 4.2 条件边 `_route`

```text
difficulty == "hard"   → hard
difficulty == "medium" → medium
否则                   → simple
```

### 4.3 挡位节点

| 节点 | 调用 | system |
| --- | --- | --- |
| `simple` | `simple_mod.run_simple` | `_merged_system(role, SIMPLE_SYSTEM)` |
| `medium` | `medium_mod.run_medium(..., name="medium_react")` | `_merged_system(role, MEDIUM_SYSTEM)` |
| `hard` | `hard_mod.run_hard(..., name="hard_react")` | `_merged_system(role, HARD_SYSTEM)` |

挡位结果经 `_branch_result` 归一为 `reply / selected_tools / candidate_tools / tool_plan_reason / used_llm / tool_trace`；hard 额外可带 `plan`、`verify_reason`。

### 4.4 收尾

`run_pipeline` 在 `tracing` 上下文中 `invoke` 总图，再 `complete(...)` 生成整轮 `trace`（含 path：理解 → 路由 → 直答或 规划/筛选/ReAct/核对）。

---

## 5. simple 子图

```text
START → chat → END
```

- 输入：改写文本 + `history`（`to_lc_messages`）+ system。
- 节点：单次 `model.invoke([SystemMessage, …messages])`。
- 无工具、无选型。
- 无模型：返回「（离线）…」。

编译名：`simple_chat`。

---

## 6. medium 子图

```text
START → select_tools → react → END
```

编译名：`medium_pipeline`；内部 ReAct agent 名：`medium_react`。

### 6.1 `select_tools`

1. `tool_selector.select_tools(rewritten, allowed=role.tools)`。
2. `allowed` 经 `expand_allowlist`：分组 id（如 `mcp-web`）展开为组内全部工具名；也可直接写工具名。
3. 空 `allowed` / 无角色 → **不限制**，候选 = 当前已注册全部工具。
4. 主模型 structured 选出子集；失败或离线走 `heuristic_tool_names`。
5. **允许空名单**：模型或启发式认为无需工具时，不强制塞默认工具；`react` 以无工具 Agent 直答。
6. 旧角色勾选（如 WorkBuddy 演示 id）无法匹配注册表时，回落为全部可用工具并在 reason 中注明。

`resolve_tools([])` 返回空列表，**不再**静默展开为全量工具。

### 6.2 `react`

1. `resolve_tools(selected_names)`；名字无效时回落全量（registry 行为）。
2. `create_agent(model, tools, system_prompt=MEDIUM_SYSTEM…)`。
3. `invoke({messages: history + HumanMessage(rewritten)})`，`recursion_limit=12`。
4. 抽最后文本为 `reply`；`extract_tool_trace` 记工具调用。
5. 无模型：跳过 LLM，直接 `run_tools(text, names)`。

适合「一两跳工具就能答」的任务；上限 12 防止空转。

---

## 7. hard 子图

```text
START → plan → select_tools → react → verify
                      ▲                    │
                      └──── 未通过且未达上限 ──┘
                                         │ 通过或达上限
                                         ▼
                                        END
```

编译名：`hard_pipeline`；内部 ReAct agent 名：`hard_react`。

相对 medium 的差异：

| 维度 | medium | hard |
| --- | --- | --- |
| 规划 | 无 | 结构化 `TaskPlan` |
| 选型输入 | 仅改写文本 | 改写 + 计划文本（+ 核对缺口） |
| ReAct 递归 | 12 | 28 |
| 结束后 | 直接 END | `VerifyDecision`；可回环再选型/执行；`tool_trace` **跨轮累计** |
| 回环上限 | — | `_MAX_VERIFY_ROUNDS = 2` |

### 7.1 `plan`（结构化）

```text
TaskPlan:
  goal                 目标
  steps[]              有序步骤
  success_criteria[]   可核对的完成标准
  risks[]              卡点 / 需交叉验证处
```

- 写入 `plan`、`plan_text`（给人看的【执行计划】块），`verify_round=0`。
- 离线或失败：默认两步计划 + 通用成功标准。

### 7.2 `select_tools`

与 medium 相同选择器；查询串拼上 `plan_text`，若有 `verify_focus` 再追加「上一轮核对未通过，请优先补：…」。

### 7.3 `react`

- system = `HARD_SYSTEM`（或已 merge 的角色+HARD）再附 `plan_text`。
- 用户消息 = 改写 + 计划 +（可选）缺口焦点。
- `recursion_limit=28`，便于「改代码 → 跑 → 看 stderr → 再改」。

### 7.4 `verify`（结构化）

```text
VerifyDecision:
  passed       是否满足成功标准
  reason       理由
  missing[]    缺口
  next_focus   下一轮优先补什么
```

输入：计划目标/标准、助手 `reply`、tool_trace 摘要。

**收束规则**

1. `passed=true` → 结束。
2. `passed=false` 且 `verify_round < 2` → 写 `verify_focus`，回到 `select_tools`。
3. 已达 2 轮仍未通过 → **强制视为通过并收束**（避免无限循环），理由中注明「已达核对上限」。
4. 核对调用失败 → 采用当前回复并结束。
5. 离线：有非空 reply 即通过。

### 7.5 条件边 `after_verify`

```text
verify_passed 或 round >= 2 → end
否则 → select_tools
```

---

## 8. 接线：HTTP → 图 → 落库

```text
POST /api/chat
  message, conversation_id?, role_id?, skills?
        │
        ▼
open_for_chat → 确保会话 + workspace_dir
short_term_memory(limit ≈ role.memory × 2)
RolesService.resolve_for_chat
skill_prompt_blocks(skills) → 并入 role.prompt
use_conversation_sandbox(workspace_dir)   # 沙箱/文件工具绑本会话
        │
        ▼
run_chat → run_pipeline → LangGraph
        │
        ▼
save_exchange（主库消息 + route=difficulty）
record_turn（会话库消息 / tool_trace / 推理）
trace 按 turn_id 落会话库
返回 reply, difficulty, rewritten, tool_trace, workspace, turn_id, tokens…
```

要点：

- **原文入库**；改写只进 Agent，不替换用户气泡。
- **沙箱上下文**在图外用 contextvars 绑定，工具实现读当前会话目录。
- **Bash/PowerShell 确认**不在图节点里，在工具执行路径上挂起等待 UI。

---

## 9. 角色与技能如何进入图

```text
role.prompt  ─┐
skills.md    ─┼─→ role_runtime.prompt ─→ _merged_system(..., BASE_SYSTEM)
role.model_* ─┘                              │
role.tools   ──────→ select_tools(allowed=…) │
role.memory  ──────→ history 条数（HTTP 层）  │
                     get_chat_model(role=…) ←┘
```

| 字段 | 作用层 |
| --- | --- |
| `prompt` | 叠在挡位 system 前 |
| `tools` | medium/hard 选型白名单（分组或工具名） |
| `memory` | 短期记忆窗口（HTTP 计算 limit） |
| `model_id` / 温度等 | `get_chat_model` |
| `skills`（请求体） | 安装包 `SKILL.md` 文本并入 prompt |

`stream` / `json_mode` / `retries` 已持久化，当前同步 `/api/chat` **尚未**驱动图行为。

---

## 10. 追踪 path（与图对应）

`trace.recording._path(difficulty)` 生成展示用路径：

| 节点 id | 标签 | simple | medium | hard |
| --- | --- | --- | --- | --- |
| understand | 理解 | ✓ | ✓ | ✓ |
| route | 路由 | ✓ | ✓ | ✓ |
| simple | 直答 | ✓ | | |
| plan | 规划 | | | ✓ |
| select_tools | 筛选工具 | | ✓ | ✓ |
| react | ReAct / ReAct·复杂 | | ✓ | ✓ |
| verify | 核对 | | | ✓ |

运行时还有 `span("plan"|"select_tools"|"react"|"verify"|"simple")` 与 LLM/工具子步骤。

---

## 11. 关键参数一览

| 常量 | 位置 | 值 | 含义 |
| --- | --- | --- | --- |
| medium `_RECURSION_LIMIT` | `medium.py` | 12 | ReAct 图递归上限 |
| hard `_RECURSION_LIMIT` | `hard.py` | 28 | 复杂任务更多工具跳 |
| hard `_MAX_VERIFY_ROUNDS` | `hard.py` | 2 | 核对回环次数上限 |
| `_MAX_WEB_SEARCH` | medium/hard | 3 | 对齐 LangChain 文档 search `run_limit` |
| `_MAX_TOOL_CALLS` | medium/hard | 10 | 对齐 LangChain 文档全体工具 `run_limit` |
| `DEFAULT_HISTORY_LIMIT` | `memory.py` | 24 | 未传角色时的默认历史条数 |
| 角色 memory | HTTP | `memory × 2`，夹在 0…60 | 短期记忆条数 |

---

## 12. 扩展指引

| 需求 | 建议 |
| --- | --- |
| 新难度档 | 新子图模块 + pipeline 条件边 + router 枚举 + trace `_path` |
| hard 更强核对 | 调 `_MAX_VERIFY_ROUNDS`；或 verify 失败时强制重跑 sandbox 工具 |
| 人审节点 | LangGraph `interrupt` + 前端确认（与现有 Bash 审批可统一） |
| 流式 | 挡位 `react`/`chat` 改 `astream`；总图仍可同步选型 |
| 共享选型逻辑 | medium/hard 的 `select_tools_node` 已趋同，可再抽到 `graphs/common.py` |

改图时同步：`docs/agents.md` 摘要、本文件、`backend/tests/test_agent_graphs.py`、前端 `TraceWindow` 的 `STEP_LABEL`。

---

## 13. 相关源码速查

```text
backend/agents/
  service.py              run_chat
  router.py               understand
  tool_selector.py        select_tools / expand_allowlist
  memory.py               to_lc_messages
  llm.py                  get_chat_model / invoke_structured
  graphs/
    pipeline.py           总图
    simple.py / medium.py / hard.py
    state.py / common.py / tool_trace.py
backend/trace/            追踪记录与落库
backend/tests/test_agent_graphs.py
```
