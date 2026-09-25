# 团队模式与群组注册 · 实现设计

本设计覆盖本轮落地的四块能力：**角色一句话描述**、**会话群组成员注册**、**团队模式**（主 agent 花名册注入 + `delegate_to_agent` 工具 + 按 `actor_id` 隔离的独立短期记忆）、以及 **UI 气泡完整上下文 + 耗时展示**。配套 `features.md`（已实现清单）与 `agent-graphs.md`（Agent 图设计）。

> **模块边界**：群组 / 团队功能自 **v12** 起独立成 `backend/chats/` 模块，与 `conversations` 解耦。
> - `conversations`：纯会话管理（CRUD、消息、技能、工作区、短期记忆存储）。
> - `chats`：群组成员花名册（独立表 `chat_groups`）+ 团队装配（主 agent 花名册注入 + ContextVar）。
> - `agents/delegation.py`：`delegate_to_agent` 工具（挂载点仍由 medium/hard 的 react 节点按 `_team_mode` 挂载）。
> 单向依赖：`chats → conversations`（仅查询会话存在性）；`conversations` 不依赖 `chats`。

---

## 1. 角色一句话描述（description）

### 目标
角色列表 / 群组花名册需要一个一行可读的用途说明，避免只看到名字与模型。

### 数据流
```
RolesView 表单 → CreateRoleDto/UpdateRoleDto.description
    → roles.repository 整行读写
    → RoleResponseDto.description → rolesStore → 列表副标题
RolesService.get_runtime() 透传 description → 花名册注入（第 3 节）
```

### 改动点
| 层 | 位置 | 说明 |
| --- | --- | --- |
| 实体 | `roles/entity/entity.py` | `Role` 增加 `description: str = ""`（`max_length=200`） |
| DTO | `roles/entity/dto.py` | `CreateRoleDto` / `UpdateRoleDto` 增加可选 `description`；`RoleResponseDto` 增加必填 `description` |
| Service | `roles/service.py` | `create_role` / `update_role` 写入并 `strip()`；`to_response` / `get_runtime` 透传 |
| 迁移 | `db.py` | `SCHEMA_VERSION` 升到 **10**，`_ensure_roles_description_column()` 补列（旧库） |
| 前端 | `src/api.ts` / `rolesStore.ts` / `RolesView.tsx` | 类型、`makeNewRole`、表单「角色描述」输入框、列表副标题优先显示描述 |

---

## 2. 会话群组成员注册（chats 模块）

### 目标
会话记录一组参与角色 id（JSON 列表），为团队模式的「花名册」提供持久化来源；支持补注册、随消息透传。

### 数据模型（v12 起独立表）
`chat_groups` 表（`chats` 模块专属）：

| 列 | 说明 |
| --- | --- |
| `conversation_id` | 主键，外键 `conversations.id ON DELETE CASCADE`（会话删除自动清理） |
| `members` | JSON 文本：角色 id 列表，如 `["r_code_review","r_docs"]` |
| `created_at` / `updated_at` | 时间戳 |

v11 及更早的 `conversations.group_members` 列在 v12 迁移中数据搬入本表后删除，`conversations` 不再感知群组概念。

### 两种注册路径
1. **补注册**：`POST /api/chats/{id}/group-members`（`GroupMembersDto`）；读取 `GET /api/chats/{id}/group-members`。
2. **随消息透传**：`POST /api/chat` 的 `ChatRequest.group_members` 非空时，`_chat_turn` 在落库前调用 `chats_service.register_group_members` 合并去重。

合并语义：`ChatGroupsRepository.merge_members` 读取现有列表 + 新列表 → 清洗保序去重 → 回写（不覆盖，防前端传错丢历史）。

### 改动点
| 层 | 位置 | 说明 |
| --- | --- | --- |
| 实体 | `chats/entity/entity.py` | `ChatGroup` 表（`conversation_id` 外键级联） |
| DTO | `chats/entity/dto.py` | `GroupMembersDto`、`ChatGroupRecord` |
| Repository | `chats/repository.py` | `_decode_members` / `_encode_members`；`get_members` / `merge_members` |
| Service | `chats/service.py` | `get_group_members` / `register_group_members`；`assemble_team`（第 3.1 节） |
| Controller | `chats/controller.py` | `GET/POST /api/chats/{id}/group-members`（查询会话存在性 404） |
| 模块 | `chats/module.py` | `chats_router(prefix=/api/chats)` + `chats_service` 单例 |
| 入口 | `main.py` | 挂载 `chats_router`；`ChatRequest.group_members`；`_chat_turn` 随消息注册 |
| 迁移 | `db.py` | `SCHEMA_VERSION` 升到 **12**，`_split_group_members_to_chat_groups()`（搬数据 + 删旧列） |
| 前端 | `src/api.ts` | `registerGroupMembers` / `getGroupMembers` 指向 `/api/chats`；`ConversationRecord` 移除 `group_members`；`sendChat` 透传 |

---

## 3. 团队模式（Team Mode）

### 触发条件
`POST /api/chat` 携带 `group_members`（非空、且去掉主角色 id 后至少有一个成员）即视为团队模式。主 agent 即当前绑定的角色（协调者），成员为花名册中的其余角色。

### 3.1 主 agent 花名册注入（chats 模块收口）
`main._chat_turn` 只调用一行 `role_runtime = chats_service.assemble_team(role_runtime, req.group_members, workspace_dir=...)`，内部：
1. 遍历 `req.group_members`，`RolesService().get_runtime(rid)` 取成员（名字 + 一句话描述 + role id），剔除主 agent 自己。
2. 生成花名册文本块，**追加到主 agent 的 role prompt 末尾**：
   - 列出可协作成员；
   - 提示：任务适合分工时用 `delegate_to_agent` 派发并汇总；
   - **提示：任务量小、不需要分工时直接自己完成，不必派发**（小任务短路，见 3.4）。
3. 在 `role_runtime` 上打 `_team_mode: True` + `_roster`，medium/hard 的 react 节点据此挂工具。
4. `set_team_context({workspace_dir, roster})` 写入 ContextVar，供 `delegate_to_agent` 工具读取。

### 3.2 `delegate_to_agent` 工具
- 位置：`backend/agents/delegation.py`（新文件），`@tool("delegate_to_agent")`，同时导出 `DELEGATE_TOOL` 供挂载。
- 入参：`role_id`（花名册成员）、`task`（子任务）、`instruction`（可选约束）。
- 执行流程：
  1. 读团队上下文；校验 `role_id ∈ roster`（不在花名册直接返回可用成员列表）。
  2. `RolesService().get_runtime(role_id)` 取成员运行时；无模型返回错误。
  3. **独立短期记忆**：`short_term_memory(workspace_dir, actor_id=role_id, limit≈memory×2)` —— 只取该成员名下历史。
  4. 用成员自己的模型 `get_chat_model(role=member_runtime)` + 成员自己的工具 `resolve_tools(member_tools + ALWAYS_ON_TOOLS)` 构建子 agent（`build_react_graph`，medium 量级护栏）。
  5. 跑一轮 ReAct，取 `last_text` 作为成员回复。
  6. `record_turn(actor_id=role_id)` 把「派发任务 + 成员回复」写回成员名下 → 形成成员独立记忆链。
- **任务拆分**：主 agent 可按领域给每个子任务挑选最合适的成员，为每个子任务各调用一次 `delegate_to_agent`（可连续多次、派发给不同成员），最后汇总各成员回复。
- **防递归**：子 agent 只挂成员自身工具 + 常驻工具，**不挂** `delegate_to_agent`。
- 挂载点：`agents/graphs/medium.py` / `hard.py` 的 `react_node`，当 `role._team_mode` 时把 `DELEGATE_TOOL` 追加进工具列表（`tools = [*tools, DELEGATE_TOOL]`）。未开启团队模式时不会挂载，不影响单角色会话。

### 3.3 按 actor_id 隔离的独立短期记忆
- `session_store.list_messages(db, *, limit, actor_id=None)`：`actor_id` 非空时 `WHERE actor_id = ?`，只取该角色名下消息。
- `conversations.service.short_term_memory(..., actor_id=None)` 透传。
- `conversations.service.record_turn(..., actor_id=None)`：用户/助手两条消息都带 `actor_id` 写入。
- 主 agent 本轮自身的历史仍走全量（`main._chat_turn` 的 `history` 不变），成员各自通过 delegate 时取自己名下记忆 → 互不串线。

### 3.4 小任务主 agent 直接完成（不派发）
两层约束：
1. **prompt 级**：花名册注入块明确写「任务量小、不需要分工时，直接自己完成即可，不必派发」。
2. **工具级**：`delegate_to_agent` 的 docstring 同样强调「适合分工时派发；小任务直接完成」。工具是可选调用，由主 agent 自行判断，模型默认不会为了用工具而用工具。

### 边界与限制
- 主 agent 无模型时团队模式退化：花名册仍注入但主 agent 走离线链路，成员不可被有效派发（成员无模型时工具返回错误说明）。
- 成员角色 `tools` 为空时只挂常驻工具（`ALWAYS_ON_TOOLS`）。
- 嵌套派发（成员再派发给其他成员）不支持：子 agent 不挂 `delegate_to_agent`。

---

## 4. UI：气泡完整上下文 + 耗时展示

### 4.1 上下文百分百完整展示
`MarkdownMessage.tsx` 移除 `codeBlockMaxHeight={320}` 上限：长代码块 / 表格不再被压缩出内部滚动条，随气泡整体展开，长内容依赖页面级 `ScrollArea` 滚动查看。

### 4.2 耗时显示在气泡后面
`ChatPanel.tsx`：把原来的「tokens · 耗时」元信息行从**气泡上方**移到**气泡内容之后**（footer），仍满足：
- 群组变体在行首显示回复者名字（`actor` / `roleName`）；
- 助手消息非流式时展示 `formatTokens(m.tokens)` · `formatDuration(m.durationMs)`；
- 数据源：`ChatMessage.tokens / durationMs`，由 `sendChat` 响应的 `tokens / duration_ms` 就地回填，或 `loadConversation` 从 `turn_traces` 补全（后端 `list_messages` 上限 500 条 + `apply_turn_metrics`）。

---

## 5. 数据库迁移汇总

| 版本 | 变更 | 函数 |
| --- | --- | --- |
| v10 | `roles.description` 列 | `_ensure_roles_description_column()` |
| v11 | `conversations.group_members` 列（JSON 文本，默认 `[]`） | `_ensure_conversations_group_members_column()` |
| v12 | 群组独立成 `chats`：新建 `chat_groups` 表，存量 `conversations.group_members` 数据搬入后删列 | `_split_group_members_to_chat_groups()` |

迁移幂等：`PRAGMA table_info` 探测列是否存在，不存在才 `ALTER TABLE`；`SCHEMA_VERSION` 与 `PRAGMA user_version` 对账，仅在落后时执行。v12 的 `_split` 同样先探测 `group_members` 列，v11 之前的库无该列则跳过。

---

## 6. 端到端时序（群组 @ 成员 → 主 agent 派发）

```
前端群组面板 @成员A,B + 发送
  → POST /api/chat { group_members:[A,B], append_user_message:true, ... }
  → _chat_turn：
      1. open_for_chat 建/取会话
      2. chats_service.register_group_members 随消息透传（合并去重落 chat_groups）
      3. chats_service.assemble_team：roster={A,B 名字/描述} → 注入主 agent prompt + _team_mode + set_team_context
      4. run_chat：medium/hard react_node 挂 delegate_to_agent
      5. 主 agent 判断：任务大 → delegate_to_agent(role_id=A, task)
           · 读 ContextVar 团队上下文
           · 取 A 的独立短期记忆（actor_id=A）
           · A 自己的模型+工具跑一轮 ReAct
           · record_turn(actor_id=A) 写回 → A 记忆链
           · 返回 [成员 A 的回复] 给主 agent
      6. 主 agent 汇总 → save_exchange 落主 agent 名下 → 响应 tokens/duration_ms
  → 前端就地回填各成员占位气泡 + 气泡后显示耗时
```

---

## 7. 相关文档
| 文档 | 内容 |
| --- | --- |
| [`features.md`](./features.md) | 已实现功能清单 |
| [`agent-graphs.md`](./agent-graphs.md) | Agent 图（三挡位 / 状态 / 接线） |
| [`short-term-memory.md`](./short-term-memory.md) | 短期记忆设计 |
| [`workspace.md`](./workspace.md) | 主工作区 vs 会话工作区 |
